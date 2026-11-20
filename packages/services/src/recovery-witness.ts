// The keeper proposes inputs to the clearing-owned verifier. Only clearing
// authenticates the complete book and decides if a schedule is admissible.
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
export function recoveryRateWitness(book:FrozenRecoveryBook, edges:readonly sdk.SearchEdge[], rank:bigint):sdk.RateWitness {
  assert.equal(book.rows.length, 8, 'Recovery verifier requires eight frozen members');
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
  const proposal = proposeAccountRates({rows, pools:marketPair(book.pools), budgets:marketPair(book.insurance)});
  assert(!proposal.fractional.some(Boolean), 'Recovery witness needs another insurance pass');
  const rates = [proposal.factor, ...proposal.numerators];
  assert(rates.every(value => value >= 0n && value <= maxU64), 'Recovery witness exceeds its wire width');
  const orders = proposal.rates.map((rate, market) =>
    Uint8Array.from(proposeMarketOrder(rows, market, rate), ordinal => Number(ordinal)));
  return {rates, orders};
}


/** Read the header, original freeze and full page at one RPC context slot.
 * Callers select the page layout from the pinned local deployment. */
export async function readRecoveryWitnessBook(rpc:Pick<Rpc,'call'>, venue:Address,
  deployment:'recovery-search-candidate'|'integrated-recovery-candidate', epoch:bigint, revision:bigint) {
  const [[prepared, preparedBump], [resolution, resolutionBump], [page, pageBump]] = await Promise.all([
    sdk.deriveSettlementWorkspace(venue, 'prepared'), sdk.deriveVenueComponent(venue, 'resolution'),
    sdk.deriveFrozenMarginPage(venue, 0n),
  ]);
  const response = await rpc.call('getMultipleAccounts', [[prepared, resolution, page],
    {encoding:'base64', commitment:'confirmed'}]);
  assert.equal(response.value?.length, 3, 'Incomplete recovery snapshot');
  const header = decodeAccountWorker(response.value[0], sdk.PREPARED_SETTLEMENT_DISCRIMINATOR, sdk.getPreparedSettlementDecoder());
  const source = decodeAccountWorker(response.value[1], sdk.RESOLUTION_DISCRIMINATOR, sdk.getResolutionDecoder());
  const decoder = deployment === 'integrated-recovery-candidate' ? sdk.getMultiLotBookPageDecoder() : sdk.getFrozenMarginPageDecoder();
  const frozen = decodeAccountWorker<sdk.FrozenMarginPage>(response.value[2], sdk.FROZEN_MARGIN_PAGE_DISCRIMINATOR, decoder);
  assert(epoch > 0n && revision > 0n && header.stage === 4 && header.revision === revision && source.stage === 2
    && header.source === resolution && header.sourceRevision === source.revision
    && header.membershipEpoch === source.membershipEpoch && sdk.hex(header.registryHash) === sdk.hex(source.registryHash),
    'Recovery freeze or revision changed');
  assert([header, source, frozen].every(account => account.venue === venue && account.epoch === epoch && account.schemaVersion === 10)
    && header.bump === preparedBump && source.bump === resolutionBump && frozen.bump === pageBump,
    'Foreign recovery snapshot');
  assert(source.count === 8n && header.count === source.count && frozen.pageIndex === 0n && frozen.rowCount === 8,
    'Recovery verifier requires one complete eight-member book');
  assert.deepEqual(header.pools, source.poolsBefore);
  assert.deepEqual(header.insurance, source.insuranceBefore);
  return {rows:frozen.rows, pools:header.pools, insurance:header.insurance};
}
