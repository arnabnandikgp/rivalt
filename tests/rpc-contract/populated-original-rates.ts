// Verify the wide original settlement on signed frozen pages before selection.
import assert from 'node:assert/strict';
import {AccountRole, type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {qualifySettlementRates} from './scalable-settlement-rates-rpc.js';
import {denominatorPages} from './settlement-page-plan.js';

export async function verifyPopulatedOriginalRates(
  h: CanonicalHarness, setup: Awaited<ReturnType<typeof liquidityExecutionSetup>>,
  rows: {cash:bigint;claims:bigint[]}[], members: Address[], expectedCommon: bigint,
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
  return {rows:accepted,denominatorContinuations:continuations,rateContinuations:verified.continuations,
    verifiedPrefixes:verified.observedPrefixes,rounds:verified.reference.evaluations.length,
    factorBits:BigInt(verified.reference.evaluations[0].proposal[0]).toString(2).length,
    originalRateBits:verified.reference.evaluations[0].proposal.slice(1).map(value=>BigInt(value).toString(2).length),
    stage:completed.stage,rateStage:verified.state.stage};
}
