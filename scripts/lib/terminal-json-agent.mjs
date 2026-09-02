import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const JSON_ONLY_SYSTEM =
  'You are WebXni Hermes Harness. ' +
  'CRITICAL OUTPUT RULE: Reply with exactly one JSON object matching the provided schema. ' +
  'No prose, no markdown, no code fences, no trailing text. ' +
  'Use the loaded Hermes skills for the requested role. Hermes is the only orchestrator/backend. ' +
  'Do not call another model provider or model CLI. Perform research through Hermes tools only.';

const BROKEN_BACKEND_TTL_MS = Number(process.env.AGENCY_BACKEND_FAILURE_TTL_MS || 0);
const TERMINAL_PROCESS_TIMEOUT_MS = Number(process.env.AGENCY_TERMINAL_TIMEOUT_MS || 15 * 60 * 1000);
const brokenBackends = new Map();
let geminiKeyCursor = 2;

// ── Backend availability ─────────────────────────────────────────────────────

function commandAvailable(cmd) {
  const r = spawnSync(cmd, ['--version'], { shell: false, env: process.env, stdio: 'ignore' });
  return r.status === 0;
}

function resolveHermesCommand() {
  const candidates = [
    process.env.HERMES_CLI_PATH,
    process.env.HERMES_COMMAND,
    process.env.HERMES_BIN,
    join(homedir(), '.local/bin/hermes'),
    join(process.env.HERMES_HOME || '', 'bin/hermes'),
    'hermes',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    if (commandAvailable(candidate)) return candidate;
  }
  return null;
}

function normalizeBackendName(backend) {
  const b = String(backend || '').trim().toLowerCase();
  if (b === 'hermes_cli' || b === 'hermes-agent' || b === 'hermes-agent-cli') return 'hermes';
  if (b === 'claude_code' || b === 'claude-code' || b === 'claude' || b === 'anthropic') return 'blocked';
  if (b === 'codex' || b === 'openai-codex') return 'blocked';
  if (b === 'openai_api' || b === 'openai-api' || b === 'openai') return 'blocked';
  if (b === 'gemini_cli' || b === 'gemini-cli' || b === 'gemini' || b === 'google') return 'hermes';
  return b;
}

function isBackendAvailable(backend) {
  const b = normalizeBackendName(backend);
  const brokenUntil = brokenBackends.get(b) || 0;
  if (brokenUntil > Date.now()) return false;
  if (brokenUntil) brokenBackends.delete(b);
  if (b === 'blocked') return false;
  if (b === 'hermes') return !!resolveHermesCommand();
  return false;
}

/**
 * Expand a priority list into an ordered list of available backends.
 * 'auto' expands to all available backends in default order.
 */
function completePriority(_backends, excludedBackends = []) {
  const excluded = new Set(excludedBackends.map(normalizeBackendName));
  return excluded.has('hermes') ? [] : ['hermes'];
}

function expandPriority(backends, excludedBackends = []) {
  const completeOrder = completePriority(backends, excludedBackends);
  const seen = new Set();
  const result = [];
  for (const backend of completeOrder) {
    if (!seen.has(backend) && isBackendAvailable(backend)) {
      seen.add(backend);
      result.push(backend);
    }
  }
  if (result.length === 0) {
    const tried = backends.join(', ');
    throw new Error(
      `No backend available. Tried: ${tried}. ` +
      'Check Hermes CLI / HERMES_CLI_PATH. OpenAI, Codex, Claude, and direct Gemini backends are disabled by policy.',
    );
  }
  return result;
}

function markBackendBroken(backend) {
  const normalized = normalizeBackendName(backend);
  // Hermes is the only approved executor. Do not suppress it for the rest of a
  // multi-slot batch after one transient model/validation failure; let slot-level
  // retry feedback correct the output instead.
  if (!normalized || normalized === 'blocked' || normalized === 'hermes' || BROKEN_BACKEND_TTL_MS <= 0) return;
  brokenBackends.set(normalized, Date.now() + BROKEN_BACKEND_TTL_MS);
}

// ── JSON helpers ─────────────────────────────────────────────────────────────

function extractJsonObject(text) {
  let s = text.trim();
  if (!s) return null;
  // Strip surrounding/leading markdown fences (grounded models love ```json).
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const start = s.indexOf('{');
  if (start === -1) return null;
  // Return the FIRST complete, balanced {...} object — robust against trailing
  // prose, repeated blocks, or stray ``` after the JSON (which broke a naive
  // first-{ to last-} slice on grounded Gemini output).
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return s.slice(start); // unbalanced (likely truncated) — let the parser try/repair
}

// Some models (notably grounded Gemini) emit raw control characters (literal
// newlines/tabs) INSIDE JSON string values, which is invalid JSON. Escape control
// chars only while inside a string literal so structural whitespace is preserved.
function sanitizeJsonControlChars(s) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && ch.charCodeAt(0) < 0x20) {
      out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : '';
      continue;
    }
    out += ch;
  }
  return out;
}

