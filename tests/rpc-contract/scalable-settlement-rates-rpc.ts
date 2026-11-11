// Actual uploaded proposals, bounded continuations and hostile-attempt recovery.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {AccountRole,getAddressEncoder,getProgramDerivedAddress,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import type {ExpectedInstructionError} from './instruction-errors.js';
import {ratePages} from './settlement-page-plan.js';

type Evaluation={proposal:string[];budgets:string[];spent:string[];fractional:boolean[];prefixes:string[][];residuals:string[];losses:string[]};
export async function qualifySettlementRates(options:{h:CanonicalHarness;
  setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>; prepared:Address;epoch:bigint;
  rows:{cash:bigint;claims:bigint[]}[];rowPages:Address[];limbPages:Address[];tracked:Address[];
  expectedCommon:bigint;hostileChecks?:boolean;reject:(label:string,instruction:Instruction,error?:ExpectedInstructionError)=>Promise<void>}) {
  const {h,setup,prepared,epoch,rows,rowPages,limbPages,tracked,reject}=options;
  const header=sdk.getPreparedSettlementDecoder().decode((await h.read(prepared))!);
  const reference=JSON.parse(execFileSync('python3',['tests/financial/settlement_rpc_reference.py'],{
    input:JSON.stringify({rows,pools:header.pools,insurance:header.insurance},(_,value)=>typeof value==='bigint'?String(value):value),encoding:'utf8'
  })) as {common:string;evaluations:Evaluation[]};
  assert.equal(BigInt(reference.common),options.expectedCommon);
  if(options.hostileChecks!==false)assert(reference.evaluations.length>=2,'signed fixture must exercise real fractional insurance clipping');
  const le64=(value:bigint)=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(value);return bytes;};
  const le32=(value:number)=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
  const pda=async(label:string,...suffix:Uint8Array[])=>(await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,
    seeds:[Buffer.from(label),getAddressEncoder().encode(setup.venue),...suffix]}))[0];
  const rates=await pda('settlement-rates');tracked.push(rates);
  const common={...setup.safetyCommon,prepared,rates,epoch};
  const state=async()=>sdk.getSettlementRatesDecoder().decode((await h.read(rates))!);
  const page=async(register:number)=>sdk.getSettlementLimbPageDecoder().decode((await h.read(limbPages[register]))!);
  await h.send('P54 initialize rate verification',[sdk.getInitializeSettlementRatesInstruction(common)]);
  for(let register=3;register<25;register++){
    const key=await pda('resolution-limbs',le32(register),le64(0n));limbPages.push(key);tracked.push(key);
    await h.send('P54 provision reusable rate register',[sdk.getInitializeSettlementLimbPageInstruction({...common,page:key,register,pageIndex:0n})]);
  }
  const words=(value:bigint)=>{const result:bigint[]=[];while(value){result.push(value&((1n<<64n)-1n));value>>=64n;}return result;};
  const factorWords=(value:bigint)=>{const result=words(value);while(result.length<5)result.push(0n);assert.equal(result.length,5);return result;};
  const begin=async(proposal:bigint[])=>{
    const current=await state();
    await h.send('P54 start untrusted rate attempt',[sdk.getBeginSettlementRateProposalInstruction({...common,actor:setup.payer,
      revision:current.revision,factor:factorWords(proposal[0]),lengths:proposal.slice(1).map(value=>BigInt(words(value).length))})]);
    return (await state()).attempt;
  };
  const upload=async(proposal:bigint[],hostile=false)=>{
    for(let market=0;market<2;market++){
      const values=words(proposal[market+1]);if(!values.length)continue;
      const current=await state();
      const args={...common,proposer:setup.payer,page:limbPages[3+market],revision:current.revision,attempt:current.attempt,market,offset:0n,words:values};
      if(hostile&&market===0){
        await reject('oversized upload',sdk.getUploadSettlementRateInstruction({...args,words:Array(33).fill(1n)}));
        await reject('non-normalized upload',sdk.getUploadSettlementRateInstruction({...args,words:values.map((value,index)=>index===values.length-1?0n:value)}));
        await reject('skipped proposal word',sdk.getUploadSettlementRateInstruction({...args,offset:1n}));
        await reject('wrong rate register',sdk.getUploadSettlementRateInstruction({...args,page:limbPages[4]}));
      }
      const instruction=sdk.getUploadSettlementRateInstruction(args);
      await h.send('P54 upload canonical numerator words',[instruction]);
      if(hostile&&market===0)await reject('duplicate proposal chunk',instruction);
    }
  };
  const first=reference.evaluations[0].proposal.map(BigInt);
  let current=await state(),stalled=0n;
  if(options.hostileChecks!==false) {
  await reject('stale rate epoch',sdk.getBeginSettlementRateProposalInstruction({...common,epoch:epoch+1n,actor:setup.payer,
    revision:current.revision,factor:factorWords(1n),lengths:[0n,0n]}));
  await reject('zero rate factor',sdk.getBeginSettlementRateProposalInstruction({...common,actor:setup.payer,revision:current.revision,
    factor:[0n,0n,0n,0n,0n],lengths:[0n,0n]}));
  await reject('oversized rate width',sdk.getBeginSettlementRateProposalInstruction({...common,actor:setup.payer,revision:current.revision,
    factor:factorWords(1n),lengths:[(await page(0)).wordCount+1,0]}));
  // An absent proposer cannot retain exclusive control indefinitely.
  await begin(first);current=await state();
  await h.send('P54 reject early foreign reset',[sdk.getResetSettlementRateProposalInstruction({...common,actor:setup.traderOwner,
    revision:current.revision,attempt:current.attempt})],[setup.traderOwner],sdk.CLEARING_ERROR__RESOLUTION);
  await reject('incomplete upload cannot verify',sdk.getAcceptSettlementRateRowInstruction({...common,page:rowPages[0],
    revision:current.revision,attempt:current.attempt}));
  stalled=current.attempt;const deadline=Date.now()+20_000;
  while(await setup.slot()<current.lastProgressSlot+64n){assert(Date.now()<deadline,'real slot progress');await delay(50);}
  await h.send('P54 permissionless stalled upload recovery',[sdk.getResetSettlementRateProposalInstruction({...common,actor:setup.traderOwner,
    revision:current.revision,attempt:stalled})],[setup.traderOwner]);
  assert.equal((await state()).stage,0);
  // A fully uploaded proposal is also recoverable if every helper disappears.
  await begin(first);await upload(first);current=await state();assert.equal(current.stage,2);
  await reject('proposer cannot reset active verification',sdk.getResetSettlementRateProposalInstruction({...common,actor:setup.payer,
    revision:current.revision,attempt:current.attempt}));
  const verificationDeadline=Date.now()+20_000;
  while(await setup.slot()<current.lastProgressSlot+64n){assert(Date.now()<verificationDeadline,'real verification slot progress');await delay(50);}
  await h.send('P54 permissionless stalled verification recovery',[sdk.getResetSettlementRateProposalInstruction({...common,actor:setup.traderOwner,
    revision:current.revision,attempt:current.attempt})],[setup.traderOwner]);
  assert.equal((await state()).stage,0);
  }
  let continuations=0,observedPrefixes=0;
  const magnitude=async(checkpoint:Buffer,register:number)=>{
    const used=Number(checkpoint.readBigUInt64LE(320+register*8));assert(used<=256);
    return (await page(register)).payload.words.slice(0,used).reduceRight((value,word)=>(value<<64n)+word,0n);
  };
  const verify=async(expected?:Evaluation,hostile=false)=>{
    let processed=0,steps=0,checkedPageOrder=false;
    while((await state()).stage===2){
      const current=await state(),checkpoint=Buffer.from(current.state.work);
      if(checkpoint[1]===4){
        const ordinal=Number(checkpoint.readBigUInt64LE(216));assert.equal(ordinal,processed);
        const instruction=sdk.getAcceptSettlementRateRowInstruction({...common,revision:current.revision,attempt:current.attempt,page:rowPages[Math.floor(ordinal/8)]});
        await h.send('P54 accept exact next rate row',[instruction]);
        if(hostile&&ordinal===0)await reject('rate row replay',instruction);
      }else{
        const requests=ratePages(checkpoint);assert(requests.every(request=>request.index===0n));
        for(const request of requests){
          const data=await page(request.register);
          if(request.register>=5&&data.attempt!==current.attempt)
            await h.send('P54 reuse scratch under new attempt',[sdk.getPrepareSettlementRateScratchInstruction({...common,attempt:current.attempt,page:limbPages[request.register]})]);
        }
        const revisions=await Promise.all(requests.map(async request=>(await page(request.register)).revision));
        while(revisions.length<3)revisions.push(0n);
        const instruction=sdk.getContinueSettlementRatesInstruction({...common,revision:current.revision,attempt:current.attempt,steps:128,revisions});
        const full={...instruction,accounts:[...instruction.accounts,...requests.map(request=>({address:limbPages[request.register],role:request.writable?AccountRole.WRITABLE:AccountRole.READONLY}))]};
        if(hostile&&steps===0){
          await reject('missing rate limb',instruction);
          await reject('foreign rate register',{...full,accounts:[...instruction.accounts,
            ...full.accounts.slice(instruction.accounts.length).map((meta,index)=>index===0?{...meta,address:limbPages[2]}:meta)]});
          const old=sdk.getContinueSettlementRatesInstruction({...common,revision:current.revision,attempt:stalled,steps:128,revisions});
          await reject('stale attempt cannot reuse work',{...old,accounts:full.accounts});
        }
        if(hostile&&!checkedPageOrder&&requests.length>1){
          // Promote message privileges so the intended identity/order guard,
          // rather than a preceding readonly guard, proves the rejection.
          const metas=full.accounts.slice(instruction.accounts.length).map(meta=>({...meta,role:AccountRole.WRITABLE}));
          await reject('reordered rate limbs',{...full,accounts:[...instruction.accounts,...[...metas].reverse()]});
          await reject('duplicated rate page',{...full,accounts:[...instruction.accounts,...metas.map((meta,index)=>index===1?metas[0]:meta)]},sdk.CLEARING_ERROR__ALIAS);
          checkedPageOrder=true;
        }
        await h.send('P54 bounded rate arithmetic',[full]);steps++;continuations++;
      }
      const next=await state(),nextWork=Buffer.from(next.state.work);
      if(next.stage!==3){
        const nextProcessed=Number(nextWork.readBigUInt64LE(216));
        if(nextProcessed>processed){
          assert.equal(nextProcessed,processed+1);
          if(expected){
            const mask=nextWork[4];const incoming=await Promise.all([0,1].map(market=>magnitude(nextWork,(mask&(1<<market)?15:7)+market)));
            assert.deepEqual(incoming,expected.prefixes[processed].map(BigInt));observedPrefixes++;
          }
          processed=nextProcessed;
        }
      }
      assert(steps<2000,'bounded fixture rate continuations');
    }
    if(hostile)assert(checkedPageOrder,'mandatory reordered/duplicated page checks executed');
    return state();
  };
  // Correctly encoded but financially wrong rates must be rejected after actual
  // deterministic evaluation, with the original insurance checkpoint preserved.
  if(options.hostileChecks!==false) {
  const bad=[first[0],first[1]-1n,first[2]],beforeBad=Buffer.from((await state()).state.insurance);
  await begin(bad);await upload(bad,true);const badResult=await verify(undefined,true);
  assert.equal(badResult.stage,3);assert.deepEqual(Buffer.from(badResult.state.insurance),beforeBad);
  await h.send('P54 reset rejected equation',[sdk.getResetSettlementRateProposalInstruction({...common,actor:setup.traderOwner,
    revision:badResult.revision,attempt:badResult.attempt})],[setup.traderOwner]);
  }
  for(const expected of reference.evaluations){
    const proposal=expected.proposal.map(BigInt);await begin(proposal);await upload(proposal);
    const result=await verify(expected),checkpoint=Buffer.from(result.state.work);
    assert.deepEqual([checkpoint.readBigUInt64LE(520),checkpoint.readBigUInt64LE(528)],expected.spent.map(BigInt));
    assert.equal(checkpoint[536],Number(expected.fractional[0])+2*Number(expected.fractional[1]));
    assert.deepEqual(await Promise.all([19,20].map(register=>magnitude(checkpoint,register))),expected.residuals.map(BigInt));
    assert.deepEqual(await Promise.all([21,22].map(register=>magnitude(checkpoint,register))),expected.losses.map(BigInt));
    const insurance=Buffer.from(result.state.insurance);
    assert.deepEqual([insurance.readBigUInt64LE(8),insurance.readBigUInt64LE(16)],header.insurance);
    assert.equal(result.stage,expected.fractional.some(Boolean)?0:4);
  }
  current=await state();assert.equal(current.stage,4);
  await reject('verified plan cannot reset',sdk.getResetSettlementRateProposalInstruction({...common,actor:setup.payer,revision:current.revision,attempt:current.attempt}));
  await reject('verified plan cannot accept another row',sdk.getAcceptSettlementRateRowInstruction({...common,page:rowPages[0],revision:current.revision,attempt:current.attempt}));
  assert.equal(Buffer.from(current.state.insurance)[2],reference.evaluations.length);
  return {rates,continuations,observedPrefixes,reference,state:current};
}
