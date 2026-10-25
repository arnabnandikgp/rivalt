import { quoteMaker, type MakerQuoteRequest } from './quote-maker.js';
import type { MakerState } from './generatedMakerA/index.js';

export type RouteBalance = { id: number; cash: bigint; lots: bigint; virtualScaled: bigint; reserved: bigint };
export type RouteCandidate = { state: MakerState; request: MakerQuoteRequest; balance: RouteBalance };
export type Allocation = { snapshotSlot: bigint; side: number; lots: bigint; grossQuote: bigint; fee: bigint; allIn: bigint; legs: { makerId: number; lots: bigint; grossQuote: bigint }[] };
const scale = 1_000_000_000n, abs = (n: bigint) => n < 0n ? -n : n;
const feeFor = (n: bigint) => (n + 4999n) / 5000n;
function healthy(p: RouteBalance, lower: bigint, upper: bigint): boolean {
  const unpaid = p.lots * (p.lots < 0n ? upper : lower) * scale + p.virtualScaled;
  const equity = p.cash * scale + (unpaid < 0n ? unpaid : 0n);
  const required = (abs(p.lots) * upper + 9n) / 10n + p.reserved;
  return p.cash >= 0n && p.cash <= 1_000_000_000_000_000n && abs(p.lots) <= 100_000_000n &&
    abs(p.virtualScaled) <= 10n ** 26n && p.reserved >= 0n && equity >= required * scale;
}

/** Exhaustive fixed A/B shortlist: at most 513 integer splits; no external venue routing.
 * Inputs must describe one labeled local snapshot with balances accrued to the effective funding index. On-chain checks remain authoritative.
 */
export function allocateRoute(input: {
  snapshotSlot: bigint; side: number; lots: bigint; lower: bigint; upper: bigint;
  trader: RouteBalance; candidates: RouteCandidate[]; grossLots: bigint;
  maxFee: bigint; allInLimit: bigint; notionalPrefix?:bigint;
  postReserve?:(before:RouteBalance,after:RouteBalance,gross:bigint,fee:bigint)=>bigint;
  /** An explicitly selected account engine may replace single-position admission.
   * Allocation, maker pricing, fees, bounds and tie-breaking remain unchanged. */
  admissible?:(before:RouteBalance,after:RouteBalance,gross:bigint,fee:bigint)=>boolean;
}): Allocation | null {
  const { side, lots, lower, upper, trader, candidates, snapshotSlot } = input;
  if (![0, 1].includes(side) || lots < 1n || lots > 4608n || lower < 1n || upper < lower || upper > 1_000_000n ||
    candidates.length < 1 || candidates.length > 2 || input.maxFee < 0n || input.allInLimit < 0n ||
    trader.reserved < 0n || input.grossLots < 0n || input.grossLots > 200_000_000n) throw new Error('route bounds');
  const seen = new Set<number>(), participants = new Set([trader.id]);
  for (const c of candidates) {
    if (seen.has(c.state.makerId) || ![0, 1].includes(c.state.makerId) || participants.has(c.balance.id) ||
      c.request.side !== side || c.request.slot !== snapshotSlot || c.request.inventory !== c.balance.lots || c.request.cash !== c.balance.cash ||
      c.balance.reserved < 0n) throw new Error('candidate binding');
    seen.add(c.state.makerId);participants.add(c.balance.id);
  }
  if (candidates.length === 2) {
    const [a, b] = candidates.map(c => c.request);
    if (a.market !== b.market || a.referencePrice !== b.referencePrice || a.termsEpoch !== b.termsEpoch ||
      a.marketConfigEpoch !== b.marketConfigEpoch || !a.domain.every((v, i) => v === b.domain[i])) throw new Error('mixed snapshot');
  }
  const a = candidates.find(c => c.state.makerId === 0), b = candidates.find(c => c.state.makerId === 1);
  const minA = b ? (lots > 4096n ? lots - 4096n : 0n) : lots;
  const maxA = a ? (lots < 512n ? lots : 512n) : 0n;
  let best: Allocation | null = null;
  for (let qa = minA; qa <= maxA; qa++) {
    const assignments: [RouteCandidate | undefined, bigint][] = [[a, qa], [b, lots - qa]];
    let total = 0n, deltaGross = 0n, valid = true;
    const legs: Allocation['legs'] = [];
    for (const [candidate, quantity] of assignments) {
      if (quantity === 0n) continue;
      if (!candidate) { valid = false;break; }
      try {
        const q = quoteMaker(candidate.state, { ...candidate.request, lots: quantity });
        const ref = candidate.request.referencePrice;
        if (q.grossQuote * 10n < quantity * ref * 9n || q.grossQuote * 10n > quantity * ref * 11n) { valid = false;break; }
        const direction = side === 0 ? -1n : 1n, before = candidate.balance;
        const after = { ...before, lots: before.lots + direction * quantity, virtualScaled: before.virtualScaled - direction * q.grossQuote * scale };
        if(input.postReserve)after.reserved=input.postReserve(before,after,q.grossQuote,0n);
        if (!(input.admissible ? input.admissible(before,after,q.grossQuote,0n) : healthy(after, lower, upper)) || abs(after.lots) > candidate.request.inventoryLimit) { valid = false;break; }
        deltaGross += abs(after.lots) - abs(before.lots);
        total += q.grossQuote;legs.push({ makerId: candidate.state.makerId, lots: quantity, grossQuote: q.grossQuote });
      } catch { valid = false;break; }
    }
    if (!valid || total < 1000n) continue;
    const prefix=input.notionalPrefix??0n;
    if(prefix<0n||prefix+total>1_000_000_000_000_000n)throw new Error('fee prefix bounds');
    const fee = feeFor(prefix+total)-feeFor(prefix), allIn = side === 0 ? total + fee : total - fee, sign = side === 0 ? 1n : -1n;
    const after = { ...trader, cash: trader.cash - fee, lots: trader.lots + sign * lots, virtualScaled: trader.virtualScaled - sign * total * scale };
    if(input.postReserve)after.reserved=input.postReserve(trader,after,total,fee);
    const gross = input.grossLots + deltaGross + abs(after.lots) - abs(trader.lots);
    if (!(input.admissible ? input.admissible(trader,after,total,fee) : healthy(after, lower, upper)) || gross < 0n || gross > 200_000_000n || fee > input.maxFee ||
      (side === 0 ? allIn > input.allInLimit : allIn < input.allInLimit)) continue;
    // Equal all-in outcomes prefer fewer legs, then the lower stable maker ID,
    // then more A lots. This tie rule is independent of caller candidate order.
    if (!best || (side === 0 ? allIn < best.allIn : allIn > best.allIn) ||
      (allIn === best.allIn && (legs.length < best.legs.length || (legs.length === best.legs.length &&
        (legs[0].makerId < best.legs[0].makerId || (legs[0].makerId === best.legs[0].makerId && legs[0].lots > best.legs[0].lots)))))) {
      best = { snapshotSlot, side, lots, grossQuote: total, fee, allIn, legs };
    }
  }
  return best;
}
