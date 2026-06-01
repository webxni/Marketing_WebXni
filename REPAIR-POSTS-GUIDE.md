# AI Agency — Repair Wrong Posts Guide

**Purpose:** Review existing posts for wrong content and repair them with validation in place  
**Timeline:** 1-2 hours (depends on number of wrong posts)  
**Prerequisites:** Deployment complete (migrations run, bot restarted)  

---

## Quick Overview

Wrong posts are identified → Validated wrong ones are deleted → System regenerates with validation

```
1. Run Editorial Review Agent
   ↓
2. Check findings dashboard
   ↓
3. Identify wrong posts (industry mismatch, forbidden topics, etc.)
   ↓
4. Delete each wrong post
   ↓
5. Regenerate posts with validation in place
   ↓
6. Verify new posts are correct
```

---

## Phase 1: Audit Existing Posts (15 minutes)

### Step 1.1: Run Editorial Review Agent

In Discord, run:
```
@webxni /agency-run agent:editorial-review
```

This agent will:
- Scan all existing draft/pending posts
- Check each for industry match, service validation, content quality
- Flag any issues with severity levels
- Generate audit findings

**Wait:** 10 minutes for agent to complete

### Step 1.2: Check Findings Dashboard

Open: https://marketing.webxni.com/agency/findings

Filter by:
- `agent_slug = editorial-review`
- `severity = warning` or `critical`

**Look for these issues:**
- `industry_mismatch` — Post topic doesn't match client industry
- `service_validation_error` — Post mentions services client doesn't offer
- `forbidden_topic_detected` — Topic is on client's forbidden list
- `content_quality_issue` — Generic quality problems

### Step 1.3: Export Wrong Posts List

In the dashboard, click "Export" to save findings as CSV

Expected columns:
```
post_id | client_id | client_name | issue_type | severity | topic | reason
```

---

## Phase 2: Categorize Wrong Posts (15 minutes)

### Categories

**Category A: Industry Mismatch (Most Common)**
- Example: Locksmith client with "Transform Your Kitchen"
- Action: DELETE immediately
- Why: Clearly wrong, no salvage value

**Category B: Service Validation Error**
- Example: Client mentions service they don't offer
- Action: DELETE immediately
- Why: Can't fix manually, regeneration is better

**Category C: Forbidden Topic**
- Example: Locksmith with "HVAC tips"
- Action: DELETE immediately
- Why: Explicitly forbidden in validation rules

**Category D: Content Quality Issues**
- Example: Generic intro, weak CTA, fluff
- Action: Consider fixing vs. regenerating
- If unclear: DELETE and regenerate (validation system will improve)

### Spreadsheet to Track

Create in `/tmp/repair-tracking.csv`:
```
post_id,client_id,client_name,issue_type,action,status,notes
```

Example:
```
post-123,unlock-pros-id,Unlock´D Pros,industry_mismatch,DELETE,pending,kitchen remodel content for locksmith
post-124,unlock-pros-id,Unlock´D Pros,forbidden_topic,DELETE,pending,HVAC tips for locksmith
post-125,hvac-pro-id,HVAC Pro,service_validation,DELETE,pending,mentions service not offered
post-126,remodel-pro-id,ReModel Pro,content_quality,REGENERATE,pending,weak CTA but on-topic
```

---

## Phase 3: Delete Wrong Posts (30 minutes)

### Option A: Dashboard Delete (Recommended for Small Batches)

For each wrong post:

1. Open: https://marketing.webxni.com/posts
2. Find post by title or date
3. Click post → "⋮ More Options" → "Change Status"
4. Select "Cancelled"
5. Click "Confirm"
6. Verify status changed to "cancelled"

**Example:**
```
Post: "Transform Your Kitchen" 
Client: Unlock´D Pros
Status: draft → cancelled ✓
```

### Option B: SQL Delete (Faster for Large Batches)

If you have 10+ posts to delete, use SQL:

```bash
# Connect to database
npx wrangler d1 shell webxni-db --remote

# Find wrong posts for a client
SELECT id, title, client_id, status, created_at 
FROM posts 
WHERE client_id = 'unlock-pros-id' 
  AND status IN ('draft', 'pending_approval')
  AND (
    title LIKE '%kitchen%'
    OR title LIKE '%bathroom%'
    OR title LIKE '%remodel%'
  )
ORDER BY created_at DESC;

# Update those posts to cancelled
UPDATE posts 
SET status = 'cancelled', cancelled_reason = 'Editorial review: wrong industry content'
WHERE id IN (
  'post-123',
  'post-124',
  'post-125'
);

# Verify
SELECT COUNT(*) as cancelled_count 
FROM posts 
WHERE status = 'cancelled' 
  AND cancelled_reason = 'Editorial review: wrong industry content';

.exit
```

### Tracking Progress

In your tracking spreadsheet, mark each as:
- `status = DELETED` when removed
- `deleted_at = [timestamp]`
- `verified_status_change = YES`

---

## Phase 4: Regenerate Posts with Validation (30-45 minutes)

### Step 4.1: Verify Migrations Are In Place

