#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { auditPostsContentQuality } from './lib/content-quality-audit.mjs';

function readJsonInput() {
  const inputPath = process.argv[2];
  const text = inputPath ? readFileSync(inputPath, 'utf8') : readFileSync(0, 'utf8');
  if (!text.trim()) throw new Error('No JSON input provided. Pass a file or pipe a /api/posts JSON response.');
  return JSON.parse(text);
}

const payload = readJsonInput();
const posts = Array.isArray(payload) ? payload : (payload.posts || payload.rows || []);
const result = auditPostsContentQuality(posts);
console.log(JSON.stringify(result, null, 2));

if (process.env.CONTENT_QUALITY_FAIL_ON_BLOCKERS === '1' && result.blocker_count > 0) {
  process.exitCode = 1;
}
