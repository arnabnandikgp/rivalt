import assert from 'node:assert/strict';
import type {Address,Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import type {ExpectedInstructionError} from './instruction-errors.js';
import {publishFixtureFeed} from './oracle-fixture.js';

export async function qualifyListedFunding(h:CanonicalHarness,rpc:Pick<sdk.UserRpc,'call'>,
  setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,listing:Address,registrations:Address[],listingIndex:Address) {
  const {payer,venue,safety,updater,traderOwner:owner}=setup;
  const [funding]=await sdk.findFundingPda({listing});
  const [configuration]=await sdk.findListedFundingPublisherPda({listing});
  const [registry]=await sdk.findLiquidityRegistryPda({market:listing});
  const common={venue,safety,listing,funding,configuration,program:sdk.CLEARING_PROGRAM_ADDRESS};
  const accepted:[string,Instruction][]=[];
  async function send(label:string,ix:Instruction,signers:(typeof payer)[]=[]) {
    await h.send(label,[ix],signers);
    accepted.push([label,ix]);
  }
  const index=sdk.getListingIndexDecoder().decode((await h.read(listingIndex))!);
  const members=await Promise.all(registrations.map(async key=>sdk.getMakerRegistrationDecoder().decode((await h.read(key))!)));
  const money=[setup.vault,...members.map(v=>v.capital),...registrations,listing,listingIndex];
  const read=(keys:Address[])=>Promise.all(keys.map(h.read));
  const before=await read(money);
  const initialize=await sdk.getInitializeListedFundingInstructionAsync({...common,authority:payer,publisher:updater.address,listingIndex,registry});
  await send('bind restricted SOL funding publisher',initialize);
  const refresh=async(anchor:bigint)=>{
    const now=await setup.now();
    const sources=index.sources.map((src,i)=>publishFixtureFeed(src,i<2?setup.primary.address:setup.guard.address,now,
      {price:i%2===0?150_000_000n:1_000_000n,confidence:i%2===0?100_000n:1_000n}));
    const prices=await Promise.all(members.map(async(maker,i)=>{
      const module=setup.instances[i].module;
      const config=module.getMakerCurveDecoder().decode((await h.read(maker.config))!).state;
      const price=module.getMakerPriceDecoder().decode((await h.read(maker.price))!).state;
      return module.getRepriceInstruction({...setup.instances[i].makerCommon,config:maker.config,price:maker.price,actor:updater,
        expectedControl:config.controlEpoch,expectedSequence:price.sequence,anchor});
    }));
    await h.send('refresh SOL funding sources and makers',[...sources,...prices],[updater,setup.primary,setup.guard]);
  };
  const snapshot=()=>sdk.readListedFundingReport(rpc,venue,2);
  const publish=(input:Awaited<ReturnType<typeof snapshot>>,publisher=updater,overrides:Partial<sdk.FundingReport>={})=>
    sdk.getPublishListedFundingInstructionAsync({...common,...input.instructionAccounts,publisher,report:{...input.report,...overrides}});
  const reject=async(label:string,ix:Instruction,signer:typeof payer,code:ExpectedInstructionError)=>{
    const old=await read([funding,configuration,...money]);
    await h.send(label,[ix],[signer],code);
    assert.deepEqual(await read([funding,configuration,...money]),old,label);
  };
  await refresh(250n);
  const thin=await snapshot();
  assert.equal(thin.report.outcome,3,thin.coverageReason??'out-of-band depth');
  await send('record unavailable SOL depth',await publish(thin),[updater]);
  await setup.waitUntil(thin.report.observedTime+3n);
  await refresh(150n);
  const good=await snapshot();
  assert.equal(good.report.outcome,0,good.coverageReason??'available published depth');
  assert.deepEqual([good.report.referencePrice,good.report.quantity,good.report.bid,good.report.ask],[150n,40_000n,5_920_000n,6_080_000n]);
  await reject('reject other SOL funding signer',await publish(good,owner),owner,2001);
  await reject('reject BTC domain on SOL report',await publish(await snapshot(),updater,{market:setup.markets[0]}),updater,sdk.CLEARING_ERROR__FUNDING_REPORT);
  await reject('reject invented SOL funding Q',await publish(await snapshot(),updater,{quantity:39_999n}),updater,sdk.CLEARING_ERROR__ORACLE_POLICY);
  const fresh=await snapshot();
  const wrongFeed=await sdk.getPublishListedFundingInstructionAsync({...common,...fresh.instructionAccounts,publisher:updater,
    report:fresh.report,primaryAsset:setup.feeds[0].feed});
  await reject('reject substituted SOL funding source',wrongFeed,updater,sdk.CLEARING_ERROR__ORACLE_SOURCE);
  const available=await snapshot(),instruction=await publish(available);
  await send('accept two-maker SOL impact',instruction,[updater]);
  await reject('reject replay of accepted SOL impact',instruction,updater,sdk.CLEARING_ERROR__FUNDING_REPORT);
  const state=()=>h.read(funding).then(raw=>sdk.getListedFundingDecoder().decode(raw!).values);
  const priced=await state();
  assert.equal(priced.fundingIndexScaled,0n);
  assert.equal(priced.oracle.quantity,40_000n);
  const rotate=await sdk.getConfigureListedFundingInstructionAsync({...common,authority:payer,epoch:1n,publisher:owner.address});
  await send('replace SOL funding signer',rotate);
  const reset=await state();
  assert.deepEqual([reset.oracle.quantity,reset.oracle.heldSlot,reset.oracle.heldUntil,reset.fundingIndexScaled],
    [0n,0n,reset.oracle.sampledAt,0n]);
  await setup.waitUntil(reset.oracle.sampledAt+3n);
  await refresh(150n);
  const latest=await snapshot();
  await reject('retired SOL publisher cannot post',await publish(latest),updater,2001);
  await send('new SOL funding signer publishes',await publish(await snapshot(),owner),[owner]);
  assert.deepEqual(await read(money),before,'pre-trading funding touched market membership, index or cash');
  return {funding,configuration,accepted};
}
