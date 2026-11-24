// Re-score a completed router load run against its saved finalized RPC receipts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getBase58Decoder} from '@solana/kit';
import {VersionedTransaction} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {eventPayloads, json} from '../../packages/indexer/src/events.js';

const directory = process.argv[2];
assert(directory, 'Pass a completed router-load run directory');
const read = (name: string) => JSON.parse(readFileSync(join(directory, name), 'utf8'));
type Offer = {id: number; trader: number; market: number; side: number; lots: string; expectedGross: string};
type Receipt = {role: string; offer: number; signature: string; slot: number; error: unknown};
const run = read('router-load.json');
const offers: Offer[] = run.offers;
const byId = new Map(offers.map(offer => [offer.id, offer]));
assert.equal(byId.size, run.counts.offered);
assert.equal(offers.length, byId.size);
assert(run.events > 0);
const {venue, program} = read('sql-drained-snapshot.json').binding;
assert.equal(program, sdk.CLEARING_PROGRAM_ADDRESS);
const [authority] = await sdk.findEventAuthorityPda();
const tag = Buffer.from(sdk.LIQUIDITY_ROUTE_FEE_RECORDED_EVENT_DISCRIMINATOR);
const filledOffers = new Set<number>(), landedOffers = new Set<number>(), signatures = new Set<string>();
const wallets = new Map<number, Set<string>>();
const makerSelections: Record<string, number> = {};
let offeredGrossAtoms = 0n, filledGrossAtoms = 0n, fees = 0n, filledLots = 0n;
for (const offer of offers) {
  const sizes = wallets.get(offer.trader) ?? new Set<string>();
  sizes.add(offer.lots);
  wallets.set(offer.trader, sizes);
  offeredGrossAtoms += BigInt(offer.expectedGross);
}
for (const receipt of run.receipts as Receipt[]) {
  if (receipt.role !== 'trader') continue;
  assert(!signatures.has(receipt.signature) && !landedOffers.has(receipt.offer));
  signatures.add(receipt.signature);
  landedOffers.add(receipt.offer);
  const offer = byId.get(receipt.offer);
  assert(offer);
  const landed = read('landed-' + receipt.signature + '.json');
  const transaction = VersionedTransaction.deserialize(Buffer.from(landed.transaction[0], 'base64'));
  assert.equal(getBase58Decoder().decode(transaction.signatures[0]), receipt.signature);
  assert.equal(landed.slot, receipt.slot);
  assert.deepEqual(landed.meta.err, receipt.error);
  if (landed.meta.err !== null) continue;
  const parsed = read('parsed-' + receipt.signature + '.json');
  assert.equal(parsed.slot, receipt.slot);
  const matches = eventPayloads(receipt.signature, parsed, authority)
    .filter(event => event.payload.subarray(0, 8).equals(tag));
  assert.equal(matches.length, 1);
  const fill = sdk.getLiquidityRouteFeeRecordedEventDecoder().decode(matches[0].payload);
  assert.deepEqual([fill.venue, fill.marketState.index, fill.side, fill.lots],
    [venue, offer.market, offer.side, BigInt(offer.lots)]);
  assert.equal(fill.legs.reduce((total, leg) => total + leg.gross, 0n), fill.grossQuote);
  assert.equal(fill.legs.reduce((total, leg) => total + leg.lots, 0n), fill.lots);
  const selection = [offer.market, ...fill.legs.map(leg => leg.instance)].join('/');
  makerSelections[selection] = (makerSelections[selection] ?? 0) + 1;
  filledOffers.add(offer.id);
  filledGrossAtoms += fill.grossQuote;
  fees += fill.fee;
  filledLots += fill.lots;
}
assert.equal(filledOffers.size, run.counts.filled);
assert.equal(filledLots.toString(), run.counts.fillLots);
assert.equal(landedOffers.size, run.counts.filled + run.counts.refused);
assert.equal(offers.length, landedOffers.size + run.counts.previewRefused + run.counts.expired + run.counts.unresolved);
console.log(json({harness: run.revision, program: run.program, counts: run.counts, offeredGrossAtoms, filledGrossAtoms,
  takerFeeAtoms: fees, wallets: wallets.size, walletsWithOneSize: [...wallets.values()].filter(sizes => sizes.size === 1).length,
  fillsByMarketAndMakerInstances: makerSelections}));
