// Find the cheapest signed candidate set when the full directory optimum fits
// the wallet's leg cap. Gross quotes are cumulative and their marginals monotone.
type Book = { lower: bigint; upper: bigint; quote(lots: bigint): bigint };

export function directoryAllocation(books: readonly (Book | null)[], side: 0 | 1, size: bigint, width: number) {
  const direction = side === 0 ? 1n : -1n;
  const curves = books.flatMap((book, id) => {
    if (!book) return [];
    const { upper } = book;
    const cost = (lot: bigint) => direction * (book.quote(lot) - (lot === 1n ? 0n : book.quote(lot - 1n)));
    const first = cost(1n), last = cost(book.upper);
    function prefix(threshold: bigint) {
      if (threshold < first) return 0n;
      if (threshold >= last) return upper;
      let low = 1n, high = upper - 1n;
      while (low < high) {
        const mid = low + (high - low + 1n) / 2n;
        if (cost(mid) <= threshold) low = mid;
        else high = mid - 1n;
      }
      return low;
    }
    return [{ id, book, first, last, prefix }];
  });
  if (!curves.length || curves.reduce((sum, curve) => sum + curve.book.upper, 0n) < size) return null;
  let low = curves.reduce((lowest, curve) => curve.first < lowest ? curve.first : lowest, curves[0].first);
  let high = curves.reduce((highest, curve) => curve.last > highest ? curve.last : highest, curves[0].last);
  while (low < high) {
    const mid = low + (high - low) / 2n;
    const supplied = curves.reduce((sum, curve) => sum + curve.prefix(mid), 0n);
    if (supplied >= size) high = mid;
    else low = mid + 1n;
  }
  const legs = curves.map(curve => {
    const lots = curve.prefix(low - 1n);
    return { id: curve.id, lots, tied: curve.prefix(low) - lots, lower: curve.book.lower };
  });
  // Use already-required makers first. Among unused makers at the cutoff,
  // take the largest tied prefix first to fit the fewest signed accounts.
  let remaining = size - legs.reduce((sum, leg) => sum + leg.lots, 0n);
  legs.sort((left, right) => {
    if ((left.lots > 0n) !== (right.lots > 0n)) return left.lots > 0n ? -1 : 1;
    if (left.lots === 0n && left.tied !== right.tied) return left.tied > right.tied ? -1 : 1;
    return left.id - right.id;
  });
  for (const leg of legs) {
    const take = remaining < leg.tied ? remaining : leg.tied;
    leg.lots += take;
    remaining -= take;
  }
  const filled = legs.filter(leg => leg.lots > 0n).sort((left, right) => left.id - right.id);
  if (remaining || filled.length > width || filled.some(leg => leg.lots < leg.lower)) return null;
  return filled.map(leg => [leg.id, leg.lots] as [number, bigint]);
}
