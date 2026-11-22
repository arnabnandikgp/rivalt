import {expect,it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {accountFixture,accountTradeFixture} from '../../sdk/src/account-test-fixture.js';
import {accountAuthorityValue,type AccountAuthority} from './account-authority.js';
import {accountBudget} from './account-execution.js';

it('authenticates a canonical root state version without a global custody stamp',async()=>{
  const fixture=await accountFixture(),account=fixture.margins[0];
  const bytes=Buffer.from(fixture.accounts.get(account).data[0],'base64');
  const authority:AccountAuthority={kind:'accountStateVersion',venue:fixture.config.venue,account,value:'9'};
  expect(await accountAuthorityValue(authority,bytes)).toBe(9n);
  await expect(accountAuthorityValue({...authority,account:fixture.margins[1]},bytes)).rejects.toThrow(/binding/);
  await expect(accountAuthorityValue({...authority,venue:fixture.owner},bytes)).rejects.toThrow(/binding/);
  const membershipBytes=sdk.getMarginAccountEncoder().encode({...sdk.getMarginAccountDecoder().decode(bytes),revision:47n});
  const membership={...authority,kind:'accountRevision'} as const;
  expect(await accountAuthorityValue(membership,Buffer.from(membershipBytes))).toBe(47n);
  await expect(accountAuthorityValue({...membership,account:fixture.margins[1]},Buffer.from(membershipBytes))).rejects.toThrow(/binding/);
  bytes[0]^=1;await expect(accountAuthorityValue(authority,bytes)).rejects.toThrow(/schema/);
});
it('keeps selected-market sampling and maker epoch proofs distinct and canonical',async()=>{
  const fixture=await accountTradeFixture(),venue=fixture.config.venue,market=fixture.marketPdas[0][0],maker=fixture.makers[0];
  const sample:AccountAuthority={kind:'accountObservation',venue,account:market,value:'0'};
  expect(await accountAuthorityValue(sample,Buffer.from(fixture.accounts.get(market).data[0],'base64'))).toBe(0n);
  const makerBytes=Buffer.from(fixture.accounts.get(maker.registration).data[0],'base64');
  await expect(accountAuthorityValue({kind:'accountMakerEpoch',venue,account:maker.registration,value:'1'} as unknown as AccountAuthority,makerBytes)).rejects.toThrow(/Unknown/);
  await expect(accountAuthorityValue(sample,makerBytes)).rejects.toThrow(/schema/);
});
it('separates all market/maker lamport budgets and rejects scope aliasing',()=>{
  const names=[0,1].flatMap(market=>[0,1,2].map(maker=>accountBudget('maker',market,maker).name));
  expect(new Set(names).size).toBe(6);expect(accountBudget('maker',1,0).cap).toBe(1_000_000n);
  expect(accountBudget('funding',0).name).not.toBe(accountBudget('funding',1).name);
  expect(accountBudget('risk')).toEqual({name:'liquidity-risk',cap:5_000_000n});
  expect(()=>accountBudget('maker',2,0)).toThrow(/Market/);expect(()=>accountBudget('orders',0)).toThrow(/Invalid/);
});

it('uses the executor deployment layout for expired market and margin originals',async()=>{
  const fixture=await accountFixture(),venue=fixture.config.venue;
  const market=fixture.marketPdas[0][0],account=fixture.margins[0];
  const marketPrefix=Buffer.from(fixture.accounts.get(market).data[0],'base64');
  const marketBytes=Buffer.concat([marketPrefix,Buffer.alloc(48)]);
  const observation:AccountAuthority={kind:'accountObservation',venue,account:market,value:'0'};
  expect(await accountAuthorityValue(observation,marketBytes,'ledger-lanes')).toBe(sdk.getMarketDecoder().decode(marketPrefix).observationSequence);
  await expect(accountAuthorityValue(observation,marketBytes,'selected')).rejects.toThrow();
  await expect(accountAuthorityValue(observation,marketPrefix,'ledger-lanes')).rejects.toThrow();
  await expect(accountAuthorityValue({...observation,account},marketBytes,'ledger-lanes')).rejects.toThrow(/binding/);

  const prefix=Buffer.from(fixture.accounts.get(account).data[0],'base64');
  const marginBytes=Buffer.concat([prefix,Buffer.from('RVPROF01'),Buffer.alloc(256)]);
  const revision:AccountAuthority={kind:'accountRevision',venue,account,value:'0'};
  expect(await accountAuthorityValue(revision,marginBytes,'ledger-lanes')).toBe(sdk.getMarginAccountDecoder().decode(prefix).revision);
  await expect(accountAuthorityValue(revision,marginBytes,'selected')).rejects.toThrow();
  await expect(accountAuthorityValue(revision,prefix,'ledger-lanes')).rejects.toThrow();
});
