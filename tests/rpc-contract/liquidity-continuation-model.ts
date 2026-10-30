// Independent, deliberately slow per-lot reference for the bounded P32 schedule.
// Does not call the SDK quote, allocator or financial-admission implementation.
import assert from 'node:assert/strict';
import type * as sdk from '@rivalt/sdk';

export type Profile = 'baseline' | 'control' | 'treatment';
export type Region = { endLots: bigint; offset: bigint; slope: bigint };
export type Candidate = {
  instance: number; capital: string; registration: string; config: string;
  referencePrice: bigint; inventory: bigint; buyConsumed: bigint; sellConsumed: bigint; anchor: bigint;
  available: boolean; reason: string | null; legacy: boolean;
  bids: readonly Region[]; asks: readonly Region[];
  longCap: bigint; shortCap: bigint; target: bigint; step: bigint; tick: bigint;
};
export type Allocation = { grossQuote: bigint; fee: bigint; allIn: bigint; legs: { instance: number; lots: bigint; gross: bigint }[] };
const abs = (value: bigint) => value < 0n ? -value : value;
function potential(inventory: bigint, maker: Candidate) {
  let value = 0n;
  // Literal sum of marginal inventory penalties, independent of closed-form math.
  for (let distance = 0n; distance < abs(inventory - maker.target); distance++) value += distance / maker.step * maker.tick;
  return value;
}
export function referenceQuote(maker: Candidate, side: 0 | 1, lots: bigint): bigint | null {
  if (!maker.available || lots <= 0n) return null;
  const consumed = side === 0 ? maker.buyConsumed : maker.sellConsumed;
  const regions = side === 0 ? maker.asks : maker.bids;
  const capacity = side === 0 ? maker.shortCap + maker.inventory : maker.longCap - maker.inventory;
  if (lots > capacity || consumed + lots > regions.at(-1)!.endLots) return null;
  let gross = 0n;
  for (let lot = 0n; lot < lots; lot++) {
    let start = 0n, offset: bigint | undefined;
    for (const region of regions) {
      if (consumed + lot < region.endLots) { offset = region.offset + (consumed + lot - start) * region.slope; break; }
      start = region.endLots;
    }
    assert(offset !== undefined);
    const inventory = maker.inventory + (side === 0 ? -lot : lot);
    const next = inventory + (side === 0 ? -1n : 1n);
    const skew = maker.legacy ? maker.inventory / maker.step * maker.tick
      : potential(next, maker) - potential(inventory, maker);
    const price = maker.legacy ? maker.anchor - skew + (side === 0 ? offset : -offset)
      : maker.anchor + (side === 0 ? offset + skew : -offset - skew);
    assert(price * 10n >= maker.referencePrice * 9n && price * 10n <= maker.referencePrice * 11n, 'Independent marginal index band');
    gross += price;
  }
  return gross;
}
export function referenceAllocation(makers: Candidate[], side: 0 | 1, lots: bigint): Allocation | null {
  const values = makers.map(maker => Array.from({ length: Number(lots) }, (_, index) => referenceQuote(maker, side, BigInt(index + 1))));
  const choices: Allocation[] = [];
  function add(assignments: [number, bigint][]) {
    const legs = assignments.map(([index, quantity]) => ({ instance: makers[index].instance, lots: quantity, gross: values[index][Number(quantity - 1n)] }));
    if (legs.some(leg => leg.gross === null)) return;
    const grossQuote = legs.reduce((total, leg) => total + leg.gross!, 0n), fee = (grossQuote + 4999n) / 5000n;
    choices.push({ grossQuote, fee, allIn: grossQuote + (side === 0 ? fee : -fee), legs: legs as Allocation['legs'] });
  }
  for (let first = 0; first < makers.length; first++) {
    add([[first, lots]]);
    for (let second = first + 1; second < makers.length; second++) {
      for (let quantity = 1n; quantity < lots; quantity++) add([[first, quantity], [second, lots - quantity]]);
    }
  }
  choices.sort((left, right) => {
    if (left.allIn !== right.allIn) return (left.allIn < right.allIn) === (side === 0) ? -1 : 1;
    if (left.legs.length !== right.legs.length) return left.legs.length - right.legs.length;
    for (let index = 0; index < left.legs.length; index++) if (left.legs[index].instance !== right.legs[index].instance) return left.legs[index].instance - right.legs[index].instance;
    return left.legs[0].lots > right.legs[0].lots ? -1 : left.legs[0].lots < right.legs[0].lots ? 1 : 0;
  });
  return choices[0] ?? null;
}
export function candidates(snapshot: sdk.AccountSnapshot, profile: Profile, marketIndex: 0 | 1 = 0): Candidate[] {
  if (profile !== 'baseline') return snapshot.liquidity!.adapters.map(maker => ({
    instance: maker.config.instance, capital: maker.registrationState.capital, registration: maker.registration,
    config: maker.registrationState.config, referencePrice: snapshot.marketStates[marketIndex].referencePrice, inventory: maker.capital.positions[marketIndex].lots,
    buyConsumed: maker.registrationState.buyConsumed, sellConsumed: maker.registrationState.sellConsumed,
    anchor: maker.price.anchor, available: !maker.unavailable, reason: maker.unavailable, legacy: false,
    bids: maker.shape.bids, asks: maker.shape.asks, longCap: maker.shape.longCap, shortCap: maker.shape.shortCap,
    target: maker.shape.target, step: maker.shape.skewStep, tick: maker.shape.skewTick,
  }));
  return snapshot.makers.filter(maker => maker.marketIndex === marketIndex).map(maker => {
    const registration = maker.registrationState, inventory = snapshot.roots[registration.capital].positions[marketIndex].lots;
    const regions = maker.makerId === 0 ? [{ endLots: 512n, offset: 10n, slope: 1n }]
      : [{ endLots: 256n, offset: 30n, slope: 0n }, { endLots: 4096n, offset: 30n, slope: 1n }];
    const reason = registration.quarantined ? 'quarantined' : snapshot.slot >= maker.state.expirySlot ? 'epoch-expired' : null;
    assert(abs(inventory) < (maker.makerId === 0 ? 64n : 256n), 'Predeclared legacy zero-skew range');
    return { instance: maker.makerId, capital: registration.capital, registration: maker.registration, config: registration.config,
      inventory, buyConsumed: registration.buyConsumed, sellConsumed: registration.sellConsumed, anchor: snapshot.marketStates[marketIndex].referencePrice, referencePrice: snapshot.marketStates[marketIndex].referencePrice,
      available: !reason, reason, legacy: true, bids: regions, asks: regions, longCap: registration.inventoryLimit,
      shortCap: registration.inventoryLimit, target: 0n, step: maker.makerId === 0 ? 64n : 256n, tick: maker.makerId === 0 ? 4n : 1n };
  });
}

