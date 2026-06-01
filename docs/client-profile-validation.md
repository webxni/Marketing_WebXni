# Client Profile Validation System

## What This Prevents

The client profile validation system prevents the critical error that occurred with **Unlock´D Pros**:

```
❌ BEFORE: 
  Client: Unlock´D Pros (locksmith business)
  Generated content: "Transform Your Kitchen with Expert Remodeling"
  Result: Content saved, reached approval, then discovered to be completely wrong
  
✅ AFTER:
  Client: Unlock´D Pros (locksmith business)
  Generated content: "Transform Your Kitchen with Expert Remodeling"
  Result: BLOCKED immediately with reason: "Remodeling topic blocked for locksmith client"
```

## Client Profile Data Model

### Tables

#### `clients` (existing)
- `id`, `slug`, `canonical_name`
- `industry` — "locksmith", "roofing", "remodeling", "beauty", etc.
- `phone`, `owner_name`, `state`

#### `client_services` (new)
Defines what services this client offers.

```sql
CREATE TABLE client_services (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients,
  name TEXT,           -- "Key Duplication", "Emergency Lockout", etc.
  allowed_in_content INTEGER DEFAULT 1,  -- Can we write about this?
  priority INTEGER,    -- Weighting for generation
  forbidden_keywords TEXT  -- JSON array of conflicting terms
);
```

**Example Data:**
```
Unlock´D Pros Services:
├── Key Duplication (priority=2, allowed=1)
├── Emergency Lockout (priority=1, allowed=1)
├── Rekeying (priority=2, allowed=1)
├── Smart Lock Installation (priority=3, allowed=1)
└── Commercial Locks (priority=1, allowed=1)

Each service has forbidden_keywords:
- "remodel", "renovation", "kitchen", "bathroom"
- "construction", "hvac", "plumbing"
```

#### `client_service_areas` (new)
Defines geographic areas served.

```sql
CREATE TABLE client_service_areas (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients,
  city TEXT,
  state TEXT,
  primary_area INTEGER,  -- 1 = main area, 0 = secondary
  sort_order INTEGER
);
```

**Example Data:**
```
Unlock´D Pros Service Areas:
├── Los Angeles, CA (primary=1)
├── Pasadena, CA (primary=0)
└── San Marino, CA (primary=0)
```

#### `client_profile_validation_rules` (new)
Configures validation strictness per client.

```sql
CREATE TABLE client_profile_validation_rules (
  client_id TEXT PRIMARY KEY REFERENCES clients,
  industry_strict_mode INTEGER DEFAULT 1,        -- Block wrong industry?
  forbidden_service_categories TEXT,             -- JSON array
  forbidden_topics TEXT,                         -- JSON array
  allowed_content_types TEXT,                    -- JSON array
  require_geographic_mention INTEGER DEFAULT 0, -- Must mention area?
  require_service_mention INTEGER DEFAULT 0     -- Must mention service?
);
```

#### `generation_validation_results` (new)
Audit trail of every validation check.

```sql
CREATE TABLE generation_validation_results (
  id TEXT PRIMARY KEY,
  generation_run_id TEXT REFERENCES generation_runs,
  post_id TEXT REFERENCES posts,
  client_id TEXT REFERENCES clients,
  validation_passed INTEGER,  -- 1 = passed, 0 = blocked
  hard_blocks TEXT,           -- JSON: blocking issues
  warnings TEXT,              -- JSON: non-blocking warnings
  validated_at INTEGER
);
```

## Setup Process

### Step 1: Run Migrations

```bash
# First, create the tables
npx wrangler d1 execute webxni-db --file=db/migrations/0036_client_services.sql --remote
npx wrangler d1 execute webxni-db --file=db/migrations/0037_client_service_areas.sql --remote
npx wrangler d1 execute webxni-db --file=db/migrations/0038_client_profile_validation_rules.sql --remote
npx wrangler d1 execute webxni-db --file=db/migrations/0039_generation_validation_results.sql --remote
npx wrangler d1 execute webxni-db --file=db/migrations/0040_discord_context_memory.sql --remote

# Verify
npx wrangler d1 shell webxni-db
> .tables
# Should show: client_services, client_service_areas, client_profile_validation_rules, etc.
```

