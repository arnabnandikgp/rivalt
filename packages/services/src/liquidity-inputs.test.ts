import {it,expect} from 'vitest';
import {Keypair} from '@solana/web3.js';
import {blockhash,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../indexer/src/events.js';
import {assertLiquidityInputWire} from './liquidity-inputs.js';

it('binds retained input/calculation to the original signed report across JSONB key order',async()=>{
  const payer=await Keypair.fromSeed(new Uint8Array(32).fill(44));
  const report:sdk.FundingReport={version:1,domain:new Uint8Array(32).fill(1),market:payer.address,authorityEpoch:2n,sequence:4n,
    expectedObservationSequence:6n,expectedConfigEpoch:1n,expectedTermsEpoch:1n,observedSlot:100n,observedTime:20n,
    validUntilSlot:150n,validUntilTime:26n,referencePrice:60000n,quantity:100n,bid:5999800n,ask:6000300n,outcome:0,inputDigest:new Uint8Array(32).fill(9)};
  const data=sdk.getPublishFundingReportInstructionDataEncoder().encode({report});
  async function sign(instructions:Instruction[]){
    const {transaction}=await sdk.signCanonicalInstructions({getLatestBlockhash:async()=>({blockhash:blockhash('11111111111111111111111111111111'),lastValidBlockHeight:200n})},
      payer,instructions,{computeUnitLimit:200000,loadedAccountsDataSizeLimit:8388608});
    return Buffer.from(transaction.serialize()).toString('base64');
  }
  const wire=await sign([{programAddress:sdk.CLEARING_PROGRAM_ADDRESS,accounts:[],data}]),calculation={kind:'funding-report-v1',report};
  expect(()=>assertLiquidityInputWire(wire,sdk.hex(report.inputDigest),calculation)).not.toThrow();
  const [venue,safety,market,configuration,primaryAsset,primaryCollateral,guardAsset,guardCollateral,eventAuthority,first,second,third]=
    await Promise.all(Array.from({length:12},(_,i)=>Keypair.fromSeed(new Uint8Array(32).fill(i+1)).then(key=>key.address)));
  const common={venue,safety,market,eventAuthority,program:sdk.CLEARING_PROGRAM_ADDRESS};
  const laneReport={...report,market},laneCalculation={...calculation,report:laneReport,marginLayout:'ledger-lanes'};
  const publication=sdk.withFundingCheckpoints(sdk.getPublishFundingReportInstruction({...common,configuration,publisher:payer,
    primaryAsset,primaryCollateral,guardAsset,guardCollateral,report:laneReport}),[first,second,third]);
  const checkpoint=sdk.getCheckpointMarketInstruction({...common,first,second,third});
  const digest=sdk.hex(report.inputDigest);
  const laneWire=await sign([checkpoint,publication]);
  expect(()=>assertLiquidityInputWire(laneWire,digest,laneCalculation)).not.toThrow();
  for(const invalid of [[publication],[publication,checkpoint],[{...checkpoint,accounts:[...checkpoint.accounts.slice(0,3),
    checkpoint.accounts[4],...checkpoint.accounts.slice(4)]},publication]]){
    const refused=await sign(invalid);
    expect(()=>assertLiquidityInputWire(refused,digest,laneCalculation)).toThrow(/checkpoint/);
  }
  const stored=JSON.parse(json(calculation));stored.report=Object.fromEntries(Object.entries(stored.report).reverse());
  expect(()=>assertLiquidityInputWire(wire,sdk.hex(report.inputDigest),stored)).not.toThrow();
  for(const mutate of [(value:any)=>value.report.ask='6000301',(value:any)=>value.report.authorityEpoch='3',
    (value:any)=>value.report.inputDigest='aa'.repeat(32),(value:any)=>value.kind='untrusted']) {
    const changed=structuredClone(stored);mutate(changed);expect(()=>assertLiquidityInputWire(wire,sdk.hex(report.inputDigest),changed)).toThrow(/differs/);
  }
  expect(()=>assertLiquidityInputWire(wire,'aa'.repeat(32),stored)).toThrow(/differs/);
});
