# June 3 Content Generation — Agent Orchestration & Monitoring

**Date:** June 3, 2026  
**Workflow:** Research → Strategy → Content Creation (Social + Blog) → Editorial Review  
**Validation:** ENABLED (hard-blocks wrong content)  
**Timeline:** ~45 minutes total  

---

## 🎯 Complete Workflow

```
PHASE 1: Delete Draft Posts (5 min)
    ↓
PHASE 2: Client Research Agent (5 min)
    Researches: SEO, competitors, market trends for each client
    Output: client_research_notes table populated
    ↓
PHASE 3: Strategy Agent (3 min)
    Analyzes: Research findings + company intelligence
    Output: Content strategy recommendations
    ↓
PHASE 4: Social Copy Agent (5-10 min) ← WITH VALIDATION
    Generates: Social media captions for Facebook, Instagram, LinkedIn, X, etc.
    Validation: Checks industry match, services, forbidden topics
    Output: Posts in pending_approval (wrong content = BLOCKED)
    ↓
PHASE 5: Blog Writer Agent (5-10 min) ← WITH VALIDATION
    Generates: SEO-optimized blog posts
    Validation: Industry + services + keyword relevance
    Output: Blog drafts with SEO metadata
    ↓
PHASE 6: Editorial Review Agent (10 min)
    Reviews: ALL generated content for quality
    Checks: Industry match, service validation, content quality
    Output: Audit findings (severity = warning if issues)
    ↓
PHASE 7: Manual Approval (Marvin)
    Approves: Posts that passed validation
    Rejects: Any with issues flagged by Editorial Review
    Output: Posts ready for designer/publishing
```

---

## 📋 Step-by-Step Execution

### STEP 1: Delete Draft Posts

Run this script first (on your machine):

```bash
./scripts/orchestrate-june-3-generation.sh
```

OR manually:

```bash
npx wrangler d1 shell webxni-db --remote

UPDATE posts
SET status='cancelled', cancelled_reason='Regenerate for June 3'
WHERE status='draft';

SELECT COUNT(*) FROM posts WHERE status='cancelled' AND cancelled_reason='Regenerate for June 3';

.exit
```

**Expected:** X posts eliminated

---

### STEP 2: Start Client Research Agent

**In Discord:**
```
@webxni /agency-run agent:client-research
```

**What it does:**
- Researches each active client
- Finds SEO opportunities
- Identifies competitor strategies
- Analyzes market trends
- Stores findings in `client_research_notes` table

**Duration:** ~5 minutes  
**Monitor:** Check logs for "Researching client X"

---

### STEP 3: Start Strategy Agent

**In Discord:**
```
@webxni /agency-run agent:strategy
```

**What it does:**
- Analyzes research findings
- Creates content strategy per client
- Identifies content angles
- Recommends topics based on research + company intelligence
- Links to client profile (services, areas)

**Duration:** ~3 minutes  
**Monitor:** Check logs for strategy recommendations

---

### STEP 4: Start Social Copy Agent (WITH VALIDATION)

**In Discord:**
```
@webxni /agency-run agent:social-copy
```

**What it does:**
1. Generates social media captions for:
   - Facebook
   - Instagram
   - LinkedIn
   - X / Twitter
   - Threads
   - TikTok
   - Google Business
   - Pinterest
   - Bluesky

2. **VALIDATES** each caption:
   - ✅ Industry match (is content appropriate for client industry?)
   - ✅ Service validation (mentions only services client offers?)
   - ❌ Forbidden topics (blocks remodeling for locksmith, etc.)
   - ✅ Quality check (no fluff, has CTA?)

3. **Hard blocks** wrong content:
   - If validation fails → post is NOT saved
   - Logged to `generation_validation_results` table
   - Agent tries next topic

4. Posts saved in `pending_approval` status (not published)

**Duration:** ~5-10 minutes  
**Monitor:** 
- Dashboard: https://marketing.webxni.com/agency/logs
- Filter: `status=info` (successes) or `BLOCK` (validation blocks)
- Expected: Validation logs showing pass/fail decisions

---

### STEP 5: Start Blog Writer Agent (WITH VALIDATION)

**In Discord:**
```
@webxni /agency-run agent:blog-writer
```

