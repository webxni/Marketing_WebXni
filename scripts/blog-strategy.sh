#!/usr/bin/env bash
# Blog Post Strategy Generator — Codex-powered
# Generates a 3-month SEO blog strategy for each client using saved intelligence.
# Excludes: modern-vision-remodeling, jaz-makeup-artist
#
# Usage: bash scripts/blog-strategy.sh [--dry-run]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

LOG_FILE="${LOG_DIR}/blog-strategy-$(date +%Y-%m-%d).log"
mkdir -p "$LOG_DIR"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }
log "=== Blog Strategy Run: $(date) ==="
log "Mode: $($DRY_RUN && echo 'DRY-RUN' || echo 'LIVE')"

# Clients to process (exclude modern-vision-remodeling and jaz-makeup-artist)
declare -a STRATEGY_CLIENTS=(
  "247-lockout-pasadena|24/7 Lockout Locksmith|Locksmith|Pasadena, CA"
  "724-locksmith-ca|7/24 Locksmith Services|Locksmith|California"
  "americas-professional-builders|America's Professional Builders Inc.|General Contractor|Los Angeles, CA"
  "caliview-builders|CALI-VIEW BUILDERS|Construction & Remodeling|Los Angeles, CA"
  "caliview-landscape|Caliview Landscape|Landscaping|Los Angeles, CA"
  "daniels-locksmith|Daniel's Locks & Key|Locksmith|California"
  "elite-team-builders|Elite Team Builders Inc.|Construction & Remodeling|Los Angeles, CA and Seattle, WA"
  "golden-touch-roofing|Golden Touch Roofing|Roofing|Los Angeles, CA"
  "unlocked-pros|Unlock'D Pros|Locksmith|Pasadena, CA"
  "webxni|WebXni|Marketing Agency|Los Angeles, CA"
)

total=0
succeeded=0
failed=0

for entry in "${STRATEGY_CLIENTS[@]}"; do
  IFS='|' read -r slug name industry location <<< "$entry"
  total=$((total + 1))

  log ""
  log "── ${name} (${slug})"

  INTEL_FILE="${STRATEGY_DIR}/${slug}-intelligence.json"
  PROFILE_FILE="${STRATEGY_DIR}/${slug}.md"
  OUTPUT_FILE="${STRATEGY_DIR}/${slug}-blog-strategy.md"

  # Build context from available files
  CONTEXT=""
  if [[ -f "$INTEL_FILE" ]]; then
    CONTEXT="${CONTEXT}

=== CLIENT INTELLIGENCE ===
$(cat "$INTEL_FILE")"
  fi
  if [[ -f "$PROFILE_FILE" ]]; then
    CONTEXT="${CONTEXT}

=== CLIENT PROFILE ===
$(cat "$PROFILE_FILE")"
  fi

  BLOG_TOPICS_FILE="${STRATEGY_DIR}/${slug}-blog-topics.md"
  if [[ -f "$BLOG_TOPICS_FILE" ]]; then
    CONTEXT="${CONTEXT}

=== RESEARCHED BLOG TOPICS ===
$(cat "$BLOG_TOPICS_FILE")"
  fi

  CODEX_PROMPT="You are a senior SEO content strategist building a comprehensive blog strategy for a local business.

BUSINESS: ${name}
INDUSTRY: ${industry}
LOCATION: ${location}

${CONTEXT}

BUILD A 3-MONTH SEO BLOG CONTENT STRATEGY with the following sections:

## 1. Strategic Goals
- Primary SEO objective (what rankings to target)
- Target audience segments (homeowner, property manager, emergency caller, etc.)
- Content differentiation angle vs. competitors in ${location}

## 2. Content Pillars (4–5 pillars)
Each pillar: name, goal, example topics, target buyer stage (awareness/consideration/decision)

## 3. Keyword Targets
- 5 primary keywords (high intent, local)
- 10 secondary/long-tail keywords
- 3 featured snippet opportunities

## 4. 3-Month Publishing Calendar
Month 1–3: 4 posts per month = 12 posts total
For each post:
- Week number
- Working title
- Target keyword
- Content format (how-to, list, FAQ, case study, local guide, comparison)
- Call to action
- Internal link target

## 5. Content Brief Templates
Write a 150-word brief for the top 2 posts from Month 1 that includes: audience, angle, H2 outline, CTA, and SEO notes.

## 6. Distribution Plan
How each blog post should be repurposed across their active social platforms.

Write in clear markdown. Be specific to ${industry} in ${location}. Focus on driving local leads, Google rankings, and trust. Do not be generic."

  if $DRY_RUN; then
    log "  [dry-run] Would run Codex for ${slug}"
    continue
  fi

  log "  Running Codex..."
  TMPFILE=$(mktemp /tmp/codex-strategy-XXXXXX.txt)

  if codex exec "$CODEX_PROMPT" \
    -c 'sandbox_permissions=["read-only"]' \
    > "$TMPFILE" 2>/dev/null; then

    if [[ -s "$TMPFILE" ]]; then
      {
        echo "# Blog Post Strategy — ${name}"
        echo "**Generated:** $(date +%Y-%m-%d) | **Industry:** ${industry} | **Location:** ${location}"
        echo ""
        cat "$TMPFILE"
      } > "$OUTPUT_FILE"
      log "  ✅ Strategy saved → ${slug}-blog-strategy.md"
      succeeded=$((succeeded + 1))
    else
      log "  ❌ Codex returned empty output"
      failed=$((failed + 1))
    fi
  else
    # Codex may output to stdout even on non-zero exit — check tmpfile
    if [[ -s "$TMPFILE" ]]; then
      {
        echo "# Blog Post Strategy — ${name}"
        echo "**Generated:** $(date +%Y-%m-%d) | **Industry:** ${industry} | **Location:** ${location}"
        echo ""
        cat "$TMPFILE"
      } > "$OUTPUT_FILE"
      log "  ✅ Strategy saved (exit non-zero but output exists) → ${slug}-blog-strategy.md"
      succeeded=$((succeeded + 1))
    else
      log "  ❌ Codex failed for ${slug}"
      failed=$((failed + 1))
    fi
  fi

  rm -f "$TMPFILE"

  # Brief pause between clients to avoid rate limits
  sleep 3
done

log ""
log "=== Blog Strategy Complete: ${succeeded}/${total} succeeded, ${failed} failed ==="
log "Files saved to: ${STRATEGY_DIR}/"
log "Log: ${LOG_FILE}"

# Discord notification
curl -sf -X POST "${API_BASE}/internal/agent/discord-notify" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"📋 Blog Strategy Complete\",\"description\":\"Generated 3-month SEO blog strategies for ${succeeded}/${total} clients using Codex. Saved to scripts/strategy/.\",\"color\":\"ok\"}" \
  > /dev/null 2>&1 || true
