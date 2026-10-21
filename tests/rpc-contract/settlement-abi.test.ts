import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import * as sdk from '@rivalt/sdk';
import { addresses, payerKey, fixtureKey } from './custody-cases.js';

it('matches all settlement instructions and account roles against isolated legacy Anchor',async()=>{
  const a=await addresses(),payer=await payerKey(),owner=await fixtureKey('trader'),mint=await fixtureKey('mint'),token=await fixtureKey('user-token');
  const [participant]=await sdk.findParticipantPda({market:a.market,owner:owner.address}),[routeState]=await sdk.findRouteStatePda({market:a.market}),[guard]=await sdk.findGuardPda({market:a.market});
  const shared={...a,participant,routeState,guard,sequence:9007199254740993n,observation:8n,amount:1n};
  const modern=[await sdk.getInitializeExitGuardInstructionAsync({...a,payer}),await sdk.getCheckExitCohortInstructionAsync({...shared,start:8}),await sdk.getCollectLossInstructionAsync(shared),await sdk.getSettleGainInstructionAsync(shared),await sdk.getWithdrawTradingInstructionAsync({...shared,owner,quoteMint:mint.address,userToken:token.address})];
  const idl=JSON.parse((await import('node:fs')).readFileSync('packages/sdk/idl/clearing.json','utf8'));
  const names=['initializeExitGuard','checkExitCohort','collectLoss','settleGain','withdrawTrading'];
  const snake=(s:string)=>s.replace(/[A-Z]/g,x=>'_'+x.toLowerCase()),camel=(s:string)=>s.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
  const args=[[],[{kind:'u64',value:shared.sequence.toString()},{kind:'u64',value:'8'},{kind:'u16',value:8}],...Array.from({length:3},()=>[{kind:'u64',value:shared.sequence.toString()},{kind:'u64',value:'8'},{kind:'u64',value:'1'}])];
  const input={instructions:names.map((name,i)=>({name,args:args[i],accounts:Object.fromEntries(idl.instructions.find((x:any)=>x.name===snake(name)).accounts.map((x:any,j:number)=>[camel(x.name),modern[i].accounts[j].address]))}))};
  writeFileSync('.local/settlement-abi.json',JSON.stringify(input));
  const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/custody.cjs','.local/settlement-abi.json'],{encoding:'utf8'}));
  modern.forEach((ix,i)=>{assert.equal(Buffer.from(ix.data).toString('hex'),legacy.instructions[i].data);assert.deepEqual(ix.accounts.map(a=>({address:a.address,signer:(a.role&2)!==0,writable:(a.role&1)!==0})),legacy.instructions[i].accounts);});
});
