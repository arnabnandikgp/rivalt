import assert from 'node:assert/strict';

const SCALE = 1_000_000_000n;
export type Position = { cash: string; lots: string; virtualScaled: string; fundingCheckpointScaled: string };
export type EconomicsSnapshot = {
  sequence: string; fundingIndexScaled: string; referenceAtomsPerLot: string | null;
  referenceStatus: 'credible-at-capture' | 'stale' | 'absent'; participant: Position;
};
export type EconomicsInput = {
  version: 1; operatorClass: 'internal-reference'; market: string; domain: string; capital: string; owner: string;
  opening: EconomicsSnapshot; closing: EconomicsSnapshot;
  events: Array<{ signature: string; kind: string; payload: Record<string, any> }>;
  transactions: Array<{ signature: string; feePayer: string; feeLamports: string; failed: boolean }>;
  pendingFeeReservationLamports: string;
  hedge: { kind: 'not-observed'; assumedBps: string; description: string };
};

function integer(value: unknown): bigint {
  assert(typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value), 'Expected an exact decimal integer string');
  return BigInt(value);
}
function unsigned(value: unknown): bigint {
  const number = integer(value); assert(number >= 0n, 'Expected a nonnegative amount'); return number;
}
function markedClaim(position: Position, snapshot: EconomicsSnapshot): bigint | null {
  const lots = integer(position.lots);
  if (snapshot.referenceAtomsPerLot === null && lots !== 0n) return null;
  const reference = snapshot.referenceAtomsPerLot === null ? 0n : unsigned(snapshot.referenceAtomsPerLot);
  return lots * reference * SCALE + integer(position.virtualScaled)
    - lots * (integer(snapshot.fundingIndexScaled) - integer(position.fundingCheckpointScaled));
}

/** Ordinary finalized lifecycle accounting, independent of SDK pricing/settlement helpers.
 * Resolution/liquidation need their own attributed economics model and fail closed here.
 */
