import {expect,it} from 'vitest';
import * as sdk from './index.js';
import {accountFixture} from './account-test-fixture.js';

const scale=1_000_000_000n;
async function fixture() {
  const environment=await accountFixture(),snapshot=await sdk.readAccountSnapshot(environment.rpc,environment.config,[environment.margins[0]]);
  const root=snapshot.roots[environment.margins[0]];root.cash=1000n;
  snapshot.now=100n;snapshot.slot=10n;
  for(const market of snapshot.marketStates) {
    Object.assign(market,{referencePrice:100n,lower:100n,upper:100n,validFrom:1n,validUntil:1000n});
    Object.assign(market.oracle,{status:2,sampledAt:100n,sourceDeadline:120n,lastQualified:100n,
      heldEpoch:1n,heldUntil:106n,heldSlot:1000n,fundingBase:0n,premiumScaled:0n});
  }
  const view=()=>sdk.accountBalanceView(root,snapshot.safetyState,snapshot.marketStates,snapshot.now,snapshot.slot);
  return {root,snapshot,view};
}
it('values one funded cash balance and negative claims without unpaid profit offsets',async()=>{
  const {root,view}=await fixture();
  Object.assign(root.positions[0],{lots:1n,virtualScaled:200n*scale});
  Object.assign(root.positions[1],{lots:2n,virtualScaled:-400n*scale});
  expect(view()).toMatchObject({riskEquityScaled:'800000000000',initialMargin:'30',maintenanceMargin:'15',
    positiveUnpaidMarginCredit:'0',correlationDiscount:'0',indicativeCashHeadroom:'770',withdrawableCash:null,
    withdrawalStatus:'RequiresAtomicAccountChecksAndSimulation'});
});
it('tests all four held-funding corners instead of just both diagonal endpoints',async()=>{
  const {root,snapshot,view}=await fixture();
  Object.assign(root.positions[0],{lots:1n,virtualScaled:-100n*scale});
  Object.assign(root.positions[1],{lots:-1n,virtualScaled:-500n*scale});
  snapshot.marketStates.forEach(market=>market.oracle.premiumScaled=360_000n*scale);
  // Current claims [0,-600], end/end [-600,0]: either diagonal equity=400.
  // BTC=end, ETH=current => [-600,-600], hence equity=-200 and no exit headroom.
  const before=structuredClone(root);
  expect(view()).toMatchObject({riskEquityScaled:'400000000000',localCashHeadroom:'380',
    heldRiskEquityScaled:'-200000000000',indicativeCashHeadroom:'0',heldFundingBoundsScaled:[['0','600000000000'],['0','600000000000']]});
  expect(root).toEqual(before);
});
it('includes pending fractional funding and rounds cash capacity downward',async()=>{
  const {root,snapshot,view}=await fixture();
  Object.assign(root.positions[1],{lots:1n,virtualScaled:-100n*scale});snapshot.marketStates[1].oracle.premiumScaled=360n*scale;snapshot.now=101n;
  expect(view()).toMatchObject({riskEquityScaled:'999900000000',heldRiskEquityScaled:'999400000000',indicativeCashHeadroom:'989'});
  expect(view().positions[1].pendingFundingDebitScaled).toBe('100000000');
  snapshot.marketStates[1].configEpoch=2n;
  expect(view().positions[1].pendingFundingDebitScaled).toBe('0');
});
it('requires sources for live reservations even with zero positions, but permits flat stale exits',async()=>{
  const {root,snapshot,view}=await fixture(),stored=root.book.orders[0];
  stored.marketIndex=1;Object.assign(stored.order,{id:1n,state:1,termsEpoch:1n,expirySlot:100n,lots:1n,limit:110n,feeBudget:5n});
  expect(view().reserved).toBe('25');snapshot.now=120n;
  expect(view()).toMatchObject({withdrawalStatus:'RequiredSourceUnavailable',indicativeCashHeadroom:null});
  snapshot.slot=100n;
  expect(view()).toMatchObject({reserved:'0',indicativeCashHeadroom:'1000',withdrawalStatus:'RequiresAtomicAccountChecksAndSimulation'});
});
it('removes expired delegated/protection reserves and rejects foreign isolated exposure',async()=>{
  const {root,snapshot,view}=await fixture(),stored=root.book.orders[0];
  root.delegate=root.owner;root.delegateExpirySlot=20n;root.delegateEpoch=2n;
  stored.delegateEpoch=2n;stored.marketIndex=1;Object.assign(stored.order,{state:1,termsEpoch:1n,expirySlot:100n,lots:1n,limit:110n,feeBudget:5n});
  expect(view().reserved).toBe('25');snapshot.slot=20n;expect(view().reserved).toBe('0');
  root.mode=1;root.isolatedMarketIndex=0;root.positions[1].virtualScaled=1n;
  expect(view).toThrow(/Foreign isolated/);
});
it('labels pause/freeze/terminal states without inventing spendable claims',async()=>{
  const {root,snapshot,view}=await fixture();
  snapshot.safetyState.mode=2;expect(view()).toMatchObject({withdrawalStatus:'FrozenResolution',indicativeCashHeadroom:null});
  snapshot.safetyState.mode=3;snapshot.now=1000n;
  expect(view()).toMatchObject({indicativeCashHeadroom:'1000'});
  root.book.orders[0].order.state=1; // Even an expired live record must be cleared by resolution.
  expect(view()).toMatchObject({withdrawalStatus:'TerminalAccountNotSettled',indicativeCashHeadroom:null});
  root.book.orders[0].order.state=0;root.reserved=1n;
  expect(view().withdrawalStatus).toBe('TerminalAccountNotSettled');root.reserved=0n;
  root.positions[0].virtualScaled=1n;expect(view()).toMatchObject({withdrawalStatus:'TerminalAccountNotSettled',indicativeCashHeadroom:null});
  snapshot.safetyState.paused=true;expect(view().withdrawalStatus).toBe('Paused');
});