export class TerminalJsonAgentError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TerminalJsonAgentError';
    this.code = details.code || 'TERMINAL_JSON_AGENT_ERROR';
    this.backend = details.backend || null;
    this.command = details.command || null;
    this.exitStatus = details.exitStatus ?? null;
    this.signal = details.signal ?? null;
    this.stderrPreview = safePreview(details.stderr || '');
    this.stdoutPreview = safePreview(details.stdout || '');
    this.bodyPreview = safePreview(details.body || details.stdout || details.stderr || '');
    this.retryable = details.retryable === true;
    this.status = details.status || (this.retryable ? 'retryable_backend_error' : 'failed');
  }
}

function safePreview(value, max = 1200) {
  return String(value || '')
    .replace(/(sk-[A-Za-z0-9_-]{12,}|cfut_[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})/g, '[redacted]')
    .slice(0, max);
}

function isRetryableBackendBody(text) {
  const lower = String(text || '').toLowerCase();
  return lower.includes('api call failed')
    || lower.includes('api_call_failed')
    || lower.includes('rate limit')
    || lower.includes('quota')
    || lower.includes('temporarily unavailable')
    || lower.includes('timeout')
    || lower.includes('503')
    || lower.includes('502')
    || lower.includes('429');
}

function parseJsonFromText(text, context = {}) {
  const candidate = extractJsonObject(text) ?? text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      // Retry after escaping in-string control characters.
      return JSON.parse(sanitizeJsonControlChars(candidate));
    } catch {
      const body = candidate || text;
      const retryable = isRetryableBackendBody(body);
      throw new TerminalJsonAgentError('Backend returned non-JSON output before a schema object could be parsed', {
        code: 'NON_JSON_BACKEND_OUTPUT',
        backend: context.backend,
        command: context.command,
        stdout: text,
        body,
        retryable,
        status: retryable ? 'retryable_non_json_backend_output' : 'non_json_backend_output',
      });
    }
  }
}

function buildWrappedPrompt(prompt, schema) {
  const schemaStr = JSON.stringify(schema);
  return {
    schemaStr,
    wrappedPrompt: `${prompt}\n\nReturn only JSON matching this schema:\n${schemaStr}`,
  };
}

// ── Backend runners ──────────────────────────────────────────────────────────

export function buildHermesArgs({ prompt, mode = 'default', skills = [] }) {
  const args = ['-z', prompt, '--toolsets', 'safe'];
  if (skills.length) args.push('--skills', skills.join(','));

  const researchMode = mode === 'research';
  if (researchMode) {
    args[args.indexOf('--toolsets') + 1] = 'safe,terminal';
    args[1] = `${args[1]}\n\nResearch execution policy: you are Hermes. Use terminal and other Hermes tools only for source inspection and evidence gathering. Do not invoke another model provider or model CLI.`;
  }
  const provider = process.env.HERMES_PROVIDER || process.env.HERMES_HARNESS_PROVIDER || '';
  const model = process.env.HERMES_MODEL
    || (mode === 'blog' ? process.env.HERMES_BLOG_MODEL : '')
    || process.env.HERMES_HARNESS_MODEL
    || '';
  const blockedProvider = /openai|codex|claude|anthropic/i;
  if (!provider) {
    throw new Error('HERMES_PROVIDER or HERMES_HARNESS_PROVIDER must be set to an allowed non-OpenAI/non-Codex/non-Claude provider. Refusing to inherit the server Hermes default.');
  }
  if (blockedProvider.test(provider)) {
    throw new Error(`Blocked Hermes provider by policy: ${provider}. Use Hermes with a non-OpenAI/non-Codex/non-Claude provider, e.g. Gemini.`);
  }
  args.push('--provider', provider);
  if (model) args.push('--model', model);
  return args;
}

