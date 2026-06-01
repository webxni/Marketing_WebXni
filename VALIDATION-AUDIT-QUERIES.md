# Validation Audit — SQL Queries Reference

**Purpose:** Helpful SQL queries to audit existing posts and validation results  
**How to use:** Copy/paste into `npx wrangler d1 shell webxni-db --remote`  

---

## Quick Audit Queries

### Find All Existing Posts (All Status)

```sql
SELECT 
  id,
  title,
  client_id,
  status,
  content_type,
  created_at,
  created_by
FROM posts
ORDER BY created_at DESC
LIMIT 50;
```

### Find Draft & Pending Approval Posts Only

```sql
SELECT 
  id,
  title,
  client_id,
  status,
  created_at
FROM posts
WHERE status IN ('draft', 'pending_approval')
ORDER BY created_at DESC;
```

### Find Posts Created Last 7 Days

```sql
SELECT 
  p.id,
  p.title,
  p.client_id,
  c.name as client_name,
  p.status,
  p.created_at
FROM posts p
JOIN clients c ON p.client_id = c.id
WHERE p.created_at > unixepoch('now', '-7 days')
ORDER BY p.created_at DESC;
```

---

## Find Wrong Content (by Keywords)

### Posts with Forbidden Keywords (Locksmith Clients)

```sql
-- Find locksmith clients
WITH locksmith_clients AS (
  SELECT id FROM clients WHERE industry='locksmith'
)
SELECT 
  p.id,
  p.title,
  p.client_id,
  p.status,
  p.created_at,
  CASE 
    WHEN p.title LIKE '%kitchen%' THEN 'kitchen_remodel'
    WHEN p.title LIKE '%bathroom%' THEN 'bathroom_reno'
    WHEN p.title LIKE '%remodel%' THEN 'remodeling'
    WHEN p.title LIKE '%renovation%' THEN 'renovation'
    WHEN p.title LIKE '%HVAC%' THEN 'hvac'
    WHEN p.title LIKE '%plumb%' THEN 'plumbing'
    ELSE 'other_mismatch'
  END as issue_type
FROM posts p
WHERE p.client_id IN (SELECT id FROM locksmith_clients)
  AND p.status IN ('draft', 'pending_approval')
  AND (
    p.title LIKE '%kitchen%'
    OR p.title LIKE '%bathroom%'
    OR p.title LIKE '%remodel%'
    OR p.title LIKE '%renovation%'
    OR p.title LIKE '%HVAC%'
    OR p.title LIKE '%plumb%'
  );
```

### Posts Mentioning Services Not in Client Profile

```sql
-- Posts that mention services but service not in client_services
SELECT 
  p.id,
  p.title,
  p.client_id,
  c.name as client_name,
  p.status
FROM posts p
JOIN clients c ON p.client_id = c.id
LEFT JOIN client_services cs ON p.client_id = cs.client_id
WHERE p.status IN ('draft', 'pending_approval')
  AND cs.id IS NULL
  -- This shows posts for clients with NO services defined
ORDER BY p.created_at DESC;
```

---

## Validation Results Analysis

### Validation Success Rate (Last 24 Hours)

```sql
SELECT 
  validation_passed,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM generation_validation_results
WHERE validated_at > unixepoch('now', '-86400')  -- 24 hours
GROUP BY validation_passed
ORDER BY validation_passed DESC;
```

Expected output:
```
validation_passed | count | percentage
1                 | 150   | 98.5%
0                 | 2     | 1.5%
```

### Validation Failures by Reason

```sql
SELECT 
  validation_failed_reason,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM generation_validation_results
WHERE validation_passed = 0
  AND validated_at > unixepoch('now', '-7 days')  -- Last 7 days
GROUP BY validation_failed_reason
ORDER BY count DESC;
```

Expected output shows failure types and frequency.

### Posts That Failed Validation

