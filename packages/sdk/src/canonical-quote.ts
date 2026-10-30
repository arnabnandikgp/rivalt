/** Profile-4 canonical arithmetic. A quote is not capital admission or a reservation. */
export type CanonicalRegion = Readonly<{
  endLots: bigint;
  offset: bigint;
  slope: bigint;
}>;

export type CanonicalShape = Readonly<{
  mode: number;
  ttlSlots: number;
  target: bigint;
  skewStep: bigint;
  skewTick: bigint;
  longCap: bigint;
  shortCap: bigint;
  bids: readonly CanonicalRegion[];
  asks: readonly CanonicalRegion[];
}>;

const MAX_POSITION = 100_000_000n;
const MAX_PRICE = 1_000_000n;
const MAX_DEPTH = 4_096n;
const min = (left: bigint, right: bigint) => left < right ? left : right;
const max = (left: bigint, right: bigint) => left > right ? left : right;
const abs = (value: bigint) => value < 0n ? -value : value;

function bound(value: bigint, lower: bigint, upper: bigint): bigint {
  if (value < lower || value > upper) throw new Error('canonical quote bounds');
  return value;
}

export function validateCanonicalShape(shape: CanonicalShape): void {
  if (![0, 1, 3].includes(shape.mode)
      || !Number.isInteger(shape.ttlSlots) || shape.ttlSlots < 1 || shape.ttlSlots > 150
      || shape.bids.length + shape.asks.length === 0) throw new Error('canonical shape');
  bound(shape.target, -MAX_POSITION, MAX_POSITION);
  bound(shape.skewStep, 1n, MAX_POSITION);
  bound(shape.skewTick, 0n, 1_000n);
  bound(shape.longCap, 0n, MAX_POSITION);
  bound(shape.shortCap, 0n, MAX_POSITION);
  for (const regions of [shape.bids, shape.asks]) {
    if (regions.length > 8) throw new Error('canonical region count');
    let start = 0n;
    let previousOffset = 0n;
    for (const region of regions) {
      bound(region.endLots, start + 1n, MAX_DEPTH);
      bound(region.offset, previousOffset, MAX_PRICE);
      bound(region.slope, 0n, 1_000n);
      previousOffset = bound(region.offset + (region.endLots - start - 1n) * region.slope, 0n, MAX_PRICE);
      start = region.endLots;
    }
  }
}

function prefix(regions: readonly CanonicalRegion[], quantity: bigint): bigint {
  bound(quantity, 0n, regions.at(-1)?.endLots ?? 0n);
  let start = 0n;
  let total = 0n;
  for (const region of regions) {
    const width = max(0n, min(quantity, region.endLots) - start);
    total += width * region.offset + region.slope * width * (width - 1n) / 2n;
    start = region.endLots;
  }
  return total;
}

function potential(shape: CanonicalShape, inventory: bigint): bigint {
  const distance = abs(inventory - shape.target);
  const quotient = distance / shape.skewStep;
  const remainder = distance % shape.skewStep;
  return shape.skewTick * (shape.skewStep * quotient * (quotient - 1n) / 2n + quotient * remainder);
}

/** Returns exact gross quote atoms; clearing separately checks all financial rules. */
export function quoteCanonical(
  shape: CanonicalShape,
  anchor: bigint,
  side: number,
  lots: bigint,
  inventory: bigint,
  consumed: bigint,
): Readonly<{ gross: bigint; remaining: bigint }> {
  validateCanonicalShape(shape);
  if (shape.mode === 0 || (side !== 0 && side !== 1)) throw new Error('canonical side/mode');
  bound(anchor, 1n, MAX_PRICE);
  bound(inventory, -MAX_POSITION, MAX_POSITION);
  bound(consumed, 0n, MAX_DEPTH);
  const regions = side === 0 ? shape.asks : shape.bids;
  const depth = max(0n, (regions.at(-1)?.endLots ?? 0n) - consumed);
  let headroom = side === 0 ? inventory + shape.shortCap : shape.longCap - inventory;
  if (shape.mode === 3) headroom = min(headroom, max(0n, side === 0 ? inventory : -inventory));
  const capacity = max(0n, min(depth, headroom));
  bound(lots, 1n, capacity);
  const direction = side === 0 ? -1n : 1n;
  const after = inventory + direction * lots;
  const offsets = prefix(regions, consumed + lots) - prefix(regions, consumed);
  const skew = potential(shape, after) - potential(shape, inventory);
  const gross = anchor * lots - direction * (offsets + skew);
  for (const index of [0n, lots - 1n]) {
    const current = inventory + direction * index;
    const spread = prefix(regions, consumed + index + 1n) - prefix(regions, consumed + index);
    const change = potential(shape, current + direction) - potential(shape, current);
    bound(anchor - direction * (spread + change), 1n, MAX_PRICE);
  }
  // Valid input bounds keep every intermediate within i128; this explicit result
  // bound matches the on-chain integer representation, never a Number conversion.
  return { gross: bound(gross, lots, lots * MAX_PRICE), remaining: capacity - lots };
}