it('describes ordinary settlement from the flat claim and the shared pool in whole atoms',()=>{
  const normal={mode:1,paused:false};
  const position={lots:'0',unpaidClaimScaled:'3000000001'};
  expect(sdk.closedGainStatus(position,0n,normal)).toBe('Awaiting loss collection');
  expect(sdk.closedGainStatus(position,2n,normal)).toBe('Market pool covers part of this claim');
  expect(sdk.closedGainStatus(position,3n,normal)).toBe('Awaiting verified payment');
  expect(sdk.closedGainStatus({...position,unpaidClaimScaled:'1'},0n,normal)).toBe('Below one payable atom');
  expect(sdk.closedGainStatus(position,3n,{mode:2,paused:true})).toBe('Ordinary settlement suspended');
  for(const claim of [null,'0','-1'])expect(sdk.closedGainStatus({...position,unpaidClaimScaled:claim},0n,normal)).toBeNull();
  expect(sdk.closedGainStatus({...position,lots:'1'},0n,normal)).toBeNull();
});

it('separates eligible fixed claims from open price gain on both sides',()=>{
  const scale=1_000_000_000n;
  const long={entryScaled:301n*scale,paidScaled:0n,denominator:3n};
  // Long basis 100 1/3, two surviving lots at 102. Five total atoms include 3 1/3 open.
  expect(sdk.ordinaryGainAtoms(5n*scale,2n,102n,long)).toBe(1n);
  expect(sdk.ordinaryGainAtoms(5n*scale,-2n,99n,long)).toBe(2n);
  expect(sdk.ordinaryGainAtoms(scale,-2n,102n,long)).toBe(1n);
  expect(sdk.ordinaryGainAtoms(-scale,2n,99n,long)).toBe(0n);
  expect(sdk.closedGainStatus({lots:'2',unpaidClaimScaled:'5000000000',ordinaryPayableAtoms:'1'},1n,
    {mode:1,paused:false})).toBe('Awaiting verified payment');
});

it('binds fresh margin history to its payout rule and rejects previously paid open gain',async()=>{
  const {root}=await fixture();
  const prefix=Buffer.from(sdk.getMarginAccountEncoder().encode(root));
  const margin=(tag:string)=>Buffer.concat([prefix,Buffer.from(tag),Buffer.alloc(256)]);
  expect(sdk.decodeProfitAttribution(margin('RVPROF01')).closedQuantity).toBe(false);
  expect(sdk.decodeProfitAttribution(margin('RVPROF02')).closedQuantity).toBe(true);
  expect(()=>sdk.decodeProfitAttribution(margin('RVPROF03'))).toThrow();
  root.positions[0].lots=1n;
  const entryWithPriorPayment=Buffer.alloc(256);
  entryWithPriorPayment.set([1,0,1,0,1,0,10,2,1]); // entry=10, paid=2, denominator=1
  const encoded=Buffer.from(sdk.getMarginAccountEncoder().encode(root));
  expect(()=>sdk.decodeProfitAttribution(Buffer.concat([encoded,Buffer.from('RVPROF02'),entryWithPriorPayment]))).toThrow(/Open price payment/);
});

