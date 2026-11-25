import { expect, it } from 'vitest';
import { selectMakerIds } from './maker-shortlist.js';

it('keeps the best shallow bids that leave room for four deep makers', () => {
  const books = Array.from({ length: 32 }, (_, id) => {
    const quantity = id < 16 ? 6000n : 40000n;
    return { id, quantity, gross: quantity * (61000n - 2n - 2n * BigInt(id)) };
  });
  expect([...selectMakerIds(books, 1, 163935n, 8, 8, [])]).toEqual([0, 1, 2, 3, 16, 17, 18, 19]);
});

it('preserves a financially admitted preview and deterministically fills spare accounts', () => {
  const books = [4, 3, 2, 1, 0].map(id => ({ id, quantity: 10n, gross: 1000n }));
  expect([...selectMakerIds(books, 0, 13n, 2, 3, [3, 4])]).toEqual([3, 4, 0]);
  expect([...selectMakerIds(books, 0, 13n, 2, 3, [])]).toEqual([0, 1, 2]);
});

it('matches attainable depth from exhaustive subsets, including a spare account outside the fill cap', () => {
  const books = Array.from({ length: 6 }, (_, id) => ({ id, quantity: 0n, gross: 0n }));
  for (let variant = 0; variant < 24; variant++) {
    for (const book of books) {
      book.quantity = BigInt((variant * (book.id + 1) + book.id * book.id) % 11);
      book.gross = book.quantity * BigInt(100 + (book.id + variant) % 3);
    }
    for (const legs of [2, 3, 4]) {
      function greatestDepth(ids: Set<number>) {
        let best = 0n;
        for (let mask = 1; mask < 1 << books.length; mask++) {
          const subset = books.filter(book => (mask & (1 << book.id)) !== 0);
          if (subset.length > legs || subset.some(book => !ids.has(book.id))) continue;
          const total = subset.reduce((sum, book) => sum + book.quantity, 0n);
          if (total > best) best = total;
        }
        return best;
      }
      const possible = greatestDepth(new Set(books.map(book => book.id)));
      for (const side of [0, 1] as const) for (const lots of [1n, 11n, 20n, 35n]) {
        const width = Math.max(3, legs);
        const selected = selectMakerIds(books, side, lots, legs, width, []);
        expect(selected.size).toBe(width);
        expect(greatestDepth(selected)).toBeGreaterThanOrEqual(possible < lots ? possible : lots);
      }
    }
  }
});
