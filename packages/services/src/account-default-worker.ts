/** One durable, revision-bound step of complete paged default. Proposals and
 * helper descriptors are untrusted; only the landed program advances authority. */
import assert from 'node:assert/strict';
import {AccountRole,type Address,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {AccountRuntime} from './account-runtime.js';
import {decodeAccountWorker,readAccountResolution,accountDefaultContext} from './account-worker-state.js';
import {SettlementPages,type SettlementPageRequest} from './settlement-pages.js';
import {defaultProposal,proposeMarketOrder} from './account-default-proposal.js';

type Continuation=Awaited<ReturnType<typeof readAccountResolution>>;
export type DefaultStep={status:'blocked';reason:string}|{status:'ready';reason:string;id:string;instruction:Instruction};
const transports=new WeakMap<AccountRuntime,SettlementPages>();
function transport(runtime:AccountRuntime) {
  let value=transports.get(runtime);if(!value){value=new SettlementPages();transports.set(runtime,value);}return value;
}
export async function accountDefaultStep(runtime:AccountRuntime,key:Keypair,state:Continuation,
  common:Awaited<ReturnType<typeof accountDefaultContext>>):Promise<DefaultStep> {
  const {header,preparedState:prepared,ratesState:rates,planState:plan}=state,epoch=header.epoch,venue=prepared.venue;
  const args={...common,epoch};
  const ready=(reason:string,instruction:Instruction):DefaultStep=>({status:'ready',reason,instruction,
    id:`default:${epoch}:${header.revision}:${prepared.revision}:${rates.revision}:${plan.revision}:${reason}`});
  const blocked=(reason:string):DefaultStep=>({status:'blocked',reason});
  const read=async(address:Address)=>{
    const result=await runtime.rpc.call('getAccountInfo',[address,{encoding:'base64',commitment:'confirmed',minContextSlot:Number(state.contextSlot)}]);
    assert(BigInt(result.context.slot)>=state.contextSlot,'Default read moved backwards');return result.value;
  };
  const frozen=async(ordinal:bigint,initialize=false)=>{
    assert(ordinal>=0n&&ordinal<header.count,'Invalid frozen ordinal');
    const [page,bump]=await sdk.deriveFrozenMarginPage(venue,ordinal/8n);
    const row=decodeAccountWorker(await read(page),sdk.FROZEN_MARGIN_PAGE_DISCRIMINATOR,sdk.getFrozenMarginPageDecoder());
    assert(row.schemaVersion===10&&row.venue===venue&&row.pageIndex===ordinal/8n&&row.bump===bump&&row.revision>0n,'Foreign frozen row page');
    if(row.epoch!==epoch) {
      assert(initialize&&row.epoch<epoch,'Unavailable frozen row epoch');
      return {page,step:ready(`rows-init-${ordinal/8n}`,sdk.getInitializeFrozenMarginPageInstruction({...args,page,pageIndex:ordinal/8n}))};
    }
    return {page,row};
  };
  const limb=async(request:SettlementPageRequest)=>{
    const [page,bump]=await sdk.deriveSettlementLimbPage(venue,request.register,request.index);
    const account=await read(page);
    const value=decodeAccountWorker(account,sdk.SETTLEMENT_LIMB_PAGE_DISCRIMINATOR,sdk.getSettlementLimbPageDecoder());
    assert(value.schemaVersion===10&&value.venue===venue&&value.register===request.register&&value.pageIndex===request.index
      &&value.bump===bump&&value.revision>0n,'Foreign settlement limb page');
    if(value.epoch!==epoch) {
      assert(value.epoch<epoch,'Foreign settlement page epoch');
      const input={...args,page,register:request.register,pageIndex:request.index};
      return {page,value,step:ready(`limb-init-${request.register}-${request.index}`,request.register<=24?
        sdk.getInitializeSettlementLimbPageInstruction(input):sdk.getInitializeSettlementPlanPageInstruction(input))};
    }
    if(request.register>=5&&request.register<=24&&value.attempt!==rates.attempt)
      return {page,value,step:ready(`scratch-${request.register}-${request.index}`,sdk.getPrepareSettlementRateScratchInstruction({...args,
        page,attempt:rates.attempt}))};
    return {page,value,encoded:Buffer.from(account.data[0],'base64').toString('hex')};
  };
  const pages=async(requests:SettlementPageRequest[])=>{
    const metas:{address:Address;role:AccountRole}[]=[],revisions:bigint[]=[];
    for(const request of requests) {
      const result=await limb(request);if(result.step)return {step:result.step,metas,revisions};
      metas.push({address:result.page,role:request.writable?AccountRole.WRITABLE:AccountRole.READONLY});revisions.push(result.value.revision);
    }
    while(revisions.length<3)revisions.push(0n);return {metas,revisions};
  };
  const withPages=(instruction:Instruction,metas:{address:Address;role:AccountRole}[]):Instruction=>({...instruction,accounts:[...instruction.accounts!,...metas]});
  if(header.stage===2) {
    if(prepared.epoch!==epoch)return ready('initialize-frozen',sdk.getInitializePreparedSettlementInstruction({...args,sourceRevision:header.revision}));
    if(prepared.stage===1) {
      const request=sdk.membershipRequest(prepared.state.membership,header.count);
      const metas=await sdk.membershipRequestAccounts(runtime.rpc,venue,request);
      if(request.kind==='member') {
        const row=await frozen(request.ordinal,true);if(row.step)return row.step;
        return ready('value-member',sdk.getValuePreparedMemberInstruction({...args,revision:prepared.revision,members:metas[0].address,
          margin:metas[1].address,page:row.page}));
      }
      assert(request.kind==='node'||request.kind==='page','Incomplete valuation has no next member');
      return ready('advance-membership',sdk.getAdvancePreparedMembershipInstruction({...args,revision:prepared.revision,index:metas[0].address}));
    }
    if(prepared.stage===2) {
      const work=Buffer.from(prepared.state.denominator);
      if(work[1]===1) {
        const row=await frozen(work.readBigUInt64LE(16));
        return ready('denominator-row',sdk.getAcceptDenominatorRowInstruction({...args,revision:prepared.revision,page:row.page}));
      }
      const current=await pages(await transport(runtime).requests(state,'denominator'));if(current.step)return current.step;
      return ready('denominator-work',withPages(sdk.getContinueSettlementDenominatorInstruction({...args,revision:prepared.revision,
        steps:128,revisions:current.revisions}),current.metas));
    }
    assert(prepared.stage===3,'Unsupported prepared stage');
    if(rates.epoch!==epoch)return ready('initialize-rates',sdk.getInitializeSettlementRatesInstruction(args));
    if(rates.stage===0||rates.stage===3) {
      const {proposal}=await defaultProposal(runtime,state);
      return ready('begin-rates',sdk.getBeginSettlementRateProposalInstruction({...args,actor:key,revision:rates.revision,
        factor:proposal.factorWords,lengths:proposal.numeratorWords.map(words=>BigInt(words.length))}));
    }
    if(rates.stage===1) {
      if(rates.proposer!==key.address) {
        if(common.slot<rates.lastProgressSlot+64n)return blocked('foreign-rate-upload-in-progress');
        return ready('reset-stalled-rates',sdk.getResetSettlementRateProposalInstruction({...args,actor:key,revision:rates.revision,attempt:rates.attempt}));
      }
      const {proposal}=await defaultProposal(runtime,state);
      if(!rates.factor.every((word,index)=>word===proposal.factorWords[index])
        ||!rates.lengths.every((length,index)=>length===BigInt(proposal.numeratorWords[index].length)))
        return ready('reset-incompatible-rates',sdk.getResetSettlementRateProposalInstruction({...args,actor:key,revision:rates.revision,attempt:rates.attempt}));
      const market=rates.uploaded.findIndex((uploaded,index)=>uploaded<rates.lengths[index]);assert(market>=0,'Upload has no missing numerator');
      const offset=rates.uploaded[market],current=await limb({register:3+market,index:offset/256n,writable:true});if(current.step)return current.step;
      const length=Number([32n,256n-offset%256n,rates.lengths[market]-offset].reduce((left,right)=>left<right?left:right));
      return ready(`upload-rate-${market}-${offset}`,sdk.getUploadSettlementRateInstruction({...args,proposer:key,page:current.page,
        revision:rates.revision,attempt:rates.attempt,market,offset,words:proposal.numeratorWords[market].slice(Number(offset),Number(offset)+length)}));
    }
    if(rates.stage===2) {
      const work=Buffer.from(rates.state.work);
      if(work[1]===4) {
        const row=await frozen(work.readBigUInt64LE(216));
        return ready('rate-row',sdk.getAcceptSettlementRateRowInstruction({...args,page:row.page,revision:rates.revision,attempt:rates.attempt}));
      }
      const current=await pages(await transport(runtime).requests(state,'rate'));if(current.step)return current.step;
      return ready('rate-work',withPages(sdk.getContinueSettlementRatesInstruction({...args,revision:rates.revision,attempt:rates.attempt,
        steps:128,revisions:current.revisions}),current.metas));
    }
    assert(rates.stage===4,'Unsupported rate stage');
    if(plan.epoch!==epoch)return ready('initialize-plan',sdk.getInitializeSettlementPlanInstruction(args));
    if(plan.stage===3||plan.stage===5)return ready('begin-order',sdk.getBeginSettlementPlanOrderInstruction({...args,actor:key,revision:plan.revision}));
    if(plan.stage===8)return ready('adopt-plan',sdk.getAdoptSettlementPlanInstruction({...args,revision:plan.revision}));
    let ordinal:bigint|undefined;
    if(plan.stage===0||plan.stage===2)ordinal=plan.cursor;
    else if(plan.stage===4&&Buffer.from(plan.work.bytes)[1]===0) {
      if(plan.proposer!==key.address) {
        if(common.slot<plan.lastProgressSlot+64n)return blocked('foreign-order-proposal-in-progress');
        return ready('reset-stalled-order',sdk.getResetSettlementPlanOrderInstruction({...args,actor:key,revision:plan.revision,attempt:plan.orderAttempt}));
      }
      const proposed=await defaultProposal(runtime,state),position=Buffer.from(plan.work.bytes).readBigUInt64LE(32);
      assert(position<header.count,'Invalid market order position');
      ordinal=proposeMarketOrder(proposed.rows,plan.orderMarket,proposed.proposal.rates[plan.orderMarket])[Number(position)];
    } else assert([1,4,6,7].includes(plan.stage),'Unsupported conserving plan stage');
    if(ordinal===undefined) {
      const loaded=new Map<string,{page:Address;value:sdk.SettlementLimbPage;encoded:string}>();
      for(let round=0;round<=8;round++) {
        const requested=await transport(runtime).requests(state,'plan-window',undefined,[...loaded.values()].map(value=>value.encoded));
        const missing=requested.filter(request=>!loaded.has(`${request.register}:${request.index}`));
        if(!missing.length) {
          const metas=requested.map(request=>({address:loaded.get(`${request.register}:${request.index}`)!.page,
            role:request.writable?AccountRole.WRITABLE:AccountRole.READONLY}));
          return ready('plan-window',withPages(sdk.getContinueSettlementPlanWindowInstruction({...args,
            revision:plan.revision,attempt:plan.orderAttempt,steps:128,pages:requested.map(request=>({register:request.register,
              pageIndex:request.index,writable:request.writable,revision:loaded.get(`${request.register}:${request.index}`)!.value.revision}))}),metas));
        }
        for(const request of missing) {
          const result=await limb(request);if(result.step)return result.step;
          loaded.set(`${request.register}:${request.index}`,{page:result.page,value:result.value,encoded:result.encoded!});
        }
        assert(loaded.size<=8,'Oversized default scratch preview');
      }
      throw new Error('Default scratch preview failed to converge');
    }
    const current=await pages(await transport(runtime).requests(state,'plan-row',ordinal));if(current.step)return current.step;
    const guarded={...args,revision:plan.revision,attempt:plan.orderAttempt,revisions:current.revisions};
    const row=await frozen(ordinal);
    return ready('plan-row',withPages(sdk.getAcceptSettlementPlanRowInstruction({...guarded,actor:key,page:row.page,ordinal}),current.metas));
  }
  if(header.stage===14) {
    assert(prepared.epoch===epoch&&rates.epoch===epoch&&plan.epoch===epoch&&plan.adoptionRevision===header.revision,
      'Adopted settlement binding mismatch');
    assert([9,10,11].includes(plan.stage),'Unsupported adopted plan stage');
  }
  // The source remains PAGED_APPLY throughout all three plan stages. Only
  // complete_plan changes it to COMPLETE; distribution never changes it.
  if(header.stage===14&&plan.stage===9) {
    if(plan.cursor===header.count)return ready('distribute',sdk.getCompleteSettlementApplicationInstruction({...args,revision:plan.revision}));
    const row=await frozen(plan.cursor);assert(row.row&&plan.cursor%8n<BigInt(row.row.rowCount),'Missing frozen application row');
    const current=await pages(await transport(runtime).requests(state,'application'));if(current.step)return current.step;
    const [flowPage]=await sdk.deriveSettlementLimbPage(venue,64,plan.cursor/36n);
    return ready('apply-member',withPages(sdk.getApplySettlementMarginInstruction({...args,revision:plan.revision,ordinal:plan.cursor,
      page:row.page,margin:row.row.rows[Number(plan.cursor%8n)].member,flowPage,revisions:current.revisions}),current.metas));
  }
  if(header.stage===14&&plan.stage===10) {
    const row=await frozen(plan.cursor);assert(row.row&&plan.cursor%8n<BigInt(row.row.rowCount),'Missing reconciliation row');
    const [flowPage]=await sdk.deriveSettlementLimbPage(venue,64,plan.cursor/36n);
    return ready('reconcile-member',sdk.getReconcileSettlementMarginInstruction({...args,revision:plan.revision,ordinal:plan.cursor,
      page:row.page,margin:row.row.rows[Number(plan.cursor%8n)].member,flowPage}));
  }
  if(header.stage===14&&plan.stage===11)return ready('complete',sdk.getCompleteSettlementPlanInstruction({...args,revision:plan.revision}));
  return blocked('unsupported-default-stage');
}
