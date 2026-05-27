#!/usr/bin/env bash
# WebXni AI Orchestrator — master weekly script
# Runs Monday 6AM — coordinates Claude (strategy) + Gemini (research) + BrightLocal.
#
# Full weekly schedule (cron-based, zero idle tokens):
#   Mon 6AM  → orchestrate.sh   Strategy (Claude) + Blog Research (Gemini)
#   Wed 6AM  → brightlocal-sync.mjs   Rankings pull
#   9AM daily → Worker cron: platform health check + Discord alert if issues
#
# Usage: bash scripts/orchestrate.sh [--dry-run] [--skip-strategy] [--skip-research]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

DRY_RUN=false; SKIP_STRATEGY=false; SKIP_RESEARCH=false
for arg in "$@"; do
  case "$arg" in
    --dry-run)        DRY_RUN=true ;;
    --skip-strategy)  SKIP_STRATEGY=true ;;
    --skip-research)  SKIP_RESEARCH=true ;;
  esac
done

LOG_FILE="${LOG_DIR}/orchestrator-$(date +%Y-%m-%d).log"
START=$(date +%s)

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }

log "╔═══════════════════════════════════════════════"
log "║  WebXni AI Orchestrator — $(date +%Y-%m-%d)"
log "║  Mode: $( $DRY_RUN && echo 'DRY-RUN' || echo 'LIVE')"
log "╚═══════════════════════════════════════════════"

STRATEGY_OK=false; RESEARCH_OK=false

# ── Module 1: Weekly Strategy (Claude) ─────────────────────────────────────────
if ! $SKIP_STRATEGY; then
  log ""
  log "▶ [1/2] Weekly Strategy — Claude analyzing all clients"
  if bash "${SCRIPT_DIR}/weekly-strategy.sh" $( $DRY_RUN && echo '--dry-run' || true ) >> "$LOG_FILE" 2>&1; then
    STRATEGY_OK=true
    log "  ✅ Strategy complete — see scripts/strategy/*.md"
  else
    log "  ❌ Strategy module failed — check ${LOG_FILE}"
  fi
fi

# ── Module 2: Blog Keyword Research (Gemini) ───────────────────────────────────
if ! $SKIP_RESEARCH; then
  log ""
  log "▶ [2/2] Blog Research — Gemini searching SEO keywords"
  if bash "${SCRIPT_DIR}/blog-research.sh" $( $DRY_RUN && echo '--dry-run' || true ) >> "$LOG_FILE" 2>&1; then
    RESEARCH_OK=true
    log "  ✅ Research complete — topics queued for WordPress clients"
  else
    log "  ❌ Research module failed — check ${LOG_FILE}"
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────────────
ELAPSED=$(( $(date +%s) - START ))

log ""
log "╔═══════════════════════════════════════════════"
log "║  Done in ${ELAPSED}s"
log "║  Strategy: $( $STRATEGY_OK && echo '✅' || echo '❌ / skipped' )"
log "║  Research: $( $RESEARCH_OK && echo '✅' || echo '❌ / skipped' )"
log "╚═══════════════════════════════════════════════"
log "Logs: ${LOG_DIR}/"
log ""
log "Next: Wed 6AM → brightlocal-sync.mjs (ranking check)"
log "Daily 9AM → platform health check (worker cron)"
