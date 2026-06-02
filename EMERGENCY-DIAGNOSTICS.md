# 🚨 EMERGENCY: Generation Failures Diagnosis & Fix

**Current Status:** CRITICAL  
**Failed Jobs:** 1+  
**Generation Failures:** HIGH severity x 8  
**Authentication Errors:** Present  
**Posts Stuck in Draft:** All clients (27+ posts, 0 approved)  

---

## 🔍 Root Cause Analysis

Based on dashboard, the failures are likely:

1. **Migraciones NO ejecutadas** (MOST LIKELY)
   - Code expects `client_profile_validation_rules` table
   - Queries fail with "table not found"
   - Worker times out → generation fails

2. **Validación bloqueando TODO**
   - If migrations ran but validation is broken
   - Every post gets blocked (0 approved posts symptom)

3. **Authentication error**
   - API keys expired or misconfigured
   - Claude/Gemini API calls failing

4. **Code bug introduced**
   - Recent deployment broke something
   - Need to check logs

---

## ⚡ IMMEDIATE DIAGNOSTIC STEPS

### Step 1: Check if Migrations Ran

```bash
npx wrangler d1 shell webxni-db --remote

# List all tables
.tables

# Should see these NEW tables:
# - client_services
# - client_service_areas  
# - client_profile_validation_rules
# - generation_validation_results
# - discord_context_memory

# If they don't exist → MIGRATIONS NOT RUN

.exit
```

**If tables don't exist:** Go to "STEP 2: RUN MIGRATIONS NOW"

### Step 2: Check Validation Rules

```bash
npx wrangler d1 shell webxni-db --remote

SELECT COUNT(*) as rule_count FROM client_profile_validation_rules;
# Should be > 0 (auto-populated during migration)

# If 0 → Rules not populated → validation broken

.exit
```

### Step 3: Check Recent Generation Errors

```bash
npx wrangler d1 shell webxni-db --remote

SELECT 
  error_message,
  COUNT(*) as count
FROM generation_runs
WHERE status='failed'
  AND created_at > unixepoch('now', '-86400')  -- Last 24 hours
GROUP BY error_message
LIMIT 10;

.exit
```

**Look for:**
- "table not found" → migrations not run
- "validation_rules not found" → validation broken
- "API error" → authentication issue
- "timeout" → worker timeout (code hanging)

### Step 4: Check Worker Logs

Open: https://dash.cloudflare.com

Navigate to: **Workers → Logs**

Search for errors in the last 24 hours

**Look for:**
```
[ERROR] Table "client_profile_validation_rules" not found
[ERROR] Failed to query validation rules
[ERROR] Timeout after 600s
[ERROR] Authentication failed
```

---

## 🔧 IMMEDIATE FIX SEQUENCE

### IF MIGRATIONS DIDN'T RUN:

```bash
chmod +x scripts/deploy-migrations.sh
./scripts/deploy-migrations.sh
```

Then:
```bash
pm2 restart webxni-bot
```

Then test:
```
@webxni /weekly-content client:test-locksmith week:this_week
```

### IF MIGRATIONS RAN BUT RULES NOT POPULATED:

```bash
npx wrangler d1 shell webxni-db --remote

-- Check current count
SELECT COUNT(*) FROM client_profile_validation_rules;

-- If 0, populate:
INSERT INTO client_profile_validation_rules (client_id, industry_strict_mode)
SELECT id, 1 FROM clients 
WHERE id NOT IN (SELECT client_id FROM client_profile_validation_rules);

-- Verify
SELECT COUNT(*) FROM client_profile_validation_rules;

.exit
```

### IF AUTHENTICATION ERROR:

Check: **Settings → Environment Variables** in Cloudflare/Discord bot

Verify:
- `ANTHROPIC_API_KEY` is valid
- `GEMINI_API_KEY` is valid (if using Gemini)
- `DISCORD_TOKEN` is valid

If expired:
1. Generate new keys from Anthropic/Google/Discord
2. Update environment variables
3. Restart bot: `pm2 restart webxni-bot`

### IF CODE BUG:

Check recent commits:
```bash
git log --oneline -10

# If last commits are:
# 325aca4 Add June 3 orchestration
# ca46938 Add urgent fix guide
# f7cbd34 Replace all draft posts script
# 58097a7 Complete audit execution guides

# REVERT to before validation code:
git revert 58097a7...f2fa9fb
```

---

## 📊 Quick Status Check Commands

```bash
# How many posts are stuck in draft?
npx wrangler d1 query webxni-db "SELECT COUNT(*) FROM posts WHERE status='draft';" --json

# How many validation rules?
npx wrangler d1 query webxni-db "SELECT COUNT(*) FROM client_profile_validation_rules;" --json

# Any generation failures in last hour?
npx wrangler d1 query webxni-db "SELECT COUNT(*) FROM generation_runs WHERE status='failed' AND created_at > unixepoch('now', '-3600');" --json

# Validation success rate?
npx wrangler d1 query webxni-db "SELECT SUM(CASE WHEN validation_passed=1 THEN 1 ELSE 0 END) as passed, COUNT(*) as total FROM generation_validation_results WHERE validated_at > unixepoch('now', '-3600');" --json
```

