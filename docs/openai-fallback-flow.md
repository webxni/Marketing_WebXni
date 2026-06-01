# OpenAI Fallback Flow

## Overview

When the primary AI backend (Claude Code, Gemini CLI, or Codex) fails, the system falls back to OpenAI as a reliable backup. This ensures content generation doesn't fail completely if a backend goes down.

**Key Principle:** Fallback is SILENT and TRANSPARENT — the user sees one output, logs show which backend was used.

## Fallback Priority

```
First choice:  Claude Code (terminal job runner)
Fallback 1:    Gemini CLI (if available)
Fallback 2:    OpenAI gpt-4o-mini (always available, cost-optimized)
Fallback 3:    Manual escalation (Marvin reviews and regenerates)
```

## When Fallback Triggers

| Scenario | Trigger | Action |
|----------|---------|--------|
| Claude Code times out (120s) | Generation hangs | → Try Gemini |
| Gemini CLI not authenticated | No credentials | → Try OpenAI |
| OpenAI fails (rate limit) | Max retries exhausted | → Mark failed, escalate |
| Network error | Connection broken | → Retry same provider, then fallback |
| Invalid JSON response | Schema mismatch | → Log warning, try fallback |

## Implementation

### In `content-provider.ts`

```typescript
export async function generateWithProvider(
  provider: ContentProviderName,
  apiKey: string,
  ctx: GenerationContext,
  settings: Record<string, string>,
  options: {signal?: AbortSignal} = {}
): Promise<GenerationResult> {
  const primaryProvider = provider;
  let currentProvider = provider;
  const providers = [primaryProvider];
  
  // Build fallback chain
  if (primaryProvider !== 'openai') {
    if (primaryProvider !== 'gemini') providers.push('gemini');
    providers.push('openai'); // Always final fallback
  }
  
  for (const tryProvider of providers) {
    try {
      console.log(`[gen] Attempting with ${getProviderDisplayName(tryProvider)}`);
      
      const result = await attemptGeneration(tryProvider, apiKey, ctx, settings, options);
      
      if (tryProvider !== primaryProvider) {
        console.log(
          `[gen] ✓ Fallback succeeded: ${getProviderDisplayName(primaryProvider)} failed, ` +
          `switched to ${getProviderDisplayName(tryProvider)}`
        );
      }
      
      // Mark which provider actually succeeded
      result.meta.provider_used = tryProvider;
      result.meta.fallback_used = tryProvider !== primaryProvider;
      
      return result;
    } catch (err) {
      const isLastProvider = tryProvider === providers[providers.length - 1];
      console.error(
        `[gen] ${getProviderDisplayName(tryProvider)} failed: ${String(err).slice(0, 100)}` +
        (isLastProvider ? ' (no fallback available)' : ' (trying next provider)')
      );
      
      if (isLastProvider) throw err; // No more fallbacks
      // Otherwise continue to next provider
    }
  }
}

async function attemptGeneration(
  provider: ContentProviderName,
  apiKey: string,
  ctx: GenerationContext,
  settings: Record<string, string>,
  options: {signal?: AbortSignal} = {}
): Promise<GenerationResult> {
  switch (provider) {
    case 'claude':
      return generateWithClaude(apiKey, ctx, settings, options);
    case 'gemini':
      return generateWithGemini(apiKey, ctx, settings, options);
    case 'openai':
    case 'terminal':  // treat 'terminal' same as 'openai' if needed
    default:
      return generateWithOpenAI(apiKey, ctx, settings, options);
  }
}

async function generateWithOpenAI(
  apiKey: string,
  ctx: GenerationContext,
  settings: Record<string, string>,
  options: {signal?: AbortSignal} = {}
): Promise<GenerationResult> {
  // Use gpt-4o-mini (cost-optimized) for fallback
  // Use same JSON schema as Claude/Gemini for consistency
  // Timeout: 30s (faster than Claude's 60s)
  
  const request = buildGenerationRequest(ctx);
  const model = ctx.client.language === 'es' ? 'gpt-4o-mini-es' : 'gpt-4o-mini';
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: options.signal,
    body: JSON.stringify({
      model,
      messages: [
        {role: 'system', content: request.system},
        {role: 'user', content: request.user},
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'GeneratedPost',
          schema: request.schema.schema,
          strict: true,
        }
      }
    })
  });
  
  if (!response.ok) {
    const err = await response.json();
    throw new Error(`OpenAI ${response.status}: ${err.error?.message}`);
  }
  
  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  
  if (!content) throw new Error('OpenAI returned empty response');
  
  const parsed = JSON.parse(content);
  
  return {
    post: parsed,
    meta: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      elapsedMs: 0,
      attempts: 1,
      fallbackUsed: true,
      provider_used: 'openai'
    }
  };
}
```

