#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const commit = (process.env.SOURCE_COMMIT || process.env.GITHUB_SHA || '').trim();
if (!commit) {
  console.error('SOURCE_COMMIT or GITHUB_SHA is required');
  process.exit(2);
}

const path = process.argv[2] || 'wrangler.toml';
let text = readFileSync(path, 'utf8');
const line = `SOURCE_COMMIT = "${commit}"`;

if (/^SOURCE_COMMIT\s*=.*$/m.test(text)) {
  text = text.replace(/^SOURCE_COMMIT\s*=.*$/m, line);
} else if (/^\[vars\]\s*$/m.test(text)) {
  text = text.replace(/^\[vars\]\s*$/m, `[vars]\n${line}`);
} else {
  console.error(`${path} does not contain a [vars] section`);
  process.exit(3);
}

writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`);
console.log(`Stamped ${path} with SOURCE_COMMIT=${commit}`);
