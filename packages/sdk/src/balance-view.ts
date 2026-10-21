import { effectiveFunding, oracleMode } from './oracle-policy.js';
import { orderReserve } from './order-policy.js';
import { resolutionBalance } from './resolution-policy.js';

/** Exact labeled preview shared by finalized API projections and direct RPC clients. */
export function balanceView(
  p: any,
  state: { market: any; risk: any; resolution?: any },
  slot: bigint,
  now = BigInt(Math.floor(Date.now() / 1000)),
) {
  if (state.market?.mode === 3) {
    const resolution = resolutionBalance(p, state.resolution);
    return {
      ...p,
      resolution,
      unpaidPnlScaled: resolution.paymentApplied ? '0' : resolution.claimAfterCollectionScaled,
      negativeUnpaidLiability: null,
      riskEquity: null,
      initialMargin: null,
      positiveUnpaidMarginCredit: '0',
      withdrawableCash: '0',
      exitRequirement: 'CompleteCohortResolutionAndAuthorizedRecovery',
      settlementAvailable: '0',
      currentRequiredReserve: '0',
      fundingIndexScaled: state.market.fundingIndexScaled,
      sourceMode: 'Frozen',
      valuationStatus: resolution.valued ? 'PinnedResolutionValuation' : 'AwaitingCohortValuation',
      evaluatedAtSlot: slot.toString(),
    };
  }
  const q = BigInt(p.lots),
    f = effectiveFunding(state.market, state.risk, now, slot),
    v = BigInt(p.virtualScaled) - q * (f - BigInt(p.fundingCheckpointScaled)),
    cash = BigInt(p.cash),
    scale = 1_000_000_000n;
  const risk = state.risk;
  const mode = oracleMode(state.market, risk, now, slot);
  const fresh = mode !== 'NoCredibleBounds';
  const unpaid = risk ? v + q * BigInt(risk.referencePrice) * scale : q === 0n ? v : null;
  const adverse = risk ? v + q * BigInt(q >= 0n ? risk.lower : risk.upper) * scale : q === 0n ? v : null;
  const liability = adverse === null ? null : adverse < 0n ? (-adverse + scale - 1n) / scale : 0n;
  const im = risk ? ((q < 0n ? -q : q) * BigInt(risk.upper) + 9n) / 10n : q === 0n ? 0n : null;
  return {
    ...p,
    unpaidPnlScaled: unpaid?.toString() ?? null,
    negativeUnpaidLiability: liability?.toString() ?? null,
    riskEquity: liability === null ? null : (cash - liability).toString(),
    initialMargin: im?.toString() ?? null,
    positiveUnpaidMarginCredit: '0',
    withdrawableCash: state.market?.mode === 0 && !state.market.paused ? p.cash : '0',
    exitRequirement: state.market?.mode > 0 ? 'FreshCompleteCohortCertificateAndPostWithdrawalMargin' : null,
    settlementAvailable: state.market?.settlement ?? '0',
    currentRequiredReserve: orderReserve(
      p,
      BigInt(state.market?.termsEpoch ?? 1),
      slot,
      fresh ? BigInt(risk.lower) : 1n,
      fresh ? BigInt(risk.upper) : 1_000_000n,
    ).toString(),
    fundingIndexScaled: f.toString(),
    sourceMode: mode,
    valuationStatus: risk
      ? fresh
        ? state.market?.mode === 2
          ? 'ControlledLocalOracle'
          : 'FreshTestObservation'
        : 'ExpiredTestObservation'
      : 'NoObservation',
    evaluatedAtSlot: slot.toString(),
  };
}
