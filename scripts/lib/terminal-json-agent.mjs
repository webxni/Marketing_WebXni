import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const JSON_ONLY_SYSTEM =
  'You are a WebXni marketing agency AI agent. ' +
  'CRITICAL OUTPUT RULE: Reply with exactly one JSON object matching the provided schema. ' +
  'No prose, no markdown, no code fences, no trailing text. ' +
  'All Claude skills (webxni-agency-orchestrator, webxni-system-reliability, webxni-security-sentinel, ' +
  'webxni-client-research, webxni-strategist, webxni-social-copywriter, webxni-blog-writer, ' +
  'webxni-editorial-reviewer) apply equally to every backend.';

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
  if (b === 'claude_code' || b === 'claude-code') return 'claude';
  if (b === 'gemini_cli' || b === 'gemini-cli') return 'gemini';
  if (b === 'openai_api' || b === 'openai-api') return 'openai';
  return b;
}

function isBackendAvailable(backend) {
  const b = normalizeBackendName(backend);
  if (b === 'openai') return !!process.env.OPENAI_API_KEY;
  if (b === 'hermes') return !!resolveHermesCommand();
  // Gemini runs via the REST API (the CLI's free OAuth tier was deprecated), so
  // it's available whenever a key is set; fall back to the CLI only if present.
  if (b === 'gemini') return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) || commandAvailable('gemini');
  if (b === 'claude' || b === 'codex') return commandAvailable(b);
  return false;
}

/**
 * Expand a priority list into an ordered list of available backends.
 * 'auto' expands to all available backends in default order.
 */