```sql
SELECT 
  gvr.slot_id,
  gvr.validation_failed_reason,
  gvr.validated_at,
  p.title,
  p.client_id,
  c.name as client_name
FROM generation_validation_results gvr
LEFT JOIN posts p ON gvr.slot_id = p.id
LEFT JOIN clients c ON p.client_id = c.id
WHERE gvr.validation_passed = 0
  AND gvr.validated_at > unixepoch('now', '-7 days')
ORDER BY gvr.validated_at DESC;
```

---

## Client-Specific Audits

### Unlock´D Pros Audit

```sql
-- Find all posts for Unlock´D Pros
SELECT 
  p.id,
  p.title,
  p.status,
  p.created_at,
  CASE 
    WHEN p.title LIKE '%kitchen%' THEN '❌ WRONG: Kitchen content'
    WHEN p.title LIKE '%bathroom%' THEN '❌ WRONG: Bathroom content'
    WHEN p.title LIKE '%remodel%' THEN '❌ WRONG: Remodeling content'
    WHEN p.title LIKE '%emergency%' THEN '✓ GOOD: Emergency lockout'
    WHEN p.title LIKE '%lock%' THEN '✓ GOOD: Locksmith topic'
    ELSE '⚠️ UNCLEAR: Review needed'
  END as assessment
FROM posts p
WHERE p.client_id = (SELECT id FROM clients WHERE slug='unlocked-pros')
ORDER BY p.created_at DESC;
```

### All Clients with Post Count

```sql
SELECT 
  c.id,
  c.name,
  c.industry,
  COUNT(p.id) as total_posts,
  SUM(CASE WHEN p.status IN ('draft', 'pending_approval') THEN 1 ELSE 0 END) as draft_pending,
  SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END) as published,
  SUM(CASE WHEN p.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
FROM clients c
LEFT JOIN posts p ON c.id = p.client_id
GROUP BY c.id, c.name, c.industry
ORDER BY total_posts DESC;
```

---

## Client Services & Validation Rules

### Client Services Populated Check

```sql
-- Show which clients have services defined
SELECT 
  c.id,
  c.name,
  COUNT(cs.id) as service_count,
  GROUP_CONCAT(cs.name, ', ') as services
FROM clients c
LEFT JOIN client_services cs ON c.id = cs.client_id AND cs.allowed_in_content=1
GROUP BY c.id, c.name
ORDER BY service_count DESC;
```

### Clients Missing Services

```sql
-- Find clients with NO services defined (need to populate)
SELECT 
  c.id,
  c.name,
  c.industry
FROM clients c
WHERE c.id NOT IN (SELECT DISTINCT client_id FROM client_services)
ORDER BY c.name;
```

### Validation Rules Check

```sql
SELECT 
  c.name,
  cvr.industry_strict_mode,
  cvr.allowed_content_types,
  cvr.forbidden_topics,
  cvr.forbidden_service_categories
FROM clients c
LEFT JOIN client_profile_validation_rules cvr ON c.id = cvr.client_id
ORDER BY c.name;
```

### Clients with Strict Mode Enabled

```sql
SELECT 
  c.name,
  cvr.industry_strict_mode
FROM clients c
JOIN client_profile_validation_rules cvr ON c.id = cvr.client_id
WHERE cvr.industry_strict_mode = 1
ORDER BY c.name;
```

---

## Recent Generation Activity

### Generation Runs (Last 24 Hours)

```sql
SELECT 
  id,
  client_id,
  (SELECT name FROM clients WHERE id=gr.client_id) as client_name,
  generation_type,
  status,
  created_at,
  completed_at,
  COUNT(gvr.id) as validation_checks
FROM generation_runs gr
LEFT JOIN generation_validation_results gvr ON gr.id = gvr.run_id
WHERE gr.created_at > unixepoch('now', '-86400')
GROUP BY gr.id
ORDER BY gr.created_at DESC;
```

### All Posts Created in Last Week

```sql
SELECT 
  DATE(p.created_at, 'unixepoch') as date,
  COUNT(*) as posts_created,
  SUM(CASE WHEN p.status='published' THEN 1 ELSE 0 END) as published,
  SUM(CASE WHEN p.status IN ('draft','pending_approval') THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN p.status='cancelled' THEN 1 ELSE 0 END) as cancelled
FROM posts p
WHERE p.created_at > unixepoch('now', '-7 days')
GROUP BY DATE(p.created_at, 'unixepoch')
ORDER BY date DESC;
```

