#!/bin/sh
set -e
npm install --prefix worker
npm install --prefix frontend
npm run build --prefix frontend
echo "=== deploying loader worker ==="
npx wrangler deploy --config wrangler.loader.toml || echo "LOADER DEPLOY FAILED (exit $?)"
echo "=== loader deploy done ==="
echo "=== deploying main worker ==="
npx wrangler deploy
echo "=== main deploy done ==="
