import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { expect, it } from 'vitest';
import { createNoopSigner, getBase58Decoder } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { CanonicalConformance } from './canonical-maker-conformance.js';

it('records the canonical name by discriminator without a generation suffix', () => {
  const key = sdk.CLEARING_PROGRAM_ADDRESS;
  const instruction = sdk.getInitializeLiquidityInstruction({ authority: createNoopSigner(key), venue: key,
    market: key, safety: key, registry: key, eventAuthority: key, program: key });
  const conformance = new CanonicalConformance();
  conformance.record([instruction]);
  expect(conformance.modules[0].instructions).toHaveLength(1);
  expect(conformance.modules[0].instructions[0].name).toBe('initializeLiquidity');
  expect(conformance.modules[0].instructions[0].expected.data).toBe(Buffer.from(instruction.data).toString('hex'));
});

it('cannot report instruction parity for an empty selection', async () => {
  await expect(new CanonicalConformance().finish('unused', [], async () => null))
    .rejects.toThrow('No instructions captured for Anchor conformance');
});

it('compares nested resolution contexts and every dynamic page meta with isolated Anchor',async()=>{
  const key=sdk.CLEARING_PROGRAM_ADDRESS;
  const fixed=sdk.getAdvancePreparedMembershipInstruction({venue:key,custody:key,safety:key,btc:key,eth:key,
    btcLedger:key,ethLedger:key,vault:key,registry:key,resolution:key,storage:key,prepared:key,index:key,
    eventAuthority:key,program:key,epoch:9007199254740993n,revision:4n});
  const remaining=[{address:sdk.makerA.MAKER_A_PROGRAM_ADDRESS,role:0 as const},
    {address:sdk.makerB.MAKER_B_PROGRAM_ADDRESS,role:1 as const}];
  const conformance=new CanonicalConformance();
  conformance.record([{...fixed,accounts:[...fixed.accounts,...remaining]}]);
  expect(conformance.modules[0].instructions[0].remainingAccounts).toEqual([
    {address:remaining[0].address,signer:false,writable:false},{address:remaining[1].address,signer:false,writable:true}]);
  expect(()=>new CanonicalConformance().record([{...fixed,accounts:fixed.accounts.slice(0,-1)}])).toThrow(/missing fixed IDL account/);
  const directory=mkdtempSync(join(tmpdir(),'rivalt-current-conformance-'));
  try{const result=await conformance.finish(directory,[],async()=>null);expect(result[0].instructions).toBe(1);}
  finally{rmSync(directory,{recursive:true});}
});

it('encodes full-width paged rate limbs through the isolated Anchor client',async()=>{
  const key=sdk.CLEARING_PROGRAM_ADDRESS,conformance=new CanonicalConformance();
  conformance.record([sdk.getUploadSettlementRateInstruction({venue:key,custody:key,safety:key,btc:key,eth:key,
    btcLedger:key,ethLedger:key,vault:key,registry:key,resolution:key,storage:key,prepared:key,rates:key,page:key,
    proposer:createNoopSigner(key),eventAuthority:key,program:key,epoch:9007199254740993n,revision:7n,attempt:2n,market:1,
    offset:9007199254740994n,words:[0n,9007199254740993n,18446744073709551615n]})]);
  const payload=sdk.getAccountResolutionRatesEventEncoder().encode({venue:key,slot:100n,epoch:9007199254740993n,
    evaluation:2,proposalHash:new Uint8Array(32).fill(255),outcome:3,nextEvaluation:2,clippedMask:0,budgets:[7n,8n],insuranceSpent:[1n,2n]});
  conformance.record([],{meta:{err:null,innerInstructions:[{instructions:[{programIdIndex:0,
    data:getBase58Decoder().decode(Buffer.concat([Buffer.alloc(8),Buffer.from(payload)]))}]}]},
    transaction:{message:{accountKeys:[key]}}});
  const directory=mkdtempSync(join(tmpdir(),'rivalt-proposal-conformance-'));
  try{const result=await conformance.finish(directory,[],async()=>null);expect(result[0].instructions).toBe(1);expect(result[0].events).toBe(1);}
  finally{rmSync(directory,{recursive:true});}
});