**What it does:**
1. Generates SEO-optimized blog posts:
   - Title + body + excerpt
   - Target keyword
   - Meta description
   - Secondary keywords
   - Featured image prompt
   - Distribution captions (for social cross-posting)

2. **VALIDATES** each blog:
   - ✅ Industry match
   - ✅ Service mentions (only services client offers)
   - ✅ Keyword relevance
   - ❌ No forbidden topics

3. Saves in `pending_approval` status

**Duration:** ~5-10 minutes  
**Monitor:**
- Dashboard: https://marketing.webxni.com/posts?type=blog&status=pending_approval
- Check validation logs for blocks

---

### STEP 6: Start Editorial Review Agent

**In Discord:**
```
@webxni /agency-run agent:editorial-review
```

**What it does:**
1. Reviews ALL generated posts:
   - Social posts
   - Blog posts
   - Any drafts created today

2. Validates:
   - Industry match (critical)
   - Service validation (client actually offers services mentioned)
   - Content quality (no weak CTAs, unclear value prop)
   - Forbidden topics (locksmith = no kitchen/bathroom)
   - SEO quality (for blogs)

3. Generates audit findings:
   - `severity=critical` → BLOCK immediately
   - `severity=warning` → Review before approving
   - `severity=info` → Approved, minor notes

**Duration:** ~10 minutes  
**Monitor:**
- Dashboard: https://marketing.webxni.com/agency/findings
- Filter: `agent_slug=editorial-review`
- Look for: Posts with severity >= warning

---

## 🔍 Real-Time Monitoring

While agents run, monitor these dashboards:

### 1. Generation Logs
**URL:** https://marketing.webxni.com/agency/logs

**What to look for:**
```
✅ [INFO] Generated post: "Emergency Lock Services"
✅ [INFO] Validation passed (locksmith industry match)
✅ [INFO] Post saved to database

✗ [BLOCK] Generated: "Kitchen Remodel Tips"
✗ [BLOCK] Validation failed: Forbidden topic for locksmith
✗ [BLOCK] Post discarded, attempting next topic
```

**Good sign:** Mix of PASSED and BLOCKED (validation working)  
**Bad sign:** All BLOCKED or all PASSED (validation may be broken)

### 2. Agent Status
**In Discord:**
```
@webxni /agency-status
```

**Expected output:**
```
Active agents: 8
Running tasks: 2 (social-copy, editorial-review)
Waiting for approval: X posts
Validation success rate: 95%+
```

### 3. Approval Queue
**URL:** https://marketing.webxni.com/approvals

**Shows:** Posts waiting for your approval  
**Review each post for:**
- Content matches client industry ✓
- Services mentioned are in client profile ✓
- No forbidden topics ✓
- Quality is good ✓

### 4. Validation Results
**SQL Query:**
```bash
npx wrangler d1 shell webxni-db --remote

SELECT
  validation_passed,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pct
FROM generation_validation_results
WHERE generated_at > unixepoch('now', '-3600')  -- Last hour
GROUP BY validation_passed;

.exit
```

**Expected:**
```
validation_passed | count | pct
1                 | 45    | 95%
0                 | 2     | 5%
```

(Legitimate edge cases only should be blocked)

---

## ✅ Validation Checklist

After all agents complete, verify:

### Check 1: Validation Success Rate

```bash
npx wrangler d1 shell webxni-db --remote

SELECT
  COUNT(*) as total,
  SUM(CASE WHEN validation_passed=1 THEN 1 ELSE 0 END) as passed,
  ROUND(100.0 * SUM(CASE WHEN validation_passed=1 THEN 1 ELSE 0 END) / COUNT(*), 2) as success_pct
FROM generation_validation_results
WHERE generated_at > unixepoch('now', '-10800');  -- Last 3 hours

.exit
```

**Expected:** success_pct >= 95%

### Check 2: No Wrong Content in Database

```bash
npx wrangler d1 shell webxni-db --remote

-- Check for any kitchen/bathroom content for locksmith
SELECT COUNT(*) as suspicious FROM posts
WHERE created_at > unixepoch('now', '-3600')
AND status IN ('draft', 'pending_approval')
AND (title LIKE '%kitchen%' OR title LIKE '%bathroom%' OR title LIKE '%remodel%')
AND client_id IN (SELECT id FROM clients WHERE industry='locksmith');

.exit
```

**Expected:** 0

### Check 3: Editorial Review Findings

