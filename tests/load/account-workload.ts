/** P28 pinned 300-second population; no pause-to-exit success path. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import type {Address, Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {VersionedTransaction} from '@solana/web3.js';
import {json} from '../../packages/indexer/src/events.js';
import type {AccountQualificationEnvironment, BrowserAccounts} from '../browser/account-environment.js';

export async function accountWorkload(environment:AccountQualificationEnvironment,accounts:BrowserAccounts) {
  const {directory,setup,transport,client,runtime,endpoint}=environment;
  const rawKeys=[setup.venue,setup.custody,setup.safety,setup.vault,setup.mint.address,...setup.markets,...setup.ledgers,...setup.roots,...setup.makers.flat().map(maker=>maker.registration),...setup.operators.map(operator=>operator.token.address)];
  const raw=async()=>{
    const response=await transport.rpc.call('getMultipleAccounts',[rawKeys,{encoding:'base64',commitment:'confirmed'}]);
    return Object.fromEntries(rawKeys.map((key,index)=>[key,response.value[index]?.data[0]??null]));
  };
  const population:any[]=[],exits:any[]=[],financialSteps:any[]=[],faults:any[]=[],drain:any[]=[];
  const report={roots:setup.roots,markets:setup.markets,ledgers:setup.ledgers,custody:setup.custody,vault:setup.vault,mint:setup.mint.address,
    makers:setup.makers.map(makers=>makers.map(maker=>({registration:maker.registration,capital:maker.capital}))),userTokens:setup.operators.map(operator=>operator.token.address),financialSteps,rawAccounts:await raw()};
  let originalNumber=0;
  async function submit(label:string,instructions:Instruction[]) {
    const prepared=await client.prepare(label,setup.owner.address,instructions);await prepared.transaction.sign([setup.owner]);
    const intent=await client.signed(prepared,prepared.transaction);return submitOriginal(intent);
  }
  async function submitOriginal(intent:sdk.SignedIntent) {
    const requestId=`p28-load-${originalNumber++}`,submittedAt=Date.now();
    writeFileSync(`${directory}/load-original-${requestId}.json`,json(intent));
    const response=await fetch(`${endpoint}/v3/submit`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId,wire:intent.wire})});
    assert.equal(response.status,200,await response.text());
    const deadline=Date.now()+15_000;let result;
    while(Date.now()<deadline){result=await runtime.queue.get(requestId);if(['failed','finalized'].includes(result?.status))break;await delay(50);}
    assert(result&&['failed','finalized'].includes(result.status),`unresolved scheduled original ${requestId}`);
    const actual=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(actual.transaction[0],intent.wire);
    const message=VersionedTransaction.deserialize(Buffer.from(intent.wire,'base64')).message;
    const budget=message.compiledInstructions.find(instruction=>message.staticAccountKeys[instruction.programIdIndex].address==='ComputeBudget111111111111111111111111111111'&&instruction.data[0]===2);
    assert(budget);const computeLimit=Buffer.from(budget.data).readUInt32LE(1);
    assert(actual.meta.computeUnitsConsumed*5<=computeLimit*4,'20% declared CU headroom');
    assert(Buffer.from(intent.wire,'base64').length<=1232,'Solana packet bound');
    writeFileSync(`${directory}/load-finalized-${requestId}.json`,json(actual));
    return {signature:intent.signature,wire:intent.wire,status:result.status,error:actual.meta.err,fee:actual.meta.fee,computeUnits:actual.meta.computeUnitsConsumed,
      bytes:Buffer.from(intent.wire,'base64').length,accounts:VersionedTransaction.deserialize(Buffer.from(intent.wire,'base64')).message.staticAccountKeys.length,submittedAt,finalizedAt:Date.now(),latencyMs:Date.now()-submittedAt};
  }
  async function offer(marketIndex:0|1,side:0|1,lots:bigint,label:string) {
    const offeredAt=Date.now();
    const response=await fetch(`${endpoint}/v3/quote`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor:setup.owner.address,margin:accounts.cross,marketIndex,side,lots:String(lots)})});
    const offered=await response.json();
    if(!offered.available)return {offeredAt,status:'unavailable',reason:offered.code??offered.error??`HTTP-${response.status}`,diagnostic:offered.diagnostic};
    const before=await raw();
    let intent:sdk.SignedIntent;
    try {
      const snapshot=await client.tradeSnapshot(accounts.cross,marketIndex),quote=await client.route({snapshot,trader:accounts.cross,marketIndex,side,lots,maxFee:10_000n,allInLimit:side===0?10_000_000n:0n},setup.owner.address);
      if(!quote)return {offeredAt,status:'unavailable',reason:'current-SDK-capacity-or-health'};
      const prepared=await client.prepare(label,setup.owner.address,quote.instructions);await prepared.transaction.sign([setup.owner]);
      intent=await client.signed(prepared,prepared.transaction);
    } catch(error) {return {offeredAt,status:'preparation-refused',reason:String(error)};}
    const result=await submitOriginal(intent),after=await raw();
    financialSteps.push({label,kind:'route',trader:accounts.cross,marketIndex,side,lots:String(lots),before,after,signature:result.signature,status:result.status});
    return {offeredAt,...result,diagnostic:offered.diagnostic};
  }
  await environment.normal();
  // Preserve one ETH position in the exit account: withdrawals exercise actual
  // whole-account funding/risk, not merely a cash-only fast path.
  const snapshot=await client.tradeSnapshot(accounts.isolated,1),quote=await client.route({snapshot,trader:accounts.isolated,marketIndex:1,side:0,lots:1n,maxFee:100n,allInLimit:100_000n},setup.owner.address);
  assert(quote);assert.equal((await submit('load exit account holds ETH',quote.instructions)).status,'finalized');
  report.rawAccounts=await raw();
  const start=Date.now(),exitSchedule=[30,60,90,180,210,270],seenFaults=new Set<string>();
  let maker=environment.maker;
  const mark=(name:string)=>{seenFaults.add(name);faults.push({name,elapsedMs:Date.now()-start});};
  const persist=()=>writeFileSync(`${directory}/load-progress.json`,json({durationSeconds:300,scheduledOffers:150,exitSchedule,population,exits,faults,drain}));
  try {
    for(let index=0;index<150;index++) {
      const scheduledAt=start+index*2000;await delay(Math.max(0,scheduledAt-Date.now()));
      const elapsed=(Date.now()-start)/1000;
      if(elapsed>=105&&!seenFaults.has('source-pause')){environment.pauseSources(true);mark('source-pause');}
      if(elapsed>=130&&!seenFaults.has('source-resume')){environment.pauseSources(false);mark('source-resume');}
      if(elapsed>=150&&!seenFaults.has('maker-kill')){maker.kill('SIGKILL');mark('maker-kill');}
      if(elapsed>=160&&!seenFaults.has('maker-restart')){maker=environment.restartMaker();mark('maker-restart');}
      if(elapsed>=225&&!seenFaults.has('indexer-pause')){await environment.pauseIndexer(true);mark('indexer-pause');}
      if(elapsed>=235&&!seenFaults.has('indexer-reopen')){await environment.pauseIndexer(false);mark('indexer-reopen');}
      const due=exitSchedule.find(seconds=>elapsed>=seconds&&!exits.some(exit=>exit.scheduledSeconds===seconds));
      let pending: {intent:sdk.SignedIntent;before:any;observations:bigint[];sequence:bigint}|undefined;
      if(due!==undefined) {
        const state=await client.snapshot([accounts.isolated],'confirmed'),plan=await client.exit(state,setup.owner.address,accounts.isolated,setup.operators[0].token.address,1n);
        const prepared=await client.prepare('busy funded ETH exit',setup.owner.address,plan.instructions);await prepared.transaction.sign([setup.owner]);
        pending={intent:await client.signed(prepared,prepared.transaction),before:await raw(),observations:state.marketStates.map(market=>market.observationSequence),sequence:state.custodyState.sequence};
      }
      const marketIndex=(index%2) as 0|1,side=(Math.floor(index/2)%2) as 0|1;
      const result=await offer(marketIndex,side,1n,`scheduled fill ${index}`);
      population.push({index,scheduledMs:index*2000,startedMs:Date.now()-start,schedulingDelayMs:Math.max(0,(result.offeredAt??Date.now())-scheduledAt),marketIndex,side,...result});
      if(pending) {
        assert.equal(result.status,'finalized','Exit window must include an unrelated actual trade, not quiescence');
        assert('signature' in result);
        const deadline=Date.now()+4000;let current=await client.snapshot([accounts.isolated],'confirmed');
        while(Date.now()<deadline&&current.marketStates.every((market,marketIndex)=>market.observationSequence===pending!.observations[marketIndex])){await delay(80);current=await client.snapshot([accounts.isolated],'confirmed');}
        assert(current.marketStates.some((market,marketIndex)=>market.observationSequence>pending!.observations[marketIndex]),'Sampler must advance after exit signature');
        const before=await raw(),exit=await submitOriginal(pending.intent),after=await raw();
        exits.push({scheduledSeconds:due,...exit,samplerAdvanced:true,unrelatedTrade:result.signature,sequenceAtPreparation:pending.sequence,sequenceBeforeSubmission:current.custodyState.sequence});
        financialSteps.push({label:`busy exit ${due}`,kind:'exit',margin:accounts.isolated,amount:'1',before,after,signature:exit.signature,status:exit.status});
        assert.equal(exit.status,'finalized','Admissible busy exit must land with its original signed bytes');
      }
      persist();if(index%15===0)console.log(json({stage:'account-load-progress',offers:population.length,exits:exits.length,elapsedMs:Date.now()-start}));
    }
    await delay(Math.max(0,start+300_000-Date.now()));
    assert.equal(population.length,150);assert.equal(exits.length,6);assert.equal(seenFaults.size,6);
    await environment.normal();
    for(const marketIndex of [0,1] as const) {
      const state=await client.snapshot([accounts.cross],'confirmed'),quantity=state.roots[accounts.cross].positions[marketIndex].lots;
      if(quantity!==0n){const result=await offer(marketIndex,quantity>0n?1:0,quantity>0n?quantity:-quantity,`drain fill ${marketIndex}`);drain.push(result);assert.equal(result.status,'finalized');}
    }
    const state=await client.tradeSnapshot(accounts.isolated,1),close=await client.route({snapshot:state,trader:accounts.isolated,marketIndex:1,side:1,lots:1n,maxFee:100n,allInLimit:0n,reduceOnly:true},setup.owner.address);
    assert(close);const before=await raw();assert.equal((await submit('close exit-account ETH position',close.instructions)).status,'finalized');
    financialSteps.push({label:'exit-account drain fill',kind:'route',trader:accounts.isolated,marketIndex:1,side:1,lots:'1',before,after:await raw(),status:'finalized'});
    report.rawAccounts=await raw();writeFileSync(`${directory}/load-financial.json`,json(report));
    const audit=execFileSync('python3',['tests/financial/account-workload-reference.py',`${directory}/load-financial.json`],{encoding:'utf8'});
    writeFileSync(`${directory}/load-audit.txt`,audit);
    const counts:Record<string,number>={},reasons:Record<string,number>={};
    for(const row of population){counts[row.status]=(counts[row.status]??0)+1;if(row.reason)reasons[row.reason]=(reasons[row.reason]??0)+1;}
    writeFileSync(`${directory}/load-summary.json`,json({durationMs:Date.now()-start,scheduledOffers:150,population,counts,reasons,exits,faults,drain,audit}));
  } finally {environment.pauseSources(false);if(seenFaults.has('indexer-pause')&&!seenFaults.has('indexer-reopen'))await environment.pauseIndexer(false);persist();}
}
