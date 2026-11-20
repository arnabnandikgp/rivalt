// The independent reference reads frozen accounts and supplies untrusted rates.
// Clearing authenticates every member, solves both markets, and binds the result.
import assert from 'node:assert/strict';
import {AccountRole,type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import type {PairReference} from './populated-pair-schedule.js';
import type {SettlementReference} from './scalable-settlement-plan-rpc.js';

export type JointReference={common:string;proposals:string[][];spent:string[];protected:number[];
  deltas:string[][];plan:SettlementReference};
const words=(number:string)=>{
  const result:bigint[]=[];
  for(let value=BigInt(number);value>0n;value>>=64n)result.push(BigInt.asUintN(64,value));
  return result;
};

export async function verifyJointPayment(h:CanonicalHarness,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,
  prepared:Address,rates:Address,pages:Address[],limbs:Address[],pairs:{certificate:Address}[],winners:{proof:Address}[],
  books:PairReference[],ref:JointReference) {
  const header=async()=>sdk.getPreparedSettlementDecoder().decode((await h.read(prepared))!);
  const initial=await header(),epoch=initial.epoch,nonce=81n;
  const [payment]=await sdk.findPaymentPda({payer:setup.payer.address,nonce});
  const source={prepared,resolution:setup.resolution}, common={...setup.safetyCommon,prepared,rates,epoch};
  const read=async()=>sdk.getJointPaymentProofDecoder().decode((await h.read(payment))!);
  const registers=[initial.state.denominator[2],3,4].map(index=>limbs[index]);
  const revisions=await Promise.all(registers.map(async key=>sdk.getSettlementLimbPageDecoder().decode((await h.read(key))!).revision));
  const proposals=ref.proposals.map(([factor,...rates])=>{
    const limbs=words(factor);assert(limbs.length<=5);
    while(limbs.length<5)limbs.push(0n);
    return {factor:limbs,rates:rates.map(words)};
  });
  const open=sdk.getOpenJointPaymentInstruction({...source,payment,payer:setup.payer,nonce,accountBytes:5200,width:12,
    rates,btcPairs:pairs[0].certificate,ethPairs:pairs[1].certificate,btcAllocation:winners[0].proof,ethAllocation:winners[1].proof,
    proposals,revisions});
  const withRegisters=(addresses:Address[])=>({...open,accounts:[...open.accounts,...addresses.map(address=>({address,role:AccountRole.READONLY}))]});
  await h.send('reject swapped original payment registers',[withRegisters([registers[0],registers[2],registers[1]])],[],sdk.CLEARING_ERROR__RESOLUTION);
  await h.send('open joint payment verification',[withRegisters(registers)]);
  let proof=await read();
  assert.deepEqual(proof.common,words(ref.common));
  const bind=async()=>sdk.getBindJointPaymentInstruction({...common,payment,revision:(await header()).revision});
  await h.send('reject incomplete joint payment binding',[await bind()],[],sdk.CLEARING_ERROR__RESOLUTION);
  const deltaPages=await Promise.all(pages.map(async(_,index)=>(await sdk.findDeltaPagePda({payment,index}))[0]));
  for(let index=pages.length-1;index>=0;index--) {
    const rows=books.map(book=>book.openings[index]);
    const prior=rows.map(row=>Buffer.from(row.prefix,'hex'));
    const openings=rows[0].rows.map((_,i)=>({weights:rows.map(page=>BigInt(page.rows[i].weight)),
      charges:rows.map(page=>BigInt(page.rows[i].charge))}));
    const args={...source,payer:setup.payer,payment,deltaPage:deltaPages[index],frozenPage:pages[index],index,prior,openings};
    if(index===pages.length-1) {
      await h.send('reject altered joint winner opening',[sdk.getCaptureJointPaymentInstruction({...args,
        prior:[Buffer.alloc(32),prior[1]]})],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.equal(await h.read(deltaPages[index]),null);
    }
    await h.send('verify joint creditor protection',[sdk.getCaptureJointPaymentInstruction(args)]);
    const page=sdk.getJointPaymentPageDecoder().decode((await h.read(deltaPages[index]))!);
    assert.deepEqual(page.deltas.slice(0,page.count).map(delta=>delta.map(String)),ref.deltas.slice(index*8,index*8+page.count));
  }
  let continuations=0;
  proof=await read();
  while(proof.stage===1) {
    const index=Math.floor(Math.min(Number(proof.rowCursor),Number(initial.count)-1)/8);
    const args={...source,payment,frozenPage:pages[index],deltaPage:deltaPages[index],revision:proof.revision,steps:64};
    if(!continuations)await h.send('reject substituted joint payment page',[sdk.getAdvanceJointPaymentInstruction({
      ...args,deltaPage:deltaPages[1]})],[],sdk.CLEARING_ERROR__RESOLUTION);
    await h.send('verify adjusted joint rate work',[sdk.getAdvanceJointPaymentInstruction(args)]);
    proof=await read();assert.equal(proof.revision,args.revision+1n);continuations++;
    assert(continuations<10_000,'bounded fixture progress');
  }
  assert.equal(proof.stage,2);assert.deepEqual(proof.spent.map(String),ref.spent);
  assert.equal(proof.round,ref.proposals.length);
  assert.equal((await header()).stage,21);
  await h.send('bind jointly verified adjusted payments',[await bind()]);
  assert.equal((await header()).stage,22);
  const [plan]=await sdk.deriveSettlementWorkspace(setup.venue,'plan');
  await h.send('reject payout while frozen rows are being copied',[sdk.getInitializeSettlementPlanInstruction({...common,plan})],[],sdk.CLEARING_ERROR__RESOLUTION);
  for(const [index,page] of pages.entries()) {
    const args={...common,page,index,deltaPage:deltaPages[index],revision:(await header()).revision};
    await h.send('copy verified joint claim deltas',[sdk.getCopyJointClaimsInstruction(args)]);
    const frozen=sdk.getOriginalBudgetPageDecoder().decode((await h.read(page))!);
    assert.deepEqual(frozen.rows.slice(0,frozen.rowCount).map(row=>row.recoveryPayout.claimDelta.map(String)),
      ref.deltas.slice(index*8,index*8+frozen.rowCount));
    if(!index)await h.send('reject copied joint claim replay',[sdk.getCopyJointClaimsInstruction({
      ...args,revision:(await header()).revision})],[],sdk.CLEARING_ERROR__RESOLUTION);
  }
  for(let register=3;register<25;register++) {
    await h.send('copy certified settlement register',[sdk.getCopyJointRegisterInstruction({...common,
      register,page:limbs[register],payment,revision:(await header()).revision})]);
  }
  assert.equal((await header()).stage,3);
  const adopted=sdk.getSettlementRatesDecoder().decode((await h.read(rates))!);
  assert.equal(adopted.attempt,proof.attempt+1n);
  assert.deepEqual(adopted.state.work,proof.rateWork);
  return {payment,continuations,spent:ref.spent,protected:ref.protected};
}