**URL:** https://marketing.webxni.com/agency/findings  
**Filter:** `agent_slug=editorial-review`

**Expected:**
- 0-2 warnings (legitimate issues only)
- 0 critical blocks
- Mostly info/pass results

---

## 🎯 Post Approval Workflow

### For Each Post in Approval Queue:

1. **Review Content**
   - Does it match the client's industry?
   - Are only offered services mentioned?
   - Is there a clear CTA?
   - Is the content high quality?

2. **Check Validation**
   - Open post → view validation log
   - Should show "Validation passed"
   - If "blocked", understand why

3. **Approve or Reject**
   - ✅ **Approve:** Click "Approve" button
   - ❌ **Reject:** Click "Reject" with reason

4. **After Approval**
   - Posts move to `pending_designer` status
   - Designer uploads featured images
   - Then posts ready for scheduling/publishing

---

## 🚨 If Validation Is Blocking Everything

**Symptom:** All posts blocked, validation_passed=0

**Causes:**
1. Client services not populated in `client_services` table
2. Validation rules too strict
3. Bug in validation code

**Fix:**
```bash
# Check if services are populated
npx wrangler d1 shell webxni-db --remote

SELECT client_id, COUNT(*) as service_count
FROM client_services
GROUP BY client_id;

# If all 0, populate:
INSERT INTO client_services (client_id, name, allowed_in_content, priority)
VALUES 
  ('client-id', 'Service Name', 1, 1),
  ...;

.exit
```

---

## 📊 Expected Outcomes

### By the end of Phase 6:

**Social Copy Results:**
- Facebook: X posts generated ✅
- Instagram: X posts generated ✅
- LinkedIn: X posts generated ✅
- X/Twitter: X posts generated ✅
- And others...
- **Total:** ~20-30 social posts created

**Blog Writer Results:**
- X blog posts generated ✅
- All with SEO metadata ✅
- Distribution captions for cross-posting ✅

**Validation Results:**
- ✅ 95%+ validation success rate
- ✅ 0% wrong industry content
- ❌ <5 legitimate blocks (edge cases)

**Editorial Review Results:**
- ✅ All posts audited
- ✅ Quality checked
- ✅ 0-2 warnings (legitimate issues only)

---

## ⏱️ Timeline

| Phase | Task | Duration | Total |
|-------|------|----------|-------|
| 1 | Delete drafts | 5 min | 5 min |
| 2 | Client Research | 5 min | 10 min |
| 3 | Strategy | 3 min | 13 min |
| 4 | Social Copy | 7 min | 20 min |
| 5 | Blog Writer | 7 min | 27 min |
| 6 | Editorial Review | 10 min | 37 min |
| 7 | Manual approval | 15 min | 52 min |

**Total:** ~1 hour end-to-end

---

## 🚀 Success Criteria

✅ All phases completed without errors  
✅ Validation success rate > 95%  
✅ 0% wrong industry content  
✅ 20-30 social posts created  
✅ 3-5 blog posts created  
✅ Editorial Review shows 0 critical issues  
✅ Marvin approves all posts  

---

## 📞 Troubleshooting

### Agent not responding in Discord
- Check: `@webxni /agency-status`
- Check: pm2 logs webxni-bot
- Restart if needed: `pm2 restart webxni-bot`

### Validation blocking all content
- Check: `client_services` table populated
- Check: Validation rules not too strict
- See "If Validation Is Blocking Everything" above

### Posts not appearing in approval queue
- Check: Posts in `pending_approval` status
- Check: Dashboard filters correctly
- Refresh: Browser cache (Ctrl+F5)

### Editorial Review finds too many issues
- Review issues one by one
- Understand why each was flagged
- Either fix manually or regenerate with agents

---

## 🎖️ Sign-Off

Once workflow completes successfully:

- [ ] All 6 agent phases completed
- [ ] Validation success rate > 95%
- [ ] 0 wrong industry content
- [ ] Editorial Review shows only legitimate warnings
- [ ] All posts approved by Marvin
- [ ] Designer has uploaded assets
- [ ] Posts ready for scheduling

**Then:** Content is ready for publication! 🎉

---

**Questions?** Check the monitoring dashboards or run:
```
@webxni /agency-status
```

**Ready to start?** Execute in Discord:
```
@webxni /agency-run agent:client-research
```
