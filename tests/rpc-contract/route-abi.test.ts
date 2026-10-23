import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { address, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { addresses,payerKey,fixtureKey } from './custody-cases.js';
import { makerAddresses } from './maker-cases.js';
it('matches test-risk and one/two-maker route ABI with isolated Anchor including optional accounts',async()=>{
  const a=await addresses(),payer=await payerKey(),owner=await fixtureKey('trader'),[trader]=await sdk.findParticipantPda({market:a.market,owner:owner.address}),[routeState]=await sdk.findRouteStatePda({market:a.market});
  const [x,y]=await Promise.all([0,1].map(makerAddresses)),systemProgram=address('11111111111111111111111111111111');
  const tag=(v:any):any=>typeof v==='bigint'?{$integer:v.toString()}:v instanceof Uint8Array?{$bytes:Array.from(v)}:Array.isArray(v)?v.map(tag):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,tag(x)])):v;
  const modern:Instruction[]=[await sdk.getInitializeTestRoutesInstructionAsync({...a,authority:payer,reference:60_000n,duration:3600n}),await sdk.getPublishTestRiskInstructionAsync({...a,authority:payer,reference:61_000n,duration:64n})];
  const admin={authority:payer.address,market:a.market,routeState,eventAuthority:a.eventAuthority,program:a.program};
  const instructions:any[]=[{program:'clearing',name:'initializeTestRoutes',args:tag([60_000n,3600n]),accounts:{...admin,systemProgram}},{program:'clearing',name:'publishTestRisk',args:tag([61_000n,64n]),accounts:admin}];
  for(const count of [1,2]) {
    const args={domain:new Uint8Array(32).fill(7),termsEpoch:1n,configEpoch:3n,observationSequence:8n,nonce:9_007_199_254_740_993n,startSlot:100n,expirySlot:250n,side:1,lots:count===1?512n:4608n,allInLimit:1n,maxFee:99n,reduceOnly:true,generation:9_007_199_254_740_994n,legs:[{lots:512n,quoteEpoch:1n,authorityEpoch:2n},...(count===2?[{lots:4096n,quoteEpoch:3n,authorityEpoch:4n}]:[])]};
    const accounts={owner:owner.address,market:a.market,trader,routeState,vault:a.vault,firstCapital:x.capital,firstRegistration:x.registration,firstProgram:x.pricingProgram,firstProgramData:x.programData,firstConfig:x.config,
      secondCapital:count===2?y.capital:null,secondRegistration:count===2?y.registration:null,secondProgram:count===2?y.pricingProgram:null,secondProgramData:count===2?y.programData:null,secondConfig:count===2?y.config:null,eventAuthority:a.eventAuthority,program:a.program};
    modern.push(await sdk.getExecuteRouteInstructionAsync({...accounts,owner,secondCapital:accounts.secondCapital??undefined,secondRegistration:accounts.secondRegistration??undefined,secondProgram:accounts.secondProgram??undefined,secondProgramData:accounts.secondProgramData??undefined,secondConfig:accounts.secondConfig??undefined,...args}));
    instructions.push({program:'clearing',name:'executeRoute',args:[tag(args)],accounts});
  }
  writeFileSync('.local/p04-abi.json',JSON.stringify({instructions}));
  const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/makers.cjs','.local/p04-abi.json'],{encoding:'utf8'}));
  modern.forEach((ix,i)=>{assert.equal(Buffer.from(ix.data!).toString('hex'),legacy.instructions[i].data);assert.deepEqual(ix.accounts!.map(a=>({address:a.address,signer:(a.role&2)!==0,writable:(a.role&1)!==0})),legacy.instructions[i].accounts);});
  assert.equal(modern[3].accounts![4].role,0,'vault only read');assert.equal(modern[3].accounts![9].role,0,'first config read-only');assert.equal(modern[3].accounts![14].role,0,'second config read-only');
});
