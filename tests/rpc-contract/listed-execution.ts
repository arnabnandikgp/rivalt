import assert from 'node:assert/strict';
import * as sdk from '@rivalt/sdk';
import type {Address} from '@solana/kit';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import type {qualifyListedDirectory} from './listed-maker-directory.js';
import type {qualifyListedFunding} from './listed-funding.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';

export async function qualifyListedExecution(h:CanonicalHarness,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,
  listing:Address,sealed:Awaited<ReturnType<typeof qualifyListedDirectory>>,published:Awaited<ReturnType<typeof qualifyListedFunding>>) {
  const {payer,venue,traderOwner:actor,markets}=setup,[trader]=setup.roots;
  const [directory]=await sdk.findDirectoryPda({venue}), [book]=await sdk.findBookPda({listing});
  const read=async(key:Address)=>(await h.read(key))!;
  const {guard,withCheckpoints}=executionTestHelpers(h,setup);
  const common={...setup.common,venue,listing,funding:published.funding,registry:sealed.registry,directory,book};
  const begin=await sdk.getBeginListedQualificationInstructionAsync({...common,authority:payer});
  await h.send('open funded wider venue for qualification',[begin]);
  assert.equal(sdk.getVenueDecoder().decode(await read(venue)).profileVersion,7);
  const selection=sdk.getListedVenueDecoder().decode(await read(directory));
  assert.deepEqual([selection.count,selection.markets[0]],[1,2]);
  const previous=sdk.decodeListedMargin(await read(trader));
  assert.deepEqual(previous.root.positions.map(position=>position.lots),[1n,-10n]);
  // Each report covers at most six seconds. Keep publishing while the
  // initial recovery interval accrues, and read all three markets at the end.
  for(let round=0;round<4;round++) {
    await setup.sample();
    await published.sampleActive();
  }
  const [btc,eth]=await Promise.all([setup.marketState(0),setup.marketState(1)]);
  const active=sdk.getListedFundingDecoder().decode(await read(published.funding)).values;
  assert.deepEqual([btc.oracle.status,eth.oracle.status,active.oracle.status],[2,2,2]);
  const makers=await Promise.all(sealed.registrations.map(async key=>sdk.getMakerRegistrationDecoder().decode(await read(key))));
  assert(makers.every(m=>m.owner!==actor.address));
  const epochs=await Promise.all(makers.map(async(maker,index)=>{
    const config=setup.instances[index].module.getMakerCurveDecoder().decode(await read(maker.config)).state;
    return {authority:maker.authorityEpoch,depth:maker.depthEpoch,shape:config.shapeEpoch,control:config.controlEpoch};
  }));
  const [zero,one,two]=makers, [zeroRegistration,oneRegistration,twoRegistration]=sealed.registrations;
  const build=async(lots:bigint)=>{
    const slot=await setup.slot();
    return sdk.getExecuteListedMarketOrderInstructionAsync({...common,actor,btc:markets[0],eth:markets[1],trader,
      zeroCapital:zero.capital,zeroRegistration,zeroProgram:zero.pricingProgram,zeroProgramData:zero.programData,zeroConfig:zero.config,zeroPrice:zero.price,
      oneCapital:one.capital,oneRegistration,oneProgram:one.pricingProgram,oneProgramData:one.programData,oneConfig:one.config,onePrice:one.price,
      twoCapital:two.capital,twoRegistration,twoProgram:two.pricingProgram,twoProgramData:two.programData,twoConfig:two.config,twoPrice:two.price,
      args:{guard:await guard(trader),domain:setup.domain,termsEpoch:1n,configEpoch:1n,startSlot:slot,expirySlot:slot+120n,
        side:0,lots,allInLimit:lots*155n,maxFee:20n,reduceOnly:false,generation:null,makerEpochs:epochs}});
  };
  const watch=()=>Promise.all([trader,...sealed.capitals,...sealed.registrations,book,setup.vault].map(read));
  const unfilled=await watch();
  const fill=await build(10n);
  await h.send('listed trade signed SOL buy beside BTC and ETH',await withCheckpoints(fill),[actor]);
  const funded=sdk.decodeListedMargin(await read(trader)), state=sdk.getListedMarketBookDecoder().decode(await read(book));
  assert.deepEqual(funded.root.positions.map(pos=>pos.lots),[1n,-10n]);
  const scale=1_000_000_000n;
  // All available standing asks have the same two-atom spread above 150.
  assert.deepEqual(funded.records.map(row=>[row.market,row.lots,row.virtualScaled]),[[2,10n,-1520n*scale]]);
  const fee=1n;
  assert.equal(funded.root.cash,previous.root.cash-fee);
  assert.deepEqual([state.grossLots,state.collectedFees,state.fees,state.insurance,state.insuranceCarry],[20n,1n,1n,0n,1]);
  const accountStates=await Promise.all(sealed.capitals.map(async key=>sdk.decodeListedMargin(await read(key))));
  assert(accountStates.every(capital=>capital.root.cash===100_000n));
  assert.equal(accountStates.flatMap(capital=>capital.records).reduce((sum,row)=>sum+row.lots,0n),-10n);
  assert.equal(accountStates.flatMap(capital=>capital.records).reduce((sum,row)=>sum+row.virtualScaled,0n),1520n*scale);
  assert.deepEqual(await read(setup.vault),unfilled.at(-1));
  const fundedImage=await watch();
  const foreign=await build(10n);
  await h.send('listed trade rejects omitted ETH source',await withCheckpoints({...foreign,accounts:foreign.accounts!.map(meta=>
    meta.address===markets[1]?{address:sdk.CLEARING_PROGRAM_ADDRESS,role:0 as const}:meta)}),[actor],sdk.CLEARING_ERROR__ORDER_STATE);
  assert.deepEqual(await watch(),fundedImage);
  return {trader,listing,fee,book,directory,cash:funded.root.cash,lots:10n,gross:1520n,inlineLots:[1n,-10n]};
}