---

## Delete Operations (Use with Caution)

### Count Wrong Posts (Locksmith + Forbidden Keywords)

```sql
-- PREVIEW: Count posts to be deleted
SELECT COUNT(*) as posts_to_delete
FROM posts p
WHERE p.client_id = (SELECT id FROM clients WHERE slug='unlocked-pros')
  AND p.status IN ('draft', 'pending_approval')
  AND (
    p.title LIKE '%kitchen%'
    OR p.title LIKE '%bathroom%'
    OR p.title LIKE '%remodel%'
    OR p.title LIKE '%renovation%'
  );
```

### List Posts to Delete (Review First)

```sql
-- REVIEW BEFORE DELETING
SELECT 
  p.id,
  p.title,
  p.client_id,
  p.status,
  p.created_at
FROM posts p
WHERE p.client_id = (SELECT id FROM clients WHERE slug='unlocked-pros')
  AND p.status IN ('draft', 'pending_approval')
  AND (
    p.title LIKE '%kitchen%'
    OR p.title LIKE '%bathroom%'
    OR p.title LIKE '%remodel%'
    OR p.title LIKE '%renovation%'
  )
ORDER BY p.created_at DESC;
```

### Delete Wrong Posts (After Review)

```sql
-- AFTER verifying above query, run:
UPDATE posts 
SET status='cancelled', 
    cancelled_reason='Editorial review: industry mismatch'
WHERE p.client_id = (SELECT id FROM clients WHERE slug='unlocked-pros')
  AND p.status IN ('draft', 'pending_approval')
  AND (
    p.title LIKE '%kitchen%'
    OR p.title LIKE '%bathroom%'
    OR p.title LIKE '%remodel%'
    OR p.title LIKE '%renovation%'
  );

-- Verify deletion
SELECT COUNT(*) as deleted_count 
FROM posts 
WHERE status='cancelled' 
  AND cancelled_reason='Editorial review: industry mismatch'
  AND client_id = (SELECT id FROM clients WHERE slug='unlocked-pros');
```

---

## Dashboard Monitoring Queries

### Validation Blocks per Client (Last 48 Hours)

```sql
SELECT 
  (SELECT name FROM clients WHERE id=gvr.client_id) as client_name,
  COUNT(*) as blocks,
  validation_failed_reason,
  MAX(gvr.validated_at) as last_block
FROM generation_validation_results gvr
WHERE gvr.validation_passed = 0
  AND gvr.validated_at > unixepoch('now', '-172800')  -- 48 hours
GROUP BY gvr.client_id, validation_failed_reason
ORDER BY blocks DESC;
```

### Validation Success Rate by Client (Last 7 Days)

```sql
SELECT 
  (SELECT name FROM clients WHERE id=gvr.client_id) as client_name,
  COUNT(*) as total_validations,
  SUM(CASE WHEN gvr.validation_passed=1 THEN 1 ELSE 0 END) as passed,
  ROUND(100.0 * SUM(CASE WHEN gvr.validation_passed=1 THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM generation_validation_results gvr
WHERE gvr.validated_at > unixepoch('now', '-604800')  -- 7 days
GROUP BY gvr.client_id
ORDER BY success_rate ASC;
```

Expected: All clients with success_rate > 95%

### Top Content Issues

```sql
SELECT 
  validation_failed_reason,
  COUNT(*) as occurrences,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pct_of_failures
FROM generation_validation_results
WHERE validation_passed = 0
  AND validated_at > unixepoch('now', '-604800')  -- Last 7 days
GROUP BY validation_failed_reason
ORDER BY occurrences DESC;
```

---

## Export & Reporting

### Export Validation Results to CSV

