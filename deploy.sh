#!/bin/sh
set -e
npm install --prefix worker
npm install --prefix frontend
npm run build --prefix frontend
npx wrangler deploy --config wrangler.loader.toml
npx wrangler deploy
