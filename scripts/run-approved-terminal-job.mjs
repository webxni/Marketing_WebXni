#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

const jobId = argValue('--job-id');
const runnerId = argValue('--runner-id') || 'discord-bot-runner';
const apiBaseUrl = argValue('--api-base-url') || process.env.API_BASE_URL || 'https://marketing.webxni.com';
const botSecret = argValue('--bot-secret') || process.env.DISCORD_BOT_SECRET || '';
const CONCURRENCY = parseInt(argValue('--concurrency') || '10', 10);
const TERMINAL_AGENT = (argValue('--terminal-agent') || process.env.TERMINAL_AGENT || process.env.TERMINAL_AI_BACKEND || 'auto').trim().toLowerCase();

if (!jobId || !botSecret) {
  console.error('Missing --job-id or --bot-secret');
  process.exit(2);
}

async function post(pathname, body) {
  const res = await fetch(`${apiBaseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${botSecret}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${pathname} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function get(pathname) {
  const res = await fetch(`${apiBaseUrl}${pathname}`, {
    headers: {
      'authorization': `Bearer ${botSecret}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${pathname} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

const JSON_ONLY_SYSTEM_APPEND =
  'CRITICAL OUTPUT RULE: For this task you must reply with EXACTLY ONE JSON object that matches the provided JSON schema. ' +
  'No preface, no commentary, no markdown, no code fences, no trailing text. Output must start with `{` and end with `}`. ' +
  'If you cannot produce valid content for a field, still return the JSON object using empty strings or empty arrays as placeholders for that field.';

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

function parseJsonFromText(label, text) {
  const candidate = extractJsonObject(text) ?? text.trim();
  return JSON.parse(candidate);
}

function commandAvailable(command) {
  const result = spawnSync(command, ['--help'], {
    shell: false,
    env: process.env,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function resolveTerminalBackend() {
  const requested = TERMINAL_AGENT === 'auto' ? '' : TERMINAL_AGENT;
  const preferred = requested ? [requested] : ['codex', 'gemini', 'claude'];
  for (const candidate of preferred) {
    if (['codex', 'gemini', 'claude'].includes(candidate) && commandAvailable(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No supported terminal CLI found. Tried: ${preferred.join(', ')}`);
}

function buildWrappedPrompt(prompt, schema) {
  const schemaStr = JSON.stringify(schema);
  return {
    schemaStr,
    wrappedPrompt:
    `${prompt}\n\n` +
    `Return ONLY a single JSON object that conforms exactly to this schema. ` +
    `No prose, no markdown, no code fences:\n${schemaStr}`,
  };
}

function runClaude(prompt, schema, plan = null) {
  const { schemaStr, wrappedPrompt } = buildWrappedPrompt(prompt, schema);
  const effort = plan?.mode === 'blog' ? 'medium' : 'low';
  const maxBudget = process.env.CLAUDE_MAX_BUDGET_USD?.trim();
  const args = [
    '-p',
    '--bare',
    '--output-format', 'json',
    '--effort', effort,
    ...(maxBudget ? ['--max-budget-usd', maxBudget] : []),
    '--model', 'sonnet',
    '--tools', '',
    '--append-system-prompt', JSON_ONLY_SYSTEM_APPEND,
    '--json-schema', schemaStr,
    wrappedPrompt,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: process.cwd(),
      shell: false,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited ${code}\nstderr: ${stderr.slice(0, 800).trim() || '(empty)'}\nstdout: ${stdout.slice(0, 800).trim() || '(empty)'}`));
        return;
      }
      if (!stdout.trim()) {
        reject(new Error(`Claude produced no output (exit 0).\nstderr: ${stderr.slice(0, 800).trim() || '(empty)'}`));
        return;
      }
      let wrapper;
      try {
        wrapper = JSON.parse(stdout.trim());
      } catch (err) {
        reject(new Error(`Failed to parse Claude wrapper: ${String(err)}\nstdout: ${stdout.slice(0, 800)}`));
        return;
      }
      if (wrapper && typeof wrapper === 'object' && wrapper.is_error) {
        reject(new Error(`Claude error: api_status=${wrapper.api_error_status} stop=${wrapper.stop_reason}`));
        return;
      }
      if (wrapper && typeof wrapper === 'object' && wrapper.structured_output && typeof wrapper.structured_output === 'object') {
        resolve(wrapper.structured_output);
        return;
      }
      const resultStr = wrapper && typeof wrapper.result === 'string' ? wrapper.result : '';
      if (!resultStr) {
        reject(new Error(`Claude wrapper had no .structured_output and no .result\nkeys: ${Object.keys(wrapper ?? {}).join(', ')}`));
        return;
      }
      const candidate = extractJsonObject(resultStr) ?? resultStr.trim();
      try {
        resolve(JSON.parse(candidate));
      } catch (err) {
        reject(new Error(`Failed to parse Claude .result JSON: ${String(err)}\nresult: ${resultStr.slice(0, 800)}`));
      }
    });
  });
}

function runGemini(prompt, schema, plan = null) {
  const { wrappedPrompt } = buildWrappedPrompt(prompt, schema);
  const args = [
    '-p', wrappedPrompt,
    '-o', 'json',
  ];
  if (plan?.mode === 'blog') args.push('-m', process.env.GEMINI_BLOG_MODEL || 'gemini-2.5-pro');
  else args.push('-m', process.env.GEMINI_SOCIAL_MODEL || 'gemini-2.5-flash');

  return new Promise((resolve, reject) => {
    const child = spawn('gemini', args, {
      cwd: process.cwd(),
      shell: false,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`gemini exited ${code}\nstderr: ${stderr.slice(0, 800).trim() || '(empty)'}\nstdout: ${stdout.slice(0, 800).trim() || '(empty)'}`));
        return;
      }
      try {
        resolve(parseJsonFromText('Gemini', stdout));
      } catch (err) {
        reject(new Error(`Failed to parse Gemini JSON: ${String(err)}\nstdout: ${stdout.slice(0, 800)}\nstderr: ${stderr.slice(0, 400)}`));
      }
    });
  });
}

