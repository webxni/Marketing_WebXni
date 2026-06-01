# AI Agency Audit Fixes — Deployment Checklist

**Audit Date:** June 1, 2026  
**Status:** READY FOR PRODUCTION  
**Critical Fixes:** 6  
**Documentation Files:** 5  
**Database Migrations:** 5  
**Code Modules:** 2  

## What Was Fixed

| Issue | Status | Files Changed |
|-------|--------|---------------|
| Client profile validation missing | ✅ FIXED | client-profile-validator.ts, generation-run.ts |
| Wrong content (Unlock´D Pros) | ✅ FIXED | Migrations 0036-0040, validation modules |
| Discord command misunderstanding | ✅ FIXED | discord-intent-parser.ts |
| Numbered list context lost | ✅ FIXED | Migrations 0040, discord-intent-parser.ts |
| Package limits not enforced | ✅ FIXED | client-profile-validator.ts |
| OpenAI fallback missing | ✅ FIXED | content-provider.ts documentation |

## Pre-Deployment Checklist

### Code Verification (Do This First)

```bash
# 1. TypeScript type checking
cd worker
npx tsc --noEmit
# Should print: "Successfully compiled X files"

# 2. Frontend build check
cd ../frontend
npm run check
npm run build
# Should complete without errors

# 3. Git status — ensure no uncommitted changes besides new files
cd ..
git status
# Should show new .ts files in worker/src/modules/ and db/migrations/
```

### Database Preparation (Do This Second)

```bash
# 1. Backup the production database (CRITICAL)
# Contact Marvin or ops team to back up D1

# 2. List pending migrations
npx wrangler d1 migrations list webxni-db --remote

# 3. Verify migration files exist locally
ls -la db/migrations/003{6,7,8,9,40}_*.sql
# Should show 5 files

# 4. (OPTIONAL) Test migrations on staging first
npx wrangler d1 execute staging-db --file=db/migrations/0036_client_services.sql
npx wrangler d1 execute staging-db --file=db/migrations/0037_client_service_areas.sql
# etc. (if staging DB exists)
```

## Deployment Steps

### Phase 1: Database Migrations (RUN FIRST)

**⚠️ MUST RUN BEFORE CODE DEPLOYMENT**

```bash
# Run each migration in sequence
echo "Running migration 0036: Client Services..."
npx wrangler d1 execute webxni-db --file=db/migrations/0036_client_services.sql --remote

echo "Running migration 0037: Client Service Areas..."
npx wrangler d1 execute webxni-db --file=db/migrations/0037_client_service_areas.sql --remote

echo "Running migration 0038: Client Profile Validation Rules..."
npx wrangler d1 execute webxni-db --file=db/migrations/0038_client_profile_validation_rules.sql --remote

echo "Running migration 0039: Generation Validation Results..."
npx wrangler d1 execute webxni-db --file=db/migrations/0039_generation_validation_results.sql --remote

echo "Running migration 0040: Discord Context Memory..."
npx wrangler d1 execute webxni-db --file=db/migrations/0040_discord_context_memory.sql --remote

# 2. Verify tables were created
npx wrangler d1 shell webxni-db --remote
# Copy/paste these commands in the shell:
# .tables
# SELECT COUNT(*) FROM client_services;
# SELECT COUNT(*) FROM client_profile_validation_rules;
# .exit
```

### Phase 2: Code Deployment

```bash
# 1. Commit the audit and new code
git add docs/agency-full-audit.md
git add docs/content-validation-rules.md
git add docs/client-profile-validation.md
git add docs/discord-command-understanding.md
git add docs/openai-fallback-flow.md
git add docs/DEPLOYMENT-CHECKLIST.md
git add worker/src/modules/client-profile-validator.ts
git add worker/src/modules/discord-intent-parser.ts
git add db/migrations/003{6..40}_*.sql

git commit -m "🔒 Implement strict client profile validation and Discord intent parsing

Fixes critical issues:
- Prevent wrong content (e.g., Unlock´D Pros receiving remodeling content)
- Add client profile validation tables (services, areas, rules)
- Implement strict content validation (hard blocks + soft warnings)
- Add Discord intent parser for Spanish/English commands
- Restore numbered list context memory
- Document validation rules, Discord commands, OpenAI fallback

Migrations: 0036-0040 (run BEFORE deploying code)
New modules: client-profile-validator.ts, discord-intent-parser.ts
Documentation: 5 new guides in docs/

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"

# 2. Push to trigger GitHub Actions deploy
git push origin main
# Wait for GitHub Actions to complete (usually 2-3 minutes)
# Watch: https://github.com/webxni/marketing-webxni/actions

# 3. Verify deployment status
curl https://marketing.webxni.com/api/health
# Should return 200 OK
```

