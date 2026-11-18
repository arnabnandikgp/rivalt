import {backingCheckpoint} from '../../sdk/src/backing-test-fixture.js';
import {expect,it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {accountTradeFixture} from '../../sdk/src/account-test-fixture.js';
import {accountClaimAmount,accountBackingCurrent} from './account-settlement-worker.js';

const SCALE=1_000_000_000n;
async function fixture(){const value=await accountTradeFixture();return {...value,snapshot:await sdk.readAccountSnapshot(value.rpc,value.config,[value.margins[0]],'confirmed')};}
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
it('backing hints survive observation/version churn but enforce required live sources and epochs',async()=>{
  const {snapshot,empty}=await fixture();
  const registry:sdk.VenueRegistry={...empty(sdk.getVenueRegistryDecoder()),schemaVersion:10,revision:1n,venue:snapshot.venue,
    nextId:2n,registeredCount:2n,financialCount:2n,membershipEpoch:4n,liveIndex:(await sdk.deriveMemberIndex(snapshot.venue,14,0n))[0]};
  const proof={...empty(sdk.getSettlementCertificateDecoder()),schemaVersion:10,venue:snapshot.venue,marketIndex:0,
    backingEpoch:7n,count:2n,next:2n,complete:true};
  const backing=snapshot.ledgerStates[0].backing={epoch:7n,safetyEpoch:2n,membershipEpoch:4n,termsEpoch:1n,configEpochs:[1n,1n],
    region:{prices:[[1n,1_000_000n],[1n,1_000_000n]],funding:[[0n,0n],[0n,0n]]},summary:backingCheckpoint()};
  expect(accountBackingCurrent(snapshot,registry,proof)).toBe(true);
  for(const market of snapshot.marketStates)market.observationSequence++;
  for(const ledger of snapshot.ledgerStates)ledger.liabilityVersion++;
  expect(accountBackingCurrent(snapshot,registry,proof)).toBe(true);
  backing.summary=backingCheckpoint(2n,0n,1);
  expect(accountBackingCurrent(snapshot,registry,proof)).toBe(true);
  snapshot.now+=21n;
  expect(accountBackingCurrent(snapshot,registry,proof)).toBe(false);
  expect(sdk.accountBackingStatus(snapshot,registry,proof)).toMatchObject({current:true,restart:false,sourcesCurrent:false});
  registry.membershipEpoch++;
  expect(sdk.accountBackingStatus(snapshot,registry,proof)).toMatchObject({current:false,restart:true});
});
