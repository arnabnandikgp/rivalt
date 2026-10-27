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
  root.positions[0].virtualScaled=1n;expect(view()).toMatchObject({withdrawalStatus:'TerminalAccountNotSettled',indicativeCashHeadroom:null});
  snapshot.safetyState.paused=true;expect(view().withdrawalStatus).toBe('Paused');
});
