// The keeper proposes inputs to the clearing-owned verifier. Only clearing
// authenticates the complete book and decides if a schedule is admissible.
import * as paged from '@rivalt/sdk/paged-recovery';
import assert from 'node:assert/strict';
import type {Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {Rpc} from '../../indexer/src/rpc.js';
import {decodeAccountWorker} from './account-worker-state.js';
import {proposeMarketOrder} from './account-default-proposal.js';
import {proposeAccountRates} from './account-rate-proposal.js';

export interface FrozenRecoveryBook {
  rows: readonly {id:bigint; cash:bigint; claims:readonly bigint[]}[];
  pools: readonly bigint[];
  insurance: readonly bigint[];
}

const claimScale = 1_000_000_000n;
const maxU64 = (1n << 64n) - 1n;

function marketPair(values:readonly bigint[]): [bigint,bigint] {
  assert.equal(values.length, 2, 'Expected exactly BTC and ETH');
  return [values[0], values[1]];
}

/** Edges use clearing order. The last edge is the least significant digit.
 * Cash collections always use the debts frozen before either market's charge. */
export function recoverySettlementCalculation(book:FrozenRecoveryBook, edges:readonly sdk.SearchEdge[], rank:bigint) {
  assert(book.rows.length > 0, 'Empty frozen membership');
  assert(rank >= 0n, 'Negative recovery rank');
  const rows = book.rows.map((row, index) => {
    assert(row.id >= 0n && row.id <= maxU64 && (index === 0 || book.rows[index - 1].id < row.id),
      'Frozen members must be in increasing identity order');
    return {id:row.id, cash:row.cash, originalClaims:marketPair(row.claims), claims:marketPair(row.claims)};
  });
  const members = new Map(rows.map(row => [row.id, row]));
  let remaining = rank;
  for (let index = edges.length - 1; index >= 0; index--) {
    const {market, debtor, winner, maximum} = edges[index];
    const owing = members.get(debtor), receiving = members.get(winner);
    assert(owing && receiving && debtor !== winner && (market === 0 || market === 1)
      && maximum > 0n && maximum <= maxU64, 'Invalid recovery edge');
    const radix = maximum + 1n;
    const change = (remaining % radix) * claimScale;
    remaining /= radix;
    owing.claims[market] += change;
    receiving.claims[market] -= change;
  }
  assert.equal(remaining, 0n, 'Recovery rank exceeds the frozen dimensions');
  const pools = marketPair(book.pools);
  let budgets = marketPair(book.insurance);
  const rounds: bigint[][] = [];
  // With two markets each fractional draw can clip a market’s insurance once.
  // Every pass uses the original distribution of funded debtor cash.
  for (let pass = 0; pass <= 2; pass++) {
    const proposal = proposeAccountRates({rows, pools, budgets});
    rounds.push([proposal.factor, ...proposal.numerators]);
    if (!proposal.fractional.some(Boolean)) {
      return {rounds, orders:proposal.rates.map((rate, market) => proposeMarketOrder(rows, market, rate))};
    }
    budgets = marketPair(budgets.map((budget, market) =>
      proposal.fractional[market] ? proposal.insuranceSpent[market] : budget));
  }
  throw new Error('Insurance clipping exceeded the two-market settlement bound');
}

/** The deployed eight-member verifier admits one insurance pass and u64 rates. */
export function recoveryRateWitness(book:FrozenRecoveryBook, edges:readonly sdk.SearchEdge[], rank:bigint):sdk.RateWitness {
  assert.equal(book.rows.length, 8, 'Recovery verifier requires eight frozen members');
  const {rounds, orders} = recoverySettlementCalculation(book, edges, rank);
  assert.equal(rounds.length, 1, 'Recovery witness needs another insurance pass');
  const [rates] = rounds;
  assert(rates.every(value => value >= 0n && value <= maxU64), 'Recovery witness exceeds its wire width');
  return {rates, orders:orders.map(order => Uint8Array.from(order, Number))};
}

/** Read each batch with both canonical headers. Advancing either revision
 * invalidates the freeze before any result is used for selection. */
export async function readRecoveryWitnessBook(rpc:Pick<Rpc,'call'>, venue:Address,
  deployment:sdk.RecoveryDeployment, epoch:bigint, revision:bigint, count=8n) {
  assert(count > 0n && count <= maxU64 && epoch > 0n && revision > 0n, 'Invalid frozen recovery identity');
  const [[prepared, preparedBump], [resolution, resolutionBump]] = await Promise.all([
    sdk.deriveSettlementWorkspace(venue, 'prepared'), sdk.deriveVenueComponent(venue, 'resolution'),
  ]);
  const decoder = deployment === 'local-successor-candidate' ? sdk.getLocalSuccessorPageDecoder() : deployment === 'paged-recovery-candidate' ? paged.getFrozenMarginPageDecoder() : deployment === 'integrated-recovery-candidate' ? sdk.getMultiLotBookPageDecoder() : sdk.getFrozenMarginPageDecoder();
  const pageCount = (count + 7n) / 8n;
  const pages: Address[] = [], rows: sdk.FrozenMargin[] = [], members = new Set<Address>();
  let contextSlot = 0;
  let header: sdk.PreparedSettlement | undefined;
  for (let first = 0n; first < pageCount; first += 32n) {
    const length = Number(pageCount-first < 32n ? pageCount-first : 32n);
    const keys = await Promise.all(Array.from({length}, (_, offset) => sdk.deriveFrozenMarginPage(venue, first+BigInt(offset))));
    const response = await rpc.call('getMultipleAccounts', [[prepared, resolution, ...keys.map(([key])=>key)],
      {encoding:'base64', commitment:'confirmed', minContextSlot:contextSlot}]);
    assert(response.value?.length === 2+length && Number.isSafeInteger(response.context.slot)
      && response.context.slot >= contextSlot, 'Incomplete recovery snapshot');
    contextSlot = response.context.slot;
    const current = decodeAccountWorker(response.value[0], sdk.PREPARED_SETTLEMENT_DISCRIMINATOR, sdk.getPreparedSettlementDecoder());
    const source = decodeAccountWorker(response.value[1], sdk.RESOLUTION_DISCRIMINATOR, sdk.getResolutionDecoder());
    assert([current, source].every(account=>account.schemaVersion === 10 && account.venue === venue && account.epoch === epoch
      && account.count === count) && current.bump === preparedBump && source.bump === resolutionBump
      && current.stage === 4 && current.revision === revision && source.stage === 2 && current.source === resolution
      && current.sourceRevision === source.revision && current.membershipEpoch === source.membershipEpoch
      && sdk.hex(current.registryHash) === sdk.hex(source.registryHash), 'Recovery freeze or revision changed');
    assert.deepEqual(current.pools, source.poolsBefore);
    assert.deepEqual(current.insurance, source.insuranceBefore);
    assert.deepEqual(current.fees, source.feesBefore);
    assert.deepEqual(current.prices, source.prices);
    assert.deepEqual(current.funding, source.funding);
    assert.deepEqual(current.gross, source.remainingGross);
    assert.equal(current.allocated, source.allocatedBefore);
    if (header) assert.deepEqual(current, header, 'Recovery header changed during page reads');
    header = current;
    for (const [offset, [key, bump]] of keys.entries()) {
      const index = first + BigInt(offset);
      const expected = Number(index+1n === pageCount ? count-index*8n : 8n);
      const page = decodeAccountWorker<sdk.FrozenMarginPage>(response.value[offset+2], sdk.FROZEN_MARGIN_PAGE_DISCRIMINATOR, decoder);
      assert(page.schemaVersion === 10 && page.venue === venue && page.epoch === epoch && page.revision > 0n
        && page.pageIndex === index && page.bump === bump && page.rowCount === expected, 'Incomplete or foreign recovery page');
      for (const row of page.rows.slice(0, expected)) {
        assert(row.originalRevision > 0n && row.activationGeneration > 0n && (!rows.length || rows[rows.length-1].id < row.id)
          && !members.has(row.member), 'Invalid frozen recovery membership');
        members.add(row.member);
        rows.push(row);
      }
      pages.push(key);
    }
  }
  assert(header && BigInt(rows.length) === count, 'Incomplete frozen recovery book');
  return {rows, pools:header.pools, insurance:header.insurance, fees:header.fees, marks:header.prices, prepared, pages, contextSlot};
}