function hermesEnv() {
  const env = { ...process.env };
  // Keep the job runner non-interactive and deterministic; never inherit a
  // gateway/session source that could deliver the subagent output elsewhere.
  env.HERMES_YOLO_MODE = env.HERMES_YOLO_MODE || '1';
  env.HERMES_SOURCE = 'marketing-webxni-approved-job';

  // The approved runner can execute dozens of slots in one batch. Google free
  // tier quota is per key, so rotate same-provider keys for each Hermes process
  // instead of pinning every slot to the first exhausted key.
  const pooledGeminiKeys = String(env.GEMINI_API_KEYS || '')
    .split(/[\s,]+/)
    .map((key) => key.trim())
    .filter(Boolean);
  if (pooledGeminiKeys.length > 0 && /^(google|gemini)$/i.test(env.HERMES_PROVIDER || env.HERMES_HARNESS_PROVIDER || '')) {
    const key = pooledGeminiKeys[geminiKeyCursor++ % pooledGeminiKeys.length];
    env.GEMINI_API_KEY = key;
    env.GOOGLE_API_KEY = key;
  }

  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDE_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

function runHermes(prompt, schema, mode, skills = []) {
  const hermesCmd = resolveHermesCommand();
  if (!hermesCmd) throw new Error('Hermes CLI not found. Run the installer or set HERMES_CLI_PATH.');
  const { wrappedPrompt } = buildWrappedPrompt(prompt, schema);
  if (Buffer.byteLength(wrappedPrompt, 'utf8') > 120000) {
    throw new Error('Hermes prompt exceeds the safe CLI argument limit');
  }
  const args = buildHermesArgs({ prompt: wrappedPrompt, mode, skills });
  return runSpawnJson(hermesCmd, args, (stdout) => ({ output: parseJsonFromText(stdout, { backend: 'hermes', command: hermesCmd }), cost_usd: null }), {
    env: hermesEnv(),
    backend: 'hermes',
  });
}

function runSpawnJson(command, args, parser, extra = {}) {
  return new Promise((resolve, reject) => {
    const hasInput = typeof extra.input === 'string';
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: false,
      env: extra.env || process.env,
      stdio: [hasInput ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let forceKillTimer;
    const timeout = TERMINAL_PROCESS_TIMEOUT_MS > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
        forceKillTimer.unref();
      }, TERMINAL_PROCESS_TIMEOUT_MS)
      : null;
    timeout?.unref();
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    if (hasInput && child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(extra.input);
    }
    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (extra.cleanup) extra.cleanup();
      reject(err);
    });
    child.on('exit', (code) => {
      try {
        if (timedOut) {
          reject(new Error(`${command} timed out after ${TERMINAL_PROCESS_TIMEOUT_MS}ms`));
          return;
        }
        if (code !== 0) {
          const combined = `${stderr}
${stdout}`;
          const classification = classifyBackendFailure(command, combined);
          reject(new TerminalJsonAgentError(`${command} exited ${code}: ${classification}`, {
            code: 'BACKEND_PROCESS_FAILED',
            backend: extra.backend || null,
            command,
            exitStatus: code,
            stderr,
            stdout,
            body: combined,
            retryable: isRetryableBackendBody(combined),
            status: isRetryableBackendBody(combined) ? 'retryable_backend_process_failed' : 'backend_process_failed',
          }));
          return;
        }
        resolve(parser(stdout));
      } catch (err) {
        reject(err);
      } finally {
        if (timeout) clearTimeout(timeout);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        if (extra.cleanup) extra.cleanup();
      }
    });
  });
}

function classifyBackendFailure(command, text) {
  const lower = text.toLowerCase();
  if (lower.includes('401 unauthorized') || lower.includes('api_error_status":401') || lower.includes('missing bearer')) {
    return `cause: ${command} authentication is missing or expired`;
  }
  if (lower.includes('model is not supported')) {
    return `cause: ${command} model is not supported by the authenticated account`;
  }
  if (lower.includes('refusing to create helper binaries') || lower.includes('could not update path')) {
    return `cause: ${command} helper/PATH setup warning; verify auth/model if the command also failed`;
  }
  if (command.includes('hermes') && lower.includes('agent failed: code')) {
    return 'cause: hermes agent execution failed before returning JSON';
  }
  return 'cause: unknown terminal backend failure';
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a structured-JSON agent call with automatic backend fallback.
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {object} opts.schema
 * @param {string|string[]} opts.preferredBackend - single name, array, or 'auto'
 * @param {string} [opts.mode] - 'default' | 'blog'
 */
export async function runTerminalJsonAgent({ prompt, schema, preferredBackend, mode = 'default', skills = [], excludedBackends = [] }) {
  const rawPriority = Array.isArray(preferredBackend)
    ? preferredBackend
    : [preferredBackend || 'auto'];

  const priority = expandPriority(rawPriority, excludedBackends);
  const errors = [];
  const attempts = [];

  for (const backend of priority) {
    try {
      let res;
      if (backend === 'hermes') res = await runHermes(prompt, schema, mode, skills);
      else throw new Error(`Blocked backend by policy: ${backend}. Hermes is the only allowed executor.`);
      const cost_usd = res && typeof res === 'object' && 'cost_usd' in res ? res.cost_usd : null;
      const output = res && typeof res === 'object' && 'output' in res ? res.output : res;
      attempts.push({ backend, status: 'completed', cost_usd });
      return {
        backend,
        output,
        cost_usd,
        attempts,
        fallback_used: attempts.length > 1,
        primary_backend: priority[0] ?? backend,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      markBackendBroken(backend);
      const typed = err && typeof err === 'object' ? err : {};
      const status = typed.status || (typed.retryable ? 'retryable_failed' : 'failed');
      const safeError = [msg, typed.bodyPreview ? `body: ${typed.bodyPreview}` : ''].filter(Boolean).join(' | ');
      errors.push(`[${backend}] ${safeError.slice(0, 700)}`);
      attempts.push({
        backend,
        status,
        error: safeError.slice(0, 1200),
        code: typed.code || null,
        retryable: typed.retryable === true,
        body_preview: typed.bodyPreview || null,
        stderr_preview: typed.stderrPreview || null,
        stdout_preview: typed.stdoutPreview || null,
      });
      console.warn(`[harness] Hermes backend failed: ${safeError.slice(0, 160)}`);
    }
  }

  const failure = new Error(`All backends failed:\n${errors.join('\n')}`);
  failure.attempts = attempts;
  throw failure;
}

export { isBackendAvailable, expandPriority, completePriority, normalizeBackendName };
