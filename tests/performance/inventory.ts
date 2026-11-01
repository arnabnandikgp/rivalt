import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { flattenAccounts, type IdlAccount } from './lock-model.js';

const instructions = [], idlHashes: Record<string, string> = {};
for (const program of ['clearing', 'maker_a', 'maker_b']) {
  const raw = readFileSync(`packages/sdk/idl/${program}.json`);
  idlHashes[program] = createHash('sha256').update(raw).digest('hex');
  const idl = JSON.parse(raw.toString()) as { instructions: { name: string; accounts: IdlAccount[] }[] };
  for (const instruction of idl.instructions) {
    const accounts = flattenAccounts(instruction.accounts);
    instructions.push({ program, name: instruction.name,
      write: accounts.filter(account => account.writable).map(account => account.path),
      read: accounts.filter(account => !account.writable).map(account => account.path),
      signers: accounts.filter(account => account.signer).map(account => account.path),
      optional: accounts.filter(account => account.optional).map(account => account.path) });
  }
}
const output = JSON.stringify({ schema: 1, scope: 'Declared IDL accounts; dynamic remaining accounts and fee payer must be resolved per transaction',
  idlHashes, instructions }, null, 2) + '\n';
const path = 'tests/performance/baselines/current-locks.json';
assert(Buffer.byteLength(output) < 64 * 1024, 'Keep the inventory bounded');
if (process.argv.includes('--write')) writeFileSync(path, output);
else assert.equal(readFileSync(path, 'utf8'), output, 'Lock inventory changed; review its access-set diff and regenerate with --write');
const clearing = instructions.filter(instruction => instruction.program === 'clearing');
console.log(JSON.stringify({ entrypoints: instructions.length, clearing: clearing.length,
  custodyWriters: clearing.filter(instruction => instruction.write.some(path => path.split('.').at(-1) === 'custody')).length }));
