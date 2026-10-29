import {it,expect} from 'vitest';
import {Keypair} from '@solana/web3.js';
import {blockhash} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../indexer/src/events.js';
import {assertLiquidityInputWire} from './liquidity-inputs.js';

it('binds retained input/calculation to the original signed report across JSONB key order',async()=>{
  const payer=await Keypair.fromSeed(new Uint8Array(32).fill(44));
  const report:sdk.FundingReportV4={version:1,domain:new Uint8Array(32).fill(1),market:payer.address,authorityEpoch:2n,sequence:4n,
    expectedObservationSequence:6n,expectedConfigEpoch:1n,expectedTermsEpoch:1n,observedSlot:100n,observedTime:20n,
    validUntilSlot:150n,validUntilTime:26n,referencePrice:60000n,quantity:100n,bid:5999800n,ask:6000300n,outcome:0,inputDigest:new Uint8Array(32).fill(9)};
  const data=sdk.getPublishFundingReportV4InstructionDataEncoder().encode({report});
  const {transaction}=await sdk.signCanonicalInstructions({getLatestBlockhash:async()=>({blockhash:blockhash('11111111111111111111111111111111'),lastValidBlockHeight:200n})},
    payer,[{programAddress:sdk.CLEARING_PROGRAM_ADDRESS,accounts:[],data}],{computeUnitLimit:200000,loadedAccountsDataSizeLimit:8388608});
  const wire=Buffer.from(transaction.serialize()).toString('base64'),calculation={kind:'funding-report-v1',report};
  expect(()=>assertLiquidityInputWire(wire,sdk.hex(report.inputDigest),calculation)).not.toThrow();
  const stored=JSON.parse(json(calculation));stored.report=Object.fromEntries(Object.entries(stored.report).reverse());
  expect(()=>assertLiquidityInputWire(wire,sdk.hex(report.inputDigest),stored)).not.toThrow();
  for(const mutate of [(value:any)=>value.report.ask='6000301',(value:any)=>value.report.authorityEpoch='3',
    (value:any)=>value.report.inputDigest='aa'.repeat(32),(value:any)=>value.kind='untrusted']) {
    const changed=structuredClone(stored);mutate(changed);expect(()=>assertLiquidityInputWire(wire,sdk.hex(report.inputDigest),changed)).toThrow(/differs/);
  }
  expect(()=>assertLiquidityInputWire(wire,'aa'.repeat(32),stored)).toThrow(/differs/);
});
