// Reconstruct the solvent open book from its finalized fills, independently of lane summaries.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ComputeBudgetProgram} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {verifyReceiptWire} from './receipt-metrics.js';
import {eventPayloads, json} from '../../packages/indexer/src/events.js';

const directory = process.argv[2];
assert(directory, 'Pass a completed paired full-lane workload');
const read = (file:string) => JSON.parse(readFileSync(join(directory,file), 'utf8'));
const result = read('capacity.json');
const population = result.fullBook.members;
assert([128,1_000].includes(population));
const expectedRows = result.grouped ? [0,0,0] : [0,population];
assert.deepEqual(result.coverageLogs, expectedRows.map(exact => 'coverage target=1 members='+population+' exact='+exact+' covered=1'));
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
const latest = new Map<bigint,sdk.MarginAccountSnapshot>();
const riskBounds = new Map<number,readonly bigint[]>();
const sparseFillCu: number[] = [];
let denseSnapshot: {members:number;openByMarket:number[];minimumHeadroom:string}|undefined;
let payerFees = 0n;
for (const file of files) {
  const wire = read(file);
  const attempt = attempts.get(wire.signature);
  if (attempt) {
    const receipt = read(file.replace('wire-', 'transaction-'));
    const {transaction:tx} = verifyReceiptWire(receipt,Buffer.from(wire.wireBase64,'base64'));
    assert.equal(tx.message.recentBlockhash,receipt.transaction.message.recentBlockhash);
    assert.deepEqual(tx.message.header,receipt.transaction.message.header);
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
    if (result.grouped && receipt.meta.err===null) {
      assert(receipt.meta.logMessages.includes('Program log: coverage target=1 members=1000 exact=0 covered=1'));
      if (attempt.label==='pay closed ETH spread with every member exposed') {
        const openByMarket=[0,0], netLots=[0n,0n];
        let minimum:bigint|undefined;
        assert.equal(latest.size,1_000);
        for (const root of latest.values()) {
          assert(root.positions.some(pos=>pos.lots!==0n));
          let headroom=root.cash*1_000_000_000n;
          for (const [market,pos] of root.positions.entries()) {
            const adverse=riskBounds.get(market)![pos.lots<0n ? 1 : 0];
            const claim=pos.virtualScaled + pos.lots*(adverse*1_000_000_000n+pos.fundingCheckpointScaled);
            if (claim<0n) headroom+=claim;
            if (pos.lots!==0n) openByMarket[market]++;
            netLots[market]+=pos.lots;
          }
          assert(headroom>=0n);
          if (minimum===undefined || headroom<minimum) minimum=headroom;
        }
        assert.deepEqual(netLots,[0n,0n]);
        assert.deepEqual(openByMarket,[6,997]);
        denseSnapshot={members:latest.size,openByMarket,minimumHeadroom:String(minimum)};
      }
    }
    attemptsSeen.add(wire.signature);
    payerFees += BigInt(receipt.meta.fee);
    const previous = paidByCase.get(attempt.label) ?? 0n;
    paidByCase.set(attempt.label, previous + (receipt.meta.err === null ? principal : 0n));
    continue;
  }
  const opening = /^open forty ETH lots in lane ([0-7])$/.exec(wire.label);
  const denseFill = /^dense (ETH fill|BTC cross fill) [0-9]+$/.test(wire.label);
  if (!opening && !denseFill && !/^(buy|sell) (ten|fifteen) ETH lots$/.test(wire.label)) continue;
  const receipt = read(file.replace('wire-', 'transaction-'));
  assert.equal(receipt.meta.err, null);
  const cross = wire.label.startsWith('dense BTC cross fill');
  const fillTag = cross ? Buffer.from(sdk.LIQUIDITY_ROUTE_FEE_RECORDED_EVENT_DISCRIMINATOR) : tag;
  const matches = eventPayloads(wire.signature, receipt, authority).filter(row => row.payload.subarray(0,8).equals(fillTag));
  assert.equal(matches.length, 1);
  const fill = (cross ? sdk.getLiquidityRouteFeeRecordedEventDecoder() :
    sdk.getLedgerLaneFilledEventDecoder()).decode(matches[0].payload);
  for (const root of fill.rootStates) latest.set(root.id,root);
  const market = fill.marketState;
  const interval = [market.lower,market.upper];
  if (riskBounds.has(market.index)) assert.deepEqual(riskBounds.get(market.index),interval);
  riskBounds.set(market.index,interval);
  assert.equal(market.fundingIndexScaled,0n);
  assert.equal(market.oracle.premiumScaled,0n);
  if (denseFill) {
    assert.equal(fill.lots,1n);
    continue;
  }
  assert.equal(fill.marketState.index, 1);
  assert.equal(fill.legs.length, 1);
  if (!opening) {
    assert.equal(fill.side, wire.label.startsWith('buy ') ? 0 : 1);
    assert(!roundTripSides.has(fill.side));
    roundTripSides.add(fill.side);
    assert.equal(fill.lots, result.grouped ? 15n : 10n);
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
  sparseFillCu.push(receipt.meta.computeUnitsConsumed);
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
assert.deepEqual([lanes.size, makers.size, margins.size, spread], [8,2,10,result.grouped ? 60n : 40n]);
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
  assert.deepEqual([...paidByCase.values()],expectedRows.map(()=>20n));
}
if (result.grouped) {
  assert(denseSnapshot);
  // Eight forty-lot fills touch at most sixteen groups. The preceding round trip,
  // collection and first credit can touch at most two additional groups.
  const revisions = (book: {groupRevisions:string[][]})=>book.groupRevisions.flat().map(BigInt);
  const first = revisions(result.fullBook), sparse = revisions(result.sparse), dense = revisions(result.dense);
  assert.deepEqual([first.length,sparse.length,dense.length],[64,64,64]);
  const sparseChanges=sparse.filter((value,index)=>value>first[index]).length;
  assert(sparseChanges>=8 && sparseChanges<=18);
  assert(sparse.every((value,index)=>value>=first[index]));
  // Every group has a previously flat trader who opened a position in the dense workload.
  assert(dense.every((value,index)=>value>sparse[index]));
}
console.log(json({denseSnapshot, sparseFillCu, creditAttemptFees: attempts.size ? payerFees : undefined, spread, occupiedLanes:lanes.size, exposedAccounts:margins.size, exposedTraderOwners:owners.size,
  lower:bounds[0], upper:bounds[1], minimumCoveredCashScaled:headroom.reduce((lowest,value) => value < lowest ? value : lowest)}));
