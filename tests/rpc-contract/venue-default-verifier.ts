// The numerical witness is derived independently from the funded book in the signed workload.
import assert from 'node:assert/strict';
import type {Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {CanonicalConformance} from './canonical-maker-conformance.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import type {openCanonicalRpcHarness} from './canonical-rpc-harness.js';

type Transport=Awaited<ReturnType<typeof openCanonicalRpcHarness>>;
export async function verifyVenueDefault(setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,roster:Address[],
  transport:Pick<Transport,'h'|'rpc'|'checks'|'flush'>,directory:string) {
  const {h,rpc,checks,flush}=transport;
  const ordered=(await Promise.all(roster.map(async key=>({key,id:sdk.getMarginAccountDecoder().decode((await h.read(key))!).id}))))
    .sort((a,b)=>a.id<b.id?-1:1).map(row=>row.key);
  const accounts={...setup.safetyCommon,btcLedger:setup.ledgers[0],ethLedger:setup.ledgers[1]};
  // 996 in the pool + 11,504 collectible + six insured, divided by 996+19,002 due.
  // Conceding 7,492 of the maker's 19,002-atom open gain brings all remaining claims to par.
  const rates=[9999,6253,9999,1,1,1];
  const make=(selected=1,proposal=rates,keys=ordered,epoch=1n)=>{
    const origin=sdk.getVerifyIndexedDefaultInstruction({...accounts,epoch,denominator:0,selected,rates:proposal});
    return {...origin,accounts:[...origin.accounts,...keys.map(address=>({address,role:0 as const}))]};
  };
  const keys=[...ordered,setup.vault,setup.resolution,setup.safety,...setup.ledgers,...setup.markets];
  const before=await Promise.all(keys.map(h.read));
  const failures=[['missing root',make(1,rates,ordered.slice(1))],['substituted member',make(1,rates,[ordered[0],...ordered.slice(0,-1)])],
    ['stale episode',make(1,rates,ordered,2n)],['forged rate',make(1,[9999,6252,9999,1,1,1])],
    ['skip recoverable gain',make(0)],['trailing witness',make(1,[...rates,1])]] as const;
  for(const [label,ix] of failures) await h.send('verify default reject '+label,[ix],[],sdk.CLEARING_ERROR__RESOLUTION);
  const ix=make();
  await h.send('verify default on complete venue',[ix]);
  await flush();
  const receipt=checks.find(row=>row.label==='verify default on complete venue')!;
  const tx=await rpc.call('getTransaction',[receipt.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
  assert.equal(tx.meta.returnData.programId,sdk.CLEARING_PROGRAM_ADDRESS);
  const bytes=Buffer.from(tx.meta.returnData.data[0],'base64');
  assert.equal(bytes.readUInt32LE(0),11);
  assert.equal(bytes.length,4+11*8);
  const result=Array.from({length:11},(_,i)=>bytes.readBigUInt64LE(4+8*i));
  assert.deepEqual(result,[0n,24_010n,12_500n,12_500n,12_500n,12_500n,1_000_970n,6n,0n,7492n,0n]);
  assert.deepEqual(await Promise.all(keys.map(h.read)),before);
  const parity=new CanonicalConformance();
  parity.record([ix],tx);
  await parity.finish(directory,[],h.read);
  return {receipt,result};
}
