import assert from 'node:assert/strict';
import type { Address } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type { GroupTradingHarness } from './group-trading-cases.js';
import type { groupSafetyCases } from './group-safety-cases.js';
import type { groupDefaultCases } from './group-default-cases.js';

export async function groupEmergencyCases(h:GroupTradingHarness,lifecycle:Awaited<ReturnType<typeof groupSafetyCases>>,
  defaults:Awaited<ReturnType<typeof groupDefaultCases>>,capture:(label:string,keys:Address[])=>Promise<void>,
  options:{reactivate?:()=>Promise<void>;secondMarketExposure?:boolean}={}) {
  const {fixture,route,reject,protectedKeys,cashInstruction,certificate}=lifecycle;
  const {safety,sources,payer,owner,operators}=fixture;
  const {readResolution,page}=defaults;
  const previousEpoch=(await readResolution()).header.epoch;
  await h.send('fund root after resolved default',[await cashInstruction(operators[0].capital[0],1_000_000n,false)],[owner]);
  await fixture.qualify();
  await options.reactivate?.();
  await h.send('open real exposure before source outage',[(await route(0,0,[50n,50n])).instruction],[owner]);
  if(options.secondMarketExposure)await h.send('open ETH exposure before second-source outage',[(await route(1,0,[20n,30n])).instruction],[owner]);
  const freeze=async(caller=payer)=>sdk.getFreezeGroupV2Instruction({...safety,...sources,...await fixture.stamp(),caller,
    target:operators[0].capital[0],emergency:true});
  await reject('reject emergency freeze with credible sources',[await freeze()],[],sdk.CLEARING_ERROR__RESOLUTION);
  await h.advance(21n);
  if(options.secondMarketExposure)for(const index of [0,1,2,3])await fixture.publish(index);
  await reject('reject emergency freeze within source grace',[await freeze()],[],sdk.CLEARING_ERROR__RESOLUTION);
  await h.advance(30n);
  if(options.secondMarketExposure)for(const index of [0,1,2,3])await fixture.publish(index);
  await reject('reject foreign emergency freeze authority',[await freeze(owner)],[owner],sdk.CLEARING_ERROR__RESOLUTION);
  await h.send('authority freezes actual exposure after source grace',[await freeze()]);
  const waiting=(await readResolution()).header;
  assert.equal(waiting.epoch,previousEpoch+1n);assert.equal(waiting.stage,1);assert.deepEqual([...waiting.prices],[0n,0n]);
  await capture('await-valuation',protectedKeys());
  await reject('reject valuation page before both prices',[await page(waiting.epoch,2,0,1)],[],sdk.CLEARING_ERROR__RESOLUTION);
  const recover=(resume:boolean)=>sdk.getRecoverGroupResolutionV2Instruction({...safety,...sources,epoch:waiting.epoch,resume,caller:payer});
  for(const index of [0,1,2,3])await fixture.publish(index);
  await reject('reject partial price recovery',[recover(false)],[],sdk.CLEARING_ERROR__ORACLE_POLICY);
  for(const index of [4,5])await fixture.publish(index);
  await h.send('pin both recovered valuation prices atomically',[recover(false)]);
  const valued=(await readResolution()).header;assert.equal(valued.stage,2);assert.deepEqual([...valued.prices],[10_000n,40_000n]);
  assert.deepEqual(valued.funding,waiting.funding);
  await capture('frozen-emergency',protectedKeys());
  while((await readResolution()).header.stage<=11) {
    const current=(await readResolution()).header;
    await h.send('complete emergency cohort page',[await page(current.epoch,current.stage,current.cursor,Math.min(4,64-current.cursor))]);
  }
  assert.equal((await readResolution()).header.stage,12);
  await capture('complete-emergency',protectedKeys());
  for(let round=0;round<4;round++) {
    await h.advance(2n);for(let index=0;index<6;index++)await fixture.publish(index);
    await h.send('qualify all-market emergency recovery',[recover(false)]);
  }
  await h.send('resume complete emergency cohort',[recover(true)]);
  for(const index of [0,1])assert.equal((await fixture.marketState(index)).fundingIndexScaled,waiting.funding[index]);
  await capture('resumed-emergency',protectedKeys());
  // Complete-cohort flat exits remain possible with stale prices, without a
  // pretense that Normal trading/funding has already requalified after recovery.
  await h.advance(21n);await certificate();
  const cash=(await fixture.rootState(operators[0].capital[0])).cash;
  assert(cash>0n);await h.send('withdraw funded cash after emergency recovery',[await cashInstruction(operators[0].capital[0],cash,true)],[owner]);
  assert.equal((await fixture.rootState(operators[0].capital[0])).cash,0n);
  await capture('emergency-exit',protectedKeys());
}
