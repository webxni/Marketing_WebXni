#!/usr/bin/env node

import { spawn } from 'node:child_process';

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

const jobId = argValue('--job-id');
const runnerId = argValue('--runner-id') || 'discord-bot-runner';
const apiBaseUrl = argValue('--api-base-url') || process.env.API_BASE_URL || 'https://marketing.webxni.com';
const botSecret = argValue('--bot-secret') || process.env.DISCORD_BOT_SECRET || '';

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
  // Strip a leading code fence if present (```json ... ```)
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  // Find the outermost {...} block in case there is preface/trailing text
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return candidate.slice(first, last + 1);
}

function runClaude(prompt, schema) {
  const schemaStr = JSON.stringify(schema);
  const wrappedPrompt =
    `${prompt}\n\n` +
    `Return ONLY a single JSON object that conforms exactly to this schema. ` +
    `No prose, no markdown, no code fences:\n${schemaStr}`;
  // Use --output-format json (not text). With --json-schema, text mode prints
  // nothing because the assistant's structured output isn't surfaced as text.
  // json mode returns a wrapper with .structured_output (parsed) and .result
  // (stringified JSON). We prefer .structured_output, falling back to parsing
  // .result if needed.
  const args = [
    '-p',
    '--output-format', 'json',
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
        const detail = `stderr: ${stderr.slice(0, 800).trim() || '(empty)'}\nstdout: ${stdout.slice(0, 800).trim() || '(empty)'}`;
        reject(new Error(`claude exited ${code}\n${detail}`));
        return;
      }
      if (!stdout.trim()) {
        reject(new Error(
          `Claude produced no output (exit 0).\n` +
          `stderr: ${stderr.slice(0, 800).trim() || '(empty)'}\n` +
          `args[0..6]: ${args.slice(0, 7).join(' ')}\n` +
          `prompt chars: ${wrappedPrompt.length}\n` +
          `schema chars: ${schemaStr.length}`,
        ));
        return;
      }
      let wrapper;
      try {
        wrapper = JSON.parse(stdout.trim());
      } catch (err) {
        reject(new Error(
          `Failed to parse Claude wrapper output: ${String(err)}\n` +
          `stdout (first 800): ${stdout.slice(0, 800)}\n` +
          `stdout (last 400): ${stdout.slice(-400)}\n` +
          `stderr: ${stderr.slice(0, 400)}`,
        ));
        return;
      }
      if (wrapper && typeof wrapper === 'object' && wrapper.is_error) {
        reject(new Error(
          `Claude reported error: api_status=${wrapper.api_error_status} stop=${wrapper.stop_reason} subtype=${wrapper.subtype}`,
        ));
        return;
      }
      // Prefer the parsed structured_output when present; fall back to
      // parsing .result (stringified JSON) and finally extracting from the
      // raw text result if the model emitted prose around the JSON.
      if (wrapper && typeof wrapper === 'object' && wrapper.structured_output && typeof wrapper.structured_output === 'object') {
        resolve(wrapper.structured_output);
        return;
      }
      const resultStr = wrapper && typeof wrapper.result === 'string' ? wrapper.result : '';
      if (!resultStr) {
        reject(new Error(`Claude wrapper had no .structured_output and no .result\nwrapper keys: ${Object.keys(wrapper ?? {}).join(', ')}`));
        return;
      }
      const candidate = extractJsonObject(resultStr) ?? resultStr.trim();
      try {
        resolve(JSON.parse(candidate));
      } catch (err) {
        reject(new Error(
          `Failed to parse Claude .result JSON: ${String(err)}\n` +
          `result (first 800): ${resultStr.slice(0, 800)}\n` +
          `result (last 400): ${resultStr.slice(-400)}`,
        ));
      }
    });
  });
}

function buildReviewPrompt(basePrompt, draft) {
  return `${basePrompt}

You must now review and improve the draft before returning the final JSON.
Review checklist:
- improve weak or repetitive captions
- strengthen SEO angle
- verify local/client fit
- improve CTA strength where appropriate
- keep this content-only; do not add image generation behavior

Current draft JSON:
${JSON.stringify(draft)}

Return only the final improved JSON that still matches the schema.`;
}

async function main() {
  const context = await get(`/internal/discord/approved-jobs/${jobId}/context`);
  const job = context.job;
  const slotSummaries = Array.isArray(context.slots) ? context.slots : [];

  if (!job || !slotSummaries.length) {
    await post(`/internal/discord/approved-jobs/${jobId}/fail`, {
      error: 'No queued slot requests found for approved Claude job.',
      run_id: JSON.parse(job?.args_json ?? '{}').run_id ?? null,
    });
    return;
  }

  const args = JSON.parse(job.args_json);
  const total = slotSummaries.length;

  await post('/internal/discord/notify', {
    content: `🧠 Claude Code started weekly content job\nRun ID: \`${args.run_id}\`\nRunner: \`${runnerId}\`\nSlots: ${total}`,
  });

  await post(`/internal/discord/approved-jobs/${jobId}/log`, {
    run_id: args.run_id,
    level: 'START',
    message: `Approved Claude runner ${runnerId} started command ${job.command_name} for ${total} slot(s)`,
  });

  let completed = 0;

  for (const summary of slotSummaries) {
    const prefix = `${summary.client_slug} / ${summary.publish_date} / ${summary.content_type}`;
    await post(`/internal/discord/approved-jobs/${jobId}/log`, {
      run_id: args.run_id,
      level: 'AI',
      message: `Claude Code generating slot ${summary.slot_idx + 1}/${total}: ${prefix}`,
    });

    let slotReq;
    try {
      slotReq = await get(`/internal/discord/approved-jobs/${jobId}/slot-request/${summary.slot_idx}`);
    } catch (err) {
      await post(`/internal/discord/approved-jobs/${jobId}/log`, {
        run_id: args.run_id,
        level: 'ERROR',
        message: `Slot ${summary.slot_idx + 1} prompt build failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const draft = await runClaude(slotReq.prompt, slotReq.schema);
    const reviewed = await runClaude(buildReviewPrompt(slotReq.prompt, draft), slotReq.schema);

    await post(`/internal/discord/approved-jobs/${jobId}/save-slot`, {
      run_id: args.run_id,
      slot_idx: summary.slot_idx,
      post: reviewed,
    });

    completed += 1;
    await post(`/internal/discord/approved-jobs/${jobId}/log`, {
      run_id: args.run_id,
      level: 'INFO',
      message: `Claude Code saved slot ${summary.slot_idx + 1}: ${prefix}`,
    });

    await post('/internal/discord/notify', {
      content: `⏳ Claude Code progress for run \`${args.run_id}\`: ${completed}/${total} slots saved`,
    });
  }

  await post(`/internal/discord/approved-jobs/${jobId}/complete`, {
    result_json: {
      run_id: args.run_id,
      completed_slots: completed,
      requested_slots: total,
      provider: 'claude',
      runner_id: runnerId,
    },
  });
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
      content: `❌ Claude Code weekly content job failed\nJob ID: \`${jobId}\`\n${err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)}`,
    });
  } catch (innerErr) {
    console.error('Failed to report approved job failure:', innerErr);
  }
  process.exit(1);
});
