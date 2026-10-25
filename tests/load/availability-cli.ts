import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { availability } from './availability.js';

const [input, output] = process.argv.slice(2);
assert(input && output, 'Usage: availability-cli.ts ATTEMPTS_JSONL NEW_REPORT');
const bytes = readFileSync(input);
const rows = bytes.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const report = { inputSha256: createHash('sha256').update(bytes).digest('hex'), ...availability(rows) };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(report));