export function makerEconomics(input: EconomicsInput) {
  assert.equal(input.version, 1); assert.equal(input.operatorClass, 'internal-reference');
  assert.equal(input.hedge.kind, 'not-observed'); assert(input.hedge.description.trim());
  const hedgeBps = unsigned(input.hedge.assumedBps); assert(hedgeBps <= 10_000n);
  let sequence = unsigned(input.opening.sequence), funding = integer(input.opening.fundingIndexScaled);
  let cash = unsigned(input.opening.participant.cash), lots = integer(input.opening.participant.lots);
  let virtual = integer(input.opening.participant.virtualScaled)
    - lots * (funding - integer(input.opening.participant.fundingCheckpointScaled));
  let fundingPnl = 0n, deposited = 0n, withdrawn = 0n, collected = 0n, settled = 0n, venueFees = 0n;
  let filledLots = 0n, grossNotional = 0n, makerFills = 0, takerFills = 0;
  const fills: Array<{ signature: string; sequence: string; role: 'provider' | 'taker'; side: 'buy' | 'sell'; lots: string; grossQuoteAtoms: string }> = [];
  const transactionBySignature = new Map(input.transactions.map(transaction => [transaction.signature, transaction]));
  assert.equal(transactionBySignature.size, input.transactions.length, 'Duplicate transaction fee');
  for (const transaction of input.transactions) unsigned(transaction.feeLamports);
  function accrue(nextFunding: bigint) {
    const change = -lots * (nextFunding - funding);
    virtual += change; fundingPnl += change; funding = nextFunding;
  }
  function fill(signature: string, role: 'provider' | 'taker', side: number, quantity: bigint, gross: bigint) {
    assert(side === 0 || side === 1); assert(quantity > 0n && gross > 0n);
    lots += side === 0 ? quantity : -quantity;
    virtual += (side === 0 ? -gross : gross) * SCALE;
    filledLots += quantity; grossNotional += gross;
    if (role === 'provider') makerFills++; else takerFills++;
    fills.push({ signature, sequence: sequence.toString(), role, side: side === 0 ? 'buy' : 'sell',
      lots: quantity.toString(), grossQuoteAtoms: gross.toString() });
  }
  for (const event of input.events) {
    const payload = event.payload;
    assert.equal(payload.market, input.market); assert.equal(payload.domain, input.domain);
    assert.equal(unsigned(payload.sequence), ++sequence, 'Missing, duplicate or reordered critical event');
    const transaction = transactionBySignature.get(event.signature);
    assert(transaction && !transaction.failed, 'Event requires successful finalized transaction');
    if ('fundingIndexScaled' in payload) accrue(integer(payload.fundingIndexScaled));
    if (event.kind === 'route') {
      assert(payload.side === 0 || payload.side === 1);
      assert(Array.isArray(payload.legs) && payload.legs.length >= 1 && payload.legs.length <= 2);
      assert.equal(new Set(payload.legs.map((leg: any) => leg.capital)).size, payload.legs.length, 'Duplicate maker leg');
      if (payload.trader === input.capital) {
        fill(event.signature, 'taker', payload.side, unsigned(payload.lots), unsigned(payload.grossQuote));
        const fee = unsigned(payload.fee); cash -= fee; venueFees += fee;
        assert.equal(integer(payload.traderLots), lots); assert.equal(integer(payload.traderVirtual), virtual);
        assert.equal(unsigned(payload.traderCash), cash);
      }
      for (const leg of payload.legs) if (leg.capital === input.capital) {
        assert.notEqual(payload.trader, input.capital, 'Self trade');
        fill(event.signature, 'provider', 1 - payload.side, unsigned(leg.lots), unsigned(leg.grossQuote));
        assert.equal(integer(leg.positionAfter), lots); assert.equal(integer(leg.virtualAfter), virtual);
      }
    } else if (event.kind === 'custody' && payload.participant === input.capital) {
      const amount = unsigned(payload.amount);
      if (payload.kind === 2) { cash += amount; deposited += amount; }
      else if (payload.kind === 3) { cash -= amount; withdrawn += amount; }
      else assert.equal(payload.kind, 1, 'Unsupported participant custody effect');
      assert.equal(unsigned(payload.participantCash), cash);
    } else if (event.kind === 'settlement' && payload.participant === input.capital) {
      const amount = unsigned(payload.amount);
      if (payload.kind === 0) { cash -= amount; virtual += amount * SCALE; collected += amount; }
      else if (payload.kind === 1) { cash += amount; virtual -= amount * SCALE; settled += amount; }
      else if (payload.kind === 2) { cash -= amount; withdrawn += amount; }
      else assert.fail('Unknown settlement kind');
      assert.equal(unsigned(payload.participantCash), cash); assert.equal(integer(payload.participantVirtual), virtual);
    } else assert(['oracle', 'maker', 'risk', 'order', 'custody', 'settlement'].includes(event.kind), 'Unsupported economic event; report would be incomplete');
    assert(cash >= 0n);
  }
  assert.equal(sequence, unsigned(input.closing.sequence), 'Missing closing history');
  accrue(integer(input.closing.fundingIndexScaled));
  const ending = input.closing.participant;
  const endingVirtual = integer(ending.virtualScaled) - integer(ending.lots) * (funding - integer(ending.fundingCheckpointScaled));
  assert.equal(lots, integer(ending.lots)); assert.equal(cash, unsigned(ending.cash)); assert.equal(virtual, endingVirtual);
  const fundedPnl = settled - collected;
  assert.equal(cash - unsigned(input.opening.participant.cash) - deposited + withdrawn + venueFees, fundedPnl);
  const openingClaim = markedClaim(input.opening.participant, input.opening), unpaid = markedClaim(ending, input.closing);
  const netPnl = unpaid === null || openingClaim === null ? null : (fundedPnl - venueFees) * SCALE + unpaid - openingClaim;
  const fees = input.transactions.filter(transaction => transaction.feePayer === input.owner)
    .reduce((sum, transaction) => sum + unsigned(transaction.feeLamports), 0n);
  return {
    schemaVersion: 1, operatorClass: input.operatorClass, independentMakerValidation: false,
    market: input.market, capital: input.capital, owner: input.owner,
    units: { quoteAtomsPerToken: '1000000', baseLotsPerBtc: '1000000', pnlScale: SCALE.toString(), networkFees: 'lamports' },
    sequence: { opening: input.opening.sequence, closing: input.closing.sequence },
    fills, makerFills, takerFills, filledLots: filledLots.toString(), grossNotionalAtoms: grossNotional.toString(),
    inventoryLots: lots.toString(), cashAtoms: cash.toString(), depositedAtoms: deposited.toString(), withdrawnAtoms: withdrawn.toString(),
    collectedLossAtoms: collected.toString(), settledGainAtoms: settled.toString(), fundedPnlAtoms: fundedPnl.toString(),
    unpaidPnlScaled: unpaid?.toString() ?? null, fundingPnlScaled: fundingPnl.toString(), venueFeesAtoms: venueFees.toString(),
    totalPnlBeforeNetworkAndHedgesScaled: netPnl?.toString() ?? null,
    valuation: { referenceAtomsPerLot: input.closing.referenceAtomsPerLot, referenceStatus: input.closing.referenceStatus,
      fundingBasis: 'finalized materialized index', staleValuationIsWithdrawableCash: false },
    networkFeesLamports: fees.toString(), networkFeeScope: 'provided finalized venue transactions, including failures; excludes setup/rent and unrelated wallet transactions',
    pendingFeeReservationLamports: unsigned(input.pendingFeeReservationLamports).toString(),
    hedge: { ...input.hedge, observedHedges: false, costAssumptionScaled: (grossNotional * hedgeBps * SCALE / 10_000n).toString(),
      basis: 'hypothetical proportional cost on every venue fill; excludes hedge slippage, financing and inventory basis', deductedFromReportedPnl: false },
    reconciliation: 'pass',
  };
}
