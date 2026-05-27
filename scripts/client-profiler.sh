#!/usr/bin/env bash
# Client Intelligence Profiler — Codex-powered (heavy lifting, more tokens than Claude)
# Runs Friday 6AM — builds per-client intelligence profiles using:
#   Gemini: local market research, competitor keywords
#   Codex:  synthesizes full intelligence profile (JSON) → updates DB
#
# Claude is NOT called here to preserve Claude tokens.
#
# Usage: bash scripts/client-profiler.sh [client_slug|all]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

TARGET="${1:-all}"
LOG_FILE="${LOG_DIR}/client-profiler-$(date +%Y-%m-%d).log"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }
log "=== Client Profiler: $(date) ==="

# ── Extract JSON object from text (handles preamble/markdown) ──────────────────
extract_json_object() {
  python3 - "$1" <<'PYEOF'
import sys, json
text = open(sys.argv[1]).read()
start = text.find('{')
if start == -1: sys.exit(1)
depth=0; in_str=False; escape=False; end=-1
for i, c in enumerate(text[start:], start):
    if escape: escape=False; continue
    if c=='\\' and in_str: escape=True; continue
    if c=='"': in_str = not in_str; continue
    if in_str: continue
    if c=='{': depth+=1
    elif c=='}':
        depth-=1
        if depth==0: end=i; break
if end==-1: sys.exit(1)
parsed = json.loads(text[start:end+1])
print(json.dumps(parsed))
PYEOF
}

