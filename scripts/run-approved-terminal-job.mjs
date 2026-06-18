#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expandPriority, runTerminalJsonAgent } from './lib/terminal-json-agent.mjs';

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
const HEARTBEAT_INTERVAL_MS = 45000;

if (!jobId || !botSecret) {
  console.error('Missing --job-id or --bot-secret');
  process.exit(2);
}

let heartbeatRunId = '';
let heartbeatMessage = '';
let heartbeatTimer = null;
let heartbeatInFlight = false;

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

// Best-effort POST for non-critical writes (progress logs, notifications).
// A transient 500 here (e.g. D1 write contention while many slots log at once)
// must NEVER flip an already-saved slot to failed, so we swallow the error.
async function postBestEffort(pathname, body) {
  try {
    return await post(pathname, body);
  } catch (err) {
    console.warn(`[best-effort] ${pathname}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function loadAiConfig() {
  try {
    const res = await fetch(`${apiBaseUrl}/internal/agency/ai-config`, {
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${botSecret}`,
      },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.openai_api_key && !process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = data.openai_api_key;
      console.log(`[terminal] OpenAI key loaded from KV settings (model: ${data.openai_model})`);
    }
    if (data.openai_model && !process.env.OPENAI_MODEL) {
      process.env.OPENAI_MODEL = data.openai_model;
    }
  } catch {
    // Non-fatal: terminal CLI backends may still be available.
  }
}

function setHeartbeatMessage(message) {
  heartbeatMessage = String(message || '').trim();
}

async function sendHeartbeat() {
  if (!heartbeatRunId || !heartbeatMessage || heartbeatInFlight) return;
  heartbeatInFlight = true;
  try {
    await post(`/internal/discord/approved-jobs/${jobId}/log`, {
      run_id: heartbeatRunId,
      level: 'INFO',
      message: heartbeatMessage,
    });
  } catch (err) {
    console.warn(`[heartbeat] ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    heartbeatInFlight = false;
  }
}

function startHeartbeat(runId) {
  heartbeatRunId = runId;
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => { void sendHeartbeat(); }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  heartbeatRunId = '';
  heartbeatMessage = '';
  heartbeatInFlight = false;
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
  return expandPriority(preferredTerminalBackends())[0] ?? 'unavailable';
}

function preferredTerminalBackends() {
  const requested = TERMINAL_AGENT === 'auto' ? '' : TERMINAL_AGENT;
  if (requested) return [requested, 'hermes', 'openai'];
  return ['hermes', 'claude', 'gemini', 'openai'];
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

async function runClaudeAPI(prompt, schema) {
  const systemPrompt = JSON_ONLY_SYSTEM_APPEND;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system: [{ type: 'text', text: systemPrompt }],
      messages: [{
        role: 'user',
        content: prompt,
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const textContent = data.content?.[0];
  if (!textContent || textContent.type !== 'text') {
    throw new Error(`Unexpected API response: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const candidate = extractJsonObject(textContent.text) ?? textContent.text.trim();
  try {
    return JSON.parse(candidate);
  } catch (err) {
    throw new Error(`Failed to parse API response JSON: ${String(err)}\ntext: ${textContent.text.slice(0, 300)}`);
  }
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
  const isBlog = plan?.mode === 'blog';
  // Complex (blog) slots lead with Claude; social slots keep the default chain
  // (Hermes-first). Honors an explicit --terminal-agent override either way.
  const backendChain = (isBlog && TERMINAL_AGENT === 'auto')
    ? ['claude', ...preferredTerminalBackends()]
    : preferredTerminalBackends();
  return runTerminalJsonAgent({
    prompt,
    schema,
    preferredBackend: backendChain,
    mode: isBlog ? 'blog' : 'default',
  });
}

async function processSlot(summary, args, total, backend) {
  const prefix = `${summary.client_slug} / ${summary.publish_date} / ${summary.content_type}`;
  setHeartbeatMessage(`Terminal AI heartbeat — working on slot ${summary.slot_idx + 1}/${total}: ${prefix}`);
  let slotReq;
  try {
    slotReq = await get(`/internal/discord/approved-jobs/${jobId}/slot-request/${summary.slot_idx}`);
  } catch (err) {
    const message = `Slot ${summary.slot_idx + 1} prompt build failed: ${err instanceof Error ? err.message : String(err)}`;
    await postBestEffort(`/internal/discord/approved-jobs/${jobId}/error`, {
      run_id: args.run_id,
      client_slug: summary.client_slug,
      slot_idx: summary.slot_idx,
      provider: backend,
      failing_step: 'slot_request',
      message,
      details: err instanceof Error ? err.stack ?? err.message : String(err),
    });
    await postBestEffort(`/internal/discord/approved-jobs/${jobId}/log`, {
      run_id: args.run_id,
      level: 'ERROR',
      message,
    });
    return { ok: false, slot_idx: summary.slot_idx, prefix };
  }

  try {
    const generatedResult = await runTerminalAgent(slotReq.prompt, slotReq.schema, slotReq.plan ?? null);
    const generated = generatedResult.output;

    // Critical write — the content save. A failure here means the slot is NOT
    // saved and must be retried, so this stays strict (throws → caught below).
    await post(`/internal/discord/approved-jobs/${jobId}/save-slot`, {
      run_id: args.run_id,
      slot_idx: summary.slot_idx,
      post: generated,
      topic_selection: slotReq.topic_selection ?? null,
    });

    // Progress log is cosmetic — best-effort so a logging hiccup never
    // turns a successfully-saved slot into a counted failure (the 80/81 bug).
    await postBestEffort(`/internal/discord/approved-jobs/${jobId}/log`, {
      run_id: args.run_id,
      level: 'INFO',
      message: `Saved slot ${summary.slot_idx + 1}/${total}: ${prefix}`,
    });

    console.log(`[${summary.slot_idx + 1}/${total}] ${prefix} [${generatedResult.backend}]`);
    return { ok: true, slot_idx: summary.slot_idx, prefix };
  } catch (err) {
    const message = `Slot ${summary.slot_idx + 1} processing failed: ${err instanceof Error ? err.message : String(err)}`;
    await postBestEffort(`/internal/discord/approved-jobs/${jobId}/error`, {
      run_id: args.run_id,
      client_slug: summary.client_slug,
      slot_idx: summary.slot_idx,
      provider: backend,
      failing_step: 'terminal_generation',
      message,
      details: err instanceof Error ? err.stack ?? err.message : String(err),
    });
    await postBestEffort(`/internal/discord/approved-jobs/${jobId}/log`, {
      run_id: args.run_id,
      level: 'ERROR',
      message,
    });
    return { ok: false, slot_idx: summary.slot_idx, prefix };
  }
}

async function runBatch(batch, args, total, backend) {
  const results = await Promise.allSettled(
    batch.map(summary => processSlot(summary, args, total, backend))
  );
  let batchCompleted = 0;
  const failedIdx = new Set();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.ok) batchCompleted++;
    else {
      failedIdx.add(batch[i].slot_idx);
      if (r.status === 'rejected') {
        console.error('Slot error:', r.reason instanceof Error ? r.reason.message : String(r.reason));
      }
    }
  });
  // Return the summaries that did not save so the caller can retry them.
  const failed = batch.filter((s) => failedIdx.has(s.slot_idx));
  return { batchCompleted, failed };
}

