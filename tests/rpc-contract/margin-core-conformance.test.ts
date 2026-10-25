import {test} from 'vitest';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNoopSigner,getAddressDecoder,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';

test('whole-account instructions match isolated Anchor with exact snapshots and nested accounts',async()=>{
  const key=(value:number)=>getAddressDecoder().decode(new Uint8Array(32).fill(value));
  const owner=createNoopSigner(key(1)),authority=createNoopSigner(key(2));
  const common={owner,authority,actor:owner,coSigner:authority,group:key(3),market:key(4),capital:key(5),registration:key(6),
    groupBinding:key(7),pricingProgram:sdk.makerA.MAKER_A_PROGRAM_ADDRESS,programData:key(8),config:key(9),
    eventAuthority:key(10),program:sdk.CLEARING_PROGRAM_ADDRESS,margin:key(11),vault:key(12),trader:key(13),
    firstCapital:key(14),firstRegistration:key(15),firstProgram:sdk.makerA.MAKER_A_PROGRAM_ADDRESS,firstProgramData:key(16),firstConfig:key(17),
    secondCapital:key(18),secondRegistration:key(19),secondProgram:sdk.makerB.MAKER_B_PROGRAM_ADDRESS,secondProgramData:key(20),secondConfig:key(21),
    primaryAsset:key(22),primaryCollateral:key(23),guardAsset:key(24),guardCollateral:key(25)};
  const large=9007199254740993n,domain=new Uint8Array(32).fill(31);
  const terms:sdk.OrderTermsArgs={side:1,lots:9n,limit:30_000n,feeBudget:77n,startSlot:large,expirySlot:large+100n,
    trigger:2,threshold:29_000n,reduceOnly:true,generation:3n};
  const intent:sdk.RouteIntentArgs={domain,termsEpoch:1n,configEpoch:2n,observationSequence:3n,nonce:large,startSlot:large,expirySlot:large+100n,
    side:1,lots:9n,allInLimit:200_000n,maxFee:77n,reduceOnly:true,generation:3n,legs:[{lots:9n,quoteEpoch:4n,authorityEpoch:5n}]};
  const execution:sdk.OrderExecutionArgs={id:large,version:2n,filled:1n,observationSequence:3n,startSlot:large,expirySlot:large+100n,lots:9n,legs:intent.legs};
  const cases:{program:string;name:string;args:unknown[];instruction:Instruction}[]=[];
  const add=(name:string,args:unknown[],instruction:Instruction,program='clearing')=>cases.push({program,name,args,instruction});
  const snapshot={sequence:large,observations:[large+1n,large+2n]};
  const whole={...common,...snapshot,otherMarket:key(26),btc:key(4),eth:key(26)};
  for(const [delegate,expirySlot] of [[key(27),large],[key(0),0n]] as const)
    add('set_margin_delegate_v2',[delegate,expirySlot],sdk.getSetMarginDelegateV2Instruction({...whole,delegate,expirySlot}));
  add('net_margin_claims_v2',[snapshot.sequence,snapshot.observations],sdk.getNetMarginClaimsV2Instruction(whole));
  for(const operation of [
    {__kind:'Place',expectedId:large,terms}, {__kind:'Replace',id:large,version:2n,terms},
    {__kind:'Protect',expectedId:large,takeProfit:terms,stopLoss:{...terms,trigger:1}},
    {__kind:'Cancel',id:large,version:2n,protectionGroup:true},
    {__kind:'Cancel',id:large,version:2n,protectionGroup:false}, {__kind:'Cleanup'},
  ] satisfies sdk.GroupOrderActionArgs[])add('manage_margin_order_v2',[snapshot.sequence,snapshot.observations,operation],sdk.getManageMarginOrderV2Instruction({...whole,operation}));
  add('execute_margin_route_v2',[snapshot.sequence,snapshot.observations,intent],sdk.getExecuteMarginRouteV2Instruction({...whole,intent}));
  add('execute_margin_route_v2',[snapshot.sequence,snapshot.observations,intent],sdk.getExecuteMarginRouteV2Instruction({...whole,
    secondCapital:undefined,secondRegistration:undefined,secondProgram:undefined,secondProgramData:undefined,secondConfig:undefined,intent}));
  add('execute_margin_order_v2',[snapshot.sequence,snapshot.observations,execution],sdk.getExecuteMarginOrderV2Instruction({...whole,args:execution}));
  function tagged(value:unknown):unknown {
    if(typeof value==='bigint')return {$bn:value.toString()};
    if(typeof value==='string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))return {$pubkey:value};
    if(value instanceof Uint8Array)return [...value];
    if(Array.isArray(value))return value.map(tagged);
    if(value && typeof value==='object'){
      const entries=Object.entries(value),kind=entries.find(([name])=>name==='__kind');
      if(kind)return {[String(kind[1]).replace(/^./,letter=>letter.toLowerCase())]:Object.fromEntries(entries.filter(([name])=>name!=='__kind').map(([name,item])=>[name,tagged(item)]))};
      return Object.fromEntries(entries.map(([name,item])=>[name,tagged(item)]));
    }
    return value;
  }
  const directory=mkdtempSync(join(tmpdir(),'rivalt-p19-conformance-'));
  try{
    const input=cases.map(entry=>{
      const idl=JSON.parse(readFileSync(`packages/sdk/idl/${entry.program}.json`,'utf8'));
      const definition=idl.instructions.find((instruction:{name:string})=>instruction.name===entry.name);
      assert(definition);
      let cursor=0;
      type Definition={name:string;optional?:boolean;accounts?:Definition[]};
      const mapped=(definitions:Definition[]):unknown=>Object.fromEntries(definitions.map(account=>[
        account.name.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),
        account.accounts?mapped(account.accounts):(()=>{const key=entry.instruction.accounts![cursor++].address;return account.optional&&key===idl.address?null:key;})()]));
      const accounts=mapped(definition.accounts);assert.equal(cursor,entry.instruction.accounts!.length);
      return {program:entry.program,name:entry.name.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),args:entry.args.map(tagged),accounts};
    });
    const file=join(directory,'input.json');writeFileSync(file,JSON.stringify(input));
    const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/group-trading.cjs',file],{encoding:'utf8'}));
    assert.equal(legacy.length,cases.length);
    for(const [index,result] of legacy.entries()){
      assert.equal(result.data,Buffer.from(cases[index].instruction.data!).toString('hex'),cases[index].name);
      assert.deepEqual(result.accounts,cases[index].instruction.accounts!.map(account=>({address:account.address,signer:account.role>=2,writable:account.role%2===1})),cases[index].name);
    }
    assert.equal(cases.length,12);
  }finally{rmSync(directory,{recursive:true});}
});
