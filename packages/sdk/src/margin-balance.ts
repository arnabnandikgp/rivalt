import type {ReadonlyUint8Array} from '@solana/kit';
import type {Market as MarketState, MarginAccount, StoredOrder} from './generated/index.js';
import type {oracleMode} from './oracle-policy.js';

/** Shared financial fields only; deployment identity/authority belongs to callers. */
export type MarginPreview<T> = T extends bigint ? bigint | string : T extends string ? string :
  T extends ReadonlyUint8Array ? ReadonlyUint8Array | string : T extends readonly (infer Item)[] ? MarginPreview<Item>[] :
    T extends object ? {[Key in keyof T]: MarginPreview<T[Key]>} : T;
export type MarginFinancialRoot = Omit<MarginAccount,'venue'|'schemaVersion'|'bump'|'discriminator'>;
export type MarginFinancialMarket = Omit<MarketState,'venue'|'schemaVersion'|'bump'|'discriminator'>;
type Root = MarginPreview<MarginFinancialRoot>;
type Market = MarginPreview<MarginFinancialMarket>;
export type MarginSourceMode = ReturnType<typeof oracleMode>;
const scale = 1_000_000_000n;
const zero = '11111111111111111111111111111111';
const abs = (value: bigint) => value < 0n ? -value : value;
const min = (left: bigint, right: bigint) => left < right ? left : right;
const max = (left: bigint, right: bigint) => left > right ? left : right;

export function marginOrderRemaining(root: Root, stored: MarginPreview<StoredOrder>, market: Market, slot: bigint): bigint {
  const order = stored.order;
  if (![1,2].includes(order.state) || stored.marketIndex !== market.index || BigInt(order.termsEpoch) !== BigInt(market.termsEpoch) || slot >= BigInt(order.expirySlot)) return 0n;
  if (BigInt(stored.delegateEpoch) !== 0n && (root.delegate === zero || slot >= BigInt(root.delegateExpirySlot) || BigInt(stored.delegateEpoch) !== BigInt(root.delegateEpoch))) return 0n;
  const position = root.positions[stored.marketIndex];
  let remaining = BigInt(order.lots) - BigInt(order.filled);
  if (remaining < 0n) throw new Error('Invalid margin order prefix');
  if (order.reduceOnly) {
    const lots = BigInt(position.lots);
    if (BigInt(order.generation) !== BigInt(position.generation) || lots === 0n || (order.side === 0) !== (lots < 0n)) return 0n;
    remaining = min(remaining, abs(lots));
  }
  if (BigInt(order.groupId) !== 0n) {
    const protection = root.book.protections.find(entry => entry.marketIndex === stored.marketIndex && BigInt(entry.protection.id) === BigInt(order.groupId));
    if (!protection) return 0n;
    remaining = min(remaining, BigInt(protection.protection.remaining));
  }
  return remaining;
}

/** One accounting calculation for both schema wrappers. This is an indicative
 * read, never permission to execute; admission still uses current chain state. */
export function marginBalanceView(root:Root, markets:Market[], funding:bigint[], sources:MarginSourceMode[],
  now:bigint, slot:bigint, frozen=false) {
  if(root.positions.length!==2||markets.length!==2||funding.length!==2||sources.length!==2||root.book.orders.length!==4)
    throw new Error('Invalid margin preview dependencies');
  if (![0,1].includes(root.mode) || (root.mode === 0 ? root.isolatedMarketIndex !== 255 : ![0,1].includes(root.isolatedMarketIndex))) throw new Error('Invalid margin mode');
  let riskEquity = BigInt(root.cash) * scale, initialMargin = 0n, maintenanceMargin = 0n, reserved = 0n;
  let available = !frozen;
  const positions = root.positions.map((position,index) => {
    const lots = BigInt(position.lots), market = markets[index];
    const permitted = root.mode === 0 || root.isolatedMarketIndex === index;
    if (!permitted && (lots !== 0n || BigInt(position.virtualScaled) !== 0n || BigInt(position.fundingCheckpointScaled) !== 0n || BigInt(position.generation) !== 0n)) throw new Error('Foreign isolated position');
    const accrued = BigInt(position.virtualScaled) - lots * (funding[index] - BigInt(position.fundingCheckpointScaled));
    const credible = !['Frozen','NoCredibleBounds'].includes(sources[index]);
    const known = lots === 0n || credible;
    if (!known) available = false;
    const claim = known ? accrued + lots * BigInt(market.referencePrice) * scale : null;
    const riskClaim = known ? accrued + lots * BigInt(lots < 0n ? market.upper : market.lower) * scale : null;
    if (riskClaim !== null) riskEquity += min(riskClaim,0n);
    if (credible) {
      initialMargin += (abs(lots) * BigInt(market.upper) + 9n) / 10n;
      maintenanceMargin += (abs(lots) * BigInt(market.upper) + 19n) / 20n;
    }
    return {marketIndex:index, lots:lots.toString(), virtualScaled:BigInt(position.virtualScaled).toString(),
      fundingCheckpointScaled:BigInt(position.fundingCheckpointScaled).toString(), effectiveFundingScaled:funding[index].toString(),
      pendingFundingDebitScaled:(lots * (funding[index] - BigInt(position.fundingCheckpointScaled))).toString(),
      unpaidClaimScaled:claim?.toString() ?? null, riskClaimScaled:riskClaim?.toString() ?? null, sourceMode:sources[index]};
  });
  const orders = root.book.orders.map(stored => {
    const market = markets[stored.marketIndex];
    if (!market) {if ([1,2].includes(stored.order.state)) throw new Error('Foreign order market'); return {remaining:'0',reserve:'0'};}
    const remaining = marginOrderRemaining(root,stored,market,slot), order = stored.order;
    const credible = !['Frozen','NoCredibleBounds'].includes(sources[stored.marketIndex]);
    const lower = credible ? BigInt(market.lower) : 1n, upper = credible ? BigInt(market.upper) : 1_000_000n;
    const loss = max(order.side === 0 ? BigInt(order.limit) - lower : upper - BigInt(order.limit),0n);
    const fees = BigInt(order.feeBudget) - BigInt(order.feeCharged);
    if (fees < 0n) throw new Error('Invalid remaining fee budget');
    const reserve = remaining === 0n ? 0n : remaining * (loss + (order.reduceOnly ? 0n : (upper+9n)/10n)) + fees;
    reserved += reserve;
    return {remaining:remaining.toString(), reserve:reserve.toString()};
  });
  return {mode:root.mode === 0 ? 'Cross' : 'Isolated', cash:BigInt(root.cash).toString(), positions, orders,
    positiveUnpaidMarginCredit:'0', correlationDiscount:'0', reserved:reserved.toString(), cachedReserved:BigInt(root.reserved).toString(),
    riskEquityScaled:available ? riskEquity.toString() : null, initialMargin:available ? initialMargin.toString() : null,
    maintenanceMargin:available ? maintenanceMargin.toString() : null,
    maintenanceDeficitScaled:available ? max(maintenanceMargin*scale-riskEquity,0n).toString() : null,
    localCashHeadroom:available ? min(BigInt(root.cash),max((riskEquity-(initialMargin+reserved)*scale)/scale,0n)).toString() : null,
    valuationStatus:frozen ? 'FrozenResolution' : available ? 'CurrentBoundsOrFlatClaims' : 'RequiredSourceUnavailable',
    evaluatedAt:{slot:slot.toString(),unixTime:now.toString()}};
}
