#!/usr/bin/env bash
# SEO blog topic research via Gemini CLI
# Runs every Tuesday 7AM — researches local SEO keywords for each WordPress client
# and adds discovered topics to the content queue.
#
# Usage: bash scripts/blog-research.sh [--dry-run]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

LOG_FILE="${LOG_DIR}/blog-research-$(date +%Y-%m-%d).log"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }
log "=== Blog Research Run: $(date) ==="
log "Mode: $( $DRY_RUN && echo 'DRY-RUN' || echo 'LIVE' )"

add_topics_to_queue() {
  local slug="$1"
  local topics_json="$2"

  if $DRY_RUN; then
    log "  [dry-run] Would add topics to ${slug}"
    return 0
  fi

  local result
  result=$(curl -sf -X POST "${API_BASE}/api/ai/mcp/execute-tool" \
    -H "Authorization: Bearer ${AGENT_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-raw "{\"tool_name\":\"add_client_topics\",\"args\":{\"client\":\"${slug}\",\"topics\":${topics_json},\"content_type\":\"blog\",\"priority\":5}}" 2>/dev/null)

  local added
  added=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('summary',{}).get('inserted','?'))" 2>/dev/null || echo "?")
  log "  → ${added} topics queued for ${slug}"
}

extract_json_array() {
  local tmpfile="$1"
  python3 - "$tmpfile" <<'PYEOF' 2>/dev/null
import sys, json

text = open(sys.argv[1], 'r').read()
start = text.find('[')
if start == -1:
    sys.exit(1)

depth = 0
in_str = False
escape = False
end = -1
for i, c in enumerate(text[start:], start):
    if escape:
        escape = False
        continue
    if c == '\\' and in_str:
        escape = True
        continue
    if c == '"':
        in_str = not in_str
        continue
    if in_str:
        continue
    if c == '[':
        depth += 1
    elif c == ']':
        depth -= 1
        if depth == 0:
            end = i
            break

if end == -1:
    sys.exit(1)

try:
    parsed = json.loads(text[start:end+1])
    if isinstance(parsed, list) and all(isinstance(x, str) for x in parsed):
        print(json.dumps(parsed))
    else:
        sys.exit(1)
except Exception:
    sys.exit(1)
PYEOF
}

for entry in "${WP_CLIENTS[@]}"; do
  IFS='|' read -r slug name industry location <<< "$entry"

  log ""
  log "── ${name} (${slug})"

  PROMPT="You are an SEO content strategist specializing in local home services and construction.

Research and generate 8 unique blog topic ideas for a ${industry} company in ${location}.

Requirements:
- Target homeowners and property managers searching for ${industry} help in ${location}
- Mix: how-to guides, buyer questions, cost comparisons, local area guides, project showcases
- Each title should be the kind of thing someone would Google before hiring a contractor
- Focus on topics that establish expertise, answer real buyer questions, and drive local leads

Business: ${name}
Industry: ${industry}
Location: ${location}
Goal: rank in Google local search, generate qualified leads

Return ONLY a valid JSON array of 8 topic title strings — no markdown, no explanation, just the raw array:
[\"Topic 1\", \"Topic 2\", ...]"

  TMPFILE=$(mktemp /tmp/gemini-research-XXXXXX.txt)
  gemini -p "$PROMPT" > "$TMPFILE" 2>/dev/null || true

  if [[ ! -s "$TMPFILE" ]]; then
    log "  ❌ Gemini returned empty output for ${slug}"
    rm -f "$TMPFILE"
    continue
  fi

  TOPICS_JSON=$(extract_json_array "$TMPFILE")

  if [[ -z "$TOPICS_JSON" ]]; then
    log "  ❌ Could not parse JSON array from Gemini output"
    echo "--- RAW OUTPUT ---" >> "$LOG_FILE"
    head -c 600 "$TMPFILE" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"
    echo "---" >> "$LOG_FILE"
    cp "$TMPFILE" "${STRATEGY_DIR}/${slug}-research-raw-$(date +%Y%m%d).txt"
    rm -f "$TMPFILE"
    continue
  fi

  rm -f "$TMPFILE"

  COUNT=$(python3 -c "import sys,json; print(len(json.loads(sys.argv[1])))" "$TOPICS_JSON" 2>/dev/null || echo 0)
  log "  ✅ ${COUNT} topics found"
  python3 -c "import sys,json; [print('     • ' + t) for t in json.loads(sys.argv[1])]" "$TOPICS_JSON" 2>/dev/null | tee -a "$LOG_FILE" || true

  add_topics_to_queue "$slug" "$TOPICS_JSON"

  # Save research to strategy dir for reference
  {
    echo "# Blog Research — ${name}"
    echo "**Date:** $(date +%Y-%m-%d)"
    echo ""
    echo "## Topics Queued"
    python3 -c "import sys,json; [print('- ' + t) for t in json.loads(sys.argv[1])]" "$TOPICS_JSON" 2>/dev/null || true
  } >> "${STRATEGY_DIR}/${slug}-blog-topics.md" || true
done

log ""
log "=== Blog Research Complete ==="

curl -sf -X POST "${API_BASE}/internal/agent/discord-notify" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"📝 SEO Blog Research Complete\",\"description\":\"Added blog topics for Americas Builders, Cali-View Builders, and Elite Team Builders. Topics are queued for content generation.\",\"color\":\"ok\"}" \
  > /dev/null 2>&1 || true

log "Log: ${LOG_FILE}"