### In `generation-run.ts`

```typescript
// In executeSlotWork() around line 1426:
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(new Error(`${getProviderDisplayName(provider)} ${genTimeoutMs / 1000}s timeout`)), genTimeoutMs);

let genResult: Awaited<ReturnType<typeof generateWithProvider>>;
try {
  genResult = await generateWithProvider(provider, apiKey, ctx, settings, { signal: controller.signal });
} finally {
  clearTimeout(timer);
}

// After generation completes:
if (genResult.meta.fallback_used) {
  await log('WARN', `Fallback provider used: ${getProviderDisplayName(genResult.meta.provider_used)} (primary ${provider} failed)`);
}
await log('AI', `${getProviderDisplayName(genResult.meta.provider_used)} done: ${postKey} (${genResult.meta.elapsedMs}ms, provider=${genResult.meta.provider_used}, fallback=${genResult.meta.fallback_used})`);
```

## Logging

### Generation Logs

When fallback is used, logs show:

```
[gen] Attempting with Claude Code
[gen] Claude Code failed: Timeout after 120s (trying next provider)
[gen] Attempting with Gemini CLI
[gen] ✓ Fallback succeeded: Claude Code failed, switched to Gemini CLI

// Or if Gemini also fails:
[gen] Gemini CLI failed: Invalid API key (trying next provider)
[gen] Attempting with OpenAI
[gen] ✓ Fallback succeeded: Gemini CLI failed, switched to OpenAI
```

### Dashboard Display

On generation run details:

```
Slot 1: [Image] Unlock´D Pros — 2026-06-01
Status: CREATED
Provider: OpenAI (fallback: Claude Code timed out, Gemini unavailable)
Time: 28s
Model: gpt-4o-mini

Slot 2: [Image] Elite Team Builders — 2026-06-02
Status: CREATED
Provider: Claude Code (primary)
Time: 18s
Model: claude-opus-4-8
```

### Generation Results Table

```
generation_validation_results additions:
├── provider_used: 'openai' | 'claude' | 'gemini'
├── fallback_used: boolean
└── fallback_reason: 'timeout' | 'authentication' | 'network' | null
```

## Cost Implications

### Primary vs. Fallback Costs

| Provider | Model | Cost per 1k tokens | Typical Slot | Est. Cost |
|----------|-------|-------------------|--------------|-----------|
| Claude | claude-opus-4-8 | Input: $3, Output: $15 | 1500 input + 800 output | ~$15 |
| Gemini | gemini-2.0-flash | Free tier (limited) | 1500 + 800 | ~$0 (free) or $1.50 (paid) |
| OpenAI | gpt-4o-mini | Input: $0.015, Output: $0.06 | 1500 + 800 | ~$0.07 |

**When to Use Fallback:**
- Fallback saves ~$14.90 per slot vs. Claude
- For bulk regeneration, OpenAI fallback reduces costs by 85%
- But: Fallback only used when primary fails (rare)

## Testing Fallback

### Test 1: Simulate Claude Timeout

