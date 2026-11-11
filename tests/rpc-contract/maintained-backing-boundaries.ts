import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import type {Address,Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import {goldenShape} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {backingStep} from './membership-scan-helper.js';
import type {WireRpc} from './wire.js';

type Context={h:CanonicalHarness;rpc:WireRpc;setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>;
  certificates:Address[];flush:()=>Promise<void>;capture:(label:string)=>Promise<void>;
  mutate:(label:string,instructions:Instruction[],signers?:Keypair[])=>Promise<void>;
  reject:(label:string,instructions:Instruction[],expected:number,signers?:Keypair[])=>Promise<void>};
export async function backingBoundaries({h,rpc,setup,certificates,flush,capture,mutate,reject}:Context) {
  const {root,guard,route}=executionTestHelpers(h,setup),cross=setup.roots[0],owner=setup.traderOwner;
  const identity={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const ledger=async(index:number)=>sdk.getMarketLedgerDecoder().decode((await h.read(setup.ledgers[index]))!);
  const proof=async(index:number)=>sdk.getSettlementCertificateDecoder().decode((await h.read(certificates[index]))!);
  const registry=async()=>sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!);
  const payment=(marketIndex:0|1,amount=1n)=>sdk.getPayAccountGainInstruction({...identity,actor:owner,
    margin:setup.instances[marketIndex*3].capital,certificate:certificates[marketIndex],marketIndex,amount});
  const withdraw=async(amount:bigint)=>sdk.getWithdrawFundedAccountInstruction({...identity,owner,margin:cross,
    quoteMint:setup.mint.address,userToken:setup.traderToken.address,guard:await guard(cross),amount});
  const scan=async(marketIndex:0|1)=>{
    let steps=0,restart=true;
    const common={...identity,ledger:setup.ledgers[marketIndex],certificate:certificates[marketIndex]};
    while(restart||!(await proof(marketIndex)).complete) {
      assert(steps<100);if(steps%6===0)await setup.sample();
      const next=await backingStep(h,common,restart);
      await mutate(`boundary scan ${marketIndex}/${steps}`,[next.instruction],[]);
      restart=false;steps++;
    }
    return steps;
  };

  await setup.sample();
  const initial=await root(cross),slot=await setup.slot(),orderId=initial.book.lastOrderId+1n;
  const terms={side:1,lots:2n,limit:58_000n,feeBudget:500n,startSlot:slot,expirySlot:slot+2000n,
    reduceOnly:true,generation:initial.positions[0].generation};
  const oldWithdraw=await withdraw(1n);
  const beforeSummary=(await ledger(0)).backing.summary;
  await mutate('maintained existing-position TP/SL creation',[sdk.getManageAccountOrderInstruction({...identity,
    actor:owner,margin:cross,guard:await guard(cross),marketIndex:0,operation:{__kind:'Protect',expectedId:orderId,
      takeProfit:{...terms,trigger:1,threshold:60_100n},stopLoss:{...terms,trigger:2,threshold:59_900n}}})]);
  assert.deepEqual((await ledger(0)).backing.summary,beforeSummary,'Reservations/funding consumption do not change q/z/cash');
  await reject('prepared cash guard cannot bypass TP/SL',[oldWithdraw],sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  const protectedRoot=await root(cross);assert(protectedRoot.reserved>0n);
  await reject('protected withdrawal cannot spend account margin',[await withdraw(protectedRoot.cash-1n)],sdk.CLEARING_ERROR__ARITHMETIC);
  setup.sourcePrices.btc=59_800_000_000n;await setup.qualify();
  const stop=(await root(cross)).book.orders.find(entry=>entry.order.id===orderId+1n)!.order;
  const stopped=await route({trader:cross,actor:setup.payer,marketIndex:0,side:1,makers:[setup.instances[0]],lots:[1n],
    stored:{id:stop.id,version:stop.version,filled:stop.filled}});
  await mutate('maintained stored SL partial fill',[stopped],[]);
  assert.equal((await root(cross)).positions[0].lots,initial.positions[0].lots-1n);
  await reject('maintained stored SL prefix cannot replay',[stopped],sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE,[]);
  const summaryAfterStop=(await ledger(0)).backing.summary;
  await mutate('maintained cancel remaining protection',[sdk.getManageAccountOrderInstruction({...identity,
    actor:owner,margin:cross,guard:await guard(cross),marketIndex:0,
    operation:{__kind:'Cancel',id:orderId,version:1n,protectionGroup:true}})]);
  assert.deepEqual((await ledger(0)).backing.summary,summaryAfterStop);
  assert.equal((await root(cross)).reserved,0n);
  const stableEpoch=(await proof(0)).backingEpoch;
  const deadline=(await setup.marketState(0)).oracle.sourceDeadline,wall=Date.now()+30_000;
  while(await setup.now()<deadline){assert(Date.now()<wall,'Bounded real source expiry');await delay(100);}
  await reject('stale live source cannot use maintained coverage',[payment(0)],sdk.CLEARING_ERROR__ORACLE_POLICY);
  await reject('staleness cannot erase completed arithmetic proof',[sdk.getCheckMarketBackingInstruction({...identity,
    ledger:setup.ledgers[0],certificate:certificates[0],revision:(await proof(0)).revision,restart:true})],sdk.CLEARING_ERROR__EXIT_COHORT,[]);
  await setup.qualify();
  await mutate('fresh source reuses original complete epoch',[payment(0)]);
  assert.equal((await proof(0)).backingEpoch,stableEpoch);

  // Close all exposures through actual maker fills before changing the test
  // price scale. Existing fractional claims remain owned and are never erased.
  for(const marketIndex of [0,1] as const) {
    await setup.sample();
    const position=(await root(cross)).positions[marketIndex];assert(position.lots>0n);
    await mutate(`close exposure before low-price boundary ${marketIndex}`,[await route({trader:cross,actor:owner,
      marketIndex,side:1,makers:[setup.instances[marketIndex*3]],lots:[position.lots]})]);
    const closed=(await root(cross)).positions[marketIndex];assert.equal(closed.lots,0n);
    const whole=-closed.virtualScaled/1_000_000_000n;assert(whole>0n);
    await mutate(`collect closed whole claim retaining fraction ${marketIndex}`,[sdk.getCollectAccountLossInstruction({...identity,
      actor:owner,margin:cross,marketIndex,amount:whole})]);
    assert.equal((await root(cross)).positions[marketIndex].virtualScaled,closed.virtualScaled+whole*1_000_000_000n);
  }
  const regions=[{endLots:3_000_000n,offset:0n,slope:0n},...Array.from({length:7},()=>({endLots:0n,offset:0n,slope:0n}))];
  const shape={...goldenShape,skewTick:0n,longCap:3_000_000n,shortCap:3_000_000n,bidCount:1,askCount:1,bids:regions,asks:regions};
  for(const maker of setup.instances) {
    const config=await maker.state(),registration=await maker.registrationState();
    await h.send('publish exact low-price qualification shape',[sdk.getControlLiquidityInstruction({...maker.controlCommon,
      expectedAuthority:registration.authorityEpoch,expectedControl:config.controlEpoch,expectedShape:config.shapeEpoch,
      action:{__kind:'Shape',fields:[shape]}})],[setup.owner]);
  }
  setup.sourcePrices.btc=2_000_000n;await setup.qualify();
  const portfolio=(await root(cross)).portfolio,[emptyMargin]=await sdk.deriveMarginAccount(portfolio,2);
  const beforeMembership=(await registry()).membershipEpoch,[members]=await sdk.deriveMemberPage(setup.venue,(await registry()).nextId/64n);
  await mutate('empty registration preserves completed proof',[await sdk.getRegisterMarginInstructionAsync({...setup.common,
    owner,portfolio,margin:emptyMargin,members,subaccountIndex:2,mode:1,isolatedMarketIndex:1,role:0})]);
  assert.equal((await registry()).membershipEpoch,beforeMembership);
  await mutate('flat payment survives empty registration',[payment(0)]);
  const membership=async(activate:boolean)=>{
    await flush();const input={...setup.common,...await sdk.readMarginMembership(rpc,setup.venue,owner.address,emptyMargin),owner};
    const instruction=activate?sdk.getActivateMarginInstruction(input):sdk.getDeactivateMarginInstruction(input);
    return {...instruction,accounts:[...instruction.accounts,...input.remaining]};
  };
  await mutate('Financial entry invalidates old coverage',[await membership(true)]);
  await reject('old member count cannot certify new cohort',[payment(0)],sdk.CLEARING_ERROR__EXIT_COHORT);
  await mutate('Financial exit advances membership again',[await membership(false)]);
  assert.equal((await registry()).financialCount,8n);
  await reject('restored count does not restore old epoch',[payment(0)],sdk.CLEARING_ERROR__EXIT_COHORT);
  await flush();
  await mutate('empty owner retires after membership exit',[sdk.getRetireMarginInstruction({...setup.common,
    ...await sdk.readMarginMembership(rpc,setup.venue,owner.address,emptyMargin,false),owner})]);
  const steps=await scan(0),newEpoch=(await proof(0)).backingEpoch;
  assert(newEpoch>stableEpoch);
  const before=await root(cross),gross=before.positions.reduce((sum,p)=>sum+(p.virtualScaled<0n?-p.virtualScaled:0n),0n);
  const retained=(gross+999_999_999n)/1_000_000_000n+3n;
  await mutate('withdraw only independently admissible flat funded cash',[await withdraw(before.cash-retained)]);
  await setup.sample();
  await mutate('admitted low-price short can make conservative backing bad',[await route({trader:cross,actor:owner,
    marketIndex:0,side:1,makers:[setup.instances[0]],lots:[1n]})]);
  assert.equal((await root(cross)).cash,retained-1n,'Exactly one atom aggregate taker fee');
  const damaged=sdk.decodeBackingSummary((await ledger(0)).backing.summary);
  assert.equal(damaged.bad,1n);assert.equal(damaged.count,8n);assert.equal((await proof(0)).backingEpoch,newEpoch);
  await reject('bad processed debtor withholds otherwise funded gain',[payment(0)],sdk.CLEARING_ERROR__EXIT_COHORT);
  await mutate('actual collateral repairs processed debtor without a rescan',[await sdk.getDepositAccountInstructionAsync({...setup.common,
    owner,margin:cross,quoteMint:setup.mint.address,userToken:setup.traderToken.address,amount:2n})]);
  assert.equal(sdk.decodeBackingSummary((await ledger(0)).backing.summary).bad,0n);
  const beneficiary=setup.instances[0].capital,benefitBefore=await root(beneficiary);
  await mutate('same complete proof pays after actual repair',[payment(0)]);
  const benefitAfter=await root(beneficiary);
  assert.equal(benefitAfter.cash,benefitBefore.cash+1n);
  // Funding is zero for the symmetric shape; both amount and fraction are exact.
  assert.equal(benefitAfter.positions[0].virtualScaled,benefitBefore.positions[0].virtualScaled-1_000_000_000n);
  assert.equal((await proof(0)).backingEpoch,newEpoch);
  await capture('boundaries complete');
  return {staleSourceRejected:true,stalenessResetRejected:true,storedProtectionExecuted:true,
    membershipInvalidations:2,restoredCountRejected:true,restartedSteps:steps,newEpoch,
    admittedBadDebtor:'1',repairedBadDebtor:'0',repairAtoms:'2',paidAtoms:'1'};
}
