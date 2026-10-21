import type { Event } from './events.js';

export type Participant = { owner: string; id: number; cash: string; lots: string; virtualScaled: string;
  fundingCheckpointScaled: string; generation: string; nonce: string; reserved: string; orderIds: string[] };
export type State = { sequence: string; market: any | null; risk: any | null;
  participants: Record<string, Participant>; makers: Record<string, any> };
export const empty = (): State => ({ sequence: '0', market: null, risk: null, participants: {}, makers: {} });
const zero = '11111111111111111111111111111111';
const requireValue = <T>(value: T | undefined | null, label: string): T => {
  if (value == null) throw new Error(`Missing ${label} projection`); return value;
};

export function project(state: State, event: Event, market: string, domain: string) {
  const e = event.data;
  if (e.market !== market || e.domain !== domain) throw new Error('Event environment mismatch');
  if (BigInt(e.sequence) !== BigInt(state.sequence) + 1n) throw new Error('Critical sequence gap');
  if (event.type === 'custody') {
    if (![0, 1, 2, 3, 4, 5, 6].includes(e.kind)) throw new Error('Unknown custody operation');
    if (e.kind === 0) {
      if (state.market || e.sequence !== '1') throw new Error('Duplicate initialization');
      state.market = { mode: 0, fundingIndexScaled: '0', grossLots: '0' };
    }
    const m = requireValue(state.market, 'market');
    for (const k of ['termsEpoch', 'configEpoch', 'totalCash', 'settlement', 'insurance', 'fees', 'allocatedVault', 'paused']) m[k] = e[k];
    if (e.kind === 1) {
      if (state.participants[e.participant]) throw new Error('Duplicate participant');
      const id = Object.keys(state.participants).length;
      if (id >= 64) throw new Error('Registry limit');
      state.participants[e.participant] = { owner: e.actor, id, cash: '0', lots: '0', virtualScaled: '0',
        fundingCheckpointScaled: '0', generation: '0', nonce: '0', reserved: '0', orderIds: ['0','0','0','0'] };
    }
    if (e.participant !== zero) requireValue(state.participants[e.participant], 'participant').cash = e.participantCash;
  } else if (event.type === 'maker') {
    if (![0, 1, 2, 3].includes(e.kind)) throw new Error('Unknown maker operation');
    requireValue(state.participants[e.capital], 'capital');
    if (e.kind === 0) {
      if (state.makers[e.registration]) throw new Error('Duplicate maker');
      state.makers[e.registration] = { buyConsumed: '0', sellConsumed: '0' };
    }
    const maker = requireValue(state.makers[e.registration], 'maker');
    for (const k of ['capital', 'makerId', 'authorityEpoch', 'quoteEpoch', 'quarantined', 'approvedHash']) maker[k] = e[k];
    if (e.kind === 2) maker.buyConsumed = maker.sellConsumed = '0';
  } else if (event.type === 'risk') {
    const m = requireValue(state.market, 'market');
    m.mode = 1; m.termsEpoch = e.termsEpoch; m.configEpoch = e.configEpoch; state.risk = e;
  } else {
    const m = requireValue(state.market, 'market');
    const trader = requireValue(state.participants[e.trader], 'trader');
    if (e.nonce !== trader.nonce || ![0, 1].includes(e.side) || ![1, 2].includes(e.legs.length)) throw new Error('Route authority/shape mismatch');
    Object.assign(trader, { cash: e.traderCash, lots: e.traderLots, virtualScaled: e.traderVirtual,
      generation: e.traderGeneration, nonce: (BigInt(e.nonce) + 1n).toString() });
    for (const leg of e.legs) {
      const capital = requireValue(state.participants[leg.capital], 'capital');
      Object.assign(capital, { lots: leg.positionAfter, virtualScaled: leg.virtualAfter, generation: leg.generationAfter });
      const maker = requireValue(Object.values(state.makers).find(m => m.capital === leg.capital && m.makerId === leg.makerId), 'maker');
      maker[e.side === 0 ? 'buyConsumed' : 'sellConsumed'] = leg.consumedAfter;
    }
    m.totalCash = e.totalCash; m.fees = e.totalFees; m.grossLots = e.grossLots;
  }
  state.sequence = e.sequence;
  const m = state.market;
  if (m && BigInt(m.allocatedVault) !== BigInt(m.totalCash) + BigInt(m.settlement) + BigInt(m.insurance) + BigInt(m.fees)) throw new Error('Cash conservation failure');
  const participants = Object.values(state.participants);
  if (m && participants.reduce((n, p) => n + BigInt(p.cash), 0n) !== BigInt(m.totalCash)) throw new Error('Participant cash mismatch');
  if (participants.reduce((n, p) => n + BigInt(p.lots), 0n) !== 0n) throw new Error('Net position mismatch');
}

export function balance(p: Participant, state: State, slot: bigint) {
  const q = BigInt(p.lots), v = BigInt(p.virtualScaled), cash = BigInt(p.cash), scale = 1_000_000_000n;
  const risk = state.risk;
  const fresh = risk && slot >= BigInt(risk.validFrom) && slot < BigInt(risk.validUntil);
  const unpaid = risk ? v + q * BigInt(risk.referencePrice) * scale : q === 0n ? v : null;
  const adverse = risk ? v + q * BigInt(q >= 0n ? risk.lower : risk.upper) * scale : q === 0n ? v : null;
  const liability = adverse === null ? null : adverse < 0n ? (-adverse + scale - 1n) / scale : 0n;
  const im = risk ? ((q < 0n ? -q : q) * BigInt(risk.upper) + 9n) / 10n : q === 0n ? 0n : null;
  return { ...p, unpaidPnlScaled: unpaid?.toString() ?? null, negativeUnpaidLiability: liability?.toString() ?? null,
    riskEquity: liability === null ? null : (cash - liability).toString(), initialMargin: im?.toString() ?? null,
    positiveUnpaidMarginCredit: '0', withdrawableCash: state.market?.mode === 0 && !state.market.paused ? p.cash : '0',
    valuationStatus: risk ? fresh ? 'FreshTestObservation' : 'ExpiredTestObservation' : 'NoObservation',
    evaluatedAtSlot: slot.toString() };
}
