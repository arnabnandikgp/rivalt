import { describe, expect, it } from 'vitest';
import { feasibleBook, type Book, type Order } from './feasible-book-reference.js';

// A separate small oracle tries each vector of quantities directly. It does
// not use the reference implementation's subset search, price levels or fees.
function exhaustive(books: Book[], order: Order) {
  const amounts = books.map(book => {
    const quotes = [0n];
    let end = 0n;
    for (const region of book.regions) {
      for (let lot = end; lot < region.endLots && lot < book.cap; lot++) {
        const offset = region.offset + (lot - end) * region.slope;
        quotes.push(quotes.at(-1)! + book.anchor + (order.side === 0 ? offset : -offset));
      }
      end = region.endLots;
    }
    return quotes;
  });
  let best: bigint | null = null;
  function visit(index: number, remaining: bigint, makers: number, gross: bigint) {
    if (index === books.length) {
      if (remaining !== 0n) return;
      const fee = gross / 5000n + (gross % 5000n ? 1n : 0n);
      const total = order.side === 0 ? gross + fee : gross - fee;
      if (fee > order.maxFee || (order.side === 0 ? total > order.limit : total < order.limit)) return;
      if (best === null || (order.side === 0 ? total < best : total > best)) best = total;
      return;
    }
    for (const [count, quote] of amounts[index].entries()) {
      const lots = BigInt(count), participants = makers + Number(count > 0);
      if (lots > remaining || participants > order.width) break;
      const pnl = order.side === 0 ? quote - lots * order.upper : lots * order.lower - quote;
      const riskCash = books[index].cash + (pnl < 0n ? pnl : 0n);
      if (riskCash * 10n < lots * order.upper) continue;
      visit(index + 1, remaining - lots, participants, gross + quote);
    }
  }
  visit(0, order.lots, 0, 0n);
  return best;
}
const base: Order = { side: 0, lots: 4n, lower: 9997n, upper: 10003n, reference: 10000n,
  traderCash: 1_000_000n, limit: 200000n, maxFee: 100n, width: 3 };
const samples: Book[] = [10009n, 9995n, 10000n, 9999n].map((anchor, id) => ({
  id, anchor, cap: BigInt(3 + id), cash: [2010n, 3050n, 0n, 7000n][id],
  regions: [{ endLots: 2n, offset: BigInt(id), slope: 1n }, { endLots: 6n, offset: BigInt(5 + id), slope: 2n }],
}));

describe('independent economically feasible book', () => {
  it('matches exhaustive quantity vectors on buys and sells at every width and signed-limit boundary', () => {
    for (const side of [0, 1] as const) for (let width = 1; width <= 4; width++) for (let lots = 1n; lots <= 8n; lots++) {
      const order = { ...base, side, lots, width, limit: side === 0 ? base.limit : 0n };
      const expected = exhaustive(samples, order);
      const result = feasibleBook(samples, order);
      expect(result.best?.allIn ?? null).toBe(expected);
      expect(result.subsets).toBe([0, 4, 6, 4, 1][width]);
      if (expected === null) continue;
      expect(feasibleBook(samples, { ...order, limit: expected }).best?.allIn).toBe(expected);
      expect(feasibleBook(samples, { ...order, limit: expected + (side === 0 ? -1n : 1n) }).best).toBeNull();
    }
  });
  it('charges adverse P&L and never borrows against favorable open P&L', () => {
    const order = { ...base, side: 1 as const, lots: 3n, width: 1, lower: 10000n, upper: 10000n, limit: 0n };
    const book = { id: 0, anchor: 10100n, cap: 3n, cash: 3300n, regions: [{ endLots: 3n, offset: 0n, slope: 0n }] };
    expect(feasibleBook([book], order).best?.gross).toBe(30300n);
    expect(feasibleBook([{ ...book, cash: 3299n }], order).capacities[0].feasible).toBe(2n);
    expect(feasibleBook([{ ...book, cash: 2999n, anchor: 9900n }], order).capacities[0].feasible).toBe(2n);
  });
});
