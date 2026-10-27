import {test} from 'vitest';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNoopSigner,getAddressDecoder,getAddressEncoder,getProgramDerivedAddress,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';

test('account safety preserves isolated Anchor bytes and every stage/optional proof shape',async()=>{
  const key=(value:number)=>getAddressDecoder().decode(new Uint8Array(32).fill(value));
  const payer=createNoopSigner(key(1)),receiverOwner=createNoopSigner(key(2));
  const common={payer,authority:payer,caller:payer,reserveAuthority:payer,receiverOwner,venue:key(3),custody:key(4),safety:key(5),
    btc:key(6),eth:key(7),btcLedger:key(8),ethLedger:key(9),vault:key(10),registry:key(11),resolution:key(12),work:key(13),
    page:key(14),target:key(15),receiver:key(16),certificate:key(17),destination:key(18),quoteMint:key(19),
    primaryBtc:key(20),primaryCollateral:key(21),guardBtc:key(22),guardCollateral:key(23),primaryEth:key(24),guardEth:key(25),
    eventAuthority:key(26),program:sdk.CLEARING_PROGRAM_ADDRESS};
  const large=9007199254740993n,guard={safetyEpoch:large,venueTermsEpoch:1n,nonce:large+1n,stateVersion:9n};
  const cases:{program:string;name:string;args:unknown[];instruction:Instruction}[]=[];
  const add=(name:string,args:unknown[],instruction:Instruction)=>cases.push({program:'clearing',name,args,instruction});
  add('initialize_account_resolution_v3',[],sdk.getInitializeAccountResolutionV3Instruction(common));
  add('initialize_account_resolution_page_v3',[31],sdk.getInitializeAccountResolutionPageV3Instruction({...common,pageIndex:31}));
  for(const emergency of [false,true])add('freeze_accounts_v3',[large,large+1n,emergency],
    sdk.getFreezeAccountsV3Instruction({...common,safetyEpoch:large,resolutionEpoch:large+1n,emergency}));
  add('value_account_resolution_v3',[large],sdk.getValueAccountResolutionV3Instruction({...common,epoch:large}));
  for(const stage of [2,3,5,6,9,10])add('advance_account_resolution_v3',[large,stage,62,1],
    sdk.getAdvanceAccountResolutionV3Instruction({...common,epoch:large,stage,start:62,length:1}));
  for(const length of [24,512]) {
    const bytes=Uint8Array.from({length},(_,index)=>index%256),proposalHash=new Uint8Array(32).fill(255);
    add('propose_account_resolution_v3',[large,2,proposalHash,1024,{$bytes:Buffer.from(bytes).toString('base64')}],
      sdk.getProposeAccountResolutionV3Instruction({...common,epoch:large,evaluation:2,proposalHash,offset:1024,bytes}));
  }
  add('finalize_account_resolution_rates_v3',[large],sdk.getFinalizeAccountResolutionRatesV3Instruction({...common,epoch:large}));
  const orders=[Array.from({length:64},(_,id)=>id),Array.from({length:64},(_,id)=>63-id)];
  add('order_account_resolution_v3',[large,orders],sdk.getOrderAccountResolutionV3Instruction({...common,epoch:large,orders}));
  add('check_account_resolution_order_v3',[large,127],sdk.getCheckAccountResolutionOrderV3Instruction({...common,epoch:large,start:127}));
  add('round_account_resolution_v3',[large,63],sdk.getRoundAccountResolutionV3Instruction({...common,epoch:large,start:63}));
  for(const resume of [false,true])add('recover_accounts_v3',[large,resume],sdk.getRecoverAccountsV3Instruction({...common,epoch:large,resume}));
  add('reactivate_accounts_v3',[large],sdk.getReactivateAccountsV3Instruction({...common,epoch:large}));
  add('initialize_account_retirement_v3',[],sdk.getInitializeAccountRetirementV3Instruction(common));
  add('check_account_retirement_v3',[62],sdk.getCheckAccountRetirementV3Instruction({...common,start:62}));
  for(const certificate of [undefined,common.certificate])for(const resolution of [undefined,common.resolution])
    add('retire_accounts_v3',[large],sdk.getRetireAccountsV3Instruction({...common,certificate,resolution,safetyEpoch:large}));
  for(const marketIndex of [0,1]) {
    add('withdraw_retired_reserve_v3',[marketIndex,large],sdk.getWithdrawRetiredReserveV3Instruction({...common,marketIndex,amount:large}));
    add('liquidate_account_v3',[guard,guard,marketIndex,large,large+1n],
      sdk.getLiquidateAccountV3Instruction({...common,targetGuard:guard,receiverGuard:guard,marketIndex,lots:large,price:large+1n}));
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
  const directory=mkdtempSync(join(tmpdir(),'rivalt-p26-conformance-'));
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
    assert.equal(cases.length,30);
  }finally{rmSync(directory,{recursive:true});}
});
