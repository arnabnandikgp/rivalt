import assert from 'node:assert/strict';
import {AccountRole, type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';

export type ProtectionReference = {
  prefixes: Record<'ownCashUpper'|'linkedFace'|'incomingDebt'|'budget', string[]>[];
  caps:string[];
};

export async function verifyForeignProtection(
  h:CanonicalHarness, setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,
  prepared:Address,rates:Address,attempt:bigint,pages:Address[],registers:Address[],
  revisions:bigint[],reference:ProtectionReference,
) {
  const header = async()=>sdk.getPreparedSettlementDecoder().decode((await h.read(prepared))!);
  const initial=await header();
  assert.equal(sdk.foreignProtectionProgress(initial),null);
  const untouched=[rates,setup.resolution,...pages,...registers];
  const readOthers=()=>Promise.all(untouched.map(key=>h.read(key)));
  const before=await readOthers();
  const instruction=async(index:number)=>{
    const final=index===pages.length-1;
    const ix=sdk.getScanForeignProtectionInstruction({...setup.safetyCommon,prepared,rates,
      page:pages[index],epoch:initial.epoch,pageIndex:BigInt(index),attempt,
      revision:(await header()).revision,pageRevisions:final?revisions:Array<bigint>(7).fill(0n)});
    return {...ix,accounts:[...ix.accounts,...(final?registers:[]).map(address=>({address,role:AccountRole.READONLY}))]};
  };
  const reject=async(label:string,index:number)=>{
    const bytes=await h.read(prepared);
    await h.send(label,[await instruction(index)],[],sdk.CLEARING_ERROR__RESOLUTION);
    assert.deepEqual(await h.read(prepared),bytes);
  };
  assert.equal(reference.prefixes.length,pages.length);
  await reject('reject out-of-order start of foreign cap scan',1);
  for(const [index,expected] of reference.prefixes.entries()) {
    await h.send(index===pages.length-1?'seal protected foreign charge caps':'advance protected foreign charge bounds',[await instruction(index)]);
    const next=await header();
    const progress=sdk.foreignProtectionProgress(next)!;
    assert.equal(progress.members,BigInt(Math.min((index+1)*8,Number(initial.count))));
    assert.equal(progress.attempt,attempt);
    for(const field of ['ownCashUpper','linkedFace','incomingDebt','budget'] as const)
      assert.deepEqual(progress[field].map(String),expected[field]);
    assert.deepEqual(progress.linkedCaps?.map(String)??null,index===pages.length-1?reference.caps:null);
    if(index===0)await reject('reject repeated foreign cap prefix',0);
  }
  await reject('reject resealing completed foreign cap scan',pages.length-1);
  assert.deepEqual(await readOthers(),before);
  return reference.caps;
}