Check that client profile data exists:

```bash
npx wrangler d1 shell webxni-db --remote

# Check client services are populated
SELECT COUNT(*) as service_count FROM client_services;
# Should be > 0

# Check validation rules exist
SELECT COUNT(*) as rule_count FROM client_profile_validation_rules;
# Should be > 0 (auto-populated during migration)

.exit
```

If counts are 0, see troubleshooting section at bottom.

### Step 4.2: Regenerate Posts for Each Client

**Unlock´D Pros example:**

In Discord:
```
@webxni /weekly-content client:unlocked-pros week:this_week mode:regenerate
```

This will:
- Generate new posts for Unlock´D Pros
- Run validation on each new post
- Only save posts that pass validation
- Log results in `/agency/logs`

**Wait:** 3-5 minutes per client

### Step 4.3: Verify New Posts Pass Validation

Check dashboard: https://marketing.webxni.com/agency/logs

Filter by:
- `client_id = unlocked-pros-id`
- `created_at > [just now]`
- `status = info` (not errors)

Expected log entries:
```
✓ Generated post: "Emergency Lock Services in Los Angeles"
✓ Validation passed (locksmith industry match)
✓ Post saved to database
✓ Waiting for Marvin approval
```

**If you see validation blocks:**
```
✗ Generated post: "Kitchen Remodeling Tips"
✗ Validation BLOCKED (forbidden topic for locksmith)
✗ Post discarded, attempting next topic
```

This is GOOD — validation is working correctly. Agent will try another topic.

### Step 4.4: Repeat for Each Client

For each client that had wrong posts:

```bash
# In Discord:
@webxni /weekly-content client:[client-slug] week:this_week mode:regenerate
```

Common clients to regenerate:
- `unlocked-pros` (locksmith)
- `hvac-pro` (if any HVAC issues)
- `remodel-pro` (if any remodeling issues)

---

## Phase 5: Verification (15 minutes)

### Check 5.1: No More Wrong Content in Database

```bash
npx wrangler d1 shell webxni-db --remote

# Check for any remaining "kitchen" or "bathroom" posts for locksmith client
SELECT COUNT(*) as suspicious_count
FROM posts
WHERE client_id = 'unlock-pros-id'
  AND status IN ('draft', 'pending_approval')
  AND (
    title LIKE '%kitchen%'
    OR title LIKE '%bathroom%'
    OR title LIKE '%remodel%'
  );
# Should be 0

.exit
```

### Check 5.2: Validation Success Rate

```bash
npx wrangler d1 shell webxni-db --remote

SELECT 
  validation_passed,
  COUNT(*) as count,
  100.0 * COUNT(*) / SUM(COUNT(*)) OVER () as pct
FROM generation_validation_results
WHERE generated_at > unixepoch('now', '-24 hours')
GROUP BY validation_passed;

# Expected:
# validation_passed | count | pct
# 1                 | 150   | 98.5%
# 0                 | 2     | 1.5%

.exit
```

High success rate (>95%) = validation working correctly  
Low success rate (<80%) = client services not properly populated

### Check 5.3: Editorial Review Findings Reduced

Run Editorial Review again:

```
@webxni /agency-run agent:editorial-review
```

Compare findings:
- **Before:** 5-15 wrong posts flagged
- **After:** 0-2 (legitimate quality issues only)

If still seeing wrong content:
→ Go back to Phase 3 and delete again
→ Check client_services table is populated correctly

---

## Example: Complete Repair Flow

### Real-World Scenario

**Audit Results:**
```
❌ post-123: Unlock´D Pros | "Transform Your Kitchen" | industry_mismatch
❌ post-124: Unlock´D Pros | "HVAC Tips" | forbidden_topic
✓ post-125: ReModel Pro | "Kitchen Remodel Ideas" | GOOD (on-topic)
❌ post-126: Unlock´D Pros | "Bathroom Reno" | industry_mismatch
```

### Repair Steps

**Step 1: Delete wrong posts**
```bash
npx wrangler d1 shell webxni-db --remote

UPDATE posts SET status='cancelled' WHERE id IN ('post-123','post-124','post-126');

SELECT COUNT(*) FROM posts WHERE status='cancelled' AND client_id='unlock-pros-id';
# Returns: 3 ✓

.exit
```

**Step 2: Regenerate for Unlock´D Pros**
```
@webxni /weekly-content client:unlocked-pros week:this_week mode:regenerate
# Wait 5 minutes
```

**Step 3: Verify**
```bash
# Check logs
https://marketing.webxni.com/agency/logs?client=unlocked-pros&status=info

# Should show:
# ✓ Generated: "Emergency Lock Services in LA"
# ✓ Validation passed (locksmith industry match)
# ✓ Generated: "Smart Lock Installation Guide"
# ✓ Validation passed (locksmith industry match)
```

