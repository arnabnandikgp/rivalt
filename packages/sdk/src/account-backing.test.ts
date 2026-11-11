import {expect,it} from 'vitest';
import * as sdk from './index.js';
import {accountTradeFixture} from './account-test-fixture.js';
import {backingCheckpoint} from './backing-test-fixture.js';

async function fixture() {
  const test=await accountTradeFixture(),snapshot=await sdk.readAccountSnapshot(test.rpc,test.config,[test.margins[0]],'confirmed');
  const registry={...test.empty(sdk.getVenueRegistryDecoder()),schemaVersion:10,venue:snapshot.venue,financialCount:2n,membershipEpoch:4n};
  const proof={...test.empty(sdk.getSettlementCertificateDecoder()),schemaVersion:10,venue:snapshot.venue,
    backingEpoch:7n,count:2n,next:2n,complete:true};
  const backing=snapshot.ledgerStates[0].backing={epoch:7n,safetyEpoch:2n,membershipEpoch:4n,termsEpoch:1n,configEpochs:[1n,1n],
    region:{prices:[[9800n,10200n],[9800n,10200n]],funding:[[-1n,1n],[-1n,1n]]},summary:backingCheckpoint(2n,0n,1)};
  return {snapshot,registry,proof,backing};
}
it('decodes exact signed quantities and full-width totals with bounded malformed rejection',()=>{
  const bytes=backingCheckpoint((1n<<64n)-1n);
  // Equal +/- 2^128 totals, which cannot fit u128, still sum within count*bound.
  bytes.writeBigUInt64LE(1n,56);bytes.writeBigUInt64LE(1n,80);bytes.fill(255,24,40);
  expect(sdk.decodeBackingSummary(bytes)).toMatchObject({quantity:-1n,positive:1n<<128n,negative:1n<<128n});
  for(const mutate of [(b:Buffer)=>{b[0]=0;},(b:Buffer)=>{b.writeBigUInt64LE(0n,8);},
    (b:Buffer)=>{b.fill(255,40,88);},(b:Buffer)=>{b.writeBigUInt64LE(3n,16);}]) {
    const bad=backingCheckpoint();mutate(bad);
    if(bad.readBigUInt64LE(8)===0n)bad.writeBigUInt64LE(1n,88);
    expect(()=>sdk.decodeBackingSummary(bad)).toThrow();
  }
});
it('separates live-source availability, conservative-region validity and funded payment readiness',async()=>{
  const {snapshot,registry,proof,backing}=await fixture();
  expect(sdk.accountBackingStatus(snapshot,registry,proof)).toMatchObject({current:true,restart:false,payable:true});
  backing.summary=backingCheckpoint(2n,0n,1,1n);
  expect(sdk.accountBackingStatus(snapshot,registry,proof)).toMatchObject({current:true,restart:false,payable:false});
  backing.summary=backingCheckpoint(2n,0n,1);
  snapshot.ledgerStates[0].settlement=1n;
  expect(sdk.accountBackingStatus(snapshot,registry,proof).payable).toBe(false);
  snapshot.ledgerStates[0].settlement=0n;snapshot.now=521n;
  expect(sdk.accountBackingStatus(snapshot,registry,proof)).toMatchObject({current:true,restart:false,sourcesCurrent:false,payable:false});
  snapshot.now=500n;snapshot.marketStates[0].upper=10201n;
  expect(sdk.accountBackingStatus(snapshot,registry,proof)).toMatchObject({current:false,restart:true,payable:false});
});
it('tracks all held endpoints and unseen partial dependencies without restarting on unrelated completed inputs',async()=>{
  const {snapshot,registry,proof}=await fixture();
  snapshot.marketStates[1].upper=20000n;
  expect(sdk.accountBackingStatus(snapshot,registry,proof).restart).toBe(false);
  proof.complete=false;expect(sdk.accountBackingStatus(snapshot,registry,proof).restart).toBe(true);
  snapshot.marketStates[1].upper=10100n;
  snapshot.marketStates[0].oracle.premiumScaled=3600n;
  // Effective funding is zero at sample time; held endpoint is six scaled units.
  expect(sdk.effectiveAccountFunding(snapshot.safetyState,snapshot.marketStates[0],snapshot.now,snapshot.slot)).toBe(0n);
  expect(sdk.accountBackingStatus(snapshot,registry,proof).restart).toBe(true);
});
