import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AccountRole,getAddressDecoder,getAddressEncoder,type Address,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {accountDefaultContext,decodeAccountWorker} from './account-worker-state.js';
import type {AccountRuntime} from './account-runtime.js';
import type {DefaultStep} from './account-default-worker.js';
import {recoveryBudget} from './recovery-selection.js';
import {populatedRecoveryProposal,type PopulatedRow} from './populated-recovery-selection.js';

type Context=Awaited<ReturnType<typeof accountDefaultContext>>;
type Proposal=ReturnType<typeof populatedRecoveryProposal>;
const proposals=new WeakMap<AccountRuntime,{identity:string;proposal:Proposal}>();
const readonly=(addresses:Address[])=>addresses.map(address=>({address,role:AccountRole.READONLY}));
const append=(ix:Instruction,addresses:Address[])=>({...ix,accounts:[...ix.accounts!,...readonly(addresses)]});
function nonce(venue:Address,epoch:bigint,attempt:bigint,role:string) {
  return createHash('sha256').update('Rivalt/populated-recovery-keeper/v1\0')
    .update(Buffer.from(getAddressEncoder().encode(venue))).update([epoch,attempt,role].join(':')).digest().readBigUInt64LE();
}

export async function populatedProofStep(runtime:AccountRuntime,key:Keypair,ctx:Context):Promise<DefaultStep> {
  const {preparedState:header,ratesState:rates,venue,prepared,resolution,contextSlot}=ctx;
  const {epoch,count,revision}=header,{attempt}=rates;
  const common={...ctx,epoch},source={prepared,resolution};
  const ready=(action:string,instruction:Instruction):DefaultStep=>({status:'ready',reason:action,
    id:['recovery',prepared,epoch,attempt,revision,action].join(':'),instruction});
  const blocked=(reason:string):DefaultStep=>({status:'blocked',reason});
  if(!recoveryBudget(process.env.RIVALT_RECOVERY_SCHEDULE_BUDGET))return blocked('recovery-search-pending');
  const readMany=async(keys:Address[])=>{
    const response=await runtime.rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'confirmed',minContextSlot:Number(contextSlot)}]);
    assert(Number.isSafeInteger(response.context.slot)&&BigInt(response.context.slot)>=contextSlot&&response.value?.length===keys.length,'Incomplete populated proof reads');
    return response.value as any[];
  };
  const read=async(address:Address)=>(await readMany([address]))[0];
  const pageKey=async(index:bigint)=>(await sdk.deriveFrozenMarginPage(venue,index))[0];
  const registerKey=async(register:number)=>(await sdk.deriveSettlementLimbPage(venue,register,0n))[0];
  const readRegisters=async(registers:number[])=>{
    const keys=await Promise.all(registers.map(registerKey));
    const values=await readMany(keys);
    const revisions=values.map((account,index)=>{
      const page=decodeAccountWorker(account,sdk.SETTLEMENT_LIMB_PAGE_DISCRIMINATOR,sdk.getSettlementLimbPageDecoder());
      assert(page.venue===venue&&page.epoch===epoch&&page.register===registers[index]&&page.pageIndex===0n&&page.schemaVersion===10);
      return page.revision;
    });
    return {keys,revisions};
  };
  if(header.stage===22) {
    const bytes=Buffer.from(header.state.membership);
    assert(bytes.subarray(0,8).equals(Buffer.from('RVJOINT2'))&&bytes.readBigUInt64LE(8)===epoch&&bytes.readBigUInt64LE(96)===attempt,'Invalid joint copying receipt');
    // Any funded keeper may finish a bound payment, including a different sponsor.
    const payment=getAddressDecoder().decode(bytes.subarray(16,48));
    const member=bytes.readBigUInt64LE(104),register=bytes.readUInt32LE(112);
    if(member<count) {
      const index=member/8n;
      const [deltaPage]=await sdk.findDeltaPagePda({payment,index});
      return ready('joint-claims-'+index,sdk.getCopyJointClaimsInstruction({...common,index,page:await pageKey(index),deltaPage,revision}));
    }
    assert(member===count && register>=3 && register<=24,'Invalid joint register cursor');
    return ready('joint-register-'+register,sdk.getCopyJointRegisterInstruction({...common,payment,register,page:await registerKey(register),revision}));
  }
  assert(header.stage===21 && rates.stage===4 && rates.epoch===epoch && attempt>0n,'Original rates are not sealed');
  const progress=sdk.foreignProtectionProgress(header);
  assert(!progress || progress.attempt===attempt,'Foreign protection attempt changed');
  if(!progress?.linkedCaps) {
    const index=(progress?.members??0n)/8n;
    const [page,bump]=await sdk.deriveFrozenMarginPage(venue,index);
    const frozen=decodeAccountWorker(await read(page),sdk.FROZEN_MARGIN_PAGE_DISCRIMINATOR,sdk.getOriginalBudgetPageDecoder());
    assert(frozen.venue===venue && frozen.epoch===epoch && frozen.pageIndex===index && frozen.bump===bump && frozen.schemaVersion===10);
    const final=(index+1n)*8n>=count;
    const registers=final || frozen.originalBudgetAttempt!==attempt?await readRegisters([3,4,5,19,20,21,22]):{keys:[],revisions:Array<bigint>(7).fill(0n)};
    const args={...common,page,pageIndex:index,attempt,pageRevisions:registers.revisions};
    return frozen.originalBudgetAttempt===attempt
      ? ready('protect-'+index,append(sdk.getScanForeignProtectionInstruction({...args,revision}),registers.keys))
      : ready('original-budget-'+index,append(sdk.getRecordOriginalBudgetsInstruction({...args,revision:frozen.revision}),registers.keys));
  }
  const identity=[prepared,epoch,attempt,revision].join(':');
  let cached=proposals.get(runtime);
  if(cached?.identity!==identity) {
    const rows:PopulatedRow[]=[];
    const totalPages=(count+7n)/8n;
    for(let first=0n;first<totalPages;first+=32n) {
      const keys=await Promise.all(Array.from({length:Number(totalPages-first<32n?totalPages-first:32n)},(_,i)=>sdk.deriveFrozenMarginPage(venue,first+BigInt(i))));
      const [snapshot,...pages]=await readMany([prepared,...keys.map(([address])=>address)]);
      const current=decodeAccountWorker(snapshot,sdk.PREPARED_SETTLEMENT_DISCRIMINATOR,sdk.getPreparedSettlementDecoder());
      assert(current.revision===revision && current.epoch===epoch && current.stage===21 && current.venue===venue && current.count===count,'Original book changed');
      pages.forEach((account,i)=>{
        const page=decodeAccountWorker(account,sdk.FROZEN_MARGIN_PAGE_DISCRIMINATOR,sdk.getOriginalBudgetPageDecoder());
        const index=first+BigInt(i),left=count-index*8n;
        assert(page.schemaVersion===10 && page.venue===venue && page.epoch===epoch && page.bump===keys[i][1] && page.pageIndex===index &&
          page.originalBudgetAttempt===attempt && page.rowCount===Number(left<8n?left:8n),'Invalid populated proof membership');
        rows.push(...page.rows.slice(0,page.rowCount));
      });
    }
    cached={identity,proposal:populatedRecoveryProposal(venue,epoch,rows,[...progress.linkedCaps],[...progress.budget],header.pools,header.insurance)};
    proposals.set(runtime,cached);
  }
  const {markets,proposals:ratesAfter}=cached.proposal;
  const winners:Address[]=[],certificates:Address[]=[];
  for(const [market,book] of markets.entries()) {
    const winnerNonce=nonce(venue,epoch,attempt,'winner'+market);
    const [proof]=await sdk.findProofPda({payer:key,nonce:winnerNonce});
    winners.push(proof);
    const winnerAccount=await read(proof);
    if(!winnerAccount)return ready('winner-open-'+market,sdk.getOpenWinnerProofInstruction({...source,proof,payer:key,nonce:winnerNonce,market,epoch,cutoffs:book.cutoffs}));
    const winner=decodeAccountWorker(winnerAccount,sdk.WINNER_ALLOCATION_PROOF_DISCRIMINATOR,sdk.getWinnerAllocationProofDecoder());
    assert(winner.prepared===prepared && winner.epoch===epoch && winner.originalAttempt===attempt && winner.market===market);
    if(winner.stage<2)return ready('winner-'+market+'-'+winner.revision,sdk.getAdvanceWinnerProofInstruction({...source,proof,revision:winner.revision,
      page:await pageKey(winner.cursor/8n),opponents:winner.scanningOpponents?await pageKey(winner.opponentCursor/8n):undefined}));
    assert(winner.stage===2 && Buffer.from(winner.targetDigest).equals(book.finalDigest),'Unexpected verified winner allocation');
    const pairNonce=nonce(venue,epoch,attempt,'pairs'+market);
    const [certificate]=await sdk.findOpenPairScheduleCertificatePda({payer:key,nonce:pairNonce});
    certificates.push(certificate);
    const pairAccount=await read(certificate);
    if(!pairAccount)return ready('pair-open-'+market,sdk.getOpenPairScheduleInstruction({...source,payer:key,allocation:proof,certificate,nonce:pairNonce,orderRoot:book.root}));
    const pair=decodeAccountWorker(pairAccount,sdk.PAIR_SCHEDULE_PROOF_DISCRIMINATOR,sdk.getPairScheduleProofDecoder());
    assert(pair.prepared===prepared && pair.allocation===proof && pair.epoch===epoch && pair.attempt===attempt && pair.market===market);
    const action='pair-'+market+'-'+pair.revision;
    const pageFor=async(role:0|1,index:bigint)=>(await sdk.derivePairOrderPage(certificate,role,index))[0];
    if(pair.stage===0 || pair.stage===1) {
      const role=pair.stage,index=pair.rows[role]/8n;
      const page=book.pages.find(value=>value.role===role && value.index===index);
      assert(page,'Missing ordered page opening');
      return ready(action,sdk.getAppendPairOrderInstruction({...source,payer:key,certificate,orderPage:await pageFor(role,index),...page}));
    }
    if(pair.stage===2) {
      assert(pair.membersLeft>0n);
      const index=(pair.membersLeft-1n)/8n;
      const page=book.openings[Number(index)],keys:Address[]=[];
      const openings=[];
      for(const {weight,charge,location} of page.members) {
        const {role,slot}=location??{role:0,slot:0n};
        let lookup=0;
        if(location) {
          const address=await pageFor(role===0?0:1,slot/8n);
          if(!keys.includes(address))keys.push(address);
          lookup=keys.indexOf(address);
        }
        openings.push({weight,charge,bookSlot:slot,lookup});
      }
      return ready(action,append(sdk.getCheckPairMembersInstruction({...source,certificate,frozenPage:await pageKey(index),prefix:page.prior,openings}),keys));
    }
    if(pair.stage===3)return ready(action,sdk.getMatchPairPageInstruction({...source,certificate,winners:await pageFor(0,pair.winnerCursor/8n),
      debtors:await pageFor(1,pair.debtorPage),revision:pair.revision}));
    assert.equal(pair.stage,4,'Unknown ordered pair cursor');
  }
  const paymentNonce=nonce(venue,epoch,attempt,'payment');
  const [payment]=await sdk.findPaymentPda({payer:key,nonce:paymentNonce});
  const account=await read(payment);
  if(!account) {
    const registers=await readRegisters([header.state.denominator[2],3,4]);
    // Explicitly bounded sponsor workspace used by the populated local verifier.
    if(ratesAfter.some(proposal=>proposal.rates.some(words=>words.length>12)))return blocked('joint-payment-register-width');
    return ready('joint-open',append(sdk.getOpenJointPaymentInstruction({...source,payment,payer:key,nonce:paymentNonce,
      accountBytes:5200,width:12,rates:ctx.rates,btcPairs:certificates[0],ethPairs:certificates[1],btcAllocation:winners[0],ethAllocation:winners[1],
      proposals:ratesAfter,revisions:registers.revisions}),registers.keys));
  }
  const proof=decodeAccountWorker(account,sdk.JOINT_PAYMENT_PROOF_DISCRIMINATOR,sdk.getJointPaymentProofDecoder());
  assert(proof.prepared===prepared && proof.epoch===epoch && proof.attempt===attempt);
  if(proof.stage===0) {
    assert(proof.membersLeft>0n);
    const index=(proof.membersLeft-1n)/8n;
    const [deltaPage]=await sdk.findDeltaPagePda({payment,index});
    const pages=markets.map(market=>market.openings[Number(index)]);
    const openings=pages[0].members.map((_,i)=>({weights:pages.map(page=>page.members[i].weight),charges:pages.map(page=>page.members[i].charge)}));
    return ready('joint-capture-'+index,sdk.getCaptureJointPaymentInstruction({...source,payer:key,payment,deltaPage,
      frozenPage:await pageKey(index),index,prior:pages.map(page=>page.prior),openings}));
  }
  if(proof.stage===1) {
    const index=(proof.rowCursor<count?proof.rowCursor:count-1n)/8n;
    const [deltaPage]=await sdk.findDeltaPagePda({payment,index});
    return ready('joint-verify-'+proof.revision,sdk.getAdvanceJointPaymentInstruction({...source,payment,deltaPage,
      frozenPage:await pageKey(index),revision:proof.revision,steps:64}));
  }
  assert.equal(proof.stage,2);
  return ready('joint-bind',sdk.getBindJointPaymentInstruction({...common,payment,revision}));
}
