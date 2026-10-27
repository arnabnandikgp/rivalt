import {it,expect} from 'vitest';
import {AccountRuntime} from './account-runtime.js';
import {accountTradeFixture} from '../../sdk/src/account-test-fixture.js';
import {readAccountTradeSnapshot} from '@rivalt/sdk';

it('classifies actual maker expiry and unsynchronized renewal without admitting stale quotes',async()=>{
  const fixture=await accountTradeFixture();
  const snapshot=await readAccountTradeSnapshot(fixture.rpc,fixture.config,fixture.margins[0],0);
  const runtime=new AccountRuntime('postgres://unused','quote-test','http://127.0.0.1:1');
  runtime.snapshot=async()=>snapshot as Awaited<ReturnType<AccountRuntime['snapshot']>>;
  runtime.heartbeats=async()=>snapshot.makers.map(maker=>({market_index:0,maker_id:maker.makerId,registration:maker.registration,
    owner:maker.registrationState.owner,online:true}));
  for(const maker of snapshot.makers)maker.state.expirySlot=snapshot.slot;
  await expect(runtime.quote(fixture.owner,fixture.margins[0],0,0,1n)).rejects.toMatchObject({code:'market-makers-renewing'});
  for(const maker of snapshot.makers){maker.state.expirySlot=snapshot.slot+100n;maker.synchronized=false;}
  await expect(runtime.quote(fixture.owner,fixture.margins[0],0,0,1n)).rejects.toMatchObject({code:'market-makers-renewing'});
  for(const maker of snapshot.makers)maker.approved=false;
  await expect(runtime.quote(fixture.owner,fixture.margins[0],0,0,1n)).rejects.toMatchObject({code:'market-maker-admission-unavailable'});
  runtime.heartbeats=async()=>[];
  await expect(runtime.quote(fixture.owner,fixture.margins[0],0,0,1n)).rejects.toMatchObject({code:'market-makers-offline'});
  await runtime.close();
});
