import { effectiveFunding, oracleMode, emptyOrderBook, orderReserve, reconcileResolution, resolutionBalance, getResolutionRowDecoder } from '@rivalt/sdk';
import { json,type Event } from './events.js';

export type Participant = { owner: string; id: number; cash: string; lots: string; virtualScaled: string;
  fundingCheckpointScaled: string; generation: string; nonce: string; reserved: string; orderIds: string[]; book:any };
export type State = { sequence: string; market: any | null; risk: any | null;
  participants: Record<string, Participant>; makers: Record<string, any>; resolution?: any | null };
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
      state.market = { mode: 0, fundingIndexScaled: '0', fundingTime:'0', grossLots: '0' };
    }
    const m = requireValue(state.market, 'market');
    for (const k of ['termsEpoch', 'configEpoch', 'totalCash', 'settlement', 'insurance', 'fees', 'allocatedVault', 'paused']) m[k] = e[k];
    if (e.kind === 1) {
      if (state.participants[e.participant]) throw new Error('Duplicate participant');
      const id = Object.keys(state.participants).length;
      if (id >= 64) throw new Error('Registry limit');
      state.participants[e.participant] = { owner: e.actor, id, cash: '0', lots: '0', virtualScaled: '0',
        fundingCheckpointScaled: '0', generation: '0', nonce: '0', reserved: '0', orderIds: ['0','0','0','0'],book:JSON.parse(json(emptyOrderBook())) };
    }
    if (e.participant !== zero) requireValue(state.participants[e.participant], 'participant').cash = e.participantCash;
  } else if (event.type === 'maker') {
    if (![0, 1, 2, 3].includes(e.kind)) throw new Error('Unknown maker operation');
    requireValue(state.participants[e.capital], 'capital');
    if (e.kind === 0) {
      if (state.makers[e.registration]) throw new Error('Duplicate maker');
      state.makers[e.registration] = { buyConsumed: '0', sellConsumed: '0' };
    }
    requireValue(state.market, 'market').configEpoch = e.configEpoch;
    const maker = requireValue(state.makers[e.registration], 'maker');
    for (const k of ['capital', 'makerId', 'authorityEpoch', 'quoteEpoch', 'quarantined', 'approvedHash']) maker[k] = e[k];
    if (e.kind === 2) maker.buyConsumed = maker.sellConsumed = '0';
  } else if (event.type === 'oracle') {
    const m = requireValue(state.market, 'market');
    m.mode = 2; m.termsEpoch=e.termsEpoch; m.configEpoch=e.configEpoch; m.fundingIndexScaled=e.fundingIndexScaled; m.fundingTime=e.fundingTime; state.risk=e;
  } else if (event.type === 'risk') {
    const m = requireValue(state.market, 'market');
    m.mode = 1; m.termsEpoch = e.termsEpoch; m.configEpoch = e.configEpoch; state.risk = e;
  } else if (event.type === 'liquidation' || event.type === 'resolution') {
    const m=requireValue(state.market,'market'),r=requireValue(state.risk,'risk');
    const updates=event.type==='liquidation'?[e.target,e.receiver]:e.participants;
    if(updates.length>(event.type==='liquidation'?2:4)||new Set(updates.map((x:any)=>x.participant)).size!==updates.length)throw new Error('Risk participant shape');
    for(const x of updates){const p=requireValue(state.participants[x.participant],'risk participant');
      if(p.id!==x.id)throw new Error('Risk participant identity');
      for(const k of ['cash','lots','virtualScaled','fundingCheckpointScaled','generation']) (p as any)[k]=x[k];
      if(event.type==='liquidation')for(const k of ['nonce','reserved','orderIds','book'])(p as any)[k]=x[k];
      else if(x.finalized){p.reserved='0';p.orderIds=['0','0','0','0'];
        for(const o of p.book.orders){if(o.state===1||o.state===2)o.state=6;o.reserve='0';}
        for(const g of p.book.groups)g.remaining='0';
      }
    }
    for(const k of ['termsEpoch','configEpoch','fundingIndexScaled','fundingTime','grossLots'])m[k]=e[k];
    r.grossLots=e.grossLots;
    if(event.type==='resolution'){
      if(![0,1,2,3].includes(e.kind))throw new Error('Unknown resolution operation');
      for(const k of ['mode','paused','totalCash','settlement','insurance','fees','allocatedVault'])m[k]=e[k];
      r.oracle=e.oracle;if(e.kind===3)r.validUntil='0';
      if(e.kind===0){
        if(e.header.count!==Object.keys(state.participants).length||e.header.epoch!==(BigInt(state.resolution?.header.epoch??0)+1n).toString())throw new Error('Resolution reset identity');
        const decoder=getResolutionRowDecoder();
        state.resolution={header:e.header,rows:Array.from({length:e.header.count},()=>JSON.parse(json(decoder.decode(new Uint8Array(decoder.fixedSize)))))};
      } else {
        const resolution=requireValue(state.resolution,'resolution');
        if(e.header.epoch!==resolution.header.epoch||e.header.count!==resolution.header.count)throw new Error('Resolution epoch/cohort mismatch');
        resolution.header=e.header;
      }
      if(e.rows.length>4||new Set(e.rows.map((x:any)=>x.id)).size!==e.rows.length)throw new Error('Resolution page shape');
      for(const x of e.rows){if(x.id<0||x.id>=e.header.count)throw new Error('Resolution member ID');state.resolution.rows[x.id]=x.row;}
    }
  } else if (event.type === 'order') {
    if(![0,1,2,3,4,5].includes(e.kind))throw new Error('Unknown order operation');
    const p=requireValue(state.participants[e.participant],'participant');
    Object.assign(p,{reserved:e.reserved,orderIds:e.orderIds,book:e.book});
  } else if (event.type === 'settlement') {
    if (![0, 1, 2].includes(e.kind)) throw new Error('Unknown settlement operation');
    const m = requireValue(state.market, 'market');
    const p = requireValue(state.participants[e.participant], 'participant');
    Object.assign(p, { cash: e.participantCash, virtualScaled: e.participantVirtual, fundingCheckpointScaled:e.fundingIndexScaled, reserved:e.participantReserved,orderIds:e.participantOrderIds,book:e.participantBook });
    m.fundingIndexScaled=e.fundingIndexScaled; m.fundingTime=e.fundingTime;
    Object.assign(m, { totalCash: e.totalCash, settlement: e.settlement, allocatedVault: e.allocatedVault });
  } else {
    const m = requireValue(state.market, 'market');
    const trader = requireValue(state.participants[e.trader], 'trader');
    if (e.nonce !== trader.nonce || ![0, 1].includes(e.side) || ![1, 2].includes(e.legs.length)) throw new Error('Route authority/shape mismatch');
    Object.assign(trader, { cash: e.traderCash, lots: e.traderLots, virtualScaled: e.traderVirtual,
      generation: e.traderGeneration, reserved:e.traderReserved,orderIds:e.traderOrderIds,book:e.traderBook,fundingCheckpointScaled:e.fundingIndexScaled, nonce: (BigInt(e.nonce) + 1n).toString() });
    for (const leg of e.legs) {
      const capital = requireValue(state.participants[leg.capital], 'capital');
      Object.assign(capital, { lots: leg.positionAfter, virtualScaled: leg.virtualAfter, generation: leg.generationAfter, reserved:leg.reservedAfter,orderIds:leg.orderIdsAfter,book:leg.bookAfter,fundingCheckpointScaled:e.fundingIndexScaled });
      const maker = requireValue(Object.values(state.makers).find(m => m.capital === leg.capital && m.makerId === leg.makerId), 'maker');
      maker[e.side === 0 ? 'buyConsumed' : 'sellConsumed'] = leg.consumedAfter;
    }
    m.fundingIndexScaled=e.fundingIndexScaled; m.fundingTime=e.fundingTime;
    m.totalCash = e.totalCash; m.fees = e.totalFees; m.grossLots = e.grossLots;
  }
  state.sequence = e.sequence;
  const m = state.market;
  if (m && BigInt(m.allocatedVault) !== BigInt(m.totalCash) + BigInt(m.settlement) + BigInt(m.insurance) + BigInt(m.fees)) throw new Error('Cash conservation failure');
  const participants = Object.values(state.participants);
  for(const p of participants){
    if(!p.book||p.book.orders.length!==4||p.book.groups.length!==2)throw new Error('Missing bounded order state');
    let reserve=0n;
    p.book.orders.forEach((o:any,i:number)=>{const active=o.state===1||o.state===2;
      if(p.orderIds[i]!== (active?o.id:'0') || (!active&&BigInt(o.reserve)!==0n))throw new Error('Order slot/reserve mismatch');
      if(active){if(BigInt(o.filled)>=BigInt(o.lots)||BigInt(o.feeCharged)!==(BigInt(o.notional)+4999n)/5000n)throw new Error('Order prefix mismatch');reserve+=BigInt(o.reserve);}
    });
    if(reserve!==BigInt(p.reserved))throw new Error('Order reservation mismatch');
  }
  if (m && participants.reduce((n, p) => n + BigInt(p.cash), 0n) !== BigInt(m.totalCash)) throw new Error('Participant cash mismatch');
  if(m?.mode===3){reconcileResolution(m,state.risk,state.participants,state.resolution);return;}
  if (participants.reduce((n, p) => n + BigInt(p.lots), 0n) !== 0n) throw new Error('Net position mismatch');
  if (m && participants.reduce((n,p) => n + BigInt(p.virtualScaled) + BigInt(p.lots)*BigInt(p.fundingCheckpointScaled),0n) !== BigInt(m.settlement)*1_000_000_000n) throw new Error('Claims conservation failure');
}