```sql
-- Copy results from this query into spreadsheet
SELECT 
  gvr.slot_id,
  gvr.client_id,
  (SELECT name FROM clients WHERE id=gvr.client_id) as client_name,
  gvr.validation_passed,
  gvr.validation_failed_reason,
  gvr.validated_at,
  CASE 
    WHEN gvr.validation_passed=1 THEN 'PASS'
    ELSE 'BLOCK'
  END as status
FROM generation_validation_results gvr
WHERE gvr.validated_at > unixepoch('now', '-604800')  -- 7 days
ORDER BY gvr.validated_at DESC;
```

### Weekly Validation Summary

```sql
SELECT 
  DATE(gvr.validated_at, 'unixepoch') as validation_date,
  (SELECT name FROM clients WHERE id=gvr.client_id) as client_name,
  COUNT(*) as total_posts,
  SUM(CASE WHEN gvr.validation_passed=1 THEN 1 ELSE 0 END) as passed,
  SUM(CASE WHEN gvr.validation_passed=0 THEN 1 ELSE 0 END) as blocked,
  ROUND(100.0 * SUM(CASE WHEN gvr.validation_passed=1 THEN 1 ELSE 0 END) / COUNT(*), 2) as success_pct
FROM generation_validation_results gvr
WHERE gvr.validated_at > unixepoch('now', '-604800')  -- 7 days
GROUP BY DATE(gvr.validated_at, 'unixepoch'), gvr.client_id
ORDER BY validation_date DESC, client_name;
```

---

## How to Run These Queries

```bash
# Connect to database
npx wrangler d1 shell webxni-db --remote

# Paste any query from above
# Example:
SELECT COUNT(*) FROM posts WHERE status='draft';

# Exit
.exit
```

### For Large Result Sets

If query returns many rows:

```bash
# Save to file
npx wrangler d1 query webxni-db "SELECT * FROM posts..." --json > posts.json

# View in Excel
cat posts.json | jq '.' > posts.csv
```

---

## Common Queries for Daily Checks

### Morning Check (5 minutes)

```sql
-- 1. Check validation success rate
SELECT 
  'Validation Success Rate' as metric,
  ROUND(100.0 * SUM(CASE WHEN validation_passed=1 THEN 1 ELSE 0 END) / COUNT(*), 2) as value
FROM generation_validation_results
WHERE validated_at > unixepoch('now', '-86400');

-- 2. Check new posts created
SELECT 
  'Posts Created (24h)' as metric,
  COUNT(*) as value
FROM posts
WHERE created_at > unixepoch('now', '-86400');

-- 3. Check validation blocks
SELECT 
  'Validation Blocks (24h)' as metric,
  COUNT(*) as value
FROM generation_validation_results
WHERE validation_passed=0 AND validated_at > unixepoch('now', '-86400');
```

### Weekly Check (15 minutes)

```sql
-- 1. Posts created by client (7 days)
SELECT 
  (SELECT name FROM clients WHERE id=p.client_id) as client,
  COUNT(*) as posts,
  SUM(CASE WHEN p.status='published' THEN 1 ELSE 0 END) as published
FROM posts p
WHERE p.created_at > unixepoch('now', '-604800')
GROUP BY p.client_id
ORDER BY posts DESC;

-- 2. Validation health (7 days)
SELECT 
  'Success Rate (7d)' as metric,
  ROUND(100.0 * SUM(CASE WHEN validation_passed=1 THEN 1 ELSE 0 END) / COUNT(*), 2) as percentage
FROM generation_validation_results
WHERE validated_at > unixepoch('now', '-604800');

-- 3. Top failure reasons (7 days)
SELECT 
  validation_failed_reason,
  COUNT(*) as count
FROM generation_validation_results
WHERE validation_passed=0 AND validated_at > unixepoch('now', '-604800')
GROUP BY validation_failed_reason
ORDER BY count DESC
LIMIT 5;
```

---

## Summary

**Use these queries to:**
- Find existing wrong posts
- Check validation success rate
- Monitor validation blocks
- Verify client services populated
- Track repair progress
- Generate reports for team

**Key metrics to monitor:**
- Validation success rate > 95%
- No posts with forbidden keywords
- All clients have services defined
- Validation blocks < 5 per day (edge cases only)
