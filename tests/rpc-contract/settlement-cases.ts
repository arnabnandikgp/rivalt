import assert from 'node:assert/strict';
import { AccountRole, type Instruction } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { getTokenDecoder } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { addresses, fixtureKey, payerKey } from './custody-cases.js';
import type { MakerHarness } from './maker-cases.js';

// Runs after P04's independently priced signed fills. Expected transitions below
// are literal cash/claim algebra, independent of the Rust financial implementation.
export async function settlementCases(h: MakerHarness) {
  const a=await addresses(),payer=await payerKey(),owner=await fixtureKey('trader'),mint=await fixtureKey('mint'),token=await fixtureKey('user-token');
  const [participant]=await sdk.findParticipantPda({market:a.market,owner:owner.address});
  const [routeState]=await sdk.findRouteStatePda({market:a.market}),[guard]=await sdk.findGuardPda({market:a.market});
  const market=async()=>sdk.getMarketStateDecoder().decode((await h.read(a.market))!);
  const risk=async()=>sdk.getTestRouteStateDecoder().decode((await h.read(routeState))!);
  const balance=async(key=participant)=>sdk.getParticipantDecoder().decode((await h.read(key))!);
  const registry=async()=>sdk.getParticipantRegistryDecoder().decode((await h.read(a.registry))!);
  const stamp=async()=>({sequence:(await market()).sequence,observation:(await risk()).observationSequence});
  const input=async()=>({...a,participant,routeState,guard,...await stamp()});
  const cash={...a,owner,participant,quoteMint:mint.address,userToken:token.address,routeState,guard};
  const snapshot=async()=>Promise.all([a.market,a.vault,guard,routeState,...(await registry()).members].map(k=>h.read(k)));
  async function reject(label:string,ix:Instruction,error:number|'reject',signers=[owner]) {
    const before=await snapshot();await h.send(label,[ix],signers,error);assert.deepEqual(await snapshot(),before,label);
  }
  await h.send('initialize sequence-bound exit certificate',[await sdk.getInitializeExitGuardInstructionAsync({...a,payer})]);
  // Cross a page boundary using real registered zero-balance participants.
  for(let i=0;i<6;i++) {
    const p=await fixtureKey(`p06-extra-${i}`);
    await h.send(`register cohort member ${i+3}`,[getTransferSolInstruction({source:payer,destination:p.address,amount:10_000_000n}),await sdk.getRegisterParticipantInstructionAsync({...a,owner:p})],[p]);
  }
  const members=(await registry()).members;
  const page=async(start:number,keys=members.slice(start,start+8),override={})=>{
    const ix=await sdk.getCheckExitCohortInstructionAsync({...a,routeState,guard,...await stamp(),start,...override});
    return {...ix,accounts:[...ix.accounts,...keys.map(address=>({address,role:AccountRole.READONLY}))]};
  };
  const certify=async()=>{for(let start=0;start<members.length;start+=8) await h.send(`certify complete cohort page ${start}`,[await page(start)]);};
  await reject('uncertified cash exit rejected',await sdk.getWithdrawTradingInstructionAsync({...cash,...await stamp(),amount:1n}),6121);
  await reject('cannot start at omitted first cohort page',await page(8),6121,[]);
  await reject('duplicate or reordered cohort member rejected',await page(0,[members[1],members[1]]),6121,[]);
  await reject('foreign account rejected in cohort',await page(0,[a.market]),6121,[]);
  await h.send('first page alone does not authorize exit',[await page(0)]);
  await reject('permissionless caller cannot rewind a partial scan',await page(0),6121,[]);
  await reject('partial cohort cash exit rejected',await sdk.getWithdrawTradingInstructionAsync({...cash,...await stamp(),amount:1n}),6121);
  await h.send('risk change invalidates partial scan',[await sdk.getPublishTestRiskInstructionAsync({...a,authority:payer,reference:60_000n,duration:3600n})]);
  await reject('cannot finish scan across market sequence change',await page(8),6121,[]);
  await certify();
  await reject('permissionless caller cannot revoke completed certificate',await page(0),6121,[]);
  const before=await market(),p0=await balance(),r=await risk();
  const old=await input();
  await reject('collection above whole negative entitlement rejected',await sdk.getCollectLossInstructionAsync({...old,amount:1_000_000_000n}),6100,[]);
  await reject('zero collection rejected',await sdk.getCollectLossInstructionAsync({...old,amount:0n}),6100,[]);
  const unpaid=p0.virtualScaled+p0.lots*r.referencePrice*1_000_000_000n;assert(unpaid<0n);
  await h.send('collect one funded loss atom into P',[await sdk.getCollectLossInstructionAsync({...old,amount:1n})]);
  assert.equal((await balance()).cash,p0.cash-1n);assert.equal((await balance()).virtualScaled,p0.virtualScaled+1_000_000_000n);
  assert.equal((await market()).settlement,before.settlement+1n);
  await reject('signed sequence replay cannot collect twice',await sdk.getCollectLossInstructionAsync({...old,amount:1n}),6122,[]);
  await reject('collection invalidates earlier exit certificate',await sdk.getWithdrawTradingInstructionAsync({...cash,...await stamp(),amount:1n}),6121);
  for(const key of members) {
    const p=await balance(key),u=p.virtualScaled+p.lots*r.referencePrice*1_000_000_000n;
    if(u>=0n) continue;
    const amount=(-u)/1_000_000_000n;if(amount===0n)continue;
    await h.send('collect remaining whole-atom funded loss',[await sdk.getCollectLossInstructionAsync({...await input(),participant:key,amount})]);
    const after=await balance(key);assert.equal(after.cash,p.cash-amount);assert.equal(after.virtualScaled,p.virtualScaled+amount*1_000_000_000n);
  }
  await h.send('distressed risk observation blocks selective exits',[await sdk.getPublishTestRiskInstructionAsync({...a,authority:payer,reference:10_000n,duration:3600n})]);
  await reject('complete cohort rejects insolvent member',await page(0),6121,[]);
  await reject('no stale-certificate withdrawal during distress',await sdk.getWithdrawTradingInstructionAsync({...cash,...await stamp(),amount:1n}),6121);
  await h.send('restore test reference through authority',[await sdk.getPublishTestRiskInstructionAsync({...a,authority:payer,reference:60_000n,duration:3600n})]);
  for(const key of members) {
    const p=await balance(key),u=p.virtualScaled+p.lots*r.referencePrice*1_000_000_000n;
    if(u<=0n)continue;
    await certify();const old=await input(),amount=u/1_000_000_000n;if(amount===0n)continue;
    await reject('settlement above entitlement rejected',await sdk.getSettleGainInstructionAsync({...old,participant:key,amount:amount+1n}),6100,[]);
    await h.send('settle whole funded gain from P',[await sdk.getSettleGainInstructionAsync({...old,participant:key,amount})]);
    const after=await balance(key);assert.equal(after.cash,p.cash+amount);assert.equal(after.virtualScaled,p.virtualScaled-amount*1_000_000_000n);
    await reject('settlement sequence replay rejected',await sdk.getSettleGainInstructionAsync({...old,participant:key,amount}),6122,[]);
  }
  assert.equal((await market()).settlement,0n);
  await certify();
  await reject('withdraw cannot spend cash needed for open-position margin',await sdk.getWithdrawTradingInstructionAsync({...cash,...await stamp(),amount:(await balance()).cash}),6100);
  await reject('withdraw requires participant owner signature',await sdk.getWithdrawTradingInstructionAsync({...cash,owner:payer,...await stamp(),amount:1n}),'reject',[]);
  const prior=await balance(),wallet=getTokenDecoder().decode((await h.read(token.address))!).amount;
  await h.send('withdraw funded trading cash by real SPL transfer',[await sdk.getWithdrawTradingInstructionAsync({...cash,...await stamp(),amount:1_000_000n})],[owner]);
  assert.equal((await balance()).cash,prior.cash-1_000_000n);assert.equal(getTokenDecoder().decode((await h.read(token.address))!).amount,wallet+1_000_000n);
  const m=await market(),ps=await Promise.all(members.map(balance)),vault=getTokenDecoder().decode((await h.read(a.vault))!).amount;
  assert.equal(ps.reduce((n,p)=>n+p.cash,0n),m.totalCash);assert.equal(ps.reduce((n,p)=>n+p.lots,0n),0n);
  assert.equal(ps.reduce((n,p)=>n+p.virtualScaled,0n),m.settlement*1_000_000_000n);
  assert.equal(vault,m.totalCash+m.settlement+m.insurance+m.fees);assert.equal(vault,m.allocatedVault);
  await h.waitUntil((await risk()).validUntil);
  await reject('expired observation cannot certify cash exits',await page(0),6118,[]);
  return {participants:members.length,market:m,participantsAfter:ps,vault};
}