export function balance(p: Participant, state: State, slot: bigint, now=BigInt(Math.floor(Date.now()/1000))) {
  if(state.market?.mode===3){
    const resolution=resolutionBalance(p,state.resolution);
    return {...p,resolution,unpaidPnlScaled:resolution.paymentApplied?'0':resolution.claimAfterCollectionScaled,negativeUnpaidLiability:null,
      riskEquity:null,initialMargin:null,positiveUnpaidMarginCredit:'0',withdrawableCash:'0',
      exitRequirement:'CompleteCohortResolutionAndAuthorizedRecovery',settlementAvailable:'0',currentRequiredReserve:'0',
      fundingIndexScaled:state.market.fundingIndexScaled,sourceMode:'Frozen',valuationStatus:resolution.valued?'PinnedResolutionValuation':'AwaitingCohortValuation',evaluatedAtSlot:slot.toString()};
  }
  const q = BigInt(p.lots), f = effectiveFunding(state.market,state.risk,now,slot), v = BigInt(p.virtualScaled)-q*(f-BigInt(p.fundingCheckpointScaled)), cash = BigInt(p.cash), scale = 1_000_000_000n;
  const risk = state.risk;
  const mode=oracleMode(state.market,risk,now,slot);
  const fresh = mode !== 'NoCredibleBounds';
  const unpaid = risk ? v + q * BigInt(risk.referencePrice) * scale : q === 0n ? v : null;
  const adverse = risk ? v + q * BigInt(q >= 0n ? risk.lower : risk.upper) * scale : q === 0n ? v : null;
  const liability = adverse === null ? null : adverse < 0n ? (-adverse + scale - 1n) / scale : 0n;
  const im = risk ? ((q < 0n ? -q : q) * BigInt(risk.upper) + 9n) / 10n : q === 0n ? 0n : null;
  return { ...p, unpaidPnlScaled: unpaid?.toString() ?? null, negativeUnpaidLiability: liability?.toString() ?? null,
    riskEquity: liability === null ? null : (cash - liability).toString(), initialMargin: im?.toString() ?? null,
    positiveUnpaidMarginCredit: '0', withdrawableCash: state.market?.mode === 0 && !state.market.paused ? p.cash : '0',
    exitRequirement: state.market?.mode > 0 ? 'FreshCompleteCohortCertificateAndPostWithdrawalMargin' : null,
    settlementAvailable: state.market?.settlement ?? '0',
    currentRequiredReserve:orderReserve(p,BigInt(state.market?.termsEpoch??1),slot,fresh?BigInt(risk.lower):1n,fresh?BigInt(risk.upper):1_000_000n).toString(),
    fundingIndexScaled:f.toString(), sourceMode:mode,
    valuationStatus: risk ? fresh ? state.market?.mode===2 ? 'ControlledLocalOracle' : 'FreshTestObservation' : 'ExpiredTestObservation' : 'NoObservation',
    evaluatedAtSlot: slot.toString() };
}
