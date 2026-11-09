import { marginBalanceView, marginOrderRemaining, type MarginFinancialRoot, type MarginFinancialMarket, type MarginSourceMode } from './margin-balance.js';
import { orderTriggered } from './order-policy.js';
import type { MarginRouteIntent } from './route-intent.js';
import { requireValue } from './wallet-client.js';
import {MAX_ACTION_LOTS,MAX_POSITION_LOTS as MAX_LOTS,MAX_CASH_ATOMS as MAX_CASH} from './quantity-limits.js';

const SCALE = 1_000_000_000n;
const MAX_SCALED = 10n ** 26n;
const MAX_U64 = (1n << 64n)-1n;
const abs = (value: bigint) => value < 0n ? -value : value;
export type LiquidityMarginInput = MarginRouteIntent & {
  root: MarginFinancialRoot; markets: MarginFinancialMarket[]; funding: bigint[];
  sources: MarginSourceMode[]; slot: bigint; now: bigint;
};

/** Same whole-account balance/reservation engine as V2/V3, prepared once per
 * search. No candidate mutates an input root. Positive claims never offset losses.
 * The caller authenticates account identities and source/funding observations.
 */
export function prepareLiquidityMargin(input: LiquidityMarginInput) {
  const { root, marketIndex, markets, funding, sources, side, lots, slot, now } = input;
  requireValue(markets.length === 2 && funding.length === 2 && sources.length === 2
    && [0,1].includes(marketIndex) && [0,1].includes(side) && lots > 0n && lots <= MAX_ACTION_LOTS
    && input.maxFee >= 0n && input.maxFee <= MAX_CASH && input.allInLimit >= 0n && input.allInLimit <= MAX_CASH,
    'Invalid liquidity financial context.');
  const market = markets[marketIndex];
  requireValue(markets.every((entry,index) => entry.index === index) && root.positions.length === 2
    && (root.mode === 0 || root.mode === 1 && root.isolatedMarketIndex === marketIndex), 'Margin account cannot trade this market.');
  requireValue(market.lower >= 1n && market.upper >= market.lower && market.upper <= 1_000_000n
    && market.referencePrice >= market.lower && market.referencePrice <= market.upper
    && market.grossLots >= 0n && market.grossLots <= 200_000_000n, 'Invalid selected market bounds.');
  requireValue(funding.every(value => abs(value) <= 10n**15n), 'Funding bound exceeded.');
  const stored = input.stored ? root.book.orders.find(entry => entry.order.id === input.stored!.id
    && entry.order.version === input.stored!.version && entry.order.filled === input.stored!.filled) : undefined;
  if (input.stored) requireValue(stored && stored.marketIndex === marketIndex && stored.order.side === side
    && marginOrderRemaining(root,stored,market,slot) >= lots && orderTriggered(stored.order,market.referencePrice,slot),
    'Stored liquidity order unavailable.');
  const position = root.positions[marketIndex];
  const reduceOnly = stored?.order.reduceOnly ?? input.reduceOnly
    ?? ((side === 1 && position.lots >= lots) || (side === 0 && -position.lots >= lots));
  if (reduceOnly) requireValue(position.lots !== 0n && lots <= abs(position.lots) && (side === 0) === (position.lots < 0n),
    'Invalid reduce-only liquidity intent.');
  for (const [index, entry] of markets.entries()) {
    const relevant = index === marketIndex || root.positions[index].lots !== 0n || root.book.orders.some(order =>
      order.marketIndex === index && marginOrderRemaining(root,order,entry,slot) > 0n);
    if (relevant) {
      requireValue(sources[index] === 'Normal' || reduceOnly && sources[index] === 'Degraded',
        'Required liquidity market source unavailable.');
      requireValue(entry.lower >= 1n && entry.upper >= entry.lower && entry.upper <= 1_000_000n
        && entry.referencePrice >= entry.lower && entry.referencePrice <= entry.upper,'Invalid relevant market bounds.');
    }
  }
  const view = (account: MarginFinancialRoot) => marginBalanceView(account,markets,funding,sources,now,slot);
  const accrue = (account: MarginFinancialRoot): MarginFinancialRoot => ({ ...account, positions: account.positions.map((position,index) => {
    if (account.mode !== 0 && account.isolatedMarketIndex !== index) return { ...position };
    return { ...position, virtualScaled: position.virtualScaled-position.lots*(funding[index]-position.fundingCheckpointScaled),
      fundingCheckpointScaled: funding[index] };
  }) });
  const trader = accrue(root);
  const previousTrader = view(trader);
  const notionalPrefix = stored?.order.notional ?? 0n;
  const maxFee = stored ? stored.order.feeBudget-stored.order.feeCharged : input.maxFee;
  const allInLimit = stored ? stored.order.limit*lots : input.allInLimit;
  requireValue(notionalPrefix >= 0n && notionalPrefix <= MAX_CASH && maxFee >= 0n && maxFee <= MAX_CASH,
    'Invalid stored fee prefix.');

  function afterFill(before: MarginFinancialRoot, delta: bigint, gross: bigint, fee: bigint, isTrader: boolean): MarginFinancialRoot {
    const positions = before.positions.map(position => ({ ...position })), position = positions[marketIndex];
    const nextLots = position.lots+delta;
    if (nextLots !== position.lots && (position.lots === 0n || nextLots === 0n || (position.lots > 0n) !== (nextLots > 0n))) position.generation++;
    position.lots = nextLots;
    position.virtualScaled -= (delta > 0n ? gross : -gross)*SCALE;
    const next = { ...before, cash: before.cash-fee, positions };
    if (isTrader && stored) {
      next.book = { ...before.book, orders: before.book.orders.map(entry => ({ ...entry, order: { ...entry.order } })),
        protections: before.book.protections.map(entry => ({ ...entry, protection: { ...entry.protection } })) };
      const order = next.book.orders.find(entry => entry.order.id === stored.order.id)!.order;
      order.filled += abs(delta); order.notional += gross; order.feeCharged += fee;
      requireValue(order.filled <= order.lots && order.notional <= MAX_CASH && order.feeCharged <= order.feeBudget,
        'Stored fill exceeds prefix/budget.');
      order.state = order.filled === order.lots ? 3 : 2;
      if (order.groupId !== 0n) {
        const protection = next.book.protections.find(entry => entry.marketIndex === marketIndex && entry.protection.id === order.groupId)?.protection;
        requireValue(protection && protection.remaining >= abs(delta), 'Protective allowance exhausted.');
        protection.remaining -= abs(delta);
      }
    }
    return next;
  }
  function admissible(before: MarginFinancialRoot, delta: bigint, gross: bigint, fee: bigint, isTrader: boolean): boolean {
    try {
      const next = afterFill(before,delta,gross,fee,isTrader);
      if (next.cash < 0n || next.cash > MAX_CASH || next.positions.some(position => abs(position.lots) > MAX_LOTS
        || abs(position.virtualScaled) > MAX_SCALED || abs(position.fundingCheckpointScaled) > 10n**15n
        || position.generation > MAX_U64 || position.lots !== 0n && position.generation === MAX_U64)) return false;
      const nextView = view(next);
      if (nextView.riskEquityScaled === null || nextView.initialMargin === null || BigInt(nextView.reserved) > MAX_CASH) return false;
      if (BigInt(nextView.riskEquityScaled) >= (BigInt(nextView.initialMargin)+BigInt(nextView.reserved))*SCALE) return true;
      if (!isTrader || !reduceOnly) return false;
      const oldLots = before.positions[marketIndex].lots, nextLots = next.positions[marketIndex].lots;
      return abs(nextLots) < abs(oldLots) && (nextLots === 0n || (nextLots > 0n) === (oldLots > 0n))
        && previousTrader.maintenanceDeficitScaled !== null && nextView.maintenanceDeficitScaled !== null
        && BigInt(nextView.maintenanceDeficitScaled) < BigInt(previousTrader.maintenanceDeficitScaled);
    } catch { return false; }
  }

  /** Conservative exclusion only. Maker claim is convex in quantity on either
   * side of flat: received buy cost, or minus paid sell proceeds, is convex.
   * Its maximum is at an endpoint or flat. IM has its minimum nearest flat;
   * surviving reduce-only reservations are monotone in |position| between
   * generation changes. Probe flat and its neighbours for those discontinuities.
   * Combining independent extrema enlarges feasibility; it cannot discard a
   * valid fill. Exact admission is still required at every returned quantity. */
  function makerPossible(before: MarginFinancialRoot, lower: bigint, upper: bigint, quote: (quantity: bigint) => bigint): boolean {
    const flat = side === 0 ? before.positions[marketIndex].lots : -before.positions[marketIndex].lots;
    const points = new Set([lower, upper, ...[flat-1n, flat, flat+1n].filter(value => value >= lower && value <= upper)]);
    try {
      const views = [...points].map(quantity => view(afterFill(before,side === 0 ? -quantity : quantity,quote(quantity),0n,false)));
      if (views.some(result => result.riskEquityScaled === null || result.initialMargin === null)) return true;
      const maximumEquity = views.map(result => BigInt(result.riskEquityScaled!)).reduce((left,right) => left > right ? left : right);
      const minimumInitial = views.map(result => BigInt(result.initialMargin!)).reduce((left,right) => left < right ? left : right);
      const minimumReserve = views.map(result => BigInt(result.reserved)).reduce((left,right) => left < right ? left : right);
      return maximumEquity >= (minimumInitial+minimumReserve)*SCALE;
    } catch { return true; } // An uncertain enclosure never proves infeasibility.
  }

  return { trader, reduceOnly, maxFee, allInLimit, notionalPrefix,
    traderPossible(minimumGross: bigint, maximumGross: bigint) {
      try {
        const feeAt = (gross: bigint) => (notionalPrefix+gross+4999n)/5000n-(notionalPrefix+4999n)/5000n;
        const minimumFee = feeAt(minimumGross), maximumFee = feeAt(maximumGross);
        if (trader.cash < minimumFee) return false;
        const delta = side === 0 ? lots : -lots;
        const views = [view(afterFill(trader,delta,minimumGross,minimumFee,true)),
          view(afterFill(trader,delta,maximumGross,maximumFee,true))];
        if (views.some(result => result.riskEquityScaled === null)) return true;
        // Independent maxima avoid treating sell-side equity as monotone: it
        // can peak when a negative claim crosses zero and fees keep increasing.
        const nextPosition = trader.positions[marketIndex].lots+delta;
        const riskPrice = nextPosition < 0n ? market.upper : market.lower;
        let maximumEquity = (trader.cash-minimumFee)*SCALE;
        for (const [index,position] of trader.positions.entries()) {
          const claim = index === marketIndex
            ? position.virtualScaled+(side === 0 ? -minimumGross : maximumGross)*SCALE+nextPosition*riskPrice*SCALE
            : position.virtualScaled+position.lots*(position.lots < 0n ? markets[index].upper : markets[index].lower)*SCALE;
          maximumEquity += claim < 0n ? claim : 0n;
        }
        const minimumReserve = BigInt(views[0].reserved) < BigInt(views[1].reserved) ? BigInt(views[0].reserved) : BigInt(views[1].reserved);
        if (maximumEquity >= (BigInt(views[0].initialMargin!)+minimumReserve)*SCALE) return true;
        const optimisticDeficit = BigInt(views[0].maintenanceMargin!)*SCALE-maximumEquity;
        return reduceOnly && previousTrader.maintenanceDeficitScaled !== null
          && (optimisticDeficit > 0n ? optimisticDeficit : 0n) < BigInt(previousTrader.maintenanceDeficitScaled);
      } catch { return true; }
    },
    prepareMaker(capital: MarginFinancialRoot) {
      requireValue(capital.role === 1 && capital.mode === 1 && capital.isolatedMarketIndex === marketIndex
        && capital.id !== root.id && capital.owner !== root.owner, 'Invalid/self maker capital.');
      const accrued = accrue(capital);
      return {
        admissible: (quantity: bigint, gross: bigint) => admissible(accrued,(side === 0 ? -quantity : quantity),gross,0n,false),
        possible: (lower: bigint, upper: bigint, quote: (quantity: bigint) => bigint) => makerPossible(accrued,lower,upper,quote),
      };
    },
    traderAdmissible(gross: bigint, fee: bigint) { return admissible(trader,side === 0 ? lots : -lots,gross,fee,true); },
  };
}
