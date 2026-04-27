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

function runClaude(prompt, schema) {
  const schemaStr = JSON.stringify(schema);
  const args = [
    '-p',
    '--output-format', 'text',
    '--model', 'sonnet',
    '--tools', '',
    '--json-schema', schemaStr,
    prompt,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: process.cwd(),
      shell: false,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (err) {
        reject(new Error(`Failed to parse Claude output: ${String(err)}\n${stdout.slice(0, 500)}`));
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