function expandPriority(backends) {
  const AUTO_ORDER = ['hermes', 'claude', 'openai'];
  const seen = new Set();
  const result = [];
  for (const b of backends) {
    const normalized = normalizeBackendName(b);
    const candidates = normalized === 'auto' ? AUTO_ORDER : [normalized];
    for (const c of candidates) {
      if (!seen.has(c) && isBackendAvailable(c)) {
        seen.add(c);
        result.push(c);
      }
    }
  }
  if (!seen.has('openai') && isBackendAvailable('openai')) {
    result.push('openai');
  }
  if (result.length === 0) {
    const tried = backends.join(', ');
    throw new Error(
      `No backend available. Tried: ${tried}. ` +
      'Check CLI installations (claude/codex/gemini --version) and OPENAI_API_KEY.',
    );
  }
  return result;
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

function parseJsonFromText(text) {
  const candidate = extractJsonObject(text) ?? text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Retry after escaping in-string control characters.
    return JSON.parse(sanitizeJsonControlChars(candidate));
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

function runClaude(prompt, schema, mode) {
  const { schemaStr, wrappedPrompt } = buildWrappedPrompt(prompt, schema);
  const env = { ...process.env };
  if (process.env.AGENCY_CLAUDE_USE_API_KEY !== '1') {
    delete env.ANTHROPIC_API_KEY;
  }
  const args = [
    '-p',
    '--output-format', 'json',
    '--effort', mode === 'blog' ? 'medium' : 'low',
    '--model', process.env.CLAUDE_CODE_MODEL || 'sonnet',
    '--max-turns', process.env.CLAUDE_CODE_MAX_TURNS || '3',
    '--no-session-persistence',
    '--append-system-prompt', JSON_ONLY_SYSTEM,
    '--json-schema', schemaStr,
    wrappedPrompt,
  ];
  if (process.env.AGENCY_CLAUDE_BARE === '1') {
    args.splice(1, 0, '--bare');
  }
  return runSpawnJson('claude', args, (stdout) => {
    const wrapper = JSON.parse(stdout.trim());
    if (wrapper?.is_error) throw new Error(`Claude error: api_status=${wrapper.api_error_status} stop=${wrapper.stop_reason}`);
    // Claude Code's JSON wrapper reports actual spend — capture it.
    const cost_usd = typeof wrapper?.total_cost_usd === 'number' ? wrapper.total_cost_usd : null;
    const output = (wrapper?.structured_output && typeof wrapper.structured_output === 'object')
      ? wrapper.structured_output
      : parseJsonFromText(wrapper?.result || stdout);
    return { output, cost_usd };
  }, { env });
}

// Rough per-1M-token USD prices (input, output) for cost estimation.
const GEMINI_PRICES = {
  'gemini-2.5-flash': { in: 0.30, out: 2.50 },
  'gemini-2.5-pro':   { in: 1.25, out: 10.0 },
};

// Round-robin cursor so consecutive Gemini calls start from a different key —
// spreads load across keys and dodges per-key rate limits.
let _geminiKeyCursor = 0;
function geminiKeys() {
  const raw = [
    ...(process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : []),
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_BACKUP,
    process.env.GEMINI_API_KEY_3,
    process.env.GOOGLE_API_KEY,
  ].map((k) => (k || '').trim()).filter(Boolean);
  return [...new Set(raw)];
}

async function runGemini(prompt, schema, mode) {
  // All configured keys, rotated per call and failed-over within a call.
  const keys = geminiKeys();
  const model = mode === 'blog'
    ? (process.env.GEMINI_BLOG_MODEL || 'gemini-2.5-pro')
    : (process.env.GEMINI_SOCIAL_MODEL || 'gemini-2.5-flash');
  const { wrappedPrompt } = buildWrappedPrompt(prompt, schema);

  // Preferred path: REST API (the CLI's free OAuth tier was deprecated by Google).
  if (keys.length) {
    // Research must stay web-grounded so it never invents client facts — enable
    // Google Search grounding for research (which also means no JSON mime mode;
    // the prompt already demands raw JSON and parseJsonFromText extracts it).
    const grounded = mode === 'research';
    const body = {
      contents: [{ role: 'user', parts: [{ text: `${JSON_ONLY_SYSTEM}\n\n${wrappedPrompt}` }] }],
      // Research/blog JSON is large — give it room so it doesn't truncate
      // ("Expected ',' or '}'" on parse).
      generationConfig: { temperature: 0.7, maxOutputTokens: (mode === 'blog' || mode === 'research') ? 8192 : 4096 },
    };
    if (grounded) body.tools = [{ google_search: {} }];
    else body.generationConfig.responseMimeType = 'application/json';

    const n = keys.length;
    const start = _geminiKeyCursor % n;
    _geminiKeyCursor = (_geminiKeyCursor + 1) % n; // rotate for the next call
    let lastErr = '';
    for (let i = 0; i < n; i++) {
      const key = keys[(start + i) % n];
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        lastErr = `Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`;
        // Failover to the next key on auth/quota/rate/server errors, or a 400
        // that's specifically an API-key problem (revoked/invalid key).
        const keyError = res.status === 400 && /api.?key/i.test(lastErr);
        const retriable = [401, 403, 429, 500, 503].includes(res.status) || keyError;
        if (retriable && i < n - 1) {
          console.warn(`[gemini] key #${(start + i) % n + 1} failed (${res.status}), rotating to next key`);
          continue;
        }
        throw new Error(lastErr);
      }
      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text || '').join('').trim();
      if (!text) throw new Error('Gemini returned empty response');
      let cost_usd = null;
      const um = data.usageMetadata;
      const price = GEMINI_PRICES[model];
      if (um && price) cost_usd = (um.promptTokenCount / 1e6) * price.in + (um.candidatesTokenCount / 1e6) * price.out;
      return { output: parseJsonFromText(text), cost_usd };
    }
    throw new Error(lastErr || 'All Gemini keys failed');
  }

  // Legacy fallback: the gemini CLI (only works if its OAuth is still valid).
  return runSpawnJson('gemini', ['-p', wrappedPrompt, '-o', 'json', '-m', model],
    (stdout) => ({ output: parseJsonFromText(stdout), cost_usd: null }));
}

function runHermes(prompt, schema, mode, skills = []) {
  const hermesCmd = resolveHermesCommand();
  if (!hermesCmd) throw new Error('Hermes CLI not found. Run the installer or set HERMES_CLI_PATH.');
  const { wrappedPrompt } = buildWrappedPrompt(prompt, schema);
  const args = ['-z', wrappedPrompt];
  if (skills.length) args.push('--skills', skills.join(','));
  // Only override provider/model when explicitly configured via HERMES_* env.
  // Otherwise let Hermes use its own authenticated default (e.g. its configured
  // provider/model from `hermes model`). Forcing a provider Hermes is not
  // authenticated for makes every Hermes call fail and silently fall through to
  // the next backend — defeating the Hermes-first routing.
  const provider = process.env.HERMES_PROVIDER;
  const model = process.env.HERMES_MODEL
    || (mode === 'blog' ? process.env.HERMES_BLOG_MODEL : undefined);
  if (provider) args.push('--provider', provider);
  if (model) args.push('--model', model);
  return runSpawnJson(hermesCmd, args, (stdout) => ({ output: parseJsonFromText(stdout), cost_usd: null }));
}

