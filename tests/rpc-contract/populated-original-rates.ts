// Verify the wide original settlement on signed frozen pages before selection.
import assert from 'node:assert/strict';
import {AccountRole, type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {qualifySettlementRates} from './scalable-settlement-rates-rpc.js';
import {denominatorPages} from './settlement-page-plan.js';

import {verifyWinnerAllocations,type WinnerReference} from './populated-winner-allocations.js';
import {verifyForeignProtection,type ProtectionReference} from './foreign-protection-scan.js';

export async function verifyPopulatedOriginalRates(
  h: CanonicalHarness, setup: Awaited<ReturnType<typeof liquidityExecutionSetup>>,
  rows: {cash:bigint;claims:bigint[]}[], members: Address[], expectedCommon: bigint, expectedBudgets?:bigint[][], protection?:ProtectionReference, winners?:WinnerReference[],
) {
  const [prepared] = await sdk.deriveSettlementWorkspace(setup.venue, 'prepared');
  const header = async () => sdk.getPreparedSettlementDecoder().decode((await h.read(prepared))!);
  const initial = await header();
  const common = {...setup.safetyCommon, prepared, epoch:initial.epoch};
  const pages = await Promise.all(Array.from({length:Math.ceil(rows.length/8)}, async (_, index) =>
    (await sdk.deriveFrozenMarginPage(setup.venue, BigInt(index)))[0]));
  const financial = [setup.resolution, ...members, ...pages];
  const readAll = (keys:Address[]) => Promise.all(keys.map(key => h.read(key)));
  const before = await readAll(financial);
  const limbs: Address[] = [];
  for (let register=0; register<3; register++) {
    const [page] = await sdk.deriveSettlementLimbPage(setup.venue, register, 0n);
    limbs.push(page);
    await h.send('initialize original denominator register',[sdk.getInitializeSettlementLimbPageInstruction({
      ...common, page, register, pageIndex:0n})]);
  }
  let accepted=0, continuations=0;
  for (let state=await header(); state.stage===20; state=await header()) {
    const work = Buffer.from(state.state.denominator);
    if (work[1]===1) {
      assert.equal(work.readBigUInt64LE(16), BigInt(accepted));
      await h.send('verify original denominator row',[sdk.getAcceptDenominatorRowInstruction({
        ...common, revision:state.revision, page:pages[Math.floor(accepted/8)]})]);
      accepted++;
    } else {
      const requests=denominatorPages(work);
      assert(requests.every(request=>request.index===0n),'fixture denominator exceeds its first register page');
      const revisions=await Promise.all(requests.map(async request =>
        sdk.getSettlementLimbPageDecoder().decode((await h.read(limbs[request.register]))!).revision));
      while(revisions.length<3)revisions.push(0n);
      const ix=sdk.getContinueSettlementDenominatorInstruction({...common,revision:state.revision,steps:128,revisions});
      await h.send('verify original denominator words',[{...ix,accounts:[...ix.accounts,...requests.map(request=>({
        address:limbs[request.register],role:request.writable?AccountRole.WRITABLE:AccountRole.READONLY}))]}]);
      continuations++;
    }
  }
  const completed=await header();
  assert.equal(accepted,rows.length);
  assert.equal(completed.stage,21);
  const denominator=Buffer.from(completed.state.denominator);
  const words=sdk.getSettlementLimbPageDecoder().decode((await h.read(limbs[denominator[2]]))!).payload.words;
  assert.equal(words.slice(0,Number(denominator.readBigUInt64LE(24))).reduceRight((value,word)=>(value<<64n)+word,0n),expectedCommon);
  const verified=await qualifySettlementRates({h,setup,prepared,epoch:initial.epoch,rows,rowPages:pages,limbPages:limbs,
    tracked:[],expectedCommon,hostileChecks:false,reject:async(label,ix,error=sdk.CLEARING_ERROR__RESOLUTION)=>{
      await h.send(label,[ix],[],error);
    }});
  const [plan]=await sdk.deriveSettlementWorkspace(setup.venue,'plan');
  const protectedKeys=[prepared,verified.rates,plan,...financial];
  const preAttempt=await readAll(protectedKeys);
  await h.send('original rates cannot authorize payouts',[sdk.getInitializeSettlementPlanInstruction({
    ...common,rates:verified.rates,plan})],[],sdk.CLEARING_ERROR__RESOLUTION);
  assert.deepEqual(await readAll(protectedKeys),preAttempt);
  assert.deepEqual(await readAll(financial),before);
  let foreignChargeCaps:string[]|undefined;
  let winnerProofs:Awaited<ReturnType<typeof verifyWinnerAllocations>>|undefined;
  if(expectedBudgets) {
    const keys=[3,4,5,19,20,21,22].map(index=>limbs[index]);
    const revisions=await Promise.all(keys.map(async key=>sdk.getSettlementLimbPageDecoder().decode((await h.read(key))!).revision));
    const decoder=sdk.getOriginalBudgetPageDecoder();
    if(protection) {
      const pending=await h.read(prepared);
      const state=sdk.getPreparedSettlementDecoder().decode(pending!);
      await h.send('reject foreign cap scan before page budgets',[sdk.getScanForeignProtectionInstruction({
        ...common,rates:verified.rates,page:pages[0],pageIndex:0n,attempt:verified.state.attempt,
        revision:state.revision,pageRevisions:Array<bigint>(7).fill(0n)})],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await h.read(prepared),pending);
    }
    for(const [index,page] of pages.entries()) {
      const original=decoder.decode((await h.read(page))!);
      assert.equal(original.originalBudgetAttempt,0n);
      const ix=sdk.getRecordOriginalBudgetsInstruction({...common,pageIndex:BigInt(index),page,
        rates:verified.rates,attempt:verified.state.attempt,revision:original.revision,pageRevisions:revisions});
      const withRegisters=(addresses:Address[])=>({...ix,accounts:[...ix.accounts,...addresses.map(address=>({address,role:AccountRole.READONLY}))]});
      if(index===0) {
        const initialBytes=await h.read(page);
        await h.send('reject substituted original rate register',[withRegisters([keys[1],keys[0],...keys.slice(2)])],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await h.read(page),initialBytes);
      }
      await h.send('record original debtor budgets',[withRegisters(keys)]);
      const recorded=decoder.decode((await h.read(page))!);
      assert.equal(recorded.originalBudgetAttempt,verified.state.attempt);
      assert.equal(recorded.revision,original.revision+1n);
      for(const [offset,row] of recorded.rows.entries()) {
        const expected: bigint[] = expectedBudgets[index*8+offset]??[0n,0n];
        assert.deepEqual(row,{...original.rows[offset],originalDebtorBudgets:expected});
      }
      if(index===0) {
        const repeat=sdk.getRecordOriginalBudgetsInstruction({...common,pageIndex:0n,page,rates:verified.rates,
          attempt:verified.state.attempt,revision:recorded.revision,pageRevisions:revisions});
        const bytes=await h.read(page);
        await h.send('reject repeated budget page',[{...repeat,accounts:withRegisters(keys).accounts}],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await h.read(page),bytes);
      }
    }
    if(protection) {
      foreignChargeCaps=await verifyForeignProtection(h,setup,prepared,verified.rates,verified.state.attempt,pages,keys,revisions,protection);
      if(winners)winnerProofs=await verifyWinnerAllocations(h,setup,prepared,initial.epoch,pages,winners);
      const frozen=await readAll(protectedKeys);
      await h.send('foreign cap verification cannot authorize payout',[sdk.getInitializeSettlementPlanInstruction({
        ...common,rates:verified.rates,plan})],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await readAll(protectedKeys),frozen);
    }
    assert.deepEqual(await readAll([setup.resolution,...members]),before.slice(0,members.length+1));
  }
  return {winnerProofs,foreignChargeCaps,budgetRows:expectedBudgets?.length??0,rows:accepted,denominatorContinuations:continuations,rateContinuations:verified.continuations,
    verifiedPrefixes:verified.observedPrefixes,rounds:verified.reference.evaluations.length,
    factorBits:BigInt(verified.reference.evaluations[0].proposal[0]).toString(2).length,
    originalRateBits:verified.reference.evaluations[0].proposal.slice(1).map(value=>BigInt(value).toString(2).length),
    stage:completed.stage,rateStage:verified.state.stage};
}
