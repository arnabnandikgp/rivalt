// Independent optimization for opening from flat on the qualification books.
// No SDK quote, shortlist or risk functions participate in the calculation.
import assert from 'node:assert/strict';

export type Book = {
  id: number; cash: bigint; anchor: bigint; cap: bigint;
  regions: readonly { endLots: bigint; offset: bigint; slope: bigint }[];
};
export type Order = {
  side: 0 | 1; lots: bigint; lower: bigint; upper: bigint; reference: bigint;
  traderCash: bigint; limit: bigint; maxFee: bigint; width: number;
};
type Level = { id: number; price: bigint; lots: bigint };
export type Allocation = { gross: bigint; fee: bigint; allIn: bigint; legs: { id: number; lots: bigint; gross: bigint }[] };
const min = (left: bigint, right: bigint) => left < right ? left : right;
const max = (left: bigint, right: bigint) => left > right ? left : right;
const feeFor = (amount: bigint) => (amount + 4999n) / 5000n;

// Cash needed for a fresh position. An unfunded gain cannot offset initial margin.
function openingCash(long: boolean, lots: bigint, gross: bigint, order: Order) {
  const adverseLoss = long ? gross - lots * order.lower : lots * order.upper - gross;
  return (lots * order.upper + 9n) / 10n + max(0n, adverseLoss);
}

function affordableLevels(book: Book, order: Order) {
  const levels: Level[] = [];
  let quantity = 0n, gross = 0n, feasible = 0n, previous: bigint | undefined;
  for (const region of book.regions) {
    const start = quantity;
    const end = min(order.lots, min(book.cap, region.endLots));
    while (quantity < end) {
      const spread = region.offset + (quantity - start) * region.slope;
      const price = book.anchor + (order.side === 0 ? spread : -spread);
      assert(previous === undefined || (order.side === 0 ? previous <= price : previous >= price));
      previous = price;
      quantity++;
      gross += price;
      assert(price > 0n && price <= 1_000_000n, 'fixture marginal must be inside the numeric price domain');
      assert(gross * 10n >= 9n * order.reference * quantity && gross * 10n <= 11n * order.reference * quantity,
        'reference only qualifies curves inside the execution collar');
      if (openingCash(order.side === 1, quantity, gross, order) > book.cash) continue;
      // Enumerate every quantity. Never silently assume a disconnected health set is a prefix.
      assert.equal(quantity, feasible + 1n, 'non-prefix financial feasibility requires another optimizer');
      feasible = quantity;
      const last = levels.at(-1);
      if (last?.price === price) last.lots++;
      else levels.push({ id: book.id, price, lots: 1n });
    }
    if (quantity >= book.cap || quantity >= order.lots) break;
  }
  return { id: book.id, feasible, levels };
}

export function feasibleBook(book: readonly Book[], order: Order) {
  assert(order.width > 0 && order.width <= book.length && order.lots > 0n);
  assert(new Set(book.map(maker => maker.id)).size === book.length);
  // For this experiment all possible allocations leave the trader well above IM and
  // below the fee ceiling. A price optimum can therefore be tested against the limit last.
  const maxGross = (11n * order.reference * order.lots + 9n) / 10n;
  const minGross = 9n * order.reference * order.lots / 10n;
  assert(minGross >= 1000n && order.maxFee >= feeFor(maxGross));
  assert(order.traderCash >= feeFor(maxGross) + openingCash(order.side === 0, order.lots,
    order.side === 0 ? maxGross : minGross, order));
  const curves = book.map(maker => affordableLevels(maker, order));
  const levels = curves.flatMap(maker => maker.levels).sort((left, right) =>
    left.price === right.price ? left.id - right.id : (left.price < right.price) === (order.side === 0) ? -1 : 1);
  let best: Allocation | null = null;
  let subsets = 0;
  const selected = new Set<number>();
  function evaluate() {
    subsets++;
    // For a fixed subset the monotone marginal prices are a sorted merge of feasible prefixes.
    let remaining = order.lots, gross = 0n;
    const taken = new Map<number, { id: number; lots: bigint; gross: bigint }>();
    for (const level of levels) {
      if (!selected.has(level.id)) continue;
      const lots = min(remaining, level.lots);
      const leg = taken.get(level.id) ?? { id: level.id, lots: 0n, gross: 0n };
      leg.lots += lots;
      leg.gross += lots * level.price;
      taken.set(level.id, leg);
      gross += lots * level.price;
      remaining -= lots;
      if (remaining === 0n) break;
    }
    if (remaining) return;
    const fee = feeFor(gross), allIn = order.side === 0 ? gross + fee : gross - fee;
    if (order.side === 0 ? allIn > order.limit : allIn < order.limit) return;
    if (!best || (order.side === 0 ? allIn < best.allIn : allIn > best.allIn) ||
        (allIn === best.allIn && taken.size < best.legs.length)) {
      best = { gross, fee, allIn, legs: [...taken.values()].sort((a, b) => a.id - b.id) };
    }
  }
  // Any allocation on fewer than width makers is contained in a subset of exactly width.
  function visit(start: number) {
    if (selected.size === order.width) return evaluate();
    for (let index = start; index <= book.length - (order.width - selected.size); index++) {
      selected.add(book[index].id);
      visit(index + 1);
      selected.delete(book[index].id);
    }
  }
  visit(0);
  return { best: best as Allocation | null, subsets, capacities: curves.map(({ id, feasible }) => ({ id, feasible })) };
}
