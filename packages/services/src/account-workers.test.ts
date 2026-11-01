import {expect,it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {accountFixture} from '../../sdk/src/account-test-fixture.js';
import {accountClaimAmount,accountBackingCurrent} from './account-settlement-worker.js';
import {accountRemainderOrders} from './account-worker-state.js';

const SCALE=1_000_000_000n;
async function fixture(){const value=await accountFixture();return {...value,snapshot:await sdk.readAccountSnapshot(value.rpc,value.config,[value.margins[0]],'confirmed')};}
it('collects whole atoms only when funded cash covers both gross debts, without positive-claim credit',async()=>{
  const {snapshot,margins}=await fixture(),root=snapshot.roots[margins[0]];root.cash=100n;
  root.positions[0].virtualScaled=-80n*SCALE-1n;root.positions[1].virtualScaled=-20n*SCALE;
  expect(accountClaimAmount(snapshot,margins[0],0,false)).toBe(0n);
  root.cash=101n;expect(accountClaimAmount(snapshot,margins[0],0,false)).toBe(80n);
  root.cash=1n;root.positions[1].virtualScaled=1_000n*SCALE;
  expect(accountClaimAmount(snapshot,margins[0],0,false)).toBe(0n);
});
it('pays only the selected funded pool, respects full-account health and preserves fractional claims',async()=>{
  const {snapshot,margins}=await fixture(),root=snapshot.roots[margins[0]];root.cash=5n;
  root.positions[0].virtualScaled=10n*SCALE+7n;root.positions[1].virtualScaled=-20n*SCALE;
  snapshot.ledgerStates[0].settlement=10n;snapshot.ledgerStates[1].settlement=100n;
  expect(accountClaimAmount(snapshot,margins[0],0,true)).toBe(0n);
  root.positions[1].virtualScaled=0n;snapshot.ledgerStates[0].settlement=3n;
  expect(accountClaimAmount(snapshot,margins[0],0,true)).toBe(3n);
  expect(root.positions[0].virtualScaled).toBe(10n*SCALE+7n);
  snapshot.safetyState.paused=true;expect(accountClaimAmount(snapshot,margins[0],0,true)).toBe(0n);
});
it('backing stamps follow the selected liability and only required source dependencies',async()=>{
  const {snapshot,empty,margins}=await fixture();
  const registry:sdk.VenueRegistry={discriminator:sdk.VENUE_REGISTRY_DISCRIMINATOR,schemaVersion:7,revision:1n,venue:snapshot.venue,bump:0,members:margins,count:2,membershipVersion:4n};
  const proof={...empty(sdk.getSettlementCertificateDecoder()),marketIndex:0,safetyEpoch:2n,membershipVersion:4n,count:2,
    liabilityVersion:1n,requiredMarketMask:0};
  expect(accountBackingCurrent(snapshot,registry,proof)).toBe(true);
  snapshot.ledgerStates[1].liabilityVersion++;snapshot.marketStates[1].observationSequence++;
  expect(accountBackingCurrent(snapshot,registry,proof)).toBe(true);
  snapshot.ledgerStates[0].liabilityVersion++;expect(accountBackingCurrent(snapshot,registry,proof)).toBe(false);
  snapshot.ledgerStates[0].liabilityVersion--;proof.requiredMarketMask=1;
  expect(accountBackingCurrent(snapshot,registry,proof)).toBe(false);
});
it('orders creditor remainders exactly with stable registry ties, including values beyond Number precision',async()=>{
  const {empty}=await fixture(),denominator=1n<<200n;
  const rows=Array.from({length:4},()=>empty(sdk.getResolutionPageDecoder()).rows[0]);
  const remainders=[denominator-1n,denominator-2n,denominator-1n,denominator-1n];
  for(const [index,row] of rows.entries()) {
    row.claimsScaled=[index===3?-1n:1n,index===0?0n:1n];row.roundedFlows=[2n,0n];
    for(const market of [0,1]) {
      let value=market===0?2n*denominator+remainders[index]:BigInt(index);
      for(let limb=0;limb<96;limb++){row.exactFlowNumerators[market].limbs[limb]=value&((1n<<64n)-1n);value>>=64n;}
    }
  }
  expect(accountRemainderOrders(rows,denominator)).toEqual([[0,2,1,3],[3,2,1,0]]);
  rows[0].roundedFlows[0]=1n;expect(()=>accountRemainderOrders(rows,denominator)).toThrow(/remainder/);
});