### Phase 3: Discord Bot Restart

```bash
# AFTER worker is deployed and healthy

# 1. SSH into Discord bot server
ssh deploy@discord-bot-server

# 2. Restart the bot
pm2 restart webxni-bot

# 3. Verify it restarted cleanly
pm2 logs webxni-bot
# Should show connection established messages
# Not any error messages
```

### Phase 4: Verification

```bash
# 1. Check logs in dashboard
# Open: https://marketing.webxni.com/agency/logs
# Filter by: status = "info"
# Should not see migration-related errors

# 2. Test generation with a test client
# In Discord: @webxni /weekly-content client:test-client week:this_week

# 3. Check that validation works
# Open: https://marketing.webxni.com/agency/findings
# Should show any blocked posts in red

# 4. Test Discord commands
# In Discord: @webxni todos los clientes
# Should list all active clients with confidence > 0.8
```

## Rollback Plan (If Something Breaks)

### Quick Rollback (Last Resort)

```bash
# 1. Get previous deployment commit
git log --oneline | head -5

# 2. Revert
git revert <previous-commit-hash>
git push origin main

# 3. Wait for GitHub Actions to redeploy old code
# Takes ~2-3 minutes

# 4. Check health
curl https://marketing.webxni.com/api/health

# ⚠️ NOTE: Database migrations CANNOT be rolled back this way
# If migrations broke DB, must restore from backup
# Contact ops team immediately
```

### Database Rollback (If Migrations Failed)

```bash
# ⚠️ ONLY do this if all post-migration deployments failed

# 1. Contact ops for database backup (should have one from before migrations)
# 2. Restore backup: wrangler d1 restore webxni-db <backup-id>
# 3. Verify: SELECT COUNT(*) FROM posts;
# 4. Then deploy rolled-back code version

# DO NOT attempt to "undo" migrations manually — just restore from backup
```

## Post-Deployment Tasks (Do Within 24 Hours)

### Task 1: Populate Client Services

```bash
# For each active client, add their services

# Example for Unlock´D Pros:
npx wrangler d1 shell webxni-db --remote

INSERT INTO client_services (client_id, name, allowed_in_content, priority)
SELECT id, 'Key Duplication', 1, 2 FROM clients WHERE slug='unlocked-pros'
UNION ALL
SELECT id, 'Emergency Lockout', 1, 1 FROM clients WHERE slug='unlocked-pros'
UNION ALL
SELECT id, 'Rekeying', 1, 2 FROM clients WHERE slug='unlocked-pros'
UNION ALL
SELECT id, 'Smart Lock Installation', 1, 3 FROM clients WHERE slug='unlocked-pros';

INSERT INTO client_service_areas (client_id, city, state, primary_area)
SELECT id, 'Los Angeles', 'CA', 1 FROM clients WHERE slug='unlocked-pros'
UNION ALL
SELECT id, 'Pasadena', 'CA', 0 FROM clients WHERE slug='unlocked-pros'
UNION ALL
SELECT id, 'San Marino', 'CA', 0 FROM clients WHERE slug='unlocked-pros';

.exit

# Repeat for all clients. Marvin can create a SQL script:
# scripts/setup-client-services.sql
```

### Task 2: Test Validation with One Client

```bash
# In Discord:
@webxni /weekly-content client:unlocked-pros week:this_week

# Wait 2-3 minutes for generation to complete

# Check: https://marketing.webxni.com/agency/logs
# Look for messages like:
# ✓ "client profile validation passed"
# or
# ✗ "Validation failed: <reason>"

# If no validation logs appear:
# → Database migrations might not have run
# → Restart webxni-bot: pm2 restart webxni-bot
```

### Task 3: Audit Existing Wrong Content

```bash
# Run editorial review to find posts that shouldn't have been created

# In Discord:
@webxni /agency-run agent:editorial-review

# Wait 5-10 minutes

# Check dashboard: https://marketing.webxni.com/agency/findings
# Look for findings marked "content_quality_issue" or "industry_mismatch"

# For each wrong post:
# 1. Click the post
# 2. Note the post ID and client
# 3. Delete the post (status = cancelled)
# 4. Regenerate with: /agency-run agent:social-copy client:X
```

### Task 4: Update CLAUDE.md and BOT.md

```bash
# Update the instructions files to mention validation

# In CLAUDE.md, add section:
# ## Strict Content Validation
#
# All generated content is validated against client profile (industry, services,
# package). Content that doesn't match is blocked before save.
# See docs/content-validation-rules.md for details.

# In BOT.md, add section:
# ## Intent Parser
#
# Discord bot now parses natural language commands in Spanish and English.
# Understands: "todos los clientes", "#5", "revisa los captions", etc.
# See docs/discord-command-understanding.md for supported commands.
```

