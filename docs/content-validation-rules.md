# Content Validation Rules

## Overview

The content validation system prevents the WebXni AI Agency from generating content that doesn't match a client's business profile. This was the root cause of Unlock´D Pros receiving remodeling content instead of locksmith content.

## Validation Layers

### Layer 1: Industry Validation (Hard Block)

**When:** During slot execution in `executeSlotWork()`

**How:** Checks if generated content keywords match client's industry.

**Industry Rules:**

| Industry | Must Include | Must NOT Include |
|----------|-------------|-----------------|
| **Locksmith** | lock, locksmith, unlock, key, security, access, lockout | remodel, renovation, kitchen, bathroom, construction, ADU |
| **Roofing** | roof, roofing, shingle, gutter, leak, damage, inspection | locksmith, plumbing, electrical, interior |
| **Remodeling** | remodel, renovation, kitchen, bathroom, contractor, builder | locksmith, roofing services |
| **Beauty/Salon** | hair, makeup, beauty, style, service | locksmith, roofing, construction |

**Example Blocks:**
```
❌ Unlock´D Pros (locksmith) + "Transform Your Kitchen" → BLOCKED
   Reason: "remodel" keyword in locksmith client content

❌ Golden Touch Roofing + "Fix Your Lock in Minutes" → BLOCKED
   Reason: "locksmith" keyword in roofing client content

✅ Unlock´D Pros + "Emergency Lockout Solutions" → ALLOWED
   Reason: Matches locksmith industry requirements
```

### Layer 2: Service Validation (Hard Block)

**When:** During slot execution, if client has defined services

**How:** Checks if generated content mentions services the client actually offers.

**Requirements:**
- Client must have `client_services` entries with `allowed_in_content = 1`
- Content must mention at least one allowed service (if required by profile)
- Content must NOT mention forbidden services

**Example:**
```
Unlock´D Pros Services:
- Key Duplication
- Emergency Lockout
- Rekeying
- Smart Lock Installation

Generated Content: "We offer emergency lockout assistance and rekeying services"
✅ VALID — mentions two allowed services

Generated Content: "Need a kitchen remodel or lockout help?"
❌ BLOCKED — mentions "kitchen remodel" which is not an Unlock´D service
```

### Layer 3: Forbidden Topics (Hard Block)

**When:** During slot execution

**How:** Checks if content explicitly forbidden by client profile appears.

**Configuration:** `client_profile_validation_rules.forbidden_topics` (JSON array)

**Example:**
```
Locksmith Client — Forbidden Topics:
["kitchen remodel", "bathroom renovation", "home addition", "deck building"]

Generated Title: "Everything You Need to Know About Home Additions"
❌ BLOCKED — "home addition" is forbidden topic

Generated Title: "Emergency Lockout Prevention in Your Home"
✅ ALLOWED — no forbidden topics
```

### Layer 4: Content Type Validation (Soft Warning)

**When:** During slot execution

**How:** Checks if content type (image/reel/video/blog) is allowed by package.

**Configuration:** `client_profile_validation_rules.allowed_content_types` (JSON array)

**Example:**
```
Basic Package: ["image"] only
Generated Content Type: "reel"
⚠️ WARNING: Content type "reel" not in allowed types for basic package

Premium Package: ["image", "reel", "video", "blog"]
Generated Content Type: "blog"
✅ VALID — blog in allowed types
```

### Layer 5: Geographic Validation (Soft Warning)

**When:** During slot execution

**How:** If `require_geographic_mention = 1`, checks if content mentions a service area.

**Configuration:** `client_service_areas` + `client_profile_validation_rules.require_geographic_mention`

**Example:**
```
Unlock´D Pros Service Areas:
- Los Angeles
- Pasadena
- San Marino

Generated Caption: "Fast, reliable locksmith services"
⚠️ WARNING: Missing geographic mention (Los Angeles, Pasadena, etc.)

Generated Caption: "Emergency lockout? Call us in Pasadena today!"
✅ VALID — mentions service area "Pasadena"
```

## Implementation

### In Generation-Run

Located in `worker/src/loader/generation-run.ts:executeSlotWork()`:

```typescript
import { validateContentAgainstClientProfile } from '../modules/client-profile-validator';

// After generating content (line ~1433):
const validationRules = await db
  .prepare('SELECT * FROM client_profile_validation_rules WHERE client_id = ?')
  .bind(client.id)
  .first<ClientProfileValidationRules>();

const validation = validateContentAgainstClientProfile(
  genResult.post,
  client,
  validationRules,
  serviceRows.results // from client_services
);

if (!validation.valid) {
  await log('BLOCK', `Validation failed: ${validation.blockedReason}`);
  
  // Save validation result for auditing
  await db.prepare(`
    INSERT INTO generation_validation_results
    (generation_run_id, post_id, client_id, validation_passed, hard_blocks)
    VALUES (?, ?, ?, 0, ?)
  `).bind(run_id, existingPost?.id, client.id, JSON.stringify([validation.blockedReason])).run();
  
  return await finishSlot(slot_idx + 1, 'skipped', clientName, slots);
}

// If valid, continue to save post
```

### In Database Queries

Add to `worker/src/db/queries.ts`:

```typescript
export async function getClientProfileValidationRules(
  db: D1Database,
  clientId: string,
): Promise<ClientProfileValidationRules | null> {
  return db
    .prepare('SELECT * FROM client_profile_validation_rules WHERE client_id = ?')
    .bind(clientId)
    .first<ClientProfileValidationRules>();
}

export async function getClientServices(
  db: D1Database,
  clientId: string,
  allowedOnly = true,
): Promise<{id: string; name: string}[]> {
  const query = allowedOnly
    ? 'SELECT id, name FROM client_services WHERE client_id = ? AND allowed_in_content = 1 ORDER BY priority DESC, sort_order ASC'
    : 'SELECT id, name FROM client_services WHERE client_id = ? ORDER BY priority DESC, sort_order ASC';
  const rows = await db.prepare(query).bind(clientId).all();
  return rows.results;
}
```

## Safety Rules

1. **Hard blocks always prevent save** — A hard block means the content is fundamentally wrong and must never be saved.

2. **Soft warnings are logged but don't block** — Warnings help operators understand quality issues but don't prevent generation.

3. **All validations are logged** — `generation_validation_results` stores every validation check for auditing.

4. **Operator can override** — Marvin can manually approve blocked content if necessary (future feature).

5. **No auto-generation past hard blocks** — Failed validations do not trigger automatic retries.

## Testing Validation

### Test Case 1: Locksmith Industry Block

```bash
curl -X POST https://marketing.webxni.com/api/run/generate \
  -H "Content-Type: application/json" \
  -d '{
    "client_slugs": ["unlocked-pros"],
    "period_start": "2026-06-01",
    "period_end": "2026-06-07"
  }'

# Expected: Generation runs, but if topic is remodeling/construction:
# Validation result shows BLOCKED with reason
# Post is NOT saved
# Log shows: "BLOCK: Validation failed: Industry mismatch..."
```

### Test Case 2: Service Validation

```bash
# Client has services: [Key Duplication, Emergency Lockout]
# Generated content mentions: [Kitchen Remodel, Bathroom Design]

# Expected: BLOCKED
# Reason: "Content mentions services not offered by client"
```

### Test Case 3: Soft Warning (Content Type)

```bash
# Basic package allows only: ["image"]
# Generation creates: reel

# Result: Content is SAVED
# Log shows: "WARN: Content type "reel" not in allowed types..."
```

## Dashboard Integration

On the AI Agency dashboard, validation results appear in:

1. **Recent Agent Logs** — Shows all validation blocks/warnings
2. **Agent Findings** — Lists blocked content by client
3. **Content Review Notes** — Tracks which posts failed validation

## Next Steps

1. **Data Migration** — Run migrations 0036–0040 to create tables
2. **Populate Client Services** — Marvin or team manually enters each client's services
3. **Set Validation Rules** — Configure `client_profile_validation_rules` per client
4. **Deploy Code** — Deploy updated `generation-run.ts` with validation checks
5. **Test with Real Clients** — Run weekly generation and verify no wrong content
6. **Audit Existing Wrong Content** — Use `agent:editorial-review` to find and list wrong posts
7. **Manual Repair** — Regenerate wrong posts with correct validation in place