### Step 2: Populate Client Services

For each client, manually add their services:

```bash
# Using the dashboard (future feature) or direct SQL:
INSERT INTO client_services (client_id, name, allowed_in_content, priority)
VALUES
  ('client_id_1', 'Key Duplication', 1, 2),
  ('client_id_1', 'Emergency Lockout', 1, 1),
  ('client_id_1', 'Rekeying', 1, 2),
  ('client_id_1', 'Smart Lock Installation', 1, 3);

INSERT INTO client_service_areas (client_id, city, state, primary_area)
VALUES
  ('client_id_1', 'Los Angeles', 'CA', 1),
  ('client_id_1', 'Pasadena', 'CA', 0),
  ('client_id_1', 'San Marino', 'CA', 0);
```

### Step 3: Configure Validation Rules

```sql
-- Default: all clients get industry_strict_mode=1
-- (This is set by migration 0038's INSERT statement)

-- For clients that need stricter validation:
UPDATE client_profile_validation_rules
SET 
  require_geographic_mention = 1,
  require_service_mention = 1,
  forbidden_topics = JSON_ARRAY('kitchen remodel', 'bathroom renovation')
WHERE client_id = 'unlock-pros-id';
```

### Step 4: Deploy Code Changes

Update `worker/src/loader/generation-run.ts` to call validation:

```typescript
import { validateContentAgainstClientProfile } from '../modules/client-profile-validator';

// In executeSlotWork(), after generation:
const validationRules = await getClientProfileValidationRules(db, client.id);
const services = await getClientServices(db, client.id, true);

const validation = validateContentAgainstClientProfile(
  genResult.post,
  client,
  validationRules,
  services
);

if (!validation.valid) {
  // Block and log
  await log('BLOCK', validation.blockedReason);
  // Don't save
  return await finishSlot(slot_idx + 1, 'skipped', clientName, slots);
}
```

## Validation Flow During Generation

```
POST /api/run/generate
  ↓
FOR EACH SLOT:
  ↓
  1. Load client, intelligence, services
  ↓
  2. Generate content with AI
  ↓
  3. Load validation rules for client
  ↓
  4. Call validateContentAgainstClientProfile()
     ├─ Check: Industry forbidden keywords? → HARD BLOCK if found
     ├─ Check: Required keywords present? → SOFT WARNING if missing
     ├─ Check: Services in profile? → HARD BLOCK if not
     ├─ Check: Forbidden topics? → HARD BLOCK if found
     └─ Check: Content type allowed? → SOFT WARNING if not
  ↓
  5. If validation.valid:
     └─ Save post to DB
  ↓
  6. If !validation.valid:
     ├─ Log blocking reason
     ├─ Save validation_result (hard_blocks populated)
     └─ Skip this slot, continue to next
```

## Audit Trail

Every validation check is recorded in `generation_validation_results`:

```json
{
  "generation_run_id": "run_123",
  "post_id": null,           // null if blocked before save
  "client_id": "unlock-pros-id",
  "validation_passed": 0,    // 0 = blocked
  "hard_blocks": [
    "Industry mismatch: 'remodel' in locksmith client content"
  ],
  "warnings": [],
  "validated_at": 1717272000
}
```

Dashboard shows:
1. Validation audit log (Agent Logs page)
2. Blocked posts per client (Agent Findings)
3. Validation statistics (Agency Overview)

## Testing

### Test Setup

Create a test client with strict rules:

```sql
INSERT INTO clients (slug, canonical_name, industry, status)
VALUES ('test-locksmith', 'Test Locksmith LLC', 'locksmith', 'active');

INSERT INTO client_services (client_id, name, allowed_in_content, priority)
SELECT 
  (SELECT id FROM clients WHERE slug='test-locksmith'),
  'Key Duplication', 1, 2;

INSERT INTO client_profile_validation_rules (client_id, industry_strict_mode)
SELECT (SELECT id FROM clients WHERE slug='test-locksmith'), 1;
```

