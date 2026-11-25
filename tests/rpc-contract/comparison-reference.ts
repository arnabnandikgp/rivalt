type Offer = { id: number; price: bigint; depth: bigint };
export type FillLeg = { id: number; lots: bigint; gross: bigint };

/** Independent flat-book optimizer. For a fixed subset the cheapest ask
 * (highest bid) consumes its full available quantity before the next price.
 * Explore both including and excluding each maker. Capacity and optimistic
 * remaining prices prune subtrees; no production quote/search code is used. */
export function compareFlat(offers: readonly Offer[], side: 0 | 1, quantity: bigint, maxLegs: number) {
  const ranked = offers
    .filter((row) => row.depth > 0n)
    .slice()
    .sort((a, b) => (a.price === b.price ? a.id - b.id : a.price < b.price === (side === 0) ? -1 : 1));
  let best: { gross: bigint; fee: bigint; allIn: bigint; legs: FillLeg[] } | null = null;
  const path: FillLeg[] = [];
  const cap = Array.from({ length: ranked.length + 1 }, () => Array<bigint>(maxLegs + 1).fill(0n));
  for (let index = ranked.length - 1; index >= 0; index--)
    for (let k = 1; k <= maxLegs; k++) {
      const take = ranked[index].depth + cap[index + 1][k - 1],
        skip = cap[index + 1][k];
      cap[index][k] = take > skip ? take : skip;
    }
  const visit = (index: number, remaining: bigint, k: number, cost: bigint) => {
    if (remaining === 0n) {
      const fee = (cost + 4999n) / 5000n;
      if (!best || (side === 0 ? cost < best.gross : cost > best.gross))
        best = { gross: cost, fee, allIn: side === 0 ? cost + fee : cost - fee, legs: [...path] };
      return;
    }
    if (cap[index][k] < remaining) return;
    const offer = ranked[index],
      bound = cost + remaining * offer.price;
    if (best && (side === 0 ? bound >= best.gross : bound <= best.gross)) return;
    const lots = remaining < offer.depth ? remaining : offer.depth;
    path.push({ id: offer.id, lots, gross: lots * offer.price });
    visit(index + 1, remaining - lots, k - 1, cost + lots * offer.price);
    path.pop();
    visit(index + 1, remaining, k, cost);
  };
  visit(0, quantity, maxLegs, 0n);
  return best as { gross: bigint; fee: bigint; allIn: bigint; legs: FillLeg[] } | null;
}
