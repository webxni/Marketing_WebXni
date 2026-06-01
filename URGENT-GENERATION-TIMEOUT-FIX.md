# 🚨 URGENT: Generation Timeout Fix

**Job:** 6b4721f829...  
**Status:** STUCK (6+ hours, 0/6 slots completed)  
**Error:** Worker timeout after 600s  
**Time:** Started 2026-06-01 17:05:59Z  

---

## Root Cause (Most Likely)

**MIGRACIONES NO EJECUTADAS**

The code deployed from commits f2fa9fb, cef2836, 58097a7 references these tables:
- `client_profile_validation_rules`
- `generation_validation_results`
- `discord_context_memory`
- `client_services`
- `client_service_areas`

If these tables don't exist:
1. Code tries to query them
2. Gets "table not found" error
3. Worker crashes/times out after 600s
4. Job fails silently

---

## IMMEDIATE FIX (5 minutes)

### Step 1: STOP the current job

In dashboard: Click "Stop"

### Step 2: Run Migrations NOW

```bash
chmod +x scripts/deploy-migrations.sh
./scripts/deploy-migrations.sh
```

This will:
- Create all 5 required tables
- Populate default validation rules
- Enable validation to work

### Step 3: Verify Tables Exist

```bash
npx wrangler d1 shell webxni-db --remote

> .tables
(Should show: client_services, client_service_areas, 
client_profile_validation_rules, generation_validation_results, 
discord_context_memory)

> SELECT COUNT(*) as rules FROM client_profile_validation_rules;
(Should return: > 0)

> .exit
```

If COUNT is 0 → migration ran but didn't populate data → PROBLEM

### Step 4: Restart Discord Bot (if migrations ran)

```bash
pm2 restart webxni-bot
```

### Step 5: Try Generation Again

In Discord:
```
@webxni /weekly-content client:unlocked-pros week:this_week
```

Monitor: https://marketing.webxni.com/agency/logs

---

## Troubleshooting

### "Table not found" error

**Cause:** Migrations didn't run  
**Fix:** Execute `./scripts/deploy-migrations.sh` again

### "Validation rules not found"

**Cause:** Migration 0038 ran but didn't insert data  
**Fix:**
```bash
npx wrangler d1 shell webxni-db --remote

INSERT INTO client_profile_validation_rules (client_id, industry_strict_mode)
SELECT id, 1 FROM clients 
WHERE id NOT IN (SELECT client_id FROM client_profile_validation_rules);

.exit
```

### "Still timing out"

**Cause:** Code has a bug or infinite loop  
**Fix:**
1. Check Cloudflare Worker logs: https://dash.cloudflare.com
2. Look for errors in worker/src/routes/agency.ts around validation call
3. If error is in validation module, may need to revert deployment

---

## Quick Checklist

- [ ] Stop current job
- [ ] Run: `./scripts/deploy-migrations.sh`
- [ ] Verify tables exist (`.tables` command)
- [ ] Verify rules populated (COUNT > 0)
- [ ] Restart bot: `pm2 restart webxni-bot`
- [ ] Try generation again
- [ ] Monitor logs for errors
- [ ] Report back

---

## If Still Not Working

Send me:
1. Output of `./scripts/deploy-migrations.sh`
2. Output of `.tables` command
3. Output of `SELECT COUNT(*) FROM client_profile_validation_rules;`
4. Worker logs from Cloudflare dashboard
5. Full error message from `/agency/logs`

I'll provide remote fix.

---

## Expected Behavior (After Fix)

Once migrations run correctly:

1. Generation starts
2. Validation checks each post
3. Posts either save (validated) or get blocked (wrong content)
4. Logs show: "✓ Validation passed" or "✗ Validation blocked"
5. Job completes with N posts created

---

**EXECUTE THIS NOW** ⏰
