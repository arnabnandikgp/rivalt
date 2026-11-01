import {test} from 'vitest';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNoopSigner,getAddressDecoder,getAddressEncoder,getProgramDerivedAddress,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';

test('account cash preserves isolated Anchor bytes and every optional certificate/token shape',async()=>{
  const key=(value:number)=>getAddressDecoder().decode(new Uint8Array(32).fill(value));
  const owner=createNoopSigner(key(1)),payer=createNoopSigner(key(2));
  const common={owner,payer,actor:payer,feeAuthority:payer,venue:key(3),custody:key(4),safety:key(5),
    btc:key(6),eth:key(7),btcLedger:key(8),ethLedger:key(9),vault:key(10),margin:key(11),
    donor:key(11),recipient:key(12),quoteMint:key(13),userToken:key(14),registry:key(15),certificate:key(16),
    ledger:key(8),eventAuthority:key(17),program:sdk.CLEARING_PROGRAM_ADDRESS};
  const large=9007199254740993n,guard={safetyEpoch:3n,venueTermsEpoch:1n,nonce:large,stateVersion:9n};
  const cases:{program:string;name:string;args:unknown[];instruction:Instruction}[]=[];
  const add=(name:string,args:unknown[],instruction:Instruction)=>cases.push({program:'clearing',name,args,instruction});
  for(const marketIndex of [0,1])add('initialize_market_backing',[marketIndex],await sdk.getInitializeMarketBackingInstructionAsync({...common,marketIndex}));
  add('check_market_backing',[62],sdk.getCheckMarketBackingInstruction({...common,start:62}));
  add('withdraw_funded_account',[guard,large],sdk.getWithdrawFundedAccountInstruction({...common,guard,amount:large}));
  add('transfer_funded_account',[guard,large],sdk.getTransferFundedAccountInstruction({...common,guard,amount:large}));
  add('net_account_claims',[guard,1,large],sdk.getNetAccountClaimsInstruction({...common,guard,sourceMarket:1,amount:large}));
  for(const certificate of [undefined,common.certificate]) {
    add('collect_account_loss',[1,large],sdk.getCollectAccountLossInstruction({...common,certificate,marketIndex:1,amount:large}));
    add('pay_account_gain',[1,large],sdk.getPayAccountGainInstruction({...common,certificate,marketIndex:1,amount:large}));
  }
  add('allocate_market_fees',[1,large],sdk.getAllocateMarketFeesInstruction({...common,marketIndex:1,amount:large}));
  add('withdraw_market_fees',[1,large],sdk.getWithdrawMarketFeesInstruction({...common,marketIndex:1,amount:large}));
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
  const directory=mkdtempSync(join(tmpdir(),'rivalt-p25-conformance-'));
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
    assert.equal(cases.length,12);
  }finally{rmSync(directory,{recursive:true});}
});
