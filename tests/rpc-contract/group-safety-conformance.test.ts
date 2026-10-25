import {test} from 'vitest';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNoopSigner,getAddressDecoder,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';

test('group safety matches isolated Anchor including nested cash authority and both boolean branches',async()=>{
  const key=(value:number)=>getAddressDecoder().decode(new Uint8Array(32).fill(value));
  const signer=createNoopSigner(key(1)),large=9007199254740993n;
  const common={authority:signer,owner:signer,receiverOwner:signer,caller:signer,group:key(2),btc:key(3),eth:key(4),
    registry:key(5),guard:key(6),resolution:key(7),vault:key(8),margin:key(9),target:key(10),receiver:key(11),
    donor:key(12),recipient:key(13),quoteMint:key(14),userToken:key(15),primaryBtc:key(16),primaryCollateral:key(17),
    guardBtc:key(18),guardCollateral:key(19),primaryEth:key(20),guardEth:key(21),eventAuthority:key(22),program:sdk.CLEARING_PROGRAM_ADDRESS,
    sequence:large,observations:[large+1n,large+2n],epoch:large+3n};
  const cases:{name:string;args:unknown[];instruction:Instruction}[]=[];
  const add=(name:string,args:unknown[],instruction:Instruction)=>cases.push({name,args,instruction});
  add('initialize_group_safety_v2',[],await sdk.getInitializeGroupSafetyV2InstructionAsync(common));
  add('activate_isolated_group_v2',[],sdk.getActivateIsolatedGroupV2Instruction(common));
  add('check_group_exit_v2',[large,common.observations,63],sdk.getCheckGroupExitV2Instruction({...common,start:63}));
  for(const choice of [false,true]) {
    add('change_group_claim_v2',[large,common.observations,1,large,choice],sdk.getChangeGroupClaimV2Instruction({...common,marketIndex:1,amount:large,gain:choice}));
    add('group_trading_cash_v2',[large,common.observations,large,choice],sdk.getGroupTradingCashV2Instruction({...common,amount:large,withdraw:choice}));
    add('freeze_group_v2',[large,common.observations,choice],sdk.getFreezeGroupV2Instruction({...common,emergency:choice}));
    add('recover_group_resolution_v2',[common.epoch,choice],sdk.getRecoverGroupResolutionV2Instruction({...common,resume:choice}));
  }
  add('transfer_trading_cash_v2',[large,common.observations,large],sdk.getTransferTradingCashV2Instruction({...common,amount:large}));
  add('liquidate_group_v2',[large,common.observations,1,4608n,100_000n],sdk.getLiquidateGroupV2Instruction({...common,marketIndex:1,lots:4608n,price:100_000n}));
  add('advance_group_resolution_v2',[common.epoch,10,63],sdk.getAdvanceGroupResolutionV2Instruction({...common,stage:10,start:63}));
  add('allocate_group_fees_v2',[large],sdk.getAllocateGroupFeesV2Instruction({...common,amount:large}));
  const idl=JSON.parse(readFileSync('packages/sdk/idl/clearing.json','utf8'));
  const camel=(name:string)=>name.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase());
  const tag=(value:unknown):unknown=>typeof value==='bigint'?{$bn:value.toString()}:Array.isArray(value)?value.map(tag):value;
  type IdlAccount={name:string;accounts?:IdlAccount[]};
  const input=cases.map(entry=>{
    let cursor=0;
    const accounts=(definitions:IdlAccount[]):unknown=>Object.fromEntries(definitions.map(definition=>[
      camel(definition.name),definition.accounts?accounts(definition.accounts):entry.instruction.accounts![cursor++].address]));
    const mapped=accounts(idl.instructions.find((definition:{name:string})=>definition.name===entry.name).accounts);
    assert.equal(cursor,entry.instruction.accounts!.length);
    return {program:'clearing',name:camel(entry.name),args:entry.args.map(tag),accounts:mapped};
  });
  const directory=mkdtempSync(join(tmpdir(),'rivalt-p18c-abi-'));
  try {
    const file=join(directory,'input.json');writeFileSync(file,JSON.stringify(input));
    const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/group-trading.cjs',file],{encoding:'utf8'}));
    assert.equal(legacy.length,15);
    for(const [index,result] of legacy.entries()) {
      assert.equal(result.data,Buffer.from(cases[index].instruction.data!).toString('hex'),cases[index].name);
      assert.deepEqual(result.accounts,cases[index].instruction.accounts!.map(account=>({address:account.address,
        signer:account.role>=2,writable:account.role%2===1})),cases[index].name);
    }
  } finally {rmSync(directory,{recursive:true});}
});
