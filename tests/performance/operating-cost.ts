// Integer scenario calculator. Bids/prices/cadences are supplied assumptions, not
// a fee-market forecast, production landing guarantee or maker P&L estimate.
export type Bid = { version: 0; microLamportsPerRequestedCu: bigint } | { version: 1; explicitPriorityLamports: bigint };
const ceil = (numerator: bigint, denominator: bigint) => (numerator + denominator - 1n) / denominator;
export function transactionCost(signatures: bigint, baseLamportsPerSignature: bigint, requestedCu: bigint, bid: Bid) {
  if (signatures < 1n || signatures > 12n || baseLamportsPerSignature < 0n || requestedCu < 1n || requestedCu > 1_400_000n)
    throw new Error('Invalid bounded transaction cost inputs');
  const amount = bid.version === 0 ? bid.microLamportsPerRequestedCu : bid.explicitPriorityLamports;
  if (amount < 0n) throw new Error('Negative priority bid');
  const priority = bid.version === 0 ? ceil(amount * requestedCu, 1_000_000n) : amount;
  return { base: signatures * baseLamportsPerSignature, priority, total: signatures * baseLamportsPerSignature + priority };
}
export function operatingDay(input: { makers: bigint; markets: bigint; makerCadenceMs: bigint; fundingCadenceMs: bigint;
  makerFeeLamports: bigint; fundingFeeLamports: bigint; otherVenueLamports: bigint; collateralAtomsPerSol: bigint }) {
  if (input.makers < 1n || input.markets < 1n || input.makerCadenceMs < 1n || input.fundingCadenceMs < 1n
    || input.makerFeeLamports < 0n || input.fundingFeeLamports < 0n || input.otherVenueLamports < 0n || input.collateralAtomsPerSol < 0n)
    throw new Error('Invalid operating scenario');
  const makerSubmissions = input.makers * ceil(86_400_000n, input.makerCadenceMs);
  const fundingSubmissions = input.markets * ceil(86_400_000n, input.fundingCadenceMs);
  const makerLamports = makerSubmissions * input.makerFeeLamports;
  const venueLamports = fundingSubmissions * input.fundingFeeLamports + input.otherVenueLamports;
  const venueCostCollateralAtoms = ceil(venueLamports * input.collateralAtomsPerSol, 1_000_000_000n);
  // Nominal retained share is 1.5 bps = 3/20000. Exact on-chain fee/carry rounding
  // is unchanged; low-volume ceiling effects are not forecast by this ratio.
  const nominalBreakEvenVolumeAtoms = ceil(venueCostCollateralAtoms * 20_000n, 3n);
  return { makerSubmissions, fundingSubmissions, makerLamports, venueLamports,
    venueCostCollateralAtoms, nominalBreakEvenVolumeAtoms };
}
