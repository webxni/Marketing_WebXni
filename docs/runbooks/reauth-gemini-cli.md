# Runbook: Re-authenticate the Gemini CLI (executor backend)

## Symptom
The `gemini` CLI fails with:

```
Error authenticating: IneligibleTierError: This client is no longer supported for
Gemini Code Assist for individuals. To continue using Gemini, please migrate to
the Antigravity suite of products.
```

Google deprecated the **free individual "Code Assist" OAuth tier** the CLI was
logged in with. Until fixed, the agency harness keeps Gemini **out of the lead**
(it would just fail and fall back to Hermes). Claude + Codex + Hermes still work.

## Fix (recommended): switch Gemini CLI to API-key mode
API-key mode does not use the deprecated Code Assist tier.

1. Create a Gemini API key at <https://aistudio.google.com/apikey> (free tier
   available; or use a billed Google Cloud project for higher limits).
2. Add it to the Discord bot environment (the host that runs the agency scripts):
   ```bash
   echo 'GEMINI_API_KEY=AIza...your_key...' >> ~/projects/Marketing_WebXni/discord-bot/.env
   ```
3. Restart the bot so the scripts inherit it:
   ```bash
   pm2 restart webxni-bot --update-env
   ```
4. Verify (should print JSON, not an auth error):
   ```bash
   GEMINI_API_KEY=AIza... gemini -p "Reply with just: ok" -o json -m gemini-2.5-flash
   ```

The runner's `runGemini` (scripts/lib/terminal-json-agent.mjs) spawns `gemini`
with `process.env`, so `GEMINI_API_KEY` is picked up automatically — no code
change needed for auth.

## Alternative: re-login via OAuth on an eligible plan
If you have a Gemini Code Assist Standard/Enterprise (paid) account, run `gemini`
once interactively on the host and complete the browser login with that account.

## After auth is restored — put Gemini back in rotation
Tell Claude Code (or edit directly): in `scripts/lib/executor-router.mjs`,
`taskTypeForAgent` should map `client-research` → `'research'` so Gemini leads
fast/cheap research passes (Hermes stays as fallback). Gemini is currently left
as a fallback only. Then redeploy/restart.

## Verify it's actually being used
```sql
-- recent executor usage (run against webxni_db)
SELECT backend, COUNT(*) n, MAX(datetime(created_at,'unixepoch')) latest
FROM agency_cost_log WHERE created_at >= unixepoch()-86400 GROUP BY backend;
```
You should start seeing `gemini` rows once research runs route to it.
