#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$ROOT_DIR/mcp-server"

export WEBXNI_WORKER_BASE_URL="${WEBXNI_WORKER_BASE_URL:-https://marketing.webxni.com}"
export WEBXNI_AGENT_INTERNAL_TOKEN="${WEBXNI_AGENT_INTERNAL_TOKEN:-${AGENT_INTERNAL_TOKEN:-}}"

if [[ -z "${WEBXNI_AGENT_INTERNAL_TOKEN}" ]]; then
  echo "Missing WEBXNI_AGENT_INTERNAL_TOKEN or AGENT_INTERNAL_TOKEN" >&2
  exit 1
fi

cd "$MCP_DIR"

if [[ -x "./node_modules/.bin/tsx" ]]; then
  exec ./node_modules/.bin/tsx src/index.ts
fi

if command -v npx >/dev/null 2>&1; then
  exec npx tsx src/index.ts
fi

echo "Missing tsx runtime. Install mcp-server dependencies first." >&2
exit 1