export function auditFill(before: sdk.MarginAccount, after: sdk.MarginAccountSnapshot,
  side: 0 | 1, lots: bigint, gross: bigint, fee: bigint, trader: boolean, marketIndex: 0 | 1 = 0) {
  const delta = side === 0 ? lots : -lots, sign = trader ? 1n : -1n;
  assert.equal(after.cash, before.cash - fee, 'Funded cash only pays actual taker fee');
  for (const index of [0, 1]) {
    const previous = before.positions[index], next = after.positions[index];
    const funded = previous.virtualScaled - previous.lots * (next.fundingCheckpointScaled - previous.fundingCheckpointScaled);
    assert.equal(next.lots, previous.lots + (index === marketIndex ? sign * delta : 0n), 'Exact lot ownership');
    assert.equal(next.virtualScaled, funded + (index === marketIndex ? -sign * (side === 0 ? gross : -gross) * 1_000_000_000n : 0n), 'Exact funded-versus-unpaid claim');
    const claim = next.virtualScaled + next.lots * (index === 0 ? 60_000n : 30_000n) * 1_000_000_000n;
    if (index === marketIndex) assert(after.cash * 1_000_000_000n + (claim < 0n ? claim : 0n) >= abs(next.lots) * (index === 0 ? 6000n : 3000n) * 1_000_000_000n,
      'Independent no-positive-credit initial margin after actual fill');
  }
}