**Step 4: Check validation success**
```bash
npx wrangler d1 shell webxni-db --remote

SELECT COUNT(*) as new_posts
FROM posts
WHERE client_id='unlock-pros-id' 
  AND status='pending_approval'
  AND created_at > unixepoch('now', '-1 hour');
# Should be > 0 (new posts created)

SELECT COUNT(*) as validation_passes
FROM generation_validation_results
WHERE client_id='unlock-pros-id'
  AND validation_passed=1
  AND generated_at > unixepoch('now', '-1 hour');
# Should match new posts count (all passed validation)

.exit
```

---

## Troubleshooting

### "No validation_passed column" error

**Cause:** Migration 0039 didn't run  
**Fix:**
```bash
npx wrangler d1 execute webxni-db --file=db/migrations/0039_generation_validation_results.sql --remote
```

### "No posts generated, validation blocked all"

**Cause:** client_services table not populated  
**Fix:**
```bash
npx wrangler d1 shell webxni-db --remote

# Check services exist
SELECT * FROM client_services WHERE client_id='unlock-pros-id' LIMIT 5;
# Should have 3-5 rows (Key Duplication, Emergency Lockout, etc.)

# If empty, populate:
INSERT INTO client_services (client_id, name, allowed_in_content, priority)
VALUES 
  ('unlock-pros-id', 'Emergency Lockout', 1, 1),
  ('unlock-pros-id', 'Key Duplication', 1, 2),
  ('unlock-pros-id', 'Rekeying', 1, 2),
  ('unlock-pros-id', 'Smart Lock Installation', 1, 3);

.exit
```

### "Editorial Review not finding old wrong posts"

**Cause:** Editorial Review agent didn't scan all posts  
**Fix:**
```bash
# Run with verbose logging
@webxni /agency-run agent:editorial-review mode:verbose

# Or manually query old posts:
npx wrangler d1 shell webxni-db --remote

SELECT id, title, client_id, created_at, status
FROM posts
WHERE created_at < unixepoch('now', '-7 days')
  AND status IN ('draft', 'pending_approval')
ORDER BY created_at DESC
LIMIT 20;

.exit
```

### "Regeneration is still creating wrong content"

**Cause 1:** Validation rules not in database  
**Fix:**
```bash
npx wrangler d1 shell webxni-db --remote

SELECT * FROM client_profile_validation_rules WHERE client_id='unlock-pros-id';
# Should have 1 row with industry_strict_mode=1

# If missing:
INSERT INTO client_profile_validation_rules (client_id, industry_strict_mode)
VALUES ('unlock-pros-id', 1);

.exit
```

**Cause 2:** Forbidden topics list is empty  
**Fix:**
```bash
npx wrangler d1 shell webxni-db --remote

SELECT * FROM client_profile_validation_rules 
WHERE client_id='unlock-pros-id';
# Check: forbidden_topics column has value

# If null or empty:
UPDATE client_profile_validation_rules
SET forbidden_topics = 'kitchen,bathroom,remodel,renovation,HVAC,plumbing'
WHERE client_id='unlock-pros-id';

.exit
```

---

## Success Checklist

After completing all 5 phases:

- [ ] Identified all wrong posts (Editorial Review run)
- [ ] Categorized posts into A/B/C/D
- [ ] Deleted all wrong posts (status = cancelled)
- [ ] Regenerated posts for each affected client
- [ ] Verified new posts pass validation
- [ ] No remaining posts with forbidden topics
- [ ] Validation success rate > 95%
- [ ] Editorial Review finds 0-2 posts with quality issues only
- [ ] No posts in database with industry mismatch
- [ ] Marvin approves first batch of new posts

---

## Timing Estimate

| Phase | Task | Duration | Notes |
|-------|------|----------|-------|
| 1 | Audit existing posts | 15 min | Run agent + check findings |
| 2 | Categorize wrong posts | 15 min | Create tracking spreadsheet |
| 3 | Delete wrong posts | 30 min | 5-10 posts typical |
| 4 | Regenerate posts | 45 min | 5 min per client × 8-9 clients |
| 5 | Verification | 15 min | Run queries + check dashboards |
| **Total** | **Complete repair** | **2 hours** | Varies by wrong post count |

---

## Post-Repair Actions

### Approve New Posts

Once regenerated posts pass validation:

```
https://marketing.webxni.com/approvals
```

For each post:
1. Review content (should match client industry/services)
2. Check validation logs (should show "passed")
3. Click "Approve" (moves to pending_designer status)
4. Designer uploads assets

### Monitor Validation

Set a daily check:

```bash
# Every morning, review validation blocks
https://marketing.webxni.com/agency/logs?status=BLOCK

# Expected:
# 0-2 blocks per day (legitimate edge cases)
# Not 5+ blocks per day (indicates misconfiguration)
```

### Update Client Profile Data

After repair is complete, populate client services and areas for all clients:

```bash
# See: scripts/setup-client-services.sql
# (Will be created based on client data)
```

---

## Summary

**What:** Review existing posts, delete wrong ones, regenerate with validation  
**Why:** Prevent repeat of "wrong content" issue (Unlock´D Pros remodeling)  
**Result:** 0% wrong content in database, 100% validation success rate  
**Time:** ~2 hours total  

**Next:** After completing this guide, system will be fully hardened against wrong content generation.
