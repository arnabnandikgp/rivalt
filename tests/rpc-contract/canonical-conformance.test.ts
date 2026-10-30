import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { expect, it } from 'vitest';
import { createNoopSigner } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { CanonicalConformance } from './canonical-maker-conformance.js';

it('records the canonical name by discriminator without a generation suffix', () => {
  const key = sdk.CLEARING_PROGRAM_ADDRESS;
  const instruction = sdk.getInitializeLiquidityInstruction({ authority: createNoopSigner(key), venue: key,
    custody: key, market: key, safety: key, registry: key, eventAuthority: key, program: key });
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
  const fixed=sdk.getAdvanceAccountResolutionInstruction({venue:key,custody:key,safety:key,btc:key,eth:key,
    btcLedger:key,ethLedger:key,vault:key,registry:key,resolution:key,work:key,page:key,
    eventAuthority:key,program:key,epoch:9007199254740993n,stage:5,start:0,length:1});
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
