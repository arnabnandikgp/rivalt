// Reconstruct the maker's realized spread from finalized fill events, independently of the worker.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as sdk from '@rivalt/sdk';
import { eventPayloads, json } from '../../packages/indexer/src/events.js';

const directory = process.argv[2];
assert(directory, 'Pass a completed worker-eth-exit run directory');
const read = (file: string) => JSON.parse(readFileSync(join(directory, file), 'utf8'));
const result = read('cashout-result.json');
assert.equal(result.arm, 'worker-eth-exit');
const before = read('sql-before-close-snapshot.json').state, after = read('sql-close-to-wallet-snapshot.json').state;
const [authority] = await sdk.findEventAuthorityPda();
const tag = Buffer.from(sdk.LEDGER_LANE_FILLED_EVENT_DISCRIMINATOR);
const offers = new Set<number>(), capitals = new Set<string>();
const makerSales = { fills: 0, lots: 0n, gross: 0n }, makerBuys = { fills: 0, lots: 0n, gross: 0n };
for (const file of readdirSync(directory).filter(name => /^wire-\d+\.json$/.test(name))) {
  const wire = read(file), match = /^traffic (\d+)$/.exec(wire.label);
  if (!match) continue;
  const offer = Number(match[1]);
  assert(offer >= 0 && offer < 48 && !offers.has(offer));
  offers.add(offer);
  const receipt = read(file.replace('wire-', 'transaction-'));
  assert.equal(receipt.meta.err, null);
  const matches = eventPayloads(wire.signature, receipt, authority).filter(event => event.payload.subarray(0, 8).equals(tag));
  assert.equal(matches.length, 1);
  const fill = sdk.getLedgerLaneFilledEventDecoder().decode(matches[0].payload);
  assert.equal(fill.marketState.index, offer % 2);
  assert.equal(fill.side, Math.floor(offer / 4) % 2);
  if (fill.marketState.index !== 1) continue;
  assert.equal(fill.legs.length, 1);
  const leg = fill.legs[0];
  assert.equal(leg.instance, 2);
  capitals.add(leg.capital);
  assert.equal(leg.lots, 10n);
  const side = fill.side === 0 ? makerSales : makerBuys;
  side.fills++;
  side.lots += leg.lots;
  side.gross += leg.gross;
}
assert.equal(offers.size, 48);
assert.equal(capitals.size, 1);
assert.deepEqual([makerSales.fills, makerBuys.fills, makerSales.lots, makerBuys.lots], [12, 12, 120n, 120n]);
const profit = makerSales.gross - makerBuys.gross, [capital] = capitals;
assert.equal(profit, 480n);
assert.equal(profit, BigInt(result.workerFlows[1].paid));
assert.equal(profit, BigInt(result.workerFlows[1].collected));
assert.equal(after.roots[capital].cash, before.roots[capital].cash);
assert.deepEqual([after.roots[capital].positions[1].lots, after.roots[capital].positions[1].virtualScaled], ['0', '0']);
const stages = result.makerExit;
const exit = result.receipts.find((row: { signature: string }) => row.signature === stages.withdrawal.signature);
assert(exit && exit.error === null && exit.label === 'withdraw closed ETH maker profit');
console.log(json({ capital, makerSales, makerBuys, profit, proofTransactions: stages.pages,
  flatClaimMs: stages.flatClaim.ms, fullPoolMs: stages.fundedPool.ms, completeMs: stages.backingComplete.ms,
  creditedMs: stages.credited.ms, walletMs: stages.wallet.ms, flatToWalletMs: stages.flatToWalletMs,
  btcWithdrawalsMs: result.rows.map((row: { withdrawalMs: number }) => row.withdrawalMs), events: result.events }));