function runCodex(prompt, schema, plan = null) {
  const { wrappedPrompt } = buildWrappedPrompt(prompt, schema);
  const workDir = mkdtempSync(join(tmpdir(), 'webxni-codex-'));
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
    '-m', plan?.mode === 'blog'
      ? (process.env.CODEX_BLOG_MODEL || 'gpt-5')
      : (process.env.CODEX_SOCIAL_MODEL || 'gpt-5-mini'),
    wrappedPrompt,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, {
      cwd: process.cwd(),
      shell: false,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
      },
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
          reject(new Error(`codex exited ${code}\nstderr: ${stderr.slice(0, 800).trim() || '(empty)'}\nstdout: ${stdout.slice(0, 800).trim() || '(empty)'}`));
          return;
        }
        const output = readFileSync(outputPath, 'utf8');
        resolve(parseJsonFromText('Codex', output));
      } catch (err) {
        reject(new Error(`Failed to parse Codex JSON: ${String(err)}\nstdout: ${stdout.slice(0, 800)}\nstderr: ${stderr.slice(0, 400)}`));
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    });
  });
}

async function runTerminalAgent(prompt, schema, plan = null) {
  const backend = resolveTerminalBackend();
  if (backend === 'codex') return { backend, output: await runCodex(prompt, schema, plan) };
  if (backend === 'gemini') return { backend, output: await runGemini(prompt, schema, plan) };
  return { backend, output: await runClaude(prompt, schema, plan) };
}

