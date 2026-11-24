// Extract the economic inputs from the finalized transactions of a retained storage run.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as sdk from '@rivalt/sdk';
import { eventPayloads } from '../../packages/indexer/src/events.js';

const directory = process.argv[2];
assert(directory, 'Pass a completed mixed-price maker run directory');
const read = (file: string) => JSON.parse(readFileSync(join(directory, file), 'utf8'));
const run = read('mixed-maker-storage.json');
const { binding } = read('sql-mixed-storage-maker-exit-snapshot.json');
assert.equal(run.program, sdk.accountDeployment('closed-quantity').programRevision);
assert.equal(binding.artifactSet, sdk.CLOSED_QUANTITY_ARTIFACT_SET);

type Route = { signature: string; error: unknown };
const pending = new Map<string, Route>(run.routes.map((route: Route) => [route.signature, route]));
assert.equal(pending.size, run.routes.length);
const [authority] = await sdk.findEventAuthorityPda();
const discriminator = Buffer.from(sdk.LIQUIDITY_ROUTE_FEE_RECORDED_EVENT_DISCRIMINATOR);
const decoder = sdk.getLiquidityRouteFeeRecordedEventDecoder();
const traders = new Map<string, number>();
let refusals = 0;
const lines: string[] = [];
const receipts = readdirSync(directory).filter(name => /^transaction-\d+\.json$/.test(name));
const receiptIndex = (name: string) => Number(name.slice('transaction-'.length, -'.json'.length));
receipts.sort((first, second) => receiptIndex(first) - receiptIndex(second));
for (const name of receipts) {
  const transaction = read(name);
  const signature = transaction.transaction.signatures[0];
  const route = pending.get(signature);
  if (!route) continue;
  pending.delete(signature);
  assert.deepEqual(transaction.meta.err, route.error);
  if (transaction.meta.err !== null) {
    refusals++;
    continue;
  }
  const events = eventPayloads(signature, transaction, authority)
    .filter(event => event.payload.subarray(0, 8).equals(discriminator));
  assert.equal(events.length, 1);
  const fill = decoder.decode(events[0].payload);
  assert.equal(fill.venue, binding.venue);
  assert.equal(fill.marketState.index, 0);
  assert.equal(fill.legs.length, 1);
  const [leg] = fill.legs;
  assert.deepEqual([leg.instance, leg.lots, leg.gross], [0, fill.lots, fill.grossQuote]);
  const takers = fill.rootStates.filter(root => root.role === 0);
  assert.equal(takers.length, 1);
  const owner = takers[0].owner;
  if (!traders.has(owner)) traders.set(owner, traders.size);
  assert(fill.side === 0 || fill.side === 1);
  const signedLots = fill.side === 0 ? fill.lots : -fill.lots;
  lines.push([traders.get(owner), signedLots, fill.grossQuote, fill.fee].join(' '));
}
assert.deepEqual([pending.size, traders.size, refusals], [0, 2, 2]);
process.stdout.write(lines.join('\n') + '\n');
