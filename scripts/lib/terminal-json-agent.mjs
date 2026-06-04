import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

function normalizeBackendName(backend) {
  const b = String(backend || '').trim().toLowerCase();
  if (b === 'claude_code' || b === 'claude-code') return 'claude';
  if (b === 'gemini_cli' || b === 'gemini-cli') return 'gemini';
  if (b === 'openai_api' || b === 'openai-api') return 'openai';
  return b;
}

function isBackendAvailable(backend) {
  const b = normalizeBackendName(backend);
  if (b === 'openai') return !!process.env.OPENAI_API_KEY;
  if (b === 'claude' || b === 'gemini' || b === 'codex') return commandAvailable(b);
  return false;
}

/**
 * Expand a priority list into an ordered list of available backends.
 * 'auto' expands to all available backends in default order.
 */
function expandPriority(backends) {
  const AUTO_ORDER = ['claude', 'openai'];
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
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return candidate.slice(first, last + 1);
}

function parseJsonFromText(text) {
  return JSON.parse(extractJsonObject(text) ?? text.trim());
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
    if (wrapper?.structured_output && typeof wrapper.structured_output === 'object') return wrapper.structured_output;
    return parseJsonFromText(wrapper?.result || stdout);
  }, { env });
}

function runGemini(prompt, schema, mode) {
  const { wrappedPrompt } = buildWrappedPrompt(prompt, schema);
  const model = mode === 'blog'
    ? (process.env.GEMINI_BLOG_MODEL || 'gemini-2.5-pro')
    : (process.env.GEMINI_SOCIAL_MODEL || 'gemini-2.5-flash');
  return runSpawnJson('gemini', ['-p', wrappedPrompt, '-o', 'json', '-m', model], parseJsonFromText);
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
  return runSpawnJson('codex', args, () => parseJsonFromText(readFileSync(outputPath, 'utf8')), {
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  });
}

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
  return parseJsonFromText(text);
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
export async function runTerminalJsonAgent({ prompt, schema, preferredBackend, mode = 'default' }) {
  const rawPriority = Array.isArray(preferredBackend)
    ? preferredBackend
    : [preferredBackend || 'auto'];

  const priority = expandPriority(rawPriority);
  const errors = [];
  const attempts = [];

  for (const backend of priority) {
    try {
      let output;
      if (backend === 'claude') output = await runClaude(prompt, schema, mode);
      else if (backend === 'gemini') output = await runGemini(prompt, schema, mode);
      else if (backend === 'codex') output = await runCodex(prompt, schema, mode);
      else if (backend === 'openai') output = await runOpenAI(prompt, schema, mode);
      else throw new Error(`Unknown backend: ${backend}`);
      attempts.push({ backend, status: 'completed' });
      return {
        backend,
        output,
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
