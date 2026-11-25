import { MAX_POSITION_LOTS } from './quantity-limits.js';
import { directoryAllocation } from './directory-allocation.js';
import {MAX_REGISTERED_MAKERS} from './market-capacity.js';
import {quoteCanonical} from './canonical-quote.js';
import { EXECUTION_DENOMINATOR, EXECUTION_LOWER_NUMERATOR, EXECUTION_UPPER_NUMERATOR } from './price-policy.js';
import type { Address } from '@solana/kit';
import type { LiquidityAdapter } from './liquidity-adapter.js';
import { prepareLiquidityMargin, type LiquidityMarginInput } from './liquidity-margin.js';
import { hex, requireValue } from './wallet-client.js';
import { convexMinimum, firstTrue, lastTrue, LIQUIDITY_SEARCH_BUDGET, LiquiditySearchLimitError } from './quantity-search.js';

const MAX_CASH = 1_000_000_000_000_000n;
const abs = (value: bigint) => value < 0n ? -value : value;
const feeFor = (notional: bigint) => (notional+4999n)/5000n;
export type LiquidityAllocationInput = LiquidityMarginInput & { makers: readonly LiquidityAdapter[]; standing?: boolean; baselineCandidates?: ReadonlySet<number> };
export type LiquidityAllocationLeg = Readonly<{
  instance: number; registration: Address; capital: Address; lots: bigint; grossQuote: bigint;
  authorityEpoch: bigint; controlEpoch: bigint; shapeEpoch: bigint; depthEpoch: bigint;
}>;
export type LiquidityAllocation = Readonly<{
  snapshotSlot: bigint; side: 0|1; lots: bigint; grossQuote: bigint; fee: bigint; allIn: bigint;
  legs: readonly LiquidityAllocationLeg[];
}>;
export type LiquiditySearchMetrics = { compositions: number; intervals: number; quantityQuotes: number; makerAdmissionChecks: number; traderAdmissionChecks: number };

function better(candidate: LiquidityAllocation, previous: LiquidityAllocation | null): boolean {
  if (!previous) return true;
  if (candidate.allIn !== previous.allIn) return candidate.side === 0 ? candidate.allIn < previous.allIn : candidate.allIn > previous.allIn;
  if (candidate.legs.length !== previous.legs.length) return candidate.legs.length < previous.legs.length;
  for (let index=0;index<candidate.legs.length;index++) {
    if (candidate.legs[index].instance !== previous.legs[index].instance) return candidate.legs[index].instance < previous.legs[index].instance;
  }
  return candidate.legs[0].lots > previous.legs[0].lots;
}

/** Exact singleton/pair optimum. Convex price bounds guide interval subdivision;
 * conservative financial enclosures can exclude an interval, never grant a fill.
 * An unfinished search throws rather than returning an uncertified incumbent.
 * Clearing repeats admission against the actual landed state.
 */
