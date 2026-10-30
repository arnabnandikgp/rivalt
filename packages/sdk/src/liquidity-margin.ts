import { marginBalanceView, marginOrderRemaining, type MarginFinancialRoot, type MarginFinancialMarket, type MarginSourceMode } from './margin-balance.js';
import { orderTriggered } from './order-policy.js';
import type { MarginRouteIntent } from './route-intent.js';
import { requireValue } from './wallet-client.js';

const SCALE = 1_000_000_000n;
const MAX_CASH = 1_000_000_000_000_000n;
const MAX_LOTS = 100_000_000n;
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
    && [0,1].includes(marketIndex) && [0,1].includes(side) && lots > 0n && lots <= 4608n
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
  return { trader, reduceOnly, maxFee, allInLimit, notionalPrefix,
    prepareMaker(capital: MarginFinancialRoot) {
      requireValue(capital.role === 1 && capital.mode === 1 && capital.isolatedMarketIndex === marketIndex
        && capital.id !== root.id && capital.owner !== root.owner, 'Invalid/self maker capital.');
      const accrued = accrue(capital);
      return (quantity: bigint, gross: bigint) => admissible(accrued,(side === 0 ? -quantity : quantity),gross,0n,false);
    },
    traderAdmissible(gross: bigint, fee: bigint) { return admissible(trader,side === 0 ? lots : -lots,gross,fee,true); },
  };
}