async function processSlot(summary, args, total) {
  const prefix = `${summary.client_slug} / ${summary.publish_date} / ${summary.content_type}`;
  let slotReq;
  try {
    slotReq = await get(`/internal/discord/approved-jobs/${jobId}/slot-request/${summary.slot_idx}`);
  } catch (err) {
    await post(`/internal/discord/approved-jobs/${jobId}/log`, {
      run_id: args.run_id,
      level: 'ERROR',
      message: `Slot ${summary.slot_idx + 1} prompt build failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { ok: false, slot_idx: summary.slot_idx, prefix };
  }

  const generatedResult = await runTerminalAgent(slotReq.prompt, slotReq.schema, slotReq.plan ?? null);
  const generated = generatedResult.output;

  await post(`/internal/discord/approved-jobs/${jobId}/save-slot`, {
    run_id: args.run_id,
    slot_idx: summary.slot_idx,
    post: generated,
    topic_selection: slotReq.topic_selection ?? null,
  });

  await post(`/internal/discord/approved-jobs/${jobId}/log`, {
    run_id: args.run_id,
    level: 'INFO',
    message: `Saved slot ${summary.slot_idx + 1}/${total}: ${prefix}`,
  });

  console.log(`[${summary.slot_idx + 1}/${total}] ${prefix} [${generatedResult.backend}]`);
  return { ok: true, slot_idx: summary.slot_idx, prefix };
}

async function runBatch(batch, args, total) {
  const results = await Promise.allSettled(
    batch.map(summary => processSlot(summary, args, total))
  );
  let batchCompleted = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.ok) batchCompleted++;
    else if (r.status === 'rejected') {
      console.error('Slot error:', r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  }
  return batchCompleted;
}

async function main() {
  const context = await get(`/internal/discord/approved-jobs/${jobId}/context`);
  const job = context.job;
  const slotSummaries = Array.isArray(context.slots) ? context.slots : [];

  if (!job || !slotSummaries.length) {
    await post(`/internal/discord/approved-jobs/${jobId}/fail`, {
      error: 'No queued slot requests found for approved terminal job.',
      run_id: JSON.parse(job?.args_json ?? '{}').run_id ?? null,
    });
    return;
  }

  const args = JSON.parse(job.args_json);
  const total = slotSummaries.length;
  const backend = resolveTerminalBackend();

  console.log(`Starting terminal content job: ${total} slots | concurrency: ${CONCURRENCY} | backend: ${backend}`);
  await post('/internal/discord/notify', {
    content: `🧠 Terminal AI started weekly content job\nRun ID: \`${args.run_id}\`\nRunner: \`${runnerId}\`\nBackend: \`${backend}\`\nSlots: ${total} | Concurrency: ${CONCURRENCY}`,
  });

  await post(`/internal/discord/approved-jobs/${jobId}/log`, {
    run_id: args.run_id,
    level: 'START',
    message: `Runner ${runnerId} starting ${job.command_name} — ${total} slots, ${CONCURRENCY} concurrent`,
  });

  let completed = 0;

  for (let i = 0; i < slotSummaries.length; i += CONCURRENCY) {
    const batch = slotSummaries.slice(i, i + CONCURRENCY);
    const batchCompleted = await runBatch(batch, args, total);
    completed += batchCompleted;
    console.log(`Batch done: ${completed}/${total} total saved`);
    await post('/internal/discord/notify', {
      content: `⏳ Terminal AI (${backend}): ${completed}/${total} slots — run \`${args.run_id}\``,
    });
  }

  await post(`/internal/discord/approved-jobs/${jobId}/complete`, {
    result_json: {
      run_id: args.run_id,
      completed_slots: completed,
      requested_slots: total,
      provider: 'terminal',
      backend,
      runner_id: runnerId,
    },
  });

  console.log(`Done: ${completed}/${total} slots completed`);
}

main().catch(async (err) => {
  console.error(err);
  try {
    const runId = (await get(`/internal/discord/approved-jobs/${jobId}/context`)).job?.generation_run_id ?? null;
    await post(`/internal/discord/approved-jobs/${jobId}/fail`, {
      run_id: runId,
      error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
    });
    await post('/internal/discord/notify', {
      content: `❌ Terminal AI weekly job failed\nJob ID: \`${jobId}\`\n${err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)}`,
    });
  } catch (innerErr) {
    console.error('Failed to report failure:', innerErr);
  }
  process.exit(1);
});
