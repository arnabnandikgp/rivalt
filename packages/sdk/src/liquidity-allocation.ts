import type { Address } from '@solana/kit';
import type { LiquidityAdapter } from './liquidity-adapter.js';
import { prepareLiquidityMargin, type LiquidityMarginInput } from './liquidity-margin.js';
import { hex, requireValue } from './wallet-client.js';

const MAX_DEPTH = 4096n;
const MAX_CASH = 1_000_000_000_000_000n;
const abs = (value: bigint) => value < 0n ? -value : value;
const feeFor = (notional: bigint) => (notional+4999n)/5000n;
export type LiquidityAllocationInput = LiquidityMarginInput & { makers: readonly LiquidityAdapter[] };
export type LiquidityAllocationLeg = Readonly<{
  instance: number; registration: Address; capital: Address; lots: bigint; grossQuote: bigint;
  authorityEpoch: bigint; controlEpoch: bigint; shapeEpoch: bigint; depthEpoch: bigint;
}>;
export type LiquidityAllocation = Readonly<{
  snapshotSlot: bigint; side: 0|1; lots: bigint; grossQuote: bigint; fee: bigint; allIn: bigint;
  legs: readonly LiquidityAllocationLeg[];
}>;
export type LiquiditySearchMetrics = { compositions: number; quantityQuotes: number; makerAdmissionChecks: number; traderAdmissionChecks: number };

function better(candidate: LiquidityAllocation, previous: LiquidityAllocation | null): boolean {
  if (!previous) return true;
  if (candidate.allIn !== previous.allIn) return candidate.side === 0 ? candidate.allIn < previous.allIn : candidate.allIn > previous.allIn;
  if (candidate.legs.length !== previous.legs.length) return candidate.legs.length < previous.legs.length;
  for (let index=0;index<candidate.legs.length;index++) {
    if (candidate.legs[index].instance !== previous.legs[index].instance) return candidate.legs[index].instance < previous.legs[index].instance;
  }
  return candidate.legs[0].lots > previous.legs[0].lots;
}

/** Exact integer singleton/pair optimum within one admitted snapshot, including
 * nonprefix maker health. No third capital, arbitrary callback, sampled split,
 * binary-search health assumption, partial quantity or price tolerance is implied.
 * This is a preview only; P32 must repeat admission on actual landed state.
 */