// Run all slots in concurrency-limited batches; collect every slot that failed.
async function runAllBatches(slots, args, total, backend, onProgress) {
  let completed = 0;
  const failed = [];
  for (let i = 0; i < slots.length; i += CONCURRENCY) {
    const batch = slots.slice(i, i + CONCURRENCY);
    const res = await runBatch(batch, args, total, backend);
    completed += res.batchCompleted;
    failed.push(...res.failed);
    if (onProgress) await onProgress(completed);
  }
  return { completed, failed };
}

async function main() {
  await loadAiConfig();
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
  startHeartbeat(args.run_id);
  setHeartbeatMessage(`Terminal AI heartbeat — preparing weekly job for ${total} slots`);

  try {
    console.log(`Starting terminal content job: ${total} slots | concurrency: ${CONCURRENCY} | backend: ${backend}`);
    await postBestEffort('/internal/discord/notify', {
      content: `🧠 Terminal AI started weekly content job\nRun ID: \`${args.run_id}\`\nRunner: \`${runnerId}\`\nBackend: \`${backend}\`\nSlots: ${total} | Concurrency: ${CONCURRENCY}`,
    });

    await postBestEffort(`/internal/discord/approved-jobs/${jobId}/log`, {
      run_id: args.run_id,
      level: 'START',
      message: `Runner ${runnerId} starting ${job.command_name} — ${total} slots, ${CONCURRENCY} concurrent`,
    });

    const reportProgress = async (done) => {
      console.log(`Batch done: ${done}/${total} total saved`);
      await postBestEffort('/internal/discord/notify', {
        content: `⏳ Terminal AI (${backend}): ${done}/${total} slots — run \`${args.run_id}\``,
      });
    };

    // First pass.
    const first = await runAllBatches(slotSummaries, args, total, backend, reportProgress);
    let completed = first.completed;
    let failed = first.failed;

    // Retry pass — transient failures (D1 contention, flaky backend) get one
    // more attempt so a single hiccup no longer produces a silent 80/81 partial.
    const RETRY_PASSES = parseInt(process.env.TERMINAL_RETRY_PASSES || '1', 10);
    for (let pass = 1; pass <= RETRY_PASSES && failed.length > 0; pass++) {
      console.log(`Retry pass ${pass}: ${failed.length} slot(s) to retry`);
      await postBestEffort(`/internal/discord/approved-jobs/${jobId}/log`, {
        run_id: args.run_id,
        level: 'WARN',
        message: `Retry pass ${pass}: re-running ${failed.length} failed slot(s)`,
      });
      const retry = await runAllBatches(failed, args, total, backend, null);
      completed += retry.completed;
      failed = retry.failed;
      await reportProgress(completed);
    }

    if (completed === 0) {
      const error = `Terminal job completed 0/${total} slots. Marking failed so the run can be retried.`;
      await post(`/internal/discord/approved-jobs/${jobId}/fail`, {
        run_id: args.run_id,
        error,
      });
      await postBestEffort('/internal/discord/notify', {
        content: `❌ Terminal AI weekly job saved 0/${total} slots\nRun ID: \`${args.run_id}\`\nBackend chain: \`${preferredTerminalBackends().join(' -> ')}\``,
      });
      throw new Error(error);
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

    // Milestone summary — best-effort so it never affects job status.
    const summaryEmoji = completed >= total ? '✅' : '⚠️';
    await postBestEffort('/internal/discord/notify', {
      content: `${summaryEmoji} Terminal AI weekly job done: saved ${completed}/${total} slot(s)\nRun ID: \`${args.run_id}\`\nBackend: \`${backend}\``,
    });

    console.log(`Done: ${completed}/${total} slots completed`);
  } finally {
    stopHeartbeat();
  }
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
