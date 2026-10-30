import {test} from 'vitest';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNoopSigner,getAddressDecoder,getAddressEncoder,getProgramDerivedAddress,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';

test('account primitives preserve isolated Anchor bytes, optional accounts and all order variants',async()=>{
  const key=(value:number)=>getAddressDecoder().decode(new Uint8Array(32).fill(value));
  const owner=createNoopSigner(key(1)),authority=createNoopSigner(key(2));
  const common={owner,authority,actor:owner,coSigner:authority,venue:key(3),market:key(4),capital:key(5),registration:key(6),
    capitalBinding:key(7),pricingProgram:sdk.makerA.MAKER_A_PROGRAM_ADDRESS,programData:key(8),config:key(9),
    eventAuthority:key(10),program:sdk.CLEARING_PROGRAM_ADDRESS,margin:key(11),vault:key(12),trader:key(13),
    firstCapital:key(14),firstRegistration:key(15),firstProgram:sdk.makerA.MAKER_A_PROGRAM_ADDRESS,firstProgramData:key(16),firstConfig:key(17),
    secondCapital:key(18),secondRegistration:key(19),secondProgram:sdk.makerB.MAKER_B_PROGRAM_ADDRESS,secondProgramData:key(20),secondConfig:key(21),
    primaryAsset:key(22),primaryCollateral:key(23),guardAsset:key(24),guardCollateral:key(25),custody:key(26),safety:key(27),otherMarket:key(28),ledger:key(29),otherLedger:key(30),btc:key(4),eth:key(28),btcLedger:key(29),ethLedger:key(30)};
  const large=9007199254740993n,domain=new Uint8Array(32).fill(31);
  const terms:sdk.OrderTermsArgs={side:1,lots:9n,limit:30_000n,feeBudget:77n,startSlot:large,expirySlot:large+100n,
    trigger:2,threshold:29_000n,reduceOnly:true,generation:3n};
  const guard:sdk.AccountGuardArgs={safetyEpoch:3n,venueTermsEpoch:1n,nonce:large,stateVersion:9n};
  const intent:sdk.ExecuteAccountRouteInstructionDataArgs={guard,domain,termsEpoch:1n,configEpoch:2n,startSlot:large,expirySlot:large+100n,
    side:1,lots:9n,allInLimit:200_000n,maxFee:77n,reduceOnly:true,generation:3n,legs:[{lots:9n,quoteEpoch:4n,authorityEpoch:5n,expectedConsumed:large}]};
  const execution:sdk.ExecuteAccountOrderInstructionDataArgs={guard,id:large,version:2n,filled:1n,startSlot:large,expirySlot:large+100n,lots:9n,legs:intent.legs};
  const preview:sdk.PreviewArgsArgs={side:1,lots:9n,referencePrice:30_000n,quoteEpoch:4n,authorityEpoch:5n,termsEpoch:1n,configEpoch:2n};
  const quote:sdk.makerA.QuoteRequestArgs={version:3,domain,market:common.market,capital:common.capital,quoteEpoch:4n,authorityEpoch:5n,termsEpoch:1n,
    marketConfigEpoch:2n,side:1,lots:9n,inventory:-4n,cash:large,inventoryLimit:100n,consumed:11n,referencePrice:30_000n,slot:large};
  const cases:{program:string;name:string;args:unknown[];instruction:Instruction}[]=[];
  const add=(name:string,args:unknown[],instruction:Instruction,program='clearing')=>cases.push({program,name,args,instruction});
  add('register_account_maker_v3',[1,100n],await sdk.getRegisterAccountMakerInstructionAsync({...common,makerId:1,inventoryLimit:100n}));
  for(const operation of [0,1,2])add('update_account_maker_v3',[operation],sdk.getUpdateAccountMakerInstruction({...common,coSigner:operation===0?authority:undefined,operation}));
  add('preview_account_maker_v3',[preview],sdk.getPreviewAccountMakerInstruction({...common,args:preview}));
  add('initialize_account_oracle_v3',[key(26),key(27)],sdk.getInitializeAccountOracleInstruction({...common,primary:key(26),guard:key(27)}));
  add('sample_account_oracle_v3',[],sdk.getSampleAccountOracleInstruction(common));
  for(const operation of [
    {__kind:'Place',expectedId:large,terms}, {__kind:'Replace',id:large,version:2n,terms},
    {__kind:'Protect',expectedId:large,takeProfit:terms,stopLoss:{...terms,trigger:1}},
    {__kind:'Cancel',id:large,version:2n,protectionGroup:true}, {__kind:'Cleanup'},
  ] satisfies sdk.GroupOrderActionArgs[])add('manage_account_order_v3',[guard,1,operation],sdk.getManageAccountOrderInstruction({...common,guard,marketIndex:1,operation}));
  add('execute_account_route_v3',[intent],sdk.getExecuteAccountRouteInstruction({...common,...intent}));
  add('execute_account_route_v3',[intent],sdk.getExecuteAccountRouteInstruction({...common,secondCapital:undefined,secondRegistration:undefined,
    secondProgram:undefined,secondProgramData:undefined,secondConfig:undefined,...intent}));
  add('execute_account_order_v3',[execution],sdk.getExecuteAccountOrderInstruction({...common,...execution}));
  add('qualify_account_trading_v3',[],sdk.getQualifyAccountTradingInstruction(common));
  add('set_account_delegate_v3',[guard,key(31),large],sdk.getSetAccountDelegateInstruction({...common,guard,delegate:key(31),expirySlot:large}));
  for(const [api,program] of [[sdk.makerA,'maker_a'],[sdk.makerB,'maker_b']] as const){
    const programAddress=program==='maker_a'?sdk.makerA.MAKER_A_PROGRAM_ADDRESS:sdk.makerB.MAKER_B_PROGRAM_ADDRESS;
    for(const [namespace,find] of [['maker',api.findConfigPda],['maker-v2',api.findInitializeGroupConfigConfigPda],
      ['maker-v3',api.findAccountConfigPda]] as const)
      assert.deepEqual(await find({capital:common.capital}),await getProgramDerivedAddress({programAddress,
        seeds:[Buffer.from(namespace),getAddressEncoder().encode(common.capital)]}),`${program}: ${namespace} helper identity`);
    add('initialize_account_config',[3600n],await api.getInitializeAccountConfigInstructionAsync({...common,duration:3600n}),program);
    add('publish_account_epoch',[3600n],api.getPublishAccountEpochInstruction({...common,duration:3600n}),program);
    add('quote_account',[{venue:common.venue,quote}],api.getQuoteAccountInstruction({...common,quote}),program);
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
  const directory=mkdtempSync(join(tmpdir(),'rivalt-p24-conformance-'));
  try{
    const input=cases.map(entry=>{
      const idl=JSON.parse(readFileSync(`packages/sdk/idl/${entry.program}.json`,'utf8'));
      const definition=idl.instructions.find((instruction:{name:string})=>instruction.name===entry.name);
      assert(definition);
      let cursor=0;
      const accounts=(definitions:{name:string;optional?:boolean;accounts?:any[]}[]):Record<string,unknown>=>Object.fromEntries(definitions.map(account=>{
        const name=account.name.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase());
        if(account.accounts)return [name,accounts(account.accounts)];
        const address=entry.instruction.accounts![cursor++].address;
        return [name,account.optional && address===idl.address?null:address];
      }));
      const resolved=accounts(definition.accounts);assert.equal(cursor,entry.instruction.accounts!.length);
      return {program:entry.program,name:entry.name.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),args:entry.args.map(tagged),accounts:resolved};
    });
    const file=join(directory,'input.json');writeFileSync(file,JSON.stringify(input));
    const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/group-trading.cjs',file],{encoding:'utf8'}));
    assert.equal(legacy.length,cases.length);
    for(const [index,result] of legacy.entries()){
      assert.equal(result.data,Buffer.from(cases[index].instruction.data!).toString('hex'),cases[index].name);
      assert.deepEqual(result.accounts,cases[index].instruction.accounts!.map(account=>({address:account.address,signer:account.role>=2,writable:account.role%2===1})),cases[index].name);
    }
    assert.equal(cases.length,23);
  }finally{rmSync(directory,{recursive:true});}
});