### Test Case 1: Hard Block — Industry Mismatch

```bash
curl -X POST https://marketing.webxni.com/api/run/generate \
  -H "Content-Type: application/json" \
  -d '{
    "client_slugs": ["test-locksmith"],
    "period_start": "2026-06-01",
    "period_end": "2026-06-01",
    "high_quality": true
  }'

# If AI generates "Transform Your Kitchen" topic:
# Expected: Validation blocks it
# generation_validation_results.validation_passed = 0
# generation_validation_results.hard_blocks = ["Industry mismatch..."]
# No post is created
```

### Test Case 2: Soft Warning — Missing Service

```bash
# Client has services: ["Key Duplication", "Emergency Lockout"]
# Generated caption: "We're here for all your security needs!"

# Expected: Post is SAVED (soft warning only)
# generation_validation_results.warnings = ["Content mentions no services..."]
# Dashboard shows warning in logs
```

### Test Case 3: Full Validation Pass

```bash
# Generated caption: "Emergency lockout? Key duplication service available!"

# Expected: Post is SAVED
# generation_validation_results.validation_passed = 1
# generation_validation_results.warnings = []
```

## Reports & Monitoring

### Check Validation Results

```sql
-- Show blocked posts per client this week
SELECT client_id, COUNT(*) as blocked_count
FROM generation_validation_results
WHERE validation_passed = 0
  AND validated_at > unixepoch() - (7 * 86400)
GROUP BY client_id
ORDER BY blocked_count DESC;

-- Show specific blocks for a client
SELECT post_id, hard_blocks, validated_at
FROM generation_validation_results
WHERE client_id = 'unlock-pros-id'
  AND validation_passed = 0
ORDER BY validated_at DESC
LIMIT 10;
```

### Dashboard Display

**AI Agency > Agent Findings**

Shows list of validation blocks:
```
🔴 BLOCKED: Unlock´D Pros
   "Transform Your Kitchen" — Industry mismatch
   Generated: 2026-06-01 10:15 AM
   Reason: 'remodel' keyword in locksmith client content
   
🔴 BLOCKED: Daniel's Locksmith
   "DIY Roof Repair Guide" — Industry mismatch
   Generated: 2026-06-01 10:30 AM
   Reason: 'roof' keyword in locksmith client content
```

## Disabling/Enabling Validation

### Disable for Testing

```sql
UPDATE client_profile_validation_rules
SET industry_strict_mode = 0
WHERE client_id = 'test-client-id';
-- Generation will proceed with soft warnings only
```

### Re-enable

```sql
UPDATE client_profile_validation_rules
SET industry_strict_mode = 1
WHERE client_id = 'test-client-id';
```

## FAQ

**Q: What if a client wants to post about multiple industries?**  
A: Create separate client profiles or mark services as `allowed_in_content = 0` for unrelated services.

**Q: How do I know if validation is working?**  
A: Check `generation_validation_results` for your client. Should see `validation_passed = 1` for valid content.

**Q: Can Marvin override a block?**  
A: Not yet (future feature). For now, Marvin regenerates with corrected topic.

**Q: What if the AI generates content that technically passes but still feels wrong?**  
A: Use soft warnings. Mark it as a warning and Marvin can review and decide.

**Q: How often should I update client services?**  
A: When the client launches new services or discontinues existing ones.

## Troubleshooting

**Problem:** All content is being blocked  
**Solution:** Check `industry_strict_mode` is `1`. If it should be `0`, update the rule.

**Problem:** No warnings appearing in dashboard  
**Solution:** Warnings are recorded but not highlighted. Check `generation_validation_results.warnings`.

**Problem:** Validation isn't running at all  
**Solution:** Ensure code includes `validateContentAgainstClientProfile()` call in `executeSlotWork()`.

**Problem:** A service is forbidden but content still saved  
**Solution:** Check `client_services.allowed_in_content` is set to `1` for that service.