---

## 🎯 DECISION TREE

```
Are migrations tables present?
├─ YES: Go to "Validation Broken"
└─ NO: Run ./scripts/deploy-migrations.sh → Restart bot → Test

Validation Broken?
├─ Rules count = 0: Populate with SQL INSERT → Test
├─ Rules count > 0: Check generation errors in logs
└─ Other: Check worker logs for specific error

All posts stuck in draft (0 approved)?
├─ Validation blocking everything: Check client_services populated
├─ Authentication error: Update API keys
└─ Code bug: Revert to last working commit

Authentication error?
├─ API key expired: Update environment variables
├─ API rate limited: Wait 1 hour, retry
└─ Token invalid: Generate new token, restart bot

Still failing?
├─ Check Cloudflare Worker logs
├─ Check Discord bot logs: pm2 logs webxni-bot
└─ Contact support with full error message
```

---

## 🚨 PRIORITY FIXES (In Order)

### 1. CRITICAL: Run Migrations (if not done)
```bash
./scripts/deploy-migrations.sh
pm2 restart webxni-bot
```
**Time:** 5 minutes

### 2. CRITICAL: Verify Rules Populated
```bash
npx wrangler d1 query webxni-db "SELECT COUNT(*) FROM client_profile_validation_rules;" --json
```
**Expected:** > 0  
**If 0:** Run SQL INSERT (see above)

### 3. HIGH: Test Generation
```
@webxni /weekly-content client:test-locksmith week:this_week
```
**Monitor:** https://marketing.webxni.com/agency/logs  
**Expected:** At least 1 post created

### 4. HIGH: Check Validation Working
```bash
npx wrangler d1 query webxni-db "SELECT validation_passed, COUNT(*) FROM generation_validation_results WHERE generated_at > unixepoch('now', '-3600') GROUP BY validation_passed;" --json
```
**Expected:** validation_passed=1 > 80%

### 5. MEDIUM: Delete Stuck Posts
```bash
npx wrangler d1 query webxni-db "UPDATE posts SET status='cancelled', cancelled_reason='Emergency cleanup' WHERE status='draft';" --json
```

### 6. MEDIUM: Restart Generation
```
@webxni /weekly-content client:all_active_clients week:this_week
```

---

## 📋 Detailed Troubleshooting

### Symptom: "Table not found" error

**Cause:** Migrations didn't run  
**Fix:**
```bash
./scripts/deploy-migrations.sh
pm2 restart webxni-bot
```

### Symptom: All posts blocked by validation

**Cause 1:** client_services table empty
```bash
npx wrangler d1 query webxni-db "SELECT COUNT(*) FROM client_services;" --json
# If 0, need to populate with services for each client
```

**Cause 2:** Validation rules too strict
```bash
npx wrangler d1 shell webxni-db --remote
SELECT industry_strict_mode FROM client_profile_validation_rules LIMIT 1;
# If 1, validation is strict (correct)
# Check if forbidden_topics is too broad
.exit
```

### Symptom: "Timeout after 600s" error

**Cause 1:** Infinite loop in validation code  
**Fix:** Check logs, revert if needed

**Cause 2:** Worker memory limit  
**Fix:** Optimize code or increase worker resources

**Cause 3:** Database query too slow  
**Fix:** Check query performance

### Symptom: Authentication error

**Cause:** Invalid API key  
**Fix:**
1. Generate new key from Anthropic/Google/Discord
2. Update environment variable
3. Restart bot

---

## ✅ Success Indicators

Once fixed, you should see:

- ✅ Posts being created (not all draft)
- ✅ Some posts approved (not 0/X)
- ✅ Validation logs showing pass/block decisions
- ✅ Editorial Review finding 0-2 legitimate issues
- ✅ No "table not found" errors
- ✅ No "authentication" errors

---

## 🔴 If Still Broken After All Steps

**Gather this info and share:**

1. Output of:
   ```bash
   ./scripts/deploy-migrations.sh
   ```

2. Output of:
   ```bash
   npx wrangler d1 shell webxni-db --remote
   > .tables
   > SELECT COUNT(*) FROM client_profile_validation_rules;
   > .exit
   ```

3. Last 50 lines of:
   ```bash
   pm2 logs webxni-bot | tail -50
   ```

4. Worker logs from:
   ```
   https://dash.cloudflare.com → Workers → Logs
   ```

5. Last error from:
   ```
   https://marketing.webxni.com/agency/logs
   ```

Then I'll provide remote fix.

---

## 🚀 EXECUTE NOW

1. Run migrations if not done:
   ```bash
   ./scripts/deploy-migrations.sh
   ```

2. Check status:
   ```bash
   npx wrangler d1 query webxni-db "SELECT COUNT(*) FROM client_profile_validation_rules;" --json
   ```

3. Restart bot:
   ```bash
   pm2 restart webxni-bot
   ```

4. Test:
   ```
   @webxni /weekly-content client:test-locksmith week:this_week
   ```

5. Report back what you find!

---

**Time estimate:** 10 minutes to diagnose + fix

**Next:** Reply with output of diagnostic commands above
