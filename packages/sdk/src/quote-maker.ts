import type { MakerState, QuoteInstructionData, QuoteResponse } from './generatedMakerA/index.js';

export type MakerQuoteRequest = Omit<QuoteInstructionData, 'discriminator'>;

/** Exact indicative evaluation for the fixed G04 strategies; never a risk authorization. */
export function quoteMaker(state: MakerState, r: MakerQuoteRequest): QuoteResponse {
  const fail = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  fail(state.version === 1 && r.version === 1 && [0, 1].includes(state.makerId), 'version/strategy');
  fail(state.market === r.market && state.capital === r.capital &&
    state.domain.length === 32 && r.domain.length === 32 && state.domain.every((v, i) => v === r.domain[i]) && state.quoteEpoch === r.quoteEpoch &&
    state.quoteEpoch > 0n && r.authorityEpoch > 0n && r.termsEpoch > 0n && r.marketConfigEpoch > 0n, 'binding');
  fail([state.quoteEpoch, state.startSlot, state.expirySlot, r.quoteEpoch, r.authorityEpoch, r.termsEpoch, r.marketConfigEpoch, r.slot].every(n => n >= 0n && n <= (1n << 64n) - 1n), 'u64 bound');
  const duration = state.expirySlot - state.startSlot;
  fail(duration >= 64n && duration <= 3600n && r.slot >= state.startSlot && r.slot < state.expirySlot, 'lifetime');
  const abs = (n: bigint) => n < 0n ? -n : n;
  const max = (a: bigint, b: bigint) => a > b ? a : b;
  const min = (...values: bigint[]) => values.reduce((a, b) => a < b ? a : b);
  fail([0, 1].includes(r.side) && r.lots > 0n && r.referencePrice >= 1n && r.referencePrice <= 1_000_000n &&
    r.cash >= 0n && r.cash <= 1_000_000_000_000_000n && r.inventoryLimit > 0n && r.inventoryLimit <= 100_000_000n &&
    abs(r.inventory) <= r.inventoryLimit && r.consumed >= 0n, 'bounds');
  const [depth, spread, flat, step, tick] = state.makerId === 0
    ? [512n, 10n, 0n, 64n, 4n] : [4096n, 30n, 256n, 256n, 1n];
  const funded = min(r.cash * 10n / r.referencePrice, 100_000_000n);
  const directional = r.inventoryLimit + (r.side === 0 ? r.inventory : -r.inventory);
  const capacity = min(depth - r.consumed, directional, max(0n, funded - abs(r.inventory)));
  fail(r.lots <= capacity, 'capacity');
  const end = r.consumed + r.lots;
  const sign = r.side === 0 ? 1n : -1n;
  const base = r.referencePrice - r.inventory / step * tick + sign * spread;
  const first = base + sign * max(0n, r.consumed - flat);
  const last = base + sign * max(0n, end - 1n - flat);
  fail(min(first, last) >= 1n && max(first, last) <= 1_000_000n, 'marginal price');
  const impact = (n: bigint) => { const rising = max(0n, n - flat); return rising * (rising - 1n) / 2n; };
  const grossQuote = base * r.lots + sign * (impact(end) - impact(r.consumed));
  fail(grossQuote > 0n && grossQuote <= 1_000_000_000_000_000n, 'gross bound');
  return { version: 1, makerId: state.makerId, side: r.side, lots: r.lots, grossQuote, remaining: capacity - r.lots,
    quoteEpoch: state.quoteEpoch, authorityEpoch: r.authorityEpoch, termsEpoch: r.termsEpoch,
    marketConfigEpoch: r.marketConfigEpoch, startSlot: state.startSlot, expirySlot: state.expirySlot,
    consumedBefore: r.consumed, referencePrice: r.referencePrice };
}