export function allocateLiquidityRoute(input: LiquidityAllocationInput): { allocation: LiquidityAllocation | null; metrics: LiquiditySearchMetrics; candidateInstances?: readonly number[];
  excluded: { instance: number; reason: string }[] } {
  const margin = prepareLiquidityMargin(input), { side, lots, slot, now, marketIndex } = input;
  requireValue(input.makers.length >= 3 && input.makers.length <= MAX_REGISTERED_MAKERS, 'Invalid maker discovery count.');
  const makers = [...input.makers].sort((left,right) => left.config.instance-right.config.instance);
  const anchor = makers[0].snapshot;
  requireValue(makers.every((maker,index) => maker.capability === 1 && maker.config.instance === index
    && maker.registrationState.instance === index && maker.snapshot.slot === slot && maker.snapshot.now === now
    && maker.snapshot.marketIndex === marketIndex && maker.snapshot.market === anchor.market
    && maker.snapshot.venue === anchor.venue && maker.snapshot.contextSlot === anchor.contextSlot
    && hex(maker.snapshot.domain) === hex(anchor.domain)), 'Mixed/unsupported liquidity snapshot.');
  requireValue(new Set(makers.map(maker => maker.registration)).size === makers.length
    && new Set(makers.map(maker => maker.registrationState.capital)).size === makers.length
    && new Set(makers.map(maker => maker.capital.id)).size === makers.length, 'Duplicate maker identity/capital.');
  const metrics: LiquiditySearchMetrics = { compositions: 0, intervals: 0, quantityQuotes: 0, makerAdmissionChecks: 0, traderAdmissionChecks: 0 };
  const excluded: { instance: number; reason: string }[] = [];
  const minimum = (...values: bigint[]) => values.reduce((left,right) => left < right ? left : right);
  const maximum = (...values: bigint[]) => values.reduce((left,right) => left > right ? left : right);
  function budget() {
    if (metrics.intervals > LIQUIDITY_SEARCH_BUDGET.intervals || metrics.quantityQuotes > LIQUIDITY_SEARCH_BUDGET.quantityQuotes)
      throw new LiquiditySearchLimitError({ intervals: metrics.intervals,quantityQuotes: metrics.quantityQuotes });
  }
  const table = makers.map(maker => {
    const standing = input.standing === true && maker.unavailable === 'stale-publication';
    const status = (standing ? null : maker.unavailable) ?? (maker.capital.id === input.root.id || maker.capital.owner === input.root.owner ? 'self-capital' : null);
    if (status) { excluded.push({ instance: maker.config.instance, reason: status }); return null; }
    requireValue(standing || slot < maker.validUntilSlot && now < maker.validUntilTime, 'Expired liquidity snapshot.');
    const inventory = maker.capital.positions[marketIndex].lots;
    const remainingDepth = maker.depthHints(side).at(-1) ?? 0n;
    const inventoryHeadroom = side === 0 ? inventory+maker.shape.shortCap : maker.shape.longCap-inventory;
    if (remainingDepth <= 0n || inventoryHeadroom <= 0n || maker.shape.mode === 3 && (side === 0 ? inventory <= 0n : inventory >= 0n)) {
      excluded.push({ instance: maker.config.instance,reason: 'zero-capacity' });return null;
    }
    const admission = margin.prepareMaker(maker.capital), cache = new Map<bigint,bigint|null>();
    const admitted = new Map<bigint,boolean>();
    function read(quantity: bigint): bigint|null {
      if (!cache.has(quantity)) {
        metrics.quantityQuotes++;budget();
        try { cache.set(quantity,standing ? quoteCanonical(maker.shape,maker.price.anchor,side,quantity,inventory,
          side === 0 ? maker.registrationState.buyConsumed : maker.registrationState.sellConsumed).gross : maker.quote(side,quantity).gross); }
        catch { cache.set(quantity,null); }
      }
      return cache.get(quantity)!;
    }
    let upper = minimum(lots,remainingDepth,inventoryHeadroom);
    if (maker.shape.mode === 3) upper = minimum(upper,abs(inventory));
    // Canonical marginal buy prices increase and sell prices decrease. Valid
    // endpoint prices therefore form a prefix; this says nothing about margin.
    if (read(1n) === null) { excluded.push({instance: maker.config.instance,reason:'invalid-quote-prices'});return null; }
    upper = lastTrue(1n,upper,quantity => read(quantity) !== null);
    const quote = (quantity: bigint) => { const gross = read(quantity);requireValue(gross !== null,'Invalid bounded quote');return gross; };
    if (input.baselineCandidates) {
      const market = input.markets[marketIndex];
      const position = maker.capital.positions[marketIndex];
      if (inventory === 0n && position.virtualScaled === 0n) {
        const price = quote(upper) - (upper === 1n ? 0n : quote(upper - 1n));
        const loss = maximum(0n, side === 0 ? market.upper - price : price - market.lower);
        upper = minimum(upper, maker.capital.cash * 10n / (market.upper + 10n * loss));
      } else {
        const closing = side === 0 ? inventory : -inventory;
        upper = minimum(upper, closing + minimum(MAX_POSITION_LOTS, maker.capital.cash * 10n / market.upper));
      }
      if (upper <= 0n) {
        excluded.push({ instance: maker.config.instance, reason: 'zero-funded-capacity' });
        return null;
      }
    }
    const reference = input.markets[marketIndex].referencePrice;
    const lowerBand = (quantity: bigint) => quote(quantity)*EXECUTION_DENOMINATOR >= quantity*reference*EXECUTION_LOWER_NUMERATOR;
    const upperBand = (quantity: bigint) => quote(quantity)*EXECUTION_DENOMINATOR <= quantity*reference*EXECUTION_UPPER_NUMERATOR;
    if (input.makerLiquidation) {
      const market = input.markets[marketIndex];
      upper = lastTrue(1n,upper,quantity => side === 0
        ? quote(quantity) <= quantity * market.upper : quote(quantity) >= quantity * market.lower);
      if (upper < 1n) { excluded.push({instance:maker.config.instance,reason:'outside-liquidation-price'});return null; }
    }
    const lower = firstTrue(1n,upper,side === 0 ? lowerBand : upperBand);
    upper = lastTrue(1n,upper,side === 0 ? upperBand : lowerBand);
    if (lower > upper) { excluded.push({instance:maker.config.instance,reason:'outside-execution-band'});return null; }
    return { lower,upper,quote,
      possible: (lower: bigint,upper: bigint) => admission.possible(lower,upper,quote),
      admissible(quantity: bigint) {
        if (!admitted.has(quantity)) { metrics.makerAdmissionChecks++;admitted.set(quantity,admission.admissible(quantity,quote(quantity))); }
        return admitted.get(quantity)!;
      },
    };
  });
  let best: LiquidityAllocation | null = null;
  const economics = (grossQuote: bigint) => {
    const fee = feeFor(margin.notionalPrefix+grossQuote)-feeFor(margin.notionalPrefix);
    return { fee,allIn: side === 0 ? grossQuote+fee : grossQuote-fee };
  };
  const score = (gross: bigint) => { const {allIn}=economics(gross);return side === 0 ? allIn : -allIn; };
  function candidate(assignments: readonly [number, bigint][]): LiquidityAllocation {
    let grossQuote=0n;
    const legs = assignments.map(([index,quantity]) => {
      const quoted = table[index]!.quote(quantity), maker = makers[index], registration = maker.registrationState;
      grossQuote += quoted;
      return { instance:maker.config.instance,registration:maker.registration,capital:registration.capital,lots:quantity,grossQuote:quoted,
        authorityEpoch:registration.authorityEpoch,controlEpoch:maker.config.controlEpoch,shapeEpoch:maker.config.shapeEpoch,depthEpoch:registration.depthEpoch };
    });
    return {snapshotSlot:slot,side,lots,grossQuote,...economics(grossQuote),legs};
  }
  function consider(assignments: readonly [number, bigint][]): boolean {
    metrics.compositions++;
    const result = candidate(assignments), {grossQuote,fee,allIn} = result;
    if (grossQuote < 1000n || margin.notionalPrefix+grossQuote > MAX_CASH || fee > margin.maxFee
      || (side === 0 ? allIn > margin.allInLimit : allIn < margin.allInLimit)) return false;
    let exposureChange=0n;
    for (const [index, quantity] of assignments) {
      if (!table[index]!.admissible(quantity)) return false;
      const before = makers[index].capital.positions[marketIndex].lots;
      exposureChange += abs(before+(side === 0 ? -quantity : quantity))-abs(before);
    }
    const traderLots = input.root.positions[marketIndex].lots;
    const grossLots = input.markets[marketIndex].grossLots+exposureChange+abs(traderLots+(side === 0 ? lots : -lots))-abs(traderLots);
    if (grossLots < 0n || grossLots > 200_000_000n) return false;
    metrics.traderAdmissionChecks++;
    if (!margin.traderAdmissible(grossQuote,fee)) return false;
    if (better(result,best)) best = result;
    return true;
  }
  // A price-optimal directory allocation is useful only if it can actually
  // be signed and passes the ordinary snapshot checks on every participant.
  if (input.baselineCandidates) {
    const baseline = input.baselineCandidates;
    const existing = directoryAllocation(table.map((book, id) => baseline.has(id) ? book : null), side, lots, baseline.size);
    if (existing) consider(existing);
    const incumbent = best;
    const proposed = directoryAllocation(table, side, lots, baseline.size);
    const signed = new Set(proposed?.map(([id]) => id));
    if (proposed && proposed.some(([id]) => !baseline.has(id))) {
      for (const id of baseline) {
        if (signed.size === baseline.size) break;
        signed.add(id);
      }
      // Reprice the complete signed account set, including padding. A spare
      // book can displace a planned leg at execution.
      const padded = directoryAllocation(table.map((book, id) => signed.has(id) ? book : null), side, lots, signed.size);
      if (padded) consider(padded);
    }
    return { allocation: best, metrics, excluded, candidateInstances: [...(best !== incumbent ? signed : baseline)] };
  }
  for (let index=0;index<makers.length;index++) {
    const entry = table[index];if (entry && lots >= entry.lower && lots <= entry.upper) consider([[index,lots]]);
  }
  for (let first=0;first<makers.length;first++) for (let second=first+1;second<makers.length;second++) {
    const left = table[first],right = table[second];if (!left || !right) continue;
    const lower = maximum(left.lower,lots-right.upper), upper = minimum(left.upper,lots-right.lower);
    if (lower > upper) continue;
    const gross = (quantity: bigint) => left.quote(quantity)+right.quote(lots-quantity);
    const convexCost = (quantity: bigint) => side === 0 ? gross(quantity) : -gross(quantity);
    const pending: [bigint,bigint][] = [[lower,upper]];
    while (pending.length) {
      const [lower,upper] = pending.pop()!;
      metrics.intervals++;budget();
      if (!left.possible(lower,upper) || !right.possible(lots-upper,lots-lower)) continue;
      const optimum = convexMinimum(lower,upper,convexCost), optimumScore = score(gross(optimum));
      const extremeGross = side === 0 ? maximum(gross(lower),gross(upper)) : minimum(gross(lower),gross(upper));
      const minimumGross = side === 0 ? gross(optimum) : extremeGross;
      const maximumGross = side === 0 ? extremeGross : gross(optimum);
      if (maximumGross < 1000n || minimumGross+margin.notionalPrefix > MAX_CASH
        || economics(minimumGross).fee > margin.maxFee
        || (side === 0 ? economics(minimumGross).allIn > margin.allInLimit : economics(maximumGross).allIn < margin.allInLimit)
        || !margin.traderPossible(minimumGross,maximumGross)) continue;
      // Net sell proceeds can tie across a one-atom fee step. Search the right
      // side of the gross optimum for the exact final deterministic tie winner.
      const quantity = lastTrue(optimum,upper,value => score(gross(value)) === optimumScore);
      const optimistic = candidate([[first,quantity],[second,lots-quantity]]);
      if (best && !better(optimistic,best)) continue;
      if (consider([[first,quantity],[second,lots-quantity]]) || lower === upper) continue;
      const middle = (lower+upper)/2n;
      // Balanced subdivision preserves nonprefix health and bounded stack depth.
      // Visit the half containing the price optimum first; both remain covered.
      const halves: [bigint,bigint][] = [[lower,middle],[middle+1n,upper]];
      if (quantity <= middle) halves.reverse();
      pending.push(...halves);
    }
  }
  return { allocation: best, metrics, excluded };
}
