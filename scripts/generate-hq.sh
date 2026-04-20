#!/usr/bin/env bash
# High-quality weekly content generation — triggers a run via the production API.
#
# Usage:
#   ./scripts/generate-hq.sh [client_slug] [week] [mode]
#
# Arguments:
#   client_slug  — e.g. elite-team-builders, golden-touch-roofing
#                  Omit or pass "all" for all active clients
#   week         — this-week | next-week | YYYY-MM-DD (the Monday of the target week)
#                  Default: next-week
#   mode         — standard | high-quality
#                  Default: high-quality
#
# Examples:
#   ./scripts/generate-hq.sh
#   ./scripts/generate-hq.sh elite-team-builders next-week high-quality
#   ./scripts/generate-hq.sh golden-touch-roofing this-week standard
#   ./scripts/generate-hq.sh all 2026-04-28 high-quality
#
# Requirements:
#   - SESSION cookie from a logged-in admin session
#   - Set SESSION env var or use the -b /tmp/session.cookie approach
#   - curl, jq

set -euo pipefail

CLIENT="${1:-all}"
WEEK="${2:-next-week}"
MODE="${3:-high-quality}"

BASE_URL="${WEBXNI_URL:-https://marketing.webxni.com}"
SESSION_COOKIE="${SESSION:-}"

# Resolve week to YYYY-MM-DD range
today=$(date -u +%Y-%m-%d)
dow=$(date -u +%u)  # 1=Mon ... 7=Sun

if [[ "$WEEK" == "next-week" ]]; then
  days_to_next_mon=$(( 8 - dow ))
  [[ $days_to_next_mon -gt 7 ]] && days_to_next_mon=$(( days_to_next_mon - 7 ))
  monday=$(date -u -d "$today + ${days_to_next_mon} days" +%Y-%m-%d 2>/dev/null || date -u -v "+${days_to_next_mon}d" +%Y-%m-%d)
elif [[ "$WEEK" == "this-week" ]]; then
  days_to_mon=$(( dow - 1 ))
  monday=$(date -u -d "$today - ${days_to_mon} days" +%Y-%m-%d 2>/dev/null || date -u -v "-${days_to_mon}d" +%Y-%m-%d)
elif [[ "$WEEK" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  monday="$WEEK"
else
  echo "Error: invalid week format. Use: this-week, next-week, or YYYY-MM-DD"
  exit 1
fi

# Compute Sunday (end of week)
sunday=$(date -u -d "$monday + 6 days" +%Y-%m-%d 2>/dev/null || date -u -v "+6d" -j -f "%Y-%m-%d" "$monday" +%Y-%m-%d)

echo "→ Client:    ${CLIENT}"
echo "→ Week:      ${monday} → ${sunday}"
echo "→ Mode:      ${MODE}"
echo "→ Endpoint:  ${BASE_URL}/api/run/generate"
echo ""

# Build JSON payload
HQ="false"
[[ "$MODE" == "high-quality" ]] && HQ="true"

if [[ "$CLIENT" == "all" ]]; then
  PAYLOAD=$(jq -n \
    --arg from "$monday" \
    --arg to   "$sunday" \
    --argjson hq "$HQ" \
    '{date_from: $from, date_to: $to, high_quality: $hq}')
else
  PAYLOAD=$(jq -n \
    --arg from   "$monday" \
    --arg to     "$sunday" \
    --argjson hq "$HQ" \
    --argjson slugs "[\"$CLIENT\"]" \
    '{date_from: $from, date_to: $to, high_quality: $hq, client_slugs: $slugs}')
fi

# Make the request
if [[ -n "$SESSION_COOKIE" ]]; then
  RESPONSE=$(curl -sS -X POST "${BASE_URL}/api/run/generate" \
    -H "Content-Type: application/json" \
    -H "Cookie: session=${SESSION_COOKIE}" \
    -d "$PAYLOAD")
elif [[ -f /tmp/wc.txt ]]; then
  RESPONSE=$(curl -sS -X POST "${BASE_URL}/api/run/generate" \
    -H "Content-Type: application/json" \
    -b /tmp/wc.txt \
    -d "$PAYLOAD")
else
  echo "Error: no session found. Set SESSION env var or ensure /tmp/wc.txt exists."
  echo "  Login: curl -c /tmp/wc.txt -X POST ${BASE_URL}/api/auth/login -d '{\"email\":\"...\",\"password\":\"...\"}'"
  exit 1
fi

echo "Response: $RESPONSE"

JOB_ID=$(echo "$RESPONSE" | jq -r '.job_id // empty')
if [[ -n "$JOB_ID" ]]; then
  echo ""
  echo "✅ Run started: $JOB_ID"
  echo "   Monitor: ${BASE_URL}/automation"
  echo "   API:     curl -s -b /tmp/wc.txt ${BASE_URL}/api/run/generate/runs/${JOB_ID} | jq .run.status"
else
  echo "❌ Generation did not start — check the response above"
  exit 1
fi
