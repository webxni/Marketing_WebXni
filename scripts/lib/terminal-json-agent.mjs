import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const JSON_ONLY_SYSTEM_APPEND =
  'CRITICAL OUTPUT RULE: Reply with exactly one JSON object matching the provided schema. ' +
  'No prose, no markdown, no code fences, no trailing text.';

function commandAvailable(command) {
  const result = spawnSync(command, ['--help'], { shell: false, env: process.env, stdio: 'ignore' });
  return result.status === 0;
}

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

function resolveBackend(preferred) {
  const requested = (preferred || process.env.AGENCY_TERMINAL_AGENT || process.env.TERMINAL_AGENT || 'auto').trim().toLowerCase();
  const candidates = requested === 'auto' || requested === 'terminal'
    ? ['codex', 'gemini', 'claude']
    : [requested];
  for (const candidate of candidates) {
    if (['codex', 'gemini', 'claude'].includes(candidate) && commandAvailable(candidate)) return candidate;
  }
  throw new Error(`No supported terminal CLI found. Tried: ${candidates.join(', ')}`);
}

function runClaude(prompt, schema, mode) {
  const { schemaStr, wrappedPrompt } = buildWrappedPrompt(prompt, schema);
  const args = [
    '-p',
    '--bare',
    '--output-format', 'json',
    '--effort', mode === 'blog' ? 'medium' : 'low',
    '--model', 'sonnet',
    '--max-turns', '1',
    '--append-system-prompt', JSON_ONLY_SYSTEM_APPEND,
    '--json-schema', schemaStr,
    wrappedPrompt,
  ];
  return runSpawnJson('claude', args, (stdout) => {
    const wrapper = JSON.parse(stdout.trim());
    if (wrapper?.is_error) throw new Error(`Claude error: api_status=${wrapper.api_error_status} stop=${wrapper.stop_reason}`);
    if (wrapper?.structured_output && typeof wrapper.structured_output === 'object') return wrapper.structured_output;
    return parseJsonFromText(wrapper?.result || stdout);
  });
}

function runGemini(prompt, schema, mode) {
  const { wrappedPrompt } = buildWrappedPrompt(prompt, schema);
  const args = ['-p', wrappedPrompt, '-o', 'json', '-m', mode === 'blog' ? (process.env.GEMINI_BLOG_MODEL || 'gemini-2.5-pro') : (process.env.GEMINI_SOCIAL_MODEL || 'gemini-2.5-flash')];
  return runSpawnJson('gemini', args, parseJsonFromText);
}

function runCodex(prompt, schema, mode) {
  const { wrappedPrompt } = buildWrappedPrompt(prompt, schema);
  const workDir = mkdtempSync(join(tmpdir(), 'webxni-agency-codex-'));
  const schemaPath = join(workDir, 'schema.json');
  const outputPath = join(workDir, 'last-message.txt');
  const codexHome = join(workDir, 'codex-home');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(schemaPath, JSON.stringify(schema));
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--output-schema', schemaPath,
    '-o', outputPath,
    '-C', process.cwd(),
    '-m', mode === 'blog' ? (process.env.CODEX_BLOG_MODEL || 'gpt-5') : (process.env.CODEX_SOCIAL_MODEL || 'gpt-5-mini'),
    wrappedPrompt,
  ];
  return runSpawnJson('codex', args, () => parseJsonFromText(readFileSync(outputPath, 'utf8')), {
    CODEX_HOME: codexHome,
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  });
}

function runSpawnJson(command, args, parser, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: false,
      env: { ...process.env, ...(extra.CODEX_HOME ? { CODEX_HOME: extra.CODEX_HOME } : {}) },
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
          reject(new Error(`${command} exited ${code}\nstderr: ${stderr.slice(0, 800).trim() || '(empty)'}\nstdout: ${stdout.slice(0, 800).trim() || '(empty)'}`));
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

export async function runTerminalJsonAgent({ prompt, schema, preferredBackend, mode = 'default' }) {
  const backend = resolveBackend(preferredBackend);
  if (backend === 'gemini') return { backend, output: await runGemini(prompt, schema, mode) };
  if (backend === 'claude') return { backend, output: await runClaude(prompt, schema, mode) };
  return { backend, output: await runCodex(prompt, schema, mode) };
}
