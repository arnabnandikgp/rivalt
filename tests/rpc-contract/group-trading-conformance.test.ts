import {test} from 'vitest';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNoopSigner,getAddressDecoder,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';

test('group primitives preserve isolated Anchor bytes, optional accounts and all order variants',async()=>{
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
  const preview:sdk.PreviewArgsArgs={side:1,lots:9n,referencePrice:30_000n,quoteEpoch:4n,authorityEpoch:5n,termsEpoch:1n,configEpoch:2n};
  const quote:sdk.makerA.QuoteRequestArgs={version:2,domain,market:common.market,capital:common.capital,quoteEpoch:4n,authorityEpoch:5n,termsEpoch:1n,
    marketConfigEpoch:2n,side:1,lots:9n,inventory:-4n,cash:large,inventoryLimit:100n,consumed:11n,referencePrice:30_000n,slot:large};
  const cases:{program:string;name:string;args:unknown[];instruction:Instruction}[]=[];
  const add=(name:string,args:unknown[],instruction:Instruction,program='clearing')=>cases.push({program,name,args,instruction});
  add('register_group_maker_v2',[1,100n],await sdk.getRegisterGroupMakerV2InstructionAsync({...common,makerId:1,inventoryLimit:100n}));
  for(const operation of [0,1,2])add('update_group_maker_v2',[operation],sdk.getUpdateGroupMakerV2Instruction({...common,coSigner:operation===0?authority:undefined,operation}));
  add('preview_group_maker_v2',[preview],sdk.getPreviewGroupMakerV2Instruction({...common,args:preview}));
  add('initialize_group_oracle_v2',[key(26),key(27)],sdk.getInitializeGroupOracleV2Instruction({...common,primary:key(26),guard:key(27)}));
  add('sample_group_oracle_v2',[],sdk.getSampleGroupOracleV2Instruction(common));
  for(const operation of [
    {__kind:'Place',expectedId:large,terms}, {__kind:'Replace',id:large,version:2n,terms},
    {__kind:'Protect',expectedId:large,takeProfit:terms,stopLoss:{...terms,trigger:1}},
    {__kind:'Cancel',id:large,version:2n,protectionGroup:true}, {__kind:'Cleanup'},
  ] satisfies sdk.GroupOrderActionArgs[])add('manage_group_order_v2',[operation],sdk.getManageGroupOrderV2Instruction({...common,operation}));
  add('execute_group_route_v2',[intent],sdk.getExecuteGroupRouteV2Instruction({...common,intent}));
  add('execute_group_route_v2',[intent],sdk.getExecuteGroupRouteV2Instruction({...common,secondCapital:undefined,secondRegistration:undefined,
    secondProgram:undefined,secondProgramData:undefined,secondConfig:undefined,intent}));
  add('execute_group_order_v2',[execution],sdk.getExecuteGroupOrderV2Instruction({...common,args:execution}));
  for(const [api,program] of [[sdk.makerA,'maker_a'],[sdk.makerB,'maker_b']] as const){
    add('initialize_group_config',[3600n],await api.getInitializeGroupConfigInstructionAsync({...common,duration:3600n}),program);
    add('publish_group_epoch',[3600n],api.getPublishGroupEpochInstruction({...common,duration:3600n}),program);
    add('quote_group',[{group:common.group,quote}],api.getQuoteGroupInstruction({...common,quote}),program);
  }
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
  const directory=mkdtempSync(join(tmpdir(),'rivalt-p18b-conformance-'));
  try{
    const input=cases.map(entry=>{
      const idl=JSON.parse(readFileSync(`packages/sdk/idl/${entry.program}.json`,'utf8'));
      const definition=idl.instructions.find((instruction:{name:string})=>instruction.name===entry.name);
      assert(definition);assert.equal(definition.accounts.length,entry.instruction.accounts!.length);
      return {program:entry.program,name:entry.name.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),args:entry.args.map(tagged),
        accounts:Object.fromEntries(definition.accounts.map((account:{name:string;optional?:boolean},index:number)=>[
          account.name.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),account.optional && entry.instruction.accounts![index].address===idl.address?null:entry.instruction.accounts![index].address]))};
    });
    const file=join(directory,'input.json');writeFileSync(file,JSON.stringify(input));
    const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/group-trading.cjs',file],{encoding:'utf8'}));
    assert.equal(legacy.length,cases.length);
    for(const [index,result] of legacy.entries()){
      assert.equal(result.data,Buffer.from(cases[index].instruction.data!).toString('hex'),cases[index].name);
      assert.deepEqual(result.accounts,cases[index].instruction.accounts!.map(account=>({address:account.address,signer:account.role>=2,writable:account.role%2===1})),cases[index].name);
    }
    assert.equal(cases.length,21);
  }finally{rmSync(directory,{recursive:true});}
});
