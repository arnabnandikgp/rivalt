import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { makerEconomics } from './economics.js';

const [input, output] = process.argv.slice(2);
assert(input && output, 'Usage: pnpm maker:report <captured-input.json> <new-report.json>');
const captured = JSON.parse(readFileSync(input, 'utf8'));
const report = makerEconomics(captured.input ?? captured);
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ result: report.reconciliation, output, independentMakerValidation: false }));
