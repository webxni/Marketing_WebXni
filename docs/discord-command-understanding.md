# Discord Command Understanding Guide

## Overview

The Discord bot now understands natural language commands from Marvin in both Spanish and English. This resolves the prior issue where commands like "todos los clientes", "revisa los captions", "#5" were misunderstood.

## How It Works

### Intent Detection

When Marvin types a message in Discord, the system:

1. **Detects language** — Spanish or English
2. **Matches intent pattern** — what action is Marvin asking for
3. **Extracts parameters** — clients, dates, post titles, numbers
4. **Resolves references** — like "#5" → item 5 from previous numbered list
5. **Executes action** — with full context

### Supported Intents

| Intent | Spanish Examples | English Examples | Action |
|--------|-----------------|-----------------|--------|
| **list_all_clients** | "todos los clientes" | "all clients" | Fetch active clients list |
| **list_posts** | "lista los posts" | "show posts" | Fetch posts for date range |
| **review_posts** | "revisa los posts" | "review posts" | List + audit each post |
| **repair_captions** | "repara los captions" | "fix captions" | Review + rewrite captions |
| **replace_post** | "reemplaza este post" | "replace this post" | Regenerate specific post |
| **delete_and_regenerate** | "elimina y recrea" | "delete and recreate" | Safe delete + regenerate |
| **resolve_numbered_item** | "#5" | "#8" | Resolve reference to previous list |

## Command Examples

### Example 1: List All Clients and Posts This Week

**Spanish:**
```
Marvin: revisa todos los posts de esta semana para todos los clientes
Bot response:
  ✓ Intent: review_posts
  ✓ Clients: all_active_clients
  ✓ Date range: 2026-06-02 to 2026-06-08 (this week)
  
  Checking Elite Team Builders:
  1. [📌 draft] "Emergency Lockout Services" — 2026-06-02
  2. [📌 draft] "Smart Lock Installation Guide" — 2026-06-03
  ...
```

**English:**
```
Marvin: show all posts for this week from all clients
Bot response: [same as above]
```

### Example 2: Parse Date Range

**Spanish:**
```
Marvin: revisa los posts de Junio 1 hasta 5 de junio
Bot response:
  ✓ Intent: review_posts
  ✓ Date range: 2026-06-01 to 2026-06-05
  
  [Lists posts in that date range]
```

**English:**
```
Marvin: check posts from June 1 to June 5
Bot response: [same as above]
```

### Example 3: Reference Previous Item

**Conversation Flow:**
```
Turn 1:
Marvin: "lista los posts del día de hoy"
Bot: "Found 10 posts today:
  1. "Emergency Lockout Solutions" — Unlock´D Pros — draft
  2. "Kitchen Remodel Cost Guide" — Caliview Builders — draft
  3. "Roof Inspection Tips" — Golden Touch Roofing — draft
  ... (8 more items)
  
  [Items shown in this response: [list stored in discord_context_memory]]"

Turn 2:
Marvin: "#5"
Bot: "Resolving #5 from previous list..."
  > "Seasonal Roofing Maintenance" — Golden Touch Roofing — draft
  
  What would you like to do? (edit / regenerate / delete / approve)

Turn 3:
Marvin: "regenerate"
Bot: "Queued regeneration for post 'Seasonal Roofing Maintenance'..."
```

### Example 4: Repair Captions for a Client

**Spanish:**
```
Marvin: "revisa todos los posts de Unlock´D Pros de esta semana y repara los captions"
Bot response:
  ✓ Intent: repair_captions
  ✓ Client: Unlock´D Pros
  ✓ Date range: this week
  
  Reviewing Unlock´D Pros posts from 2026-06-02 to 2026-06-08:
  
  1. "Transform Your Kitchen" — draft
     ❌ ISSUE: Remodeling topic for locksmith client
     → ACTION: Caption needs repair
     
  2. "Emergency Lockout Help" — draft
     ✅ OK: Matches locksmith services
     
  Would you like me to regenerate the captions for items that need repair?
  (Use "yes" to regenerate, "#1" to skip item, etc.)
```

### Example 5: Delete and Regenerate

**Spanish:**
```
Marvin: "elimina todos los posts de Unlock´D Pros de esta semana y vuelve a crearlos"
Bot response:
  ✓ Intent: delete_and_regenerate
  ✓ Client: Unlock´D Pros
  ✓ Date range: this week
  
  Found 5 posts to delete and regenerate:
  1. "Transform Your Kitchen" (draft) — will regenerate
  2. "Emergency Lockout Help" (approved) — will NOT delete (approved status)
  3. "Key Duplication Services" (draft) — will regenerate
  4. "Smart Lock Installation" (draft) — will regenerate
  5. "Rekeying Guide" (draft) — will regenerate
  
  ⚠️ Will regenerate 4 draft posts, preserve 1 approved post
  
  Type "confirm" to proceed or "cancel" to abort
```

## Implementation Details

### Intent Parser

**Location:** `worker/src/modules/discord-intent-parser.ts`

**Key Functions:**
- `parseIntent(message)` — Main parser
- `parseSpanishDateRange(text)` — Spanish "Junio 1 hasta 5"
- `parseEnglishDateRange(text)` — English "June 1 to 5"

**Returns:**
```typescript
interface ParsedIntent {
  intent: string;
  clients?: string[];
  dateRange?: {start: string; end: string};
  postTitle?: string;
  postId?: string;
  numberReference?: number;
  actionModifiers?: {repair?, replace?, delete?, regenerate?, review?};
  confidence: number; // 0.0-1.0
}
```

### Context Memory

