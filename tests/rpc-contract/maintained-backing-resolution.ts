import assert from 'node:assert/strict';
import {getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {backingStep,financialRoots} from './membership-scan-helper.js';
import {resolveLiquidityCohort} from './liquidity-resolution-cases.js';
import type {backingBoundaries} from './maintained-backing-boundaries.js';

export async function backingResolution(context:Parameters<typeof backingBoundaries>[0],checkpoint:(label:string)=>Promise<void>) {
  const {h,setup,certificates,capture,mutate,reject,flush}=context;
  const {root,guard,route}=executionTestHelpers(h,setup),[cross,receiver]=setup.roots,owner=setup.traderOwner;
  const identity={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const ledger=async(index:number)=>sdk.getMarketLedgerDecoder().decode((await h.read(setup.ledgers[index]))!);
  const proof=async()=>sdk.getSettlementCertificateDecoder().decode((await h.read(certificates[0]))!);
  const safety=async()=>sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const source=async()=>sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const payment=()=>sdk.getPayAccountGainInstruction({...identity,actor:owner,margin:setup.instances[0].capital,
    certificate:certificates[0],marketIndex:0,amount:1n});
  const trade=async(marketIndex:0|1,side:0|1,lots:bigint)=>route({trader:cross,actor:owner,marketIndex,side,
    makers:[setup.instances[marketIndex*3]],lots:[lots]});
  const net=async()=>sdk.getNetAccountClaimsInstruction({...identity,owner,margin:cross,certificate:certificates[0],
    guard:await guard(cross),sourceMarket:0,amount:1n});
  await setup.sample();
  await reject('netting cannot silently close an open short',[await net()],sdk.CLEARING_ERROR__ORDER_STATE);
  await mutate('close low-price short preserving fractions',[await trade(0,0,500n)]);
  await mutate('fund cross lifecycle from sibling own cash',[sdk.getTransferFundedAccountInstruction({...identity,
    owner,donor:receiver,recipient:cross,guard:await guard(receiver),amount:10_000n})]);
  await mutate('open low-price lots for explicit closed gain',[await trade(0,0,1000n)]);
  setup.sourcePrices.btc=3_000_000n;await setup.sample();
  await mutate('close lots with 1000 atoms gross profit',[await trade(0,1,1000n)]);
  await mutate('open ETH lot for explicit opposite closed debt',[await trade(1,0,1n)]);
  setup.sourcePrices.eth=2_999_900_000n;await setup.sample();
  await mutate('close ETH with one atom gross loss',[await trade(1,1,1n)]);
  const netBefore=await root(cross),poolsBefore=await Promise.all([0,1].map(ledger));
  assert(netBefore.positions.every(position=>position.lots===0n));
  assert(netBefore.positions[0].virtualScaled>=1_000_000_000n&&netBefore.positions[1].virtualScaled<=-1_000_000_000n);
  const netInstruction=await net();await mutate('explicit flat-only funded cross-claim net',[netInstruction]);
  const netAfter=await root(cross),poolsAfter=await Promise.all([0,1].map(ledger));
  assert.equal(netAfter.cash,netBefore.cash);
  assert.equal(netAfter.positions[0].virtualScaled,netBefore.positions[0].virtualScaled-1_000_000_000n);
  assert.equal(netAfter.positions[1].virtualScaled,netBefore.positions[1].virtualScaled+1_000_000_000n);
  assert.equal(poolsAfter[0].settlement,poolsBefore[0].settlement-1n);
  assert.equal(poolsAfter[1].settlement,poolsBefore[1].settlement+1n);
  await reject('flat netting cannot replay account authority',[netInstruction],sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);

  setup.sourcePrices.btc=60_000_000_000n;setup.sourcePrices.eth=3_000_000_000n;await setup.qualify();
  const funded=await root(cross);
  await mutate('set independently funded liquidation target cash',[sdk.getWithdrawFundedAccountInstruction({...identity,
    owner,margin:cross,quoteMint:setup.mint.address,userToken:setup.traderToken.address,guard:await guard(cross),amount:funded.cash-7000n})]);
  await mutate('open one normally margined BTC lot',[await trade(0,0,1n)]);
  setup.sourcePrices.btc=53_500_000_000n;await setup.qualify();
  await reject('out-of-region current prices cannot reuse low-price proof',[payment()],sdk.CLEARING_ERROR__EXIT_COHORT);
  let steps=0,restart=true;
  while(restart||!(await proof()).complete) {
    assert(steps<100);if(steps%6===0)await setup.sample();
    const next=await backingStep(h,{...identity,ledger:setup.ledgers[0],certificate:certificates[0]},restart);
    await mutate(`underfunded coverage ${steps}`,[next.instruction],[]);restart=false;steps++;
  }
  assert.equal(sdk.decodeBackingSummary((await ledger(0)).backing.summary).bad,1n);
  const epoch=(await proof()).backingEpoch;
  await reject('completed bad cohort cannot pay',[payment()],sdk.CLEARING_ERROR__EXIT_COHORT);
  const liquidation=async(price=53_500n,lots=1n)=>sdk.getLiquidateAccountInstruction({...identity,target:cross,receiver,
    receiverOwner:owner,targetGuard:await guard(cross),receiverGuard:await guard(receiver),marketIndex:0,price,lots});
  await reject('liquidation cannot flip target quantity',[await liquidation(53_500n,2n)],sdk.CLEARING_ERROR__ARITHMETIC);
  await reject('liquidation must improve deficit after its fee',[await liquidation(48_150n)],sdk.CLEARING_ERROR__ARITHMETIC);
  const targetBefore=await root(cross),receiverBefore=await root(receiver),liquidate=await liquidation();
  await mutate('consenting receiver liquidation repairs maintained backing',[liquidate]);
  const targetAfter=await root(cross),receiverAfter=await root(receiver);
  assert.equal(targetAfter.positions[0].lots,0n);assert.equal(receiverAfter.positions[0].lots,1n);
  assert.equal(targetAfter.cash,targetBefore.cash-27n);assert.equal(receiverAfter.cash,receiverBefore.cash+27n);
  assert.equal(sdk.decodeBackingSummary((await ledger(0)).backing.summary).bad,0n);
  assert.equal((await proof()).backingEpoch,epoch);
  await reject('liquidation cannot replay either root guard',[liquidate],sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  await mutate('liquidation-repaired completed proof pays funded gain',[payment()]);
  await flush();await checkpoint('after-net-and-liquidation');

  await mutate('fund actual new default exposure',[await sdk.getDepositAccountInstructionAsync({...setup.common,
    owner,margin:cross,quoteMint:setup.mint.address,userToken:setup.traderToken.address,amount:200_000n})]);
  await setup.sample();await mutate('open actual default exposure',[await trade(0,0,20n)]);
  const sources={primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed};
  const oldSafety=(await safety()).epoch;
  setup.sourcePrices.btc=40_000_000_000n;await setup.fresh();
  await h.send('bankrupt account freezes complete maintained cohort',[sdk.getFreezeAccountsInstruction({...setup.safetyCommon,...sources,
    caller:setup.payer,target:cross,members:(await sdk.deriveMemberPage(setup.venue,(await root(cross)).id/64n))[0],
    safetyEpoch:oldSafety,resolutionEpoch:(await source()).epoch,emergency:false})]);
  assert((await safety()).epoch>oldSafety);
  await reject('frozen mode rejects old ordinary payment authority',[payment()],sdk.CLEARING_ERROR__PROFILE);
  await flush();await checkpoint('frozen-maintained-cohort');
  const roots=await financialRoots(h,setup.venue,setup.registry);
  const resolution=await resolveLiquidityCohort(h,setup,roots,async(label,instruction,error)=>reject(label,[instruction],error??sdk.CLEARING_ERROR__RESOLUTION,[]),async label=>{await flush();await checkpoint(label);});
  for(const key of roots)assert.deepEqual((await root(key)).backingEpochs,[0n,0n]);
  await capture('complete default clears processed-root markers');
  await flush();await checkpoint('maintained-default-complete');
  const tokenBefore=getTokenDecoder().decode((await h.read(setup.token.address))!).amount;
  await mutate('resolved funded token exit ignores obsolete backing proof',[sdk.getWithdrawFundedAccountInstruction({...identity,
    owner:setup.owner,margin:roots[0],quoteMint:setup.mint.address,userToken:setup.token.address,guard:await guard(roots[0]),amount:1n})],[setup.owner]);
  assert.equal(getTokenDecoder().decode((await h.read(setup.token.address))!).amount,tokenBefore+1n);
  const recover=(resume:boolean)=>sdk.getRecoverAccountsInstruction({...setup.safetyCommon,...sources,caller:setup.payer,
    epoch:resolution.initial.epoch,resume});
  await reject('default still requires sustained source recovery',[recover(true)],sdk.CLEARING_ERROR__RESOLUTION,[]);
  setup.sourcePrices.btc=60_000_000_000n;
  for(let round=0;round<4;round++) {
    await setup.waitUntil(await setup.now()+2n);await setup.fresh();
    await h.send('sustained source recovery after maintained default',[recover(false)]);
  }
  await h.send('explicit recovery returns only to custody',[recover(true)]);
  const reactivate=()=>sdk.getReactivateAccountsInstruction({...setup.safetyCommon,...sources,caller:setup.payer,epoch:resolution.initial.epoch});
  await setup.qualify();await h.send('qualified reactivation preserves old proof fences',[reactivate()]);
  await reject('reactivation cannot revive pre-default backing epoch',[payment()],sdk.CLEARING_ERROR__EXIT_COHORT);
  await flush();await checkpoint('recovered-maintained-cohort');
  return {netAtoms:'1',cashCreatedByNet:'0',liquidationReward:'27',sameEpochAfterLiquidation:epoch,
    defaultMembers:roots.length,default:resolution,actualExitAtoms:'1',oldProofRejectedAfterRecovery:true};
}