it('decodes opposite conservative endpoints from each fixed-width market record', async()=>{
  const {root}=await fixture();
  const scale=1_000_000_000n;
  root.positions[0].lots=4n;
  root.positions[1].lots=-4n;
  const base=Buffer.from(sdk.getMarginAccountEncoder().encode(root));
  const records=Buffer.alloc(80),center=400n*scale;
  for(const offset of [0,40]) {
    records.writeBigUInt64LE(center-1n,offset);
    records.writeBigUInt64LE(center+1n,offset+16);
    records.writeBigUInt64LE(4n,offset+32);
  }
  const margin=()=>Buffer.concat([base,Buffer.from('RVPROF03'),records]);
  const decoded=sdk.decodeProfitAttribution(margin());
  expect(decoded.width).toBe(40);
  expect(decoded.credit).toBeNull();
  expect(decoded.entryBounds?.[0]).toEqual({lower:center-1n,upper:center+1n,referenceLots:4n});
  expect(decoded.ordinaryPositions.map(entry=>entry.entryScaled)).toEqual([center-1n,center+1n]);
  expect(decoded.positions.map(entry=>entry.entryScaled)).toEqual([center+1n,center-1n]);
  expect(sdk.ordinaryGainAtoms(36n*scale,4n,102n,decoded.ordinaryPositions[0])).toBe(27n);
  records.writeBigUInt64LE(1n,32);
  expect(()=>sdk.decodeProfitAttribution(margin())).toThrow(/Invalid bounded entry/);
  records.writeBigUInt64LE(4n,32);
  records.writeBigUInt64LE(center+8n,16);
  expect(()=>sdk.decodeProfitAttribution(margin())).toThrow(/Invalid bounded entry/);
  expect(()=>sdk.decodeProfitAttribution(margin().subarray(0,-1))).toThrow();
});

it('decodes a fractional listed-market debt and refuses a two-market view of it',async()=>{
  const {root}=await fixture();
  Object.assign(root,{mode:0,role:0,isolatedMarketIndex:255});
  const prefix=Buffer.concat([Buffer.from(sdk.getMarginAccountEncoder().encode(root)),Buffer.from('RVPROF03'),Buffer.alloc(80)]);
  const directory=Buffer.alloc(18+6*98);
  directory.write('RVMKTS01');
  const bytes=()=>Buffer.concat([prefix,directory]);
  expect(sdk.decodeListedMargin(bytes()).capacity).toBe(6);
  expect(sdk.decodeProfitAttribution(bytes()).root.cash).toBe(root.cash);
  directory.writeBigUInt64LE(3n,8);
  directory.writeUInt16LE(1,16);
  directory.writeUInt16LE(65535,18);
  directory.writeBigUInt64LE(3n,20);
  directory.fill(255,36,52); // -1 scaled atom
  expect(sdk.decodeListedMargin(bytes()).records[0]).toMatchObject({market:65535,incarnation:3n,lots:0n,virtualScaled:-1n});
  const occupied=directory.subarray(0,18+98);
  expect(sdk.decodeListedRecords(occupied,6,true).records).toEqual(sdk.decodeListedMargin(bytes()).records);
  expect(()=>sdk.decodeListedRecords(occupied.subarray(0,-1),6,true)).toThrow();
  expect(()=>sdk.decodeListedRecords(directory,6,true)).toThrow();
  expect(()=>sdk.decodeProfitAttribution(bytes())).toThrow(/two-market reader/);
  directory.writeUInt16LE(1,18);
  expect(()=>sdk.decodeListedMargin(bytes())).toThrow();
  directory.writeUInt16LE(258,18);
  directory[directory.length-1]=1;
  expect(()=>sdk.decodeListedMargin(bytes())).toThrow();
});