function runCodex(prompt, schema, mode) {
  const { wrappedPrompt } = buildWrappedPrompt(prompt, schema);
  const workDir = mkdtempSync(join(tmpdir(), 'webxni-agency-codex-'));
  const schemaPath = join(workDir, 'schema.json');
  const outputPath = join(workDir, 'last-message.txt');
  writeFileSync(schemaPath, JSON.stringify(schema));
  const configuredModel = mode === 'blog'
    ? (process.env.CODEX_BLOG_MODEL || 'gpt-4.1')
    : (process.env.CODEX_SOCIAL_MODEL || 'gpt-4.1-mini');
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--output-schema', schemaPath,
    '-o', outputPath,
    '-C', process.cwd(),
    wrappedPrompt,
  ];
  if (process.env.CODEX_BLOG_MODEL || process.env.CODEX_SOCIAL_MODEL || process.env.CODEX_MODEL) {
    args.splice(args.length - 1, 0, '-m', process.env.CODEX_MODEL || configuredModel);
  }
  return runSpawnJson('codex', args, () => ({ output: parseJsonFromText(readFileSync(outputPath, 'utf8')), cost_usd: null }), {
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  });
}

// Rough per-1M-token USD prices for cost estimation (input, output).
const OPENAI_PRICES = {
  'gpt-4o':      { in: 2.5,  out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
};

async function runOpenAI(prompt, schema, mode) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  // 'batch' and 'blog' modes use gpt-4o with higher token budget for large outputs
  const isBig = mode === 'blog' || mode === 'batch';
  const model = isBig
    ? (process.env.OPENAI_BLOG_MODEL || 'gpt-4o')
    : (process.env.OPENAI_MODEL || 'gpt-4o-mini');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: `${JSON_ONLY_SYSTEM}\n\nOutput must match this JSON schema exactly:\n${JSON.stringify(schema)}`,
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: isBig ? 4096 : 2048,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenAI API ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned empty response');
  // Estimate spend from token usage.
  let cost_usd = null;
  const usage = data.usage;
  const price = OPENAI_PRICES[model];
  if (usage && price) {
    cost_usd = (usage.prompt_tokens / 1e6) * price.in + (usage.completion_tokens / 1e6) * price.out;
  }
  return { output: parseJsonFromText(text), cost_usd };
}

function runSpawnJson(command, args, parser, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: false,
      env: extra.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('exit', (code) => {
      try {
        if (code !== 0) {
          const combined = `${stderr}\n${stdout}`;
          reject(new Error(
            `${command} exited ${code}\n` +
            `${classifyBackendFailure(command, combined)}\n` +
            `stderr: ${stderr.slice(0, 800).trim() || '(empty)'}\n` +
            `stdout: ${stdout.slice(0, 800).trim() || '(empty)'}`,
          ));
          return;
        }
        resolve(parser(stdout));
      } catch (err) {
        reject(err);
      } finally {
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
export async function runTerminalJsonAgent({ prompt, schema, preferredBackend, mode = 'default', skills = [] }) {
  const rawPriority = Array.isArray(preferredBackend)
    ? preferredBackend
    : [preferredBackend || 'auto'];

  const priority = expandPriority(rawPriority);
  const errors = [];
  const attempts = [];

  for (const backend of priority) {
    try {
      let res;
      if (backend === 'hermes') res = await runHermes(prompt, schema, mode, skills);
      else if (backend === 'claude') res = await runClaude(prompt, schema, mode);
      else if (backend === 'gemini') res = await runGemini(prompt, schema, mode);
      else if (backend === 'codex') res = await runCodex(prompt, schema, mode);
      else if (backend === 'openai') res = await runOpenAI(prompt, schema, mode);
      else throw new Error(`Unknown backend: ${backend}`);
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
      errors.push(`[${backend}] ${msg.slice(0, 200)}`);
      attempts.push({ backend, status: 'failed', error: msg.slice(0, 300) });
      console.warn(`[agency] backend ${backend} failed, trying next: ${msg.slice(0, 120)}`);
    }
  }

  throw new Error(`All backends failed:\n${errors.join('\n')}`);
}

export { isBackendAvailable, expandPriority, normalizeBackendName };
