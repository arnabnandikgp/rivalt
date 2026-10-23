import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {addresses,payerKey,fixtureKey} from './custody-cases.js';
import {makerAddresses} from './maker-cases.js';
it('matches all stored-order authority families with isolated legacy Anchor',async()=>{
  const a=await addresses(),payer=await payerKey(),owner=await fixtureKey('trader'),[participant]=await sdk.findParticipantPda({market:a.market,owner:owner.address}),[routeState]=await sdk.findRouteStatePda({market:a.market}),x=await makerAddresses(0);
  const terms={side:1,lots:10n,limit:54000n,feeBudget:1000n,startSlot:100n,expirySlot:200n,trigger:2,threshold:59000n,reduceOnly:true,generation:7n};
  const manage={owner:owner.address,market:a.market,participant,routeState,eventAuthority:a.eventAuthority,program:a.program};
  const cancel={owner:owner.address,market:a.market,participant,eventAuthority:a.eventAuthority,program:a.program};
  const cleanup={market:a.market,participant,eventAuthority:a.eventAuthority,program:a.program};
  const execution={keeper:payer.address,market:a.market,trader:participant,routeState,vault:a.vault,
    firstCapital:x.capital,firstRegistration:x.registration,firstProgram:x.pricingProgram,firstProgramData:x.programData,firstConfig:x.config,
    secondCapital:null,secondRegistration:null,secondProgram:null,secondProgramData:null,secondConfig:null,eventAuthority:a.eventAuthority,program:a.program};
  const args={id:2n,version:3n,filled:4n,observationSequence:5n,startSlot:100n,expirySlot:200n,lots:2n,legs:[{lots:2n,quoteEpoch:6n,authorityEpoch:7n}]};
  const modern=[await sdk.getPlaceOrderInstructionAsync({...manage,owner,expectedId:2n,terms}),await sdk.getReplaceOrderInstructionAsync({...manage,owner,id:2n,version:3n,terms}),await sdk.getCancelOrderInstructionAsync({...cancel,owner,id:2n,version:3n}),await sdk.getPlaceProtectionInstructionAsync({...manage,owner,expectedId:2n,tp:{...terms,trigger:1,threshold:61000n},sl:terms}),await sdk.getCancelProtectionInstructionAsync({...cancel,owner,groupId:1n,version:2n}),await sdk.getCleanupOrdersInstructionAsync(cleanup),await sdk.getExecuteOrderInstructionAsync({...execution,secondCapital:undefined,secondRegistration:undefined,secondProgram:undefined,secondProgramData:undefined,secondConfig:undefined,keeper:payer,...args})];
  const rows=[['placeOrder',[2n,terms],manage],['replaceOrder',[2n,3n,terms],manage],['cancelOrder',[2n,3n],cancel],['placeProtection',[2n,{...terms,trigger:1,threshold:61000n},terms],manage],['cancelProtection',[1n,2n],cancel],['cleanupOrders',[],cleanup],['executeOrder',[args],execution]];
  writeFileSync('.local/p08-abi.json',JSON.stringify({instructions:rows.map(([name,args,accounts])=>({program:'clearing',name,args,accounts}))},(_,x)=>typeof x==='bigint'?{$integer:x.toString()}:x));
  const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/makers.cjs','.local/p08-abi.json'],{encoding:'utf8'}));
  modern.forEach((ix,i)=>{assert.equal(Buffer.from(ix.data!).toString('hex'),legacy.instructions[i].data);assert.deepEqual(ix.accounts!.map(a=>({address:a.address,signer:(a.role&2)!==0,writable:(a.role&1)!==0})),legacy.instructions[i].accounts);});
  assert.equal(modern[2].accounts.length,5);assert.equal(modern[5].accounts.length,4);
});
