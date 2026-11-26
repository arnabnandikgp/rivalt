// Reconstruct the solvent open book from its finalized fills, independently of lane summaries.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ComputeBudgetProgram, VersionedTransaction} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {eventPayloads, json} from '../../packages/indexer/src/events.js';

const directory = process.argv[2];
assert(directory, 'Pass a completed paired full-lane workload');
const read = (file:string) => JSON.parse(readFileSync(join(directory,file), 'utf8'));
const result = read('capacity.json');
const population = result.fullBook.members;
assert([128,1_000].includes(population));
assert.deepEqual(result.coverageLogs, [0,population].map(exact => 'coverage target=1 members='+population+' exact='+exact+' covered=1'));
const [authority] = await sdk.findEventAuthorityPda();
const tag = Buffer.from(sdk.LEDGER_LANE_FILLED_EVENT_DISCRIMINATOR);
const margins = new Map<bigint,sdk.MarginAccountSnapshot>(), owners = new Set<string>();
const lanes = new Set<number>(), makers = new Set<bigint>();
let spread = 0n;
let recipientLane: number | undefined;
const roundTripSides = new Set<number>();
let bounds: [bigint,bigint] | undefined;
const files = readdirSync(directory).filter(name => /^wire-\d+\.json$/.test(name))
  .sort((first,second) => Number.parseInt(first.slice(5))-Number.parseInt(second.slice(5)));
type Attempt = {label:string;units:number;heap:number;cu:number;signature:string;error:unknown};
const attempts = new Map<string,Attempt>((result.attempts ?? []).map((attempt:Attempt) => [attempt.signature,attempt]));
const attemptsSeen = new Set<string>();
const paidByCase = new Map<string,bigint>();
let payerFees = 0n;
for (const file of files) {
  const wire = read(file);
  const attempt = attempts.get(wire.signature);
  if (attempt) {
    const receipt = read(file.replace('wire-', 'transaction-'));
    const tx = VersionedTransaction.deserialize(Buffer.from(wire.wireBase64,'base64'));
    assert.equal(tx.version,0); // These 25-account payments encode the budget in v0 instructions.
    assert.equal(receipt.transaction.signatures[0],wire.signature);
    assert.equal(receipt.meta.computeUnitsConsumed,attempt.cu);
    assert.deepEqual(receipt.meta.err,attempt.error);
    const keys = receipt.transaction.message.accountKeys;
    assert.notEqual(recipientLane,undefined);
    let heap = 32*1024, units = 0, principal = 0n;
    for (const ix of tx.message.compiledInstructions) {
      const program = keys[ix.programIdIndex], data = Buffer.from(ix.data);
      if (program === ComputeBudgetProgram.programId.toBase58()) {
        if (data[0] === 1) heap = data.readUInt32LE(1);
        if (data[0] === 2) units = data.readUInt32LE(1);
      }
      if (program === sdk.CLEARING_PROGRAM_ADDRESS && data.subarray(0,8).equals(Buffer.from(sdk.PAY_ACCOUNT_GAIN_DISCRIMINATOR))) {
        const credit = sdk.getPayAccountGainInstructionDataDecoder().decode(ix.data);
        assert.equal(credit.marketIndex,1);
        const laneIndices = Array.from(ix.accountKeyIndexes).slice(-8);
        assert.deepEqual(laneIndices.map(index=>keys[index]),result.fullBook.lanes);
        assert.deepEqual(laneIndices.map(index=>tx.message.isAccountWritable(index)),
          laneIndices.map((_,lane)=>lane===recipientLane));
        principal += credit.amount;
      }
    }
    assert.deepEqual([units,heap,principal],[attempt.units,attempt.heap,20n]);
    attemptsSeen.add(wire.signature);
    payerFees += BigInt(receipt.meta.fee);
    const previous = paidByCase.get(attempt.label) ?? 0n;
    paidByCase.set(attempt.label, previous + (receipt.meta.err === null ? principal : 0n));
    continue;
  }
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
    const providers = fill.rootStates.filter(margin=>margin.role !== 0);
    assert.equal(providers.length,1);
    const lane = Number(providers[0].id % 8n);
    if (recipientLane !== undefined) assert.equal(lane,recipientLane);
    recipientLane = lane;
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
if (population === 1_000) {
  assert.equal(attemptsSeen.size,result.attempts.length);
  assert.deepEqual([...paidByCase.values()],[20n,20n]);
}
console.log(json({creditAttemptFees: attempts.size ? payerFees : undefined, spread, occupiedLanes:lanes.size, exposedAccounts:margins.size, exposedTraderOwners:owners.size,
  lower:bounds[0], upper:bounds[1], minimumCoveredCashScaled:headroom.reduce((lowest,value) => value < lowest ? value : lowest)}));
