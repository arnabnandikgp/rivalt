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
    storage:key(13),members:key(14),prepared:key(27),index:key(28),rates:key(29),proposer:payer,actor:payer,page:key(14),target:key(15),receiver:key(16),certificate:key(17),destination:key(18),quoteMint:key(19),
    primaryBtc:key(20),primaryCollateral:key(21),guardBtc:key(22),guardCollateral:key(23),primaryEth:key(24),guardEth:key(25),
    eventAuthority:key(26),program:sdk.CLEARING_PROGRAM_ADDRESS};
  const large=9007199254740993n,guard={safetyEpoch:large,venueTermsEpoch:1n,nonce:large+1n,stateVersion:9n};
  const cases:{program:string;name:string;args:unknown[];instruction:Instruction}[]=[];
  const add=(name:string,args:unknown[],instruction:Instruction)=>cases.push({program:'clearing',name,args,instruction});
  add('initialize_account_resolution',[],sdk.getInitializeAccountResolutionInstruction(common));
  add('activate_liquidity',[],sdk.getActivateLiquidityInstruction(common));
  add('initialize_prepared_settlement',[large,large+1n],sdk.getInitializePreparedSettlementInstruction({...common,epoch:large,sourceRevision:large+1n}));
  for(const emergency of [false,true])add('freeze_accounts',[large,large+1n,emergency],
    sdk.getFreezeAccountsInstruction({...common,safetyEpoch:large,resolutionEpoch:large+1n,emergency}));
  add('value_account_resolution',[large],sdk.getValueAccountResolutionInstruction({...common,epoch:large}));
  add('advance_prepared_membership',[large,large+1n],sdk.getAdvancePreparedMembershipInstruction({...common,epoch:large,revision:large+1n}));
  const factor=[large,0n,0n,0n,0n],lengths=[1n,2n];
  add('begin_settlement_rate_proposal',[large,large+1n,factor,lengths],sdk.getBeginSettlementRateProposalInstruction({...common,epoch:large,revision:large+1n,factor,lengths}));
  for(const length of [1,32]) {
    const words=Array.from({length},(_,index)=>large+BigInt(index));
    add('upload_settlement_rate',[large,large+1n,2n,1,large+2n,words],sdk.getUploadSettlementRateInstruction({...common,
      epoch:large,revision:large+1n,attempt:2n,market:1,offset:large+2n,words}));
  }
  for(const resume of [false,true])add('recover_accounts',[large,resume],sdk.getRecoverAccountsInstruction({...common,epoch:large,resume}));
  add('reactivate_accounts',[large],sdk.getReactivateAccountsInstruction({...common,epoch:large}));
  add('initialize_account_retirement',[],sdk.getInitializeAccountRetirementInstruction(common));
  add('check_account_retirement',[large,true],sdk.getCheckAccountRetirementInstruction({...common,revision:large,restart:true}));
  for(const certificate of [undefined,common.certificate])for(const resolution of [undefined,common.resolution])
    add('retire_accounts',[large],sdk.getRetireAccountsInstruction({...common,certificate,resolution,safetyEpoch:large}));
  for(const marketIndex of [0,1]) {
    add('withdraw_retired_reserve',[marketIndex,large],sdk.getWithdrawRetiredReserveInstruction({...common,ledger:common.btcLedger,marketIndex,amount:large}));
    add('liquidate_account',[guard,guard,marketIndex,large,large+1n],
      sdk.getLiquidateAccountInstruction({...common,targetGuard:guard,receiverGuard:guard,marketIndex,lots:large,price:large+1n}));
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
      assert(definition,`Unknown IDL fixture instruction: ${entry.name}`);
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
    const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/wire.cjs',file],{encoding:'utf8'}));
    assert.equal(legacy.length,cases.length);
    for(const [index,result] of legacy.entries()){
      assert.equal(result.data,Buffer.from(cases[index].instruction.data!).toString('hex'),cases[index].name);
      assert.deepEqual(result.accounts,cases[index].instruction.accounts!.map(account=>({address:account.address,signer:account.role>=2,writable:account.role%2===1})),cases[index].name);
    }
    assert.equal(cases.length,23);
  }finally{rmSync(directory,{recursive:true});}
});