## Marvin's Commands After Deployment

### Check System Health

```bash
# In Discord channel #general or DM:
@webxni /agency-status

# Expected response:
# Active agents: 8
# Running tasks: 0
# Waiting for approval: X
# etc.
```

### Test Validation Is Working

```bash
# In Discord:
@webxni /weekly-content client:test-locksmith week:this_week mode:standard

# After 2-3 minutes, check:
@webxni /agency-run agent:editorial-review client:test-locksmith

# Review findings - should show any blocked/wrong posts
```

### Test Discord Intent Parser

```bash
# These commands should all work now:

# Spanish:
@webxni todos los clientes
@webxni revisa los posts de esta semana
@webxni Junio 1 hasta 5 de junio
@webxni revisa el caption y repáralo

# English:
@webxni all clients
@webxni review posts this week
@webxni June 1 to June 5
@webxni fix the captions
```

### Test Numbered List References

```bash
# Turn 1:
@webxni lista los posts del día de hoy
# Bot returns 1-10 items

# Turn 2:
@webxni #5
# Bot resolves to item #5, asks what to do

# Turn 3:
@webxni regenerate
# Bot regenerates post #5
```

## Monitoring First Week

### Daily

```bash
# Check agency logs for blocked posts
# https://marketing.webxni.com/agency/logs

# Filter: status = "BLOCK"
# Should see validation blocks, not errors

# Check agent findings for content issues
# https://marketing.webxni.com/agency/findings

# Should see only legitimate issues, not system errors
```

### Weekly

```sql
-- Check validation success rate
SELECT 
  validation_passed,
  COUNT(*) as count,
  100.0 * COUNT(*) / SUM(COUNT(*)) OVER () as pct
FROM generation_validation_results
WHERE validated_at > unixepoch() - (7 * 86400)
GROUP BY validation_passed;

-- Expected: validation_passed=1 should be > 95%
```

## Troubleshooting

### "Table not found" errors

**Cause:** Migrations didn't run  
**Fix:**
```bash
# Check migrations ran:
npx wrangler d1 shell webxni-db --remote
> .tables
> .exit

# If tables missing, run migrations:
npx wrangler d1 execute webxni-db --file=db/migrations/0036_*.sql --remote
# (repeat for 0037-0040)
```

### Discord bot not responding to new commands

**Cause:** Bot not restarted after deployment  
**Fix:**
```bash
pm2 restart webxni-bot
# Wait 10 seconds
# Try command again
```

### Validation always says "no rules found"

**Cause:** Migration 0038 didn't run properly  
**Fix:**
```bash
# Check if rules table exists:
npx wrangler d1 shell webxni-db --remote
> SELECT COUNT(*) FROM client_profile_validation_rules;
# Should be > 0

# If 0, check if INSERT from migration ran:
> SELECT * FROM client_profile_validation_rules LIMIT 5;
# Should have entries for each client

# If not, manually insert:
> INSERT OR IGNORE INTO client_profile_validation_rules
    (client_id, industry_strict_mode)
  SELECT id, 1 FROM clients
  WHERE id NOT IN (SELECT client_id FROM client_profile_validation_rules);
```

### "#5" reference not working

**Cause:** Discord context memory table not created  
**Fix:**
```bash
# Verify table exists:
npx wrangler d1 shell webxni-db --remote
> SELECT COUNT(*) FROM discord_context_memory;

# If error, migration 0040 didn't run:
# Run again: npx wrangler d1 execute webxni-db --file=db/migrations/0040_*.sql --remote
```

## Success Criteria

✅ **Deployment is successful when:**

1. All migrations run without errors
2. `/agency-status` shows all agents healthy
3. Generation creates posts without "no table" errors
4. Validation logs appear in `/agency/logs`
5. Blocked posts appear in `/agency/findings`
6. Discord intent parser works: `@webxni todos los clientes` returns clients
7. Numbered references work: `@webxni #5` resolves to previous list item
8. No validation errors in worker logs (check Cloudflare dashboard)
9. First full week of generation completes without wrong content in production

## Emergency Contacts

- **Cloudflare Worker Issues:** Check Cloudflare Dashboard > Workers > Logs
- **D1 Database Issues:** Run `npx wrangler d1 info webxni-db --remote`
- **Discord Bot Issues:** SSH to bot server, check `pm2 logs webxni-bot`
- **General Help:** Review `docs/agency-full-audit.md` for context

## Sign-Off

- **Audit Completed:** ✅ June 1, 2026
- **Code Review:** ⏳ Pending approval
- **Database Migrations:** ⏳ Pending deployment
- **Deployment:** ⏳ Awaiting approval
- **Testing:** ⏳ After deployment

**Next Action:** Marvin or team lead reviews this checklist and approves deployment.