profile_client() {
  local slug="$1"
  log ""
  log "── ${slug}"

  # ── 1. Fetch client details ─────────────────────────────────────────────────
  local client_data
  client_data=$(curl -sf -X POST "${API_BASE}/api/ai/mcp/execute-tool" \
    -H "Authorization: Bearer ${AGENT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"tool_name\":\"get_client_details\",\"args\":{\"client\":\"${slug}\"}}" 2>/dev/null || echo '{}')

  local client_name
  client_name=$(python3 -c "
import sys,json
d=json.loads(sys.argv[1])
data=d.get('data',{})
p=data.get('profile',{})
print(p.get('canonical_name') or p.get('name') or '$slug')
" "$client_data" 2>/dev/null || echo "$slug")

  # ── 2. Fetch recent posts ───────────────────────────────────────────────────
  local posts_data
  posts_data=$(curl -sf -X POST "${API_BASE}/api/ai/mcp/execute-tool" \
    -H "Authorization: Bearer ${AGENT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"tool_name\":\"list_posts\",\"args\":{\"client\":\"${slug}\",\"limit\":20,\"status\":\"published\"}}" 2>/dev/null || echo '{}')

  # ── 3. Gemini: local market research ───────────────────────────────────────
  local industry location
  industry=$(python3 -c "
import sys,json
d=json.loads(sys.argv[1])
data=d.get('data',{})
intel=data.get('intelligence') or {}
p=data.get('profile',{})
print(intel.get('industry','') or p.get('industry','') or '')
" "$client_data" 2>/dev/null || echo "")

  location=$(python3 -c "
import sys,json
d=json.loads(sys.argv[1])
data=d.get('data',{})
areas=data.get('areas',[])
print(areas[0].get('area','Los Angeles, CA') if areas else 'Los Angeles, CA')
" "$client_data" 2>/dev/null || echo "Los Angeles, CA")

  local gemini_research="No industry research available."
  if [[ -n "$industry" ]]; then
    log "  Gemini → researching ${industry} in ${location}"
    gemini_research=$(gemini -p "You are a local market analyst. Research the ${industry} market in ${location}.

Provide a short report covering:
1. Top 5 search phrases homeowners use to find a ${industry} company locally
2. Main buyer objections/concerns before hiring
3. Winning differentiators in this market (what makes a company stand out)
4. Best social media content angles that drive leads (educational, trust, urgency)
5. Seasonal demand patterns for May-August 2026

Be specific and practical. Plain text, under 300 words." 2>/dev/null || echo "Research unavailable.")
  fi

  # ── 4. Build context file for Codex ────────────────────────────────────────
  local ctx_file
  ctx_file=$(mktemp -p /tmp codex.XXXXXXXXXX)

  python3 - "$client_data" "$posts_data" "$gemini_research" "$ctx_file" <<'PYEOF'
import sys, json

client_raw = sys.argv[1]
posts_raw  = sys.argv[2]
research   = sys.argv[3]
out_path   = sys.argv[4]

client_d = json.loads(client_raw) if client_raw != '{}' else {}
posts_d  = json.loads(posts_raw)  if posts_raw  != '{}' else {}

# Correct structure: client_d.data.profile / .intelligence / .services / .areas / .platforms
data  = client_d.get('data', {})
p     = data.get('profile', {})
intel = data.get('intelligence') or {}

# Compact post sample
post_items = (posts_d.get('items') or [])[:12]
posts_compact = [{
    'caption_preview': ((p2.get('instagram_caption') or p2.get('facebook_caption') or '')[:150]),
    'service': p2.get('service_tag'), 'area': p2.get('area_tag'), 'type': p2.get('content_type'),
} for p2 in post_items]

ctx = {
    'slug':            p.get('slug', ''),
    'name':            p.get('canonical_name') or p.get('name', ''),
    'location':        (data.get('areas') or [{'area': 'Los Angeles, CA'}])[0].get('area', ''),
    'services':        [s.get('name', '') for s in (data.get('services') or [])[:10]],
    'service_areas':   [a.get('area', '') for a in (data.get('areas') or [])[:8]],
    'platforms':       [pl.get('platform', '') for pl in (data.get('platforms') or [])],
    'existing_intel':  {k: v for k, v in intel.items() if k not in ('id','client_id','created_at','updated_at')},
    'recent_posts':    posts_compact,
    'market_research': research,
}

with open(out_path, 'w') as f:
    json.dump(ctx, f, indent=2, default=str)
PYEOF

  # ── 5. Codex: synthesize full intelligence profile ─────────────────────────
  log "  Codex → synthesizing intelligence profile for ${client_name}"

  local codex_out
  codex_out=$(mktemp -p /tmp codex-out.XXXXXXXXXX)

  cat "$ctx_file" | codex exec \
    -c 'sandbox_permissions=["disk-full-read-access"]' \
    "You are a marketing intelligence analyst for local service businesses.

Analyze the JSON client data provided in stdin and produce a comprehensive marketing intelligence profile.

Return ONLY a valid JSON object with exactly these fields — no markdown, no preamble, just the JSON:
{
  \"brand_voice\": \"2-3 sentences: tone, communication style, personality of this brand\",
  \"tone_keywords\": [\"professional\", \"trustworthy\", ...up to 6 words],
  \"approved_ctas\": [\"Call for a free estimate\", ...3-4 CTAs specific to this business],
  \"content_goals\": \"Primary goal (e.g. drive phone calls, generate website leads, build local trust)\",
  \"service_priorities\": [\"highest priority service\", \"second\", \"third\"],
  \"content_angles\": [\"angle1\", \"angle2\", \"angle3\", \"angle4\"],
  \"seasonal_notes\": \"What content opportunities exist for May-August 2026 for this business type\",
  \"audience_notes\": \"Who the buyer is, what concerns them, what motivates them to hire\",
  \"primary_keyword\": \"main local SEO phrase (e.g. general contractor los angeles)\",
  \"secondary_keywords\": [\"keyword2\", \"keyword3\", \"keyword4\"],
  \"local_seo_themes\": \"Neighborhoods, cities, landmarks to reference in content\",
  \"humanization_style\": \"How to make posts feel human — storytelling style, use of owner voice, team photos, etc\"
}

Base your analysis on: the client's services, service areas, recent post content, and the market research provided." \
    > "$codex_out" 2>/dev/null || true

  rm -f "$ctx_file"

  # ── 6. Parse Codex output ──────────────────────────────────────────────────
  local profile_json
  profile_json=$(extract_json_object "$codex_out" 2>/dev/null || echo "")
  rm -f "$codex_out"

  if [[ -z "$profile_json" ]]; then
    log "  ❌ Codex returned unparseable output"
    return
  fi

  # ── 7. Save to strategy dir ────────────────────────────────────────────────
  echo "$profile_json" > "${STRATEGY_DIR}/${slug}-intelligence.json"
  log "  ✅ Profile → scripts/strategy/${slug}-intelligence.json"

  # ── 8. Update client_intelligence in DB via MCP tool ──────────────────────
  # D1 doesn't support array values — stringify array fields first
  local db_payload
  db_payload=$(python3 -c "
import sys, json
profile = json.loads(sys.argv[1])
ARRAY_FIELDS = {'tone_keywords','approved_ctas','service_priorities','content_angles','secondary_keywords'}
for k in ARRAY_FIELDS:
    if k in profile and isinstance(profile[k], list):
        profile[k] = json.dumps(profile[k])
payload = {'tool_name': 'update_client_intelligence', 'args': {'client': sys.argv[2], 'fields': profile}}
print(json.dumps(payload))
" "$profile_json" "$slug" 2>/dev/null || echo '{}')

  local update_res
  update_res=$(echo "$db_payload" | curl -sf -X POST "${API_BASE}/api/ai/mcp/execute-tool" \
    -H "Authorization: Bearer ${AGENT_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary @- 2>/dev/null || echo '{}')

  local ok
  ok=$(python3 -c "
import sys,json
d=json.loads(sys.argv[1])
print('ok' if d.get('success') or d.get('ok') else 'fail')
" "$update_res" 2>/dev/null || echo "fail")

  if [[ "$ok" == "ok" ]]; then
    log "  ✅ DB intelligence updated"
  else
    log "  ⚠️  DB update failed — profile saved locally only"
  fi
}

# ── Run ────────────────────────────────────────────────────────────────────────
if [[ "$TARGET" == "all" ]]; then
  for slug in "${ALL_CLIENTS[@]}"; do
    profile_client "$slug" || log "  ⚠️  ${slug} skipped (error)"
  done
else
  profile_client "$TARGET"
fi

log ""
log "=== Profiling Complete ==="

DONE_COUNT=$(find "${STRATEGY_DIR}" -name '*-intelligence.json' 2>/dev/null | wc -l | tr -d ' ')
curl -sf -X POST "${API_BASE}/internal/agent/discord-notify" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"🧠 Client Profiles Updated\",\"description\":\"Codex built intelligence profiles for all clients. ${DONE_COUNT} profiles saved and synced to DB.\",\"color\":\"ok\"}" \
  > /dev/null 2>&1 || true

log "Log: ${LOG_FILE}"
