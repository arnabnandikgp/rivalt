import { describe, expect, it } from 'vitest';
import { makerEconomics, type EconomicsInput } from './economics.js';

// Hand-calculated ledger: sell 2 @100, receive 0.2 funding, buy 2 @90,
// settle 20 whole atoms, withdraw 1000. The residual 0.2 stays unpaid.
function vector(): EconomicsInput {
  const event = (sequence: string, kind: string, payload: Record<string, unknown>) => ({ signature: `tx-${sequence}`, kind,
    payload: { market: 'market', domain: 'domain', sequence, ...payload } });
  return {
    version: 1, operatorClass: 'internal-reference', market: 'market', domain: 'domain', capital: 'maker', owner: 'owner',
    opening: { sequence: '0', fundingIndexScaled: '0', referenceAtomsPerLot: '100', referenceStatus: 'credible-at-capture',
      participant: { cash: '1000', lots: '0', virtualScaled: '0', fundingCheckpointScaled: '0' } },
    closing: { sequence: '5', fundingIndexScaled: '100000000', referenceAtomsPerLot: '90', referenceStatus: 'stale',
      participant: { cash: '20', lots: '0', virtualScaled: '200000000', fundingCheckpointScaled: '100000000' } },
    events: [
      event('1', 'route', { trader: 'trader', side: 0, fundingIndexScaled: '0', legs: [
        { capital: 'maker', lots: '2', grossQuote: '200', positionAfter: '-2', virtualAfter: '200000000000' }] }),
      event('2', 'oracle', { fundingIndexScaled: '100000000' }),
      event('3', 'route', { trader: 'trader', side: 1, fundingIndexScaled: '100000000', legs: [
        { capital: 'maker', lots: '2', grossQuote: '180', positionAfter: '0', virtualAfter: '20200000000' }] }),
      event('4', 'settlement', { participant: 'maker', kind: 1, amount: '20', participantCash: '1020', participantVirtual: '200000000', fundingIndexScaled: '100000000' }),
      event('5', 'settlement', { participant: 'maker', kind: 2, amount: '1000', participantCash: '20', participantVirtual: '200000000', fundingIndexScaled: '100000000' }),
    ],
    transactions: [1, 2, 3, 4, 5, 6].map(index => ({ signature: `tx-${index}`, feePayer: index >= 5 ? 'owner' : 'other', feeLamports: '5000', failed: index === 6 })),
    pendingFeeReservationLamports: '20000', hedge: { kind: 'not-observed', assumedBps: '5', description: 'Illustrative assumption, no hedge fills' },
  };
}

describe('maker economics from finalized ordinary events', () => {
  it('keeps funded gain, unpaid fraction, funding and failed-transaction fees distinct', () => {
    const report = makerEconomics(vector());
    expect(report).toMatchObject({ makerFills: 2, takerFills: 0, filledLots: '4', grossNotionalAtoms: '380',
      fundedPnlAtoms: '20', unpaidPnlScaled: '200000000', fundingPnlScaled: '200000000', cashAtoms: '20',
      withdrawnAtoms: '1000', totalPnlBeforeNetworkAndHedgesScaled: '20200000000', networkFeesLamports: '10000',
      pendingFeeReservationLamports: '20000', independentMakerValidation: false });
    expect(report.hedge).toMatchObject({ observedHedges: false, costAssumptionScaled: '190000000', deductedFromReportedPnl: false });
    expect(report.valuation.referenceStatus).toBe('stale');
  });
  it('reports exposed profit as unpaid and never adds it to funded cash', () => {
    const input = vector(); input.events = input.events.slice(0, 2);
    input.closing = { sequence: '2', fundingIndexScaled: '100000000', referenceAtomsPerLot: '90', referenceStatus: 'credible-at-capture',
      participant: { cash: '1000', lots: '-2', virtualScaled: '200000000000', fundingCheckpointScaled: '0' } };
    const report = makerEconomics(input);
    expect(report).toMatchObject({ fundedPnlAtoms: '0', cashAtoms: '1000', unpaidPnlScaled: '20200000000', fundingPnlScaled: '200000000' });
    input.closing.referenceAtomsPerLot = null; input.closing.referenceStatus = 'absent';
    expect(makerEconomics(input).unpaidPnlScaled).toBeNull();
  });
  it('charges a maker acting as taker and separates collateral injections from P&L', () => {
    const input = vector();
    input.events = [{ signature: 'tx-1', kind: 'custody', payload: { market: 'market', domain: 'domain', sequence: '1',
      participant: 'maker', kind: 2, amount: '500', participantCash: '1500' } },
    { signature: 'tx-2', kind: 'route', payload: { market: 'market', domain: 'domain', sequence: '2', trader: 'maker', side: 0,
      lots: '1', grossQuote: '100', fee: '1', traderCash: '1499', traderLots: '1', traderVirtual: '-100000000000', fundingIndexScaled: '0',
      legs: [{ capital: 'other-maker', lots: '1', grossQuote: '100' }] } }];
    input.closing = { sequence: '2', fundingIndexScaled: '0', referenceAtomsPerLot: '100', referenceStatus: 'credible-at-capture',
      participant: { cash: '1499', lots: '1', virtualScaled: '-100000000000', fundingCheckpointScaled: '0' } };
    expect(makerEconomics(input)).toMatchObject({ depositedAtoms: '500', fundedPnlAtoms: '0', venueFeesAtoms: '1',
      makerFills: 0, takerFills: 1, totalPnlBeforeNetworkAndHedgesScaled: '-1000000000' });
  });
  it.each(['duplicate-event', 'missing-event', 'foreign-domain', 'wrong-cash', 'duplicate-fee', 'failed-event', 'unsupported-resolution'])('rejects %s', kind => {
    const input = vector();
    if (kind === 'duplicate-event') input.events.splice(1, 0, input.events[0]);
    if (kind === 'missing-event') input.events.splice(1, 1);
    if (kind === 'foreign-domain') input.events[0].payload.domain = 'foreign';
    if (kind === 'wrong-cash') input.closing.participant.cash = '21';
    if (kind === 'duplicate-fee') input.transactions.push(input.transactions[0]);
    if (kind === 'failed-event') input.transactions[0].failed = true;
    if (kind === 'unsupported-resolution') input.events[1].kind = 'resolution';
    expect(() => makerEconomics(input)).toThrow();
  });
});
