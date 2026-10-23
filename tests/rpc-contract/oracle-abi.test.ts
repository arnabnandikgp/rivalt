import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {addresses,payerKey} from './custody-cases.js';
import {makerAddresses} from './maker-cases.js';
import {feedAddress} from './oracle-fixture.js';
it('matches oracle activation and full-maker sampling bytes and flags against isolated legacy Anchor',async()=>{
  const a=await addresses(),payer=await payerKey(),[routeState]=await sdk.findRouteStatePda({market:a.market}),[x,y]=await Promise.all([0,1].map(makerAddresses)),feeds=await Promise.all([0,1,2,3].map(feedAddress));
  const init={authority:payer.address,market:a.market,routeState,eventAuthority:a.eventAuthority,program:a.program};
  const sample={market:a.market,routeState,primaryBtc:feeds[0].feed,primaryCollateral:feeds[1].feed,guardBtc:feeds[2].feed,guardCollateral:feeds[3].feed,
    firstCapital:x.capital,firstRegistration:x.registration,firstProgram:x.pricingProgram,firstProgramData:x.programData,firstConfig:x.config,
    secondCapital:y.capital,secondRegistration:y.registration,secondProgram:y.pricingProgram,secondProgramData:y.programData,secondConfig:y.config,eventAuthority:a.eventAuthority,program:a.program};
  const modern=[await sdk.getInitializeOracleInstructionAsync({...init,authority:payer,primary:feeds[0].authority.address,guard:feeds[2].authority.address}),await sdk.getSampleOracleInstructionAsync(sample)];
  writeFileSync('.local/p07-abi.json',JSON.stringify({instructions:[{program:'clearing',name:'initializeOracle',args:[{$address:feeds[0].authority.address},{$address:feeds[2].authority.address}],accounts:init},{program:'clearing',name:'sampleOracle',args:[],accounts:sample}]}));
  const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/makers.cjs','.local/p07-abi.json'],{encoding:'utf8'}));
  modern.forEach((ix,i)=>{assert.equal(Buffer.from(ix.data!).toString('hex'),legacy.instructions[i].data);assert.deepEqual(ix.accounts!.map(a=>({address:a.address,signer:(a.role&2)!==0,writable:(a.role&1)!==0})),legacy.instructions[i].accounts);});
  assert.equal(modern[1].accounts.length,18);assert(modern[1].accounts.slice(2).every(a=>a.role===0));
});
