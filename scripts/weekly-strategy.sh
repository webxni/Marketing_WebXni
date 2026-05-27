#!/usr/bin/env bash
# Weekly per-client content strategy via Claude CLI
# Runs every Monday 6AM — fetches each client's profile, generates
# a 2-week content strategy, saves to scripts/strategy/[slug].md.
#
# Usage: bash scripts/weekly-strategy.sh [client_slug|all]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

TARGET="${1:-all}"
LOG_FILE="${LOG_DIR}/weekly-strategy-$(date +%Y-%m-%d).log"
WEEK_START=$(date +%Y-%m-%d)

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }
log "=== Weekly Strategy Run: ${WEEK_START} ==="

process_client() {
  local slug="$1"
  log ""
  log "── ${slug}"

  # Fetch client profile via MCP tool
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

  # Compact profile summary for prompt
  local profile_summary
  profile_summary=$(python3 -c "
import sys,json
d=json.loads(sys.argv[1])
data=d.get('data',{})
p=data.get('profile',{})
intel=data.get('intelligence') or {}
ctx={
  'name': p.get('canonical_name') or p.get('name',''),
  'services': [s.get('name') for s in (data.get('services') or [])[:8]],
  'areas': [a.get('area') for a in (data.get('areas') or [])[:6]],
  'platforms': [pl.get('platform') for pl in (data.get('platforms') or [])],
  'brand_voice': intel.get('brand_voice',''),
  'content_goals': intel.get('content_goals',''),
  'service_priorities': intel.get('service_priorities',''),
  'approved_ctas': intel.get('approved_ctas',''),
}
print(json.dumps(ctx))
" "$client_data" 2>/dev/null | head -c 2000 || echo "{\"name\":\"${slug}\"}")

  local outfile="${STRATEGY_DIR}/${slug}.md"

  local prompt="You are a social media and content marketing strategist for local service businesses.

Analyze this client and create a practical 2-week content strategy.

CLIENT PROFILE:
${profile_summary}

WEEK OF: ${WEEK_START}

Produce a concise strategy document in markdown covering:

## Content Pillars
2-3 themes for this client this week based on their services, season (spring/summer 2026), and what local buyers are searching for.

## Platform Focus
Which platforms to prioritize this week and the content format for each (image post, carousel, GBP update, etc).

## Service Spotlight
Which specific service to promote this week. Rotate so the same service is not featured two weeks in a row.

## CTA Strategy
What action to ask of the audience (call now, get a free estimate, visit website, book online). Match to the business type.

## Blog Topics (if WordPress)
2 blog post ideas targeting local search keywords. Include the keyword and the content angle.

## Buyer Persona Hook
Which buyer persona to address this week (homeowner, property manager, business owner, etc) and what concern or question to answer for them.

## Posting Cadence
Recommended posts per platform for the week based on the package and available platforms.

Be specific to this client. Use their actual services and location. Under 400 words total."

  local strategy
  strategy=$(claude --print "$prompt" 2>/dev/null || echo "")

  if [[ -z "$strategy" ]]; then
    log "  ❌ Claude returned empty output"
    return
  fi

  {
    echo "# Content Strategy — ${client_name:-$slug}"
    echo ""
    echo "> Week of ${WEEK_START} | Generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""
    echo "$strategy"
  } > "$outfile"

  log "  ✅ Saved → scripts/strategy/${slug}.md"
}

if [[ "$TARGET" == "all" ]]; then
  for slug in "${ALL_CLIENTS[@]}"; do
    process_client "$slug" || log "  ⚠️  ${slug} failed, continuing"
  done
else
  process_client "$TARGET"
fi

log ""
log "=== Strategy Run Complete ==="

# Discord summary
SUMMARY="Content strategies generated for all active clients (week of ${WEEK_START}). Review in scripts/strategy/ before generating posts."
curl -sf -X POST "${API_BASE}/internal/agent/discord-notify" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"📊 Weekly Content Strategies Ready\",\"description\":\"${SUMMARY}\",\"color\":\"ok\"}" \
  > /dev/null 2>&1 || true

log "Log: ${LOG_FILE}"