export function allocateLiquidityRoute(input: LiquidityAllocationInput): { allocation: LiquidityAllocation | null; metrics: LiquiditySearchMetrics;
  excluded: { instance: number; reason: string }[] } {
  const margin = prepareLiquidityMargin(input), { side, lots, slot, now, marketIndex } = input;
  requireValue(input.makers.length === 3, 'Discovery must supply all three sealed maker records.');
  const makers = [...input.makers].sort((left,right) => left.config.instance-right.config.instance);
  const anchor = makers[0].snapshot;
  requireValue(makers.every((maker,index) => maker.capability === 1 && maker.config.instance === index
    && maker.registrationState.instance === index && maker.snapshot.slot === slot && maker.snapshot.now === now
    && maker.snapshot.marketIndex === marketIndex && maker.snapshot.market === anchor.market
    && maker.snapshot.venue === anchor.venue && maker.snapshot.contextSlot === anchor.contextSlot
    && hex(maker.snapshot.domain) === hex(anchor.domain)), 'Mixed/unsupported liquidity snapshot.');
  requireValue(new Set(makers.map(maker => maker.registration)).size === 3
    && new Set(makers.map(maker => maker.registrationState.capital)).size === 3
    && new Set(makers.map(maker => maker.capital.id)).size === 3, 'Duplicate maker identity/capital.');
  const metrics: LiquiditySearchMetrics = { compositions: 0, quantityQuotes: 0, makerAdmissionChecks: 0, traderAdmissionChecks: 0 };
  const excluded: { instance: number; reason: string }[] = [];
  const table = makers.map(maker => {
    const status = maker.unavailable ?? (maker.capital.id === input.root.id || maker.capital.owner === input.root.owner ? 'self-capital' : null);
    if (status) { excluded.push({ instance: maker.config.instance, reason: status }); return null; }
    requireValue(slot < maker.validUntilSlot && now < maker.validUntilTime, 'Expired liquidity snapshot.');
    const inventory = maker.capital.positions[marketIndex].lots;
    const remainingDepth = maker.depthHints(side).at(-1) ?? 0n;
    const inventoryHeadroom = side === 0 ? inventory+maker.shape.shortCap : maker.shape.longCap-inventory;
    if (remainingDepth <= 0n || inventoryHeadroom <= 0n || maker.shape.mode === 3 && (side === 0 ? inventory <= 0n : inventory >= 0n)) {
      excluded.push({ instance: maker.config.instance,reason: 'zero-capacity' });return null;
    }
    const admit = margin.prepareMaker(maker.capital);
    const values: ({ gross: bigint; exposureChange: bigint } | null)[] = [null];
    for (let quantity=1n;quantity <= (lots < MAX_DEPTH ? lots : MAX_DEPTH);quantity++) {
      metrics.quantityQuotes++;
      try {
        const quote = maker.quote(side,quantity), reference = input.markets[marketIndex].referencePrice;
        const inBand = quote.gross*10n >= quantity*reference*9n && quote.gross*10n <= quantity*reference*11n;
        metrics.makerAdmissionChecks += inBand ? 1 : 0;
        const beforeLots = maker.capital.positions[marketIndex].lots;
        values.push(inBand && admit(quantity,quote.gross) ? { gross: quote.gross,
          exposureChange: abs(beforeLots+(side === 0 ? -quantity : quantity))-abs(beforeLots) } : null);
      } catch { values.push(null); }
    }
    if (values.every(value => value === null)) excluded.push({ instance: maker.config.instance, reason: 'no-feasible-quantity' });
    return values;
  });
  let best: LiquidityAllocation | null = null;
  function consider(assignments: readonly [number, bigint][]) {
    metrics.compositions++;
    let grossQuote=0n, exposureChange=0n;
    const legs: LiquidityAllocationLeg[] = [];
    for (const [index, quantity] of assignments) {
      const quoted = table[index]?.[Number(quantity)]; if (!quoted) return;
      const maker = makers[index], registration = maker.registrationState;
      grossQuote += quoted.gross; exposureChange += quoted.exposureChange;
      legs.push({ instance: maker.config.instance, registration: maker.registration, capital: registration.capital, lots: quantity,
        grossQuote: quoted.gross, authorityEpoch: registration.authorityEpoch, controlEpoch: maker.config.controlEpoch,
        shapeEpoch: maker.config.shapeEpoch, depthEpoch: registration.depthEpoch });
    }
    if (grossQuote < 1000n || margin.notionalPrefix+grossQuote > MAX_CASH) return;
    const fee = feeFor(margin.notionalPrefix+grossQuote)-feeFor(margin.notionalPrefix);
    const allIn = side === 0 ? grossQuote+fee : grossQuote-fee;
    if (fee > margin.maxFee || (side === 0 ? allIn > margin.allInLimit : allIn < margin.allInLimit)) return;
    const traderLots = input.root.positions[marketIndex].lots;
    const grossLots = input.markets[marketIndex].grossLots+exposureChange+abs(traderLots+(side === 0 ? lots : -lots))-abs(traderLots);
    if (grossLots < 0n || grossLots > 200_000_000n) return;
    const candidate: LiquidityAllocation = { snapshotSlot: slot, side, lots, grossQuote, fee, allIn, legs };
    if (!better(candidate,best)) return; // Only dominated by an already feasible result.
    metrics.traderAdmissionChecks++;
    if (margin.traderAdmissible(grossQuote,fee)) best = candidate;
  }
  for (let index=0;index<makers.length;index++) if (lots <= MAX_DEPTH) consider([[index,lots]]);
  for (let first=0;first<makers.length;first++) for (let second=first+1;second<makers.length;second++) {
    const lower = lots > MAX_DEPTH ? lots-MAX_DEPTH : 1n;
    const upper = lots-1n < MAX_DEPTH ? lots-1n : MAX_DEPTH;
    for (let firstLots=lower;firstLots<=upper;firstLots++) consider([[first,firstLots],[second,lots-firstLots]]);
  }
  requireValue(metrics.compositions <= 12_291 && metrics.quantityQuotes <= 12_288, 'Liquidity search budget exceeded.');
  return { allocation: best, metrics, excluded };
}
