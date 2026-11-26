// Reconstruct the solvent open book from its finalized fills, independently of lane summaries.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import * as sdk from '@rivalt/sdk';
import {eventPayloads, json} from '../../packages/indexer/src/events.js';

const directory = process.argv[2];
assert(directory, 'Pass a completed paired full-lane workload');
const read = (file:string) => JSON.parse(readFileSync(join(directory,file), 'utf8'));
const result = read('capacity.json');
assert.deepEqual(result.coverageLogs, [0,128].map(exact => 'coverage target=1 members=128 exact='+exact+' covered=1'));
const [authority] = await sdk.findEventAuthorityPda();
const tag = Buffer.from(sdk.LEDGER_LANE_FILLED_EVENT_DISCRIMINATOR);
const margins = new Map<bigint,sdk.MarginAccountSnapshot>(), owners = new Set<string>();
const lanes = new Set<number>(), makers = new Set<bigint>();
let spread = 0n;
const roundTripSides = new Set<number>();
let bounds: [bigint,bigint] | undefined;
const files = readdirSync(directory).filter(name => /^wire-\d+\.json$/.test(name))
  .sort((first,second) => Number.parseInt(first.slice(5))-Number.parseInt(second.slice(5)));
for (const file of files) {
  const wire = read(file);
  const opening = /^open forty ETH lots in lane ([0-7])$/.exec(wire.label);
  if (!opening && !['buy ten ETH lots','sell ten ETH lots'].includes(wire.label)) continue;
  const receipt = read(file.replace('wire-', 'transaction-'));
  assert.equal(receipt.meta.err, null);
  const matches = eventPayloads(wire.signature, receipt, authority).filter(row => row.payload.subarray(0,8).equals(tag));
  assert.equal(matches.length, 1);
  const fill = sdk.getLedgerLaneFilledEventDecoder().decode(matches[0].payload);
  assert.equal(fill.marketState.index, 1);
  assert.equal(fill.legs.length, 1);
  if (!opening) {
    assert.equal(fill.side, wire.label === 'buy ten ETH lots' ? 0 : 1);
    assert(!roundTripSides.has(fill.side));
    roundTripSides.add(fill.side);
    assert.equal(fill.lots, 10n);
    assert.equal(fill.legs[0].instance, 0);
    spread += fill.side === 0 ? fill.grossQuote : -fill.grossQuote;
    continue;
  }
  const lane = Number(opening[1]);
  assert(!lanes.has(lane));
  lanes.add(lane);
  assert.deepEqual([fill.lots,fill.side,fill.marketState.fundingIndexScaled,fill.marketState.oracle.premiumScaled], [40n,0,0n,0n]);
  const currentBounds: [bigint,bigint] = [fill.marketState.lower,fill.marketState.upper];
  if (bounds) assert.deepEqual(currentBounds,bounds);
  bounds = currentBounds;
  for (const margin of fill.rootStates) {
    margins.set(margin.id, margin);
    if (margin.role === 0) {
      assert.equal(Number(margin.id%8n), lane);
      owners.add(margin.owner);
    } else makers.add(margin.id);
  }
}
assert(bounds && roundTripSides.size === 2);
assert.deepEqual([lanes.size, makers.size, margins.size, spread], [8,2,10,40n]);
assert.equal(BigInt(result.withdrawn), spread);
const scale = 1_000_000_000n;
let netLots = 0n;
const headroom = [];
for (const margin of margins.values()) {
  const [btc, eth] = margin.positions;
  assert.deepEqual([btc.lots, btc.virtualScaled], [0n,0n]);
  const adversePrice = eth.lots > 0n ? bounds[0] : bounds[1];
  const claim = eth.virtualScaled + eth.lots*(adversePrice*scale+eth.fundingCheckpointScaled);
  const coveredCash = margin.cash*scale + (claim < 0n ? claim : 0n);
  assert(coveredCash >= 0n);
  headroom.push(coveredCash);
  netLots += eth.lots;
}
assert.equal(netLots, 0n);
console.log(json({spread, occupiedLanes:lanes.size, exposedAccounts:margins.size, exposedTraderOwners:owners.size,
  lower:bounds[0], upper:bounds[1], minimumCoveredCashScaled:headroom.reduce((lowest,value) => value < lowest ? value : lowest)}));
