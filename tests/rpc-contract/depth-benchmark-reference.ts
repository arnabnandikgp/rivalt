import assert from 'node:assert/strict';
import type {LiquidityAdapter} from '@rivalt/sdk';

export type Side = 0 | 1;
type Offer = {id: number; price: bigint; depth: bigint};
export type Leg = {id: number; lots: bigint; gross: bigint};
export const tradeFee = (gross: bigint) => (gross + 4_999n) / 5_000n;
const min = (a: bigint, b: bigint) => a < b ? a : b;

// These fixtures have one flat region, constant spread and no inventory skew.
// Price each maker directly from the fetched fields, without calling an SDK quote or allocator.
export function readOffers(adapters: readonly LiquidityAdapter[], side: Side, standing = false): Offer[] {
  return adapters.map(({shape, price, registrationState, capital, snapshot, unavailable}, id) => {
    assert.equal(registrationState.instance, id);
    assert(unavailable === null || standing && unavailable === 'stale-publication', String(unavailable));
    const regions = side === 0 ? shape.asks : shape.bids;
    assert.deepEqual([regions.length, shape.mode, shape.skewTick, regions[0].slope], [1, 1, 0n, 0n]);
    const inventory = capital.positions[snapshot.marketIndex].lots;
    const consumed = side === 0 ? registrationState.buyConsumed : registrationState.sellConsumed;
    const remaining = regions[0].endLots - consumed;
    const headroom = side === 0 ? inventory + shape.shortCap : shape.longCap - inventory;
    const depth = min(remaining, headroom);
    return {id, price: price.anchor + (side === 0 ? regions[0].offset : -regions[0].offset), depth: depth > 0n ? depth : 0n};
  });
}

export function referenceRoute(offers: readonly Offer[], side: Side, lots: bigint) {
  const choices: {legs: Leg[]; gross: bigint; fee: bigint; allIn: bigint}[] = [];
  for (let first = 0; first < offers.length; first++) {
    for (let second = first; second < offers.length; second++) {
      const pair = second === first ? [offers[first]] : [offers[first], offers[second]];
      // At constant prices the cheaper ask / higher bid takes all available lots first.
      // Distinct fixture prices differ by >=2 atoms, so one atom of fee rounding cannot reverse that order.
      if (pair.length === 2) assert(pair[0].price === pair[1].price || (pair[0].price - pair[1].price) ** 2n >= 4n);
      pair.sort((a,b) => a.price === b.price ? a.id-b.id : (a.price < b.price) === (side === 0) ? -1 : 1);
      let remaining = lots;
      const legs: Leg[] = [];
      for (const offer of pair) {
        const taken = min(remaining, offer.depth);
        if (taken > 0n) legs.push({id: offer.id, lots: taken, gross: taken * offer.price});
        remaining -= taken;
      }
      if (remaining) continue;
      legs.sort((a,b) => a.id-b.id);
      const gross = legs.reduce((sum, leg) => sum + leg.gross, 0n), fee = tradeFee(gross);
      choices.push({legs, gross, fee, allIn: side === 0 ? gross + fee : gross - fee});
    }
  }
  choices.sort((a,b) => {
    if (a.allIn !== b.allIn) return (a.allIn < b.allIn) === (side === 0) ? -1 : 1;
    if (a.legs.length !== b.legs.length) return a.legs.length - b.legs.length;
    for (let i = 0; i < a.legs.length; i++) if (a.legs[i].id !== b.legs[i].id) return a.legs[i].id - b.legs[i].id;
    return a.legs[0].lots === b.legs[0].lots ? 0 : a.legs[0].lots > b.legs[0].lots ? -1 : 1;
  });
  return choices[0] ?? null;
}