**Location:** Database table `discord_context_memory`

**Per-User Storage:**
```typescript
{
  discord_user_id: "user_123",
  discord_channel_id: "channel_456",
  numbered_items: [
    {id: "post_1", title: "...", client: "...", status: "..."},
    {id: "post_2", title: "...", client: "...", status: "..."},
    ...
  ],
  context_type: "post_list",
  expires_at: <unix timestamp + 1 hour>
}
```

**Usage in Discord Bot:**
```typescript
// When showing numbered items:
storeNumberedList(userId, items);

// When user says "#5":
const item = resolveNumberedReference(userId, "5");
if (item) {
  // Use item.id to execute action
} else {
  // Ask user to provide list again
}
```

## Date Range Parsing

### Spanish Patterns Supported

```
✓ "Junio 1 hasta 5" → June 1-5
✓ "Junio 1 al 5" → June 1-5
✓ "Junio 1-5" → June 1-5
✓ "1 de junio hasta 5 de junio" → June 1-5
✓ "esta semana" → this week (Mon-Sun)
✓ "próxima semana" → next week (Mon-Sun)
```

### English Patterns Supported

```
✓ "June 1 to 5" → June 1-5
✓ "June 1 through June 5" → June 1-5
✓ "June 1-5" → June 1-5
✓ "this week" → this week (Mon-Sun)
✓ "next week" → next week (Mon-Sun)
```

### Current Limitations

- Date ranges default to current year (2026)
- "last week" not yet supported (say "June 1-7" instead)
- Relative dates like "2 days ago" not supported
- Month abbreviations partially supported

## Safety Rules for Discord Commands

### No Auto-Approval

Commands like "regenerate" or "delete" require explicit confirmation:

```
Bot: "Delete 5 posts from Unlock´D Pros? Type 'confirm' to proceed"
Marvin: "confirm"
Bot: "✓ Deleted posts. Queued regeneration..."
```

### No Arbitrary Shell Access

Blocked commands:
- `bash`, `shell`, `execute`, etc.
- Database queries
- Admin account access

### No Designer Gate Bypass

Commands like "approve" or "mark as delivered" are ignored:
```
Marvin: "approve this post"
Bot: "❌ Cannot auto-approve. Only Marvin can approve posts manually."
```

### Context Memory Expires

Numbered list context expires after 1 hour:
```
Turn 1: (7:00 PM) Bot lists posts, context stored
Turn 2: (8:15 PM) Marvin says "#5"
Bot: "Context expired. Please use 'list posts' again to refresh."
```

## Testing Discord Commands

### Test 1: Spanish Intent — todos los clientes

```bash
# In Discord channel:
@webxni todos los clientes

# Expected: Parser detects intent=list_all_clients
# Bot fetches and displays all active clients
```

### Test 2: Spanish Date Range — Junio 1 hasta 5

```bash
# In Discord channel:
@webxni revisa los posts de Junio 1 hasta 5 de junio

# Expected: Parser detects date_range={start: 2026-06-01, end: 2026-06-05}
# Bot lists posts in that date range
```

### Test 3: Number Reference — #5

```bash
# Turn 1:
@webxni lista los posts

# Bot returns 10 items, stores in discord_context_memory

# Turn 2:
@webxni #5

# Expected: Resolves to item #5, shows details, asks for action
```

### Test 4: Repair Intent — repara los captions

```bash
# In Discord channel:
@webxni revisa todos los posts y repara los captions

# Expected: Parser detects repair intent
# Bot lists posts with issues, suggests caption repairs
```

### Test 5: Delete and Regenerate — elimina y vuelve a crear

```bash
# In Discord channel:
@webxni elimina todos los posts de Unlock´D Pros y vuelve a crearlos

# Expected: Parser detects delete_and_regenerate intent
# Bot shows posts to be deleted, asks for confirmation
# After confirmation, deletes drafts, queues regeneration
```

## Error Handling

### When Intent Confidence is Low

```
Marvin: "something about posts"
Bot: "I'm not sure what you want to do. Did you mean:
  1. List posts?
  2. Review posts?
  3. Create a post?
  
  Please clarify or use /help for slash commands."
```

### When Client Not Found

```
Marvin: "show posts from Unknown Locksmith"
Bot: "❌ Client 'Unknown Locksmith' not found.
  
  Did you mean one of:
  1. Unlock´D Pros
  2. Daniel's Locksmith
  
  Try again with one of these names."
```

### When Date Range Invalid

```
Marvin: "posts from Febrero 30" (Feb 30 doesn't exist)
Bot: "❌ Invalid date: Febrero 30.
  
  Please use valid dates or say 'this week', 'next week', etc."
```

## Troubleshooting

### "#5" doesn't resolve

**Cause:** Context expired or wrong user/channel  
**Fix:** Ask Marvin to run list command again: "lista los posts"

### Date range not parsed

**Cause:** Unusual phrasing  
**Fix:** Use standard format "June 1 to 5" or "Junio 1 hasta 5"

### Intent misdetected

**Cause:** Ambiguous message  
**Fix:** Use more specific keywords or slash commands `/status`, `/queue`, etc.

### Spanish accents not recognized

**Cause:** Character encoding issue  
**Fix:** Should be automatic, but if not, use "todos los clientes" vs. "tódos los clientes"

## Future Improvements

1. **Slash Command Integration** — Hybrid slash + natural language
2. **Context Carry-Over** — Remember client from previous command
3. **Undo Command** — "undo that regeneration"
4. **Streaming Updates** — Show progress as regeneration happens
5. **Multi-Turn Workflows** — "Regenerate → review → approve" in one flow