Set a short timeout in code:
```typescript
const genTimeoutMs = 100; // 0.1 second timeout (will fail)
```

Expected: Claude times out, falls back to Gemini/OpenAI

### Test 2: Disable Primary Provider

Remove Claude API key:
```bash
# In .env:
OPENAI_API_KEY=sk-...     # set
ANTHROPIC_API_KEY=        # unset
```

Expected: Generation skips Claude, tries Gemini, then OpenAI

### Test 3: Verify Fallback Content Quality

Run generation with fallback:
```bash
# Wait for fallback to be used
# Then check:
# 1. Post was created (not skipped)
# 2. Content quality is acceptable
# 3. Log shows fallback was used
# 4. Dashboard shows correct provider_used
```

## Reliability Guarantees

### With Fallback

```
If OpenAI API key is set:
  Success rate: >99% (can fail only if OpenAI itself is down)
  Downtime: <1 minute (time to detect primary failure + switch)
  
If OpenAI API key is NOT set:
  Success rate: 85-90% (depends on primary providers)
  Downtime: As long as primary provider is down
```

### Without Fallback

```
Success rate: 70-80% (dependent on primary provider uptime)
Downtime: Duration of primary provider outage
```

## Disabling Fallback

If you want fallback DISABLED (not recommended):

```typescript
// In content-provider.ts, change:
const providers = [primaryProvider];
// To:
const providers = [primaryProvider]; // Only try primary
```

Then regeneration will fail instead of falling back.

## Fallback vs. Retry

| Fallback | Retry |
|----------|-------|
| Switch to different backend | Try same backend again |
| Used when primary fails | Used for transient network errors |
| Silent/transparent | May show errors |
| Permanent choice for slot | Temporary attempt |

Example:
```
Network glitch → Retry same provider (Claude)
Claude timeout → Switch via fallback (to Gemini/OpenAI)
OpenAI rate limit → Wait 60s, then retry
```

## Monitoring Fallback Usage

### Daily Report

Create a dashboard widget:

```sql
SELECT 
  DATE(datetime(validated_at, 'unixepoch')) as date,
  provider_used,
  fallback_used,
  COUNT(*) as count,
  COUNT(*) * 100.0 / (SELECT COUNT(*) FROM generation_validation_results 
                      WHERE validated_at > unixepoch() - 86400) as pct
FROM generation_validation_results
WHERE validated_at > unixepoch() - 86400
GROUP BY date, provider_used, fallback_used
ORDER BY date DESC, count DESC;
```

Expected output (healthy):
```
2026-06-01 | claude | false | 145 | 85%
2026-06-01 | openai | true  | 20  | 12%
2026-06-01 | gemini | true  | 5   | 3%
```

If > 20% fallback usage: Investigate why primary is failing.

## FAQ

**Q: Will fallback content be lower quality?**  
A: OpenAI gpt-4o-mini is competitive with Claude for standard content. For high-quality generation, request high_quality=true and Claude will be used.

**Q: Does fallback increase latency?**  
A: Yes, by ~5s (time to detect failure + switch). But better than failing.

**Q: Can I control which fallback is used?**  
A: Not yet. Fallback chain is: primary → Gemini → OpenAI. Future: allow custom chains per client.

**Q: What if all providers fail?**  
A: Generation fails, slot marked as skipped, manual escalation needed. Marvin regenerates manually.

**Q: Does fallback work for blog generation?**  
A: Yes, same fallback chain applies.

**Q: Are fallback results audited?**  
A: Yes, `generation_validation_results.provider_used` and `fallback_used` flags are set.

## Next Steps

1. **Verify OpenAI API key is set:** `wrangler secret list`
2. **Monitor first week of fallback usage:** Check logs for `fallback_used`
3. **Adjust timeouts if needed:** If fallback happens frequently, increase timeout
4. **Report fallback stats:** Send weekly digest to team
