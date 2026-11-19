/** One durable, revision-bound step of complete paged default. Proposals and
 * helper descriptors are untrusted; only the landed program advances authority. */
import assert from 'node:assert/strict';
import {AccountRole,type Address,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {AccountRuntime} from './account-runtime.js';
import {decodeAccountWorker,readAccountResolution,accountDefaultContext} from './account-worker-state.js';
import {allocationCutoff,frozenWinner,type Winner} from './btc-allocation.js';
import {SettlementPages,type SettlementPageRequest} from './settlement-pages.js';
import {defaultProposal,matchesRejectedRate,proposeMarketOrder} from './account-default-proposal.js';

import {sharedInventoryProposal} from './shared-inventory-proposal.js';
import {multiLotBookPlan} from '@rivalt/sdk/multi-lot-book';
import {foreignCreditorProposal,type FrozenMember} from './foreign-creditor-proposal.js';

type Continuation=Awaited<ReturnType<typeof readAccountResolution>>;
export type DefaultStep={status:'blocked';reason:string}|{status:'ready';reason:string;id:string;instruction:Instruction};
const transports=new WeakMap<AccountRuntime,SettlementPages>();
function transport(runtime:AccountRuntime) {
  let value=transports.get(runtime);if(!value){value=new SettlementPages(undefined,runtime.deploymentSelection);transports.set(runtime,value);}return value;
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
  const multi=runtime.deploymentSelection==='multi-lot-book-candidate';
  const book=sdk.isBookInventoryDeployment(runtime.deploymentSelection);
  const allocation=runtime.deploymentSelection==='btc-allocation-candidate';
  const linkedAllocation=runtime.deploymentSelection==='linked-allocation-candidate';
  const frozen=async(ordinal:bigint,initialize=false)=>{
    assert(ordinal>=0n&&ordinal<header.count,'Invalid frozen ordinal');
    const [page,bump]=await sdk.deriveFrozenMarginPage(venue,ordinal/8n);
    const row=decodeAccountWorker(await read(page),sdk.FROZEN_MARGIN_PAGE_DISCRIMINATOR,multi?sdk.getMultiLotBookPageDecoder():book?sdk.getInventoryBookPageDecoder():linkedAllocation?sdk.getLinkedAllocationPageDecoder():allocation?sdk.getBtcAllocationPageDecoder():sdk.getFrozenMarginPageDecoder());
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
    if(['foreign-creditor-candidate','shared-inventory-candidate','partial-inventory-candidate','book-inventory-candidate','book-capacity-candidate','multi-lot-book-candidate'].includes(runtime.deploymentSelection) && prepared.stage===4) {
      const members:FrozenMember[]=[];
      for(let start=0n; start<prepared.count; start+=8n) {
        const {page,row}=await frozen(start);
        assert(row && row.rowCount===Number(prepared.count-start<8n?prepared.count-start:8n),'Incomplete foreign creditor page');
        for(const [offset,record] of row.rows.slice(0,row.rowCount).entries()) {
          members.push({ordinal:start+BigInt(offset),page,row:record});
        }
      }
      if(book) {
        const active=members.filter(({row})=>row.lots.some(lots=>lots!==0n) || (multi&&row.claims[0]<0n));
        const multiShape=multi && active.some(({row})=>row.lots[0]!==1n&&row.lots[0]!==-1n);
        const side=active.find(member=>member.row.claims[0]<0n)?.row.lots[0];
        if(multiShape){
          if(prepared.pools.some(pool=>pool!==0n)||members.some(({row})=>row.lots[1]!==0n||row.claims[1]!==0n||row.claims[0]%1_000_000_000n!==0n))
            return blocked('unsupported-multi-lot-book');
          const rows=members.map(({row})=>{
            if(!('lotRate' in row)||!Array.isArray(row.lotRate)||row.lotRate.length!==2)throw new Error('Missing frozen lot rate');
            return {id:row.id,lots:row.lots[0],face:row.claims[0]/1_000_000_000n,cash:row.cash,rate:[row.lotRate[0],row.lotRate[1]] as const};
          });
          if(!multiLotBookPlan(venue,epoch,prepared.prices[0],prepared.insurance[0],rows))return blocked('multi-lot-optimality-unproven');
        } else if((side!==1n && side!==-1n) || prepared.pools.some(pool=>pool!==0n) ||
          members.some(({row})=>row.claims[1]!==0n || row.lots[1]!==0n ||
            (row.lots[0]===0n ? row.claims[0]<0n : row.claims[0]%1_000_000_000n!==0n ||
              row.lots[0] !== (row.claims[0]<0n?side:-side))))return blocked('unsupported-inventory-book');
        const metas=[...new Set(active.map(member=>member.page))].map(address=>({address,role:AccountRole.WRITABLE}));
        const limit=multi||runtime.deploymentSelection==='book-capacity-candidate'?sdk.INVENTORY_BOOK_EVENT_PAGE_LIMIT:sdk.INVENTORY_BOOK_ACTIVE_PAGE_LIMIT;
        if(metas.length>limit)return blocked('inventory-book-requires-paged-verification');
        return ready('verify-inventory-book',withPages(sdk.getVerifyInventoryBookInstruction({
          ...args,revision:prepared.revision,ordinals:active.map(member=>member.ordinal)}),metas));
      }
      const capacity=async(member:FrozenMember,market:number)=>{
        const {row}=member, account=await read(row.member);
        assert(account?.owner===sdk.CLEARING_PROGRAM_ADDRESS && !account.executable && account.data[1]==='base64','Invalid winning root');
        const {positions,root}=sdk.decodeProfitAttribution(Buffer.from(account.data[0],'base64'),true);
        assert(root.venue===venue && root.id===row.id && root.revision===row.originalRevision,'Changed winner');
        return frozenWinner(row.id,row.lots[market],row.claims[market],prepared.prices[market],positions[market]).capacity;
      };
      const partial=runtime.deploymentSelection==='partial-inventory-candidate';
      if((partial||runtime.deploymentSelection==='shared-inventory-candidate') && prepared.gross[1]===0n) {
        const assignment=await sharedInventoryProposal(prepared,members,member=>capacity(member,0),partial);
        if(!assignment)return blocked('unsupported-shared-inventory');
        return ready('verify-shared-inventory',sdk.getVerifySharedInventoryInstruction({...args,revision:prepared.revision,...assignment}));
      }
      const proposal=foreignCreditorProposal(prepared,members);
      if(!proposal)return blocked('unsupported-foreign-creditor-book');
      for(const market of [0,1]) {
        if(await capacity(members[Number(proposal.ordinals[market+2])],market)<proposal.charges[market])
          return blocked('insufficient-foreign-creditor-capacity');
      }
      return ready('verify-foreign-creditors',sdk.getVerifyForeignCreditorsInstruction({...args,revision:prepared.revision,...proposal}));
    }
    if(linkedAllocation && prepared.stage===7) {
      const receipt=sdk.linkedAllocationReceipt(prepared);
      assert(receipt && !receipt.committed,'Missing linked allocation cursor');
      const {page,row}=await frozen(receipt.cursor);
      const offset=Number(receipt.cursor%8n);
      assert(row && offset<row.rowCount,'Missing linked allocation member');
      return ready('score-linked-allocation',sdk.getAdvanceLinkedAllocationInstruction({...args,revision:prepared.revision,
        ordinal:receipt.cursor,page,margin:row.rows[offset].member,cutoffs:null}));
    }
    if(linkedAllocation && prepared.stage===4) {
      const winners:[Winner[],Winner[]]=[[],[]];
      let debtor:{ordinal:bigint;page:Address;record:sdk.FrozenMargin}|undefined;
      for(let start=0n;start<header.count;start+=8n) {
        const {page,row}=await frozen(start);
        assert(row && row.rowCount===Number(header.count-start<8n?header.count-start:8n),'Incomplete frozen allocation page');
        for(const [offset,record] of row.rows.slice(0,row.rowCount).entries()) {
          const scale=1_000_000_000n;
          if(record.claims.some(claim=>claim%scale!==0n))return blocked('fractional-linked-claims');
          if(record.claims.some(claim=>claim<0n)) {
            if(debtor || !record.claims.every((claim,market)=>{
              const lots=record.lots[market];return claim<0n && lots!==0n && 2n*(lots<0n?-lots:lots)===header.remainingGross[market];
            }))return blocked('unsupported-linked-debtor');
            debtor={ordinal:start+BigInt(offset),page,record};
            continue;
          }
          if([0,1].every(market=>record.claims[market]!==0n||record.lots[market]!==0n))return blocked('linked-creditor-obligations');
          const market=record.lots.findIndex((lots,index)=>lots!==0n && record.claims[index]>0n);
          if(market<0)continue;
          const account=await read(record.member);
          assert(account?.owner===sdk.CLEARING_PROGRAM_ADDRESS&&!account.executable&&account.data[1]==='base64','Foreign winning account');
          const {root,positions}=sdk.decodeProfitAttribution(Buffer.from(account.data[0],'base64'),true);
          assert(root.venue===venue&&root.id===record.id&&root.revision===record.originalRevision,'Winning account changed');
          winners[market].push(frozenWinner(record.id,record.lots[market],record.claims[market],prepared.prices[market],positions[market]));
        }
      }
      if(!debtor)return blocked('missing-linked-debtor');
      const debts=debtor.record.claims.map(claim=>-claim/1_000_000_000n),total=debts[0]+debts[1];
      const available=debtor.record.cash<total?debtor.record.cash:total;
      if(debts.some(debt=>available*debt%total!==0n))return blocked('fractional-linked-cash-split');
      const targets=debts.map((debt,market)=>debt-available*debt/total-prepared.insurance[market]);
      if(targets.some((target,market)=>target<=0n||target>winners[market].reduce((sum,winner)=>sum+winner.capacity,0n)))
        return blocked('unsupported-linked-shortfall');
      const cutoffs=targets.map((target,market)=>allocationCutoff(venue,epoch,target,winners[market]));
      return ready('begin-linked-allocation',sdk.getAdvanceLinkedAllocationInstruction({...args,revision:prepared.revision,
        ordinal:debtor.ordinal,page:debtor.page,margin:debtor.record.member,cutoffs}));
    }
    const allowFlat = runtime.deploymentSelection==='linked-flat-candidate';
    if((allowFlat || runtime.deploymentSelection==='linked-pair-candidate') && (prepared.stage===4 || prepared.stage===6)) {
      const market=prepared.stage===4?0:1, other=1-market;
      type Member={ordinal:bigint; record:sdk.FrozenMargin; page:Address};
      let debtor:Member|undefined, winner:Member|undefined;
      let flatCreditorSeen=false;
      for(let start=0n;start<header.count;start+=8n) {
        const {page,row}=await frozen(start);
        assert(row && row.rowCount===Number(header.count-start<8n?header.count-start:8n),'Incomplete joint frozen page');
        for(const [offset,record] of row.rows.slice(0,row.rowCount).entries()) {
          const member={ordinal:start+BigInt(offset),record,page};
          if(record.claims[market]<0n) {
            if(debtor || record.claims[other]>=0n) return blocked('unsupported-linked-debtor');
            debtor=member;
          } else if(record.claims[market]>0n) {
            if(allowFlat && market===0 && record.lots[0]===0n && record.lots[1]===0n && record.claims[1]===0n) {
              if(flatCreditorSeen || record.claims[0]%1_000_000_000n!==0n) return blocked('unsupported-flat-btc-claims');
              flatCreditorSeen=true;
              continue;
            }
            if(winner || record.claims[other]!==0n || record.lots[other]!==0n) return blocked('unsupported-linked-creditors');
            winner=member;
          }
        }
      }
      if(!debtor || !winner || winner.record.lots[market]===0n ||
        winner.record.lots[market]!==-debtor.record.lots[market]) return blocked('unsupported-linked-inventory');
      if(market===1) assert(sdk.frozenJointReceipt(prepared)?.debtor===debtor.record.id,'Different frozen cross debtor');
      return ready('verify-linked-pair-'+market,sdk.getVerifyFrozenPairInstruction({...args,revision:prepared.revision,
        debtorOrdinal:debtor.ordinal,winnerOrdinal:winner.ordinal,debtor:debtor.record.member,winner:winner.record.member,
        debtorPage:debtor.page,winnerPage:debtor.page===winner.page?undefined:winner.page}));
    }
    if(allocation&&prepared.stage===5) {
      const receipt=sdk.btcAllocationReceipt(prepared);
      assert(receipt&&!receipt.committed,'Missing allocation scan');
      const {page,row}=await frozen(receipt.cursor);
      assert(row&&row.rowCount>Number(receipt.cursor%8n),'Missing frozen allocation row');
      return ready('score-btc-allocation',sdk.getAdvanceBtcAllocationInstruction({...args,revision:prepared.revision,
        ordinal:receipt.cursor,page,margin:row.rows[Number(receipt.cursor%8n)].member,cutoff:null}));
    }
    if(allocation&&prepared.stage===4) {
      if(header.remainingGross[1]!==0n)return blocked('unsupported-linked-market');
      const winners:Winner[]=[];
      let debtor:{ordinal:bigint;member:Address;page:Address;shortfall:bigint}|undefined;
      for(let start=0n;start<header.count;start+=8n) {
        const {page,row}=await frozen(start);
        assert(row&&row.rowCount===Number(header.count-start<8n?header.count-start:8n),'Incomplete allocation page');
        for(const [offset,record] of row.rows.slice(0,row.rowCount).entries()) {
          const claim=record.claims[0],lots=record.lots[0],quantity=lots<0n?-lots:lots;
          if(record.claims[1]!==0n)return blocked('unsupported-linked-market');
          if(claim<0n) {
            if(debtor||quantity===0n||2n*quantity!==header.remainingGross[0])return blocked('unsupported-debtor-inventory');
            const deficit=-claim/1_000_000_000n-record.cash-prepared.insurance[0];
            debtor={ordinal:start+BigInt(offset),member:record.member,page,shortfall:deficit>0n?deficit:0n};
          } else if(lots!==0n&&claim>0n) {
            const account=await read(record.member);
            assert(account?.owner===sdk.CLEARING_PROGRAM_ADDRESS&&!account.executable&&account.data[1]==='base64','Foreign winning account');
            const {root,positions}=sdk.decodeProfitAttribution(Buffer.from(account.data[0],'base64'),true);
            assert(root.venue===venue&&root.id===record.id&&root.revision===record.originalRevision,'Winning account changed');
            winners.push(frozenWinner(record.id,lots,claim,prepared.prices[0],positions[0]));
          }
        }
      }
      if(!debtor)return blocked('unsupported-debtor-inventory');
      const cutoff=allocationCutoff(venue,epoch,debtor.shortfall,winners);
      return ready('begin-btc-allocation',sdk.getAdvanceBtcAllocationInstruction({...args,revision:prepared.revision,
        ordinal:debtor.ordinal,page:debtor.page,margin:debtor.member,cutoff}));
    }
    const residual=runtime.deploymentSelection==='btc-residual-candidate';
    if(prepared.stage===4&&(residual||runtime.deploymentSelection==='verified-pair-candidate')) {
      if((residual?header.remainingGross[0]<2n:header.remainingGross[0]!==2n)||header.remainingGross[1]!==0n)return blocked('unsupported-frozen-book');
      const sides:{ordinal:bigint;key:Address;claim:bigint;page:Address}[]=[];
      for(let ordinal=0n;ordinal<prepared.count;ordinal+=8n) {
        const found=await frozen(ordinal);
        assert(found.row&&found.row.rowCount===Number(prepared.count-ordinal<8n?prepared.count-ordinal:8n),'Incomplete frozen page');
        for(const [offset,row] of found.row.rows.slice(0,found.row.rowCount).entries()) {
          if(row.lots[0]!==0n)sides.push({ordinal:ordinal+BigInt(offset),key:row.member,claim:row.claims[0],page:found.page});
        }
      }
      const debtor=sides.find(side=>side.claim<0n),winner=sides.find(side=>residual?side.claim>=0n:side.claim>0n);
      if(sides.length!==2||!debtor||!winner)return blocked('unsupported-frozen-book');
      return ready('verify-frozen-pair',sdk.getVerifyFrozenPairInstruction({...args,revision:prepared.revision,
        debtorOrdinal:debtor.ordinal,winnerOrdinal:winner.ordinal,debtor:debtor.key,winner:winner.key,
        debtorPage:debtor.page,winnerPage:debtor.page===winner.page?undefined:winner.page}));
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
      if(rates.stage===3 && await matchesRejectedRate(rates,proposal,async(market,index)=>{
        const result=await limb({register:3+market,index,writable:false});
        assert(!result.step,'Rejected rate page has a different epoch');
        return result.value;
      })) return blocked('rejected-identical-rate-proposal');
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
    if(plan.stage===5)return ready('reset-rejected-order',sdk.getResetSettlementPlanOrderInstruction({...args,actor:key,
      revision:plan.revision,attempt:plan.orderAttempt}));
    if(plan.stage===3)return ready('begin-order',sdk.getBeginSettlementPlanOrderInstruction({...args,actor:key,revision:plan.revision}));
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
