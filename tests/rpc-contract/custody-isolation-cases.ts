// P42-specific signed invariants. Provisioning cannot inject financial state.
import assert from 'node:assert/strict';
import {AccountRole,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {instructionLocks,conflicts} from '../performance/lock-model.js';

type Setup=Awaited<ReturnType<typeof liquidityExecutionSetup>>;
export async function custodyIsolationCases(h:CanonicalHarness,setup:Setup) {
  const {root,guard,route}=executionTestHelpers(h,setup), owner=setup.owner;
  const ledger=async(index:number)=>sdk.getMarketLedgerDecoder().decode((await h.read(setup.ledgers[index]))!);
  const omit=(instruction:Instruction,key:Address):Instruction=>({...instruction,accounts:instruction.accounts!.map(meta=>
    meta.address===key?{address:sdk.CLEARING_PROGRAM_ADDRESS,role:AccountRole.READONLY}:meta)});
  const [portfolio]=await sdk.deriveAccountPortfolio(setup.venue,owner.address,3);
  const [ethRoot]=await sdk.deriveMarginAccount(portfolio,1);
  await h.send('P42 create distinct owner portfolio',[await sdk.getCreatePortfolioInstructionAsync({...setup.common,owner,portfolio,index:3})],[owner]);
  await h.send('P42 register distinct owner isolated ETH',[await sdk.getRegisterMarginInstructionAsync({...setup.common,owner,portfolio,
    margin:ethRoot,subaccountIndex:1,mode:1,isolatedMarketIndex:1,role:0})],[owner]);
  const donor=setup.instances[4].capital;
  await h.send('P42 internal allocation omits token custody',[sdk.getTransferFundedAccountInstruction({...setup.common,
    btcLedger:undefined,ethLedger:undefined,owner,donor,recipient:ethRoot,guard:await guard(donor),amount:100_000n})],[owner]);
  await setup.sample();
  const btc=await route({trader:setup.roots[1],actor:setup.traderOwner,marketIndex:0,side:0,makers:[setup.instances[0]],lots:[1n],minimalMarkets:true});
  const eth=await route({trader:ethRoot,actor:owner,marketIndex:1,side:0,makers:[setup.instances[3]],lots:[1n],minimalMarkets:true});
  const access={btc:instructionLocks([btc]),eth:instructionLocks([eth])};
  assert.deepEqual(conflicts(access.btc,access.eth),[],'Disjoint isolated trades must have no protocol W/W or W/R overlap');
  for(const instruction of [btc,eth])for(const key of [setup.custody,setup.vault])
    assert(!instruction.accounts!.some(meta=>meta.address===key),'Internal route must omit custody/vault');
  const custodyBefore=await h.read(setup.custody),vaultBefore=await h.read(setup.vault);
  await h.send('P42 distinct-payer isolated BTC fill',[btc],[setup.traderOwner]);
  await h.send('P42 distinct-payer isolated ETH fill',[eth],[owner]);
  assert.deepEqual(await h.read(setup.custody),custodyBefore);assert.deepEqual(await h.read(setup.vault),vaultBefore);
  assert.equal((await root(ethRoot)).cash,99_993n,'One lot at 30003 costs seven fee atoms');
  // A cross cash transfer must invalidate both markets, even a one-scaled-unit
  // fixed claim. Omission must roll back the already processed first ledger too.
  const cross=setup.roots[0],crossState=await root(cross);
  assert(crossState.positions.every(position=>position.virtualScaled!==0n));
  const transfer=sdk.getTransferFundedAccountInstruction({...setup.common,btc:setup.markets[0],eth:setup.markets[1],owner:setup.traderOwner,
    donor:cross,recipient:setup.roots[1],guard:await guard(cross),amount:1n});
  const before=await Promise.all([cross,setup.roots[1],...setup.ledgers].map(h.read));
  await h.send('P42 cross cash rejects omitted ETH liability ledger',[omit(transfer,setup.ledgers[1])],[setup.traderOwner],sdk.CLEARING_ERROR__ORDER_STATE);
  assert.deepEqual(await Promise.all([cross,setup.roots[1],...setup.ledgers].map(h.read)),before);
  const stamps=await Promise.all([0,1].map(ledger));
  await h.send('P42 cross cash invalidates both market backing stamps',[transfer],[setup.traderOwner]);
  for(const index of [0,1])assert((await ledger(index)).liabilityVersion>stamps[index].liabilityVersion);
  // A reprice/source refresh is permitted, but a new consumed funding observation
  // invalidates a source-dependent in-progress certificate. Measure bounded
  // actual attempts, not success-conditioned availability.
  setup.sourcePrices.eth=3_100_000_000n;await setup.qualify();
  const [certificate]=await sdk.deriveSettlementCertificate(setup.venue,1);
  const members=sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!).members;
  const page=(start:number)=>{
    const check=sdk.getCheckMarketBackingInstruction({...setup.common,btc:setup.markets[0],eth:setup.markets[1],
      certificate,ledger:setup.ledgers[1],start});
    return {...check,accounts:[...check.accounts,...members.slice(start,start+2).map(address=>({address,role:AccountRole.READONLY}))]};
  };
  const progress:{offered:number;completed:number;rejected:number;reasons:Record<string,number>}={offered:0,completed:0,rejected:0,reasons:{}};
  for(let attempt=0;attempt<3;attempt++) {
    progress.offered++;
    await h.send('P42 activity scan first page',[page(0)]);
    await h.send('P42 activity scan exposed debtors',[page(2)]);
    await setup.sample();
    await h.send('P42 funding observation invalidates scan continuation',[page(4)],[],sdk.CLEARING_ERROR__EXIT_COHORT);
    progress.rejected++;progress.reasons['source-observation-advanced']=(progress.reasons['source-observation-advanced']??0)+1;
  }
  // Three deliberately interleaved attempts establish a classified limitation,
  // not a general availability percentage. One bounded quiet source window then
  // proves complete scanning plus final-page/payment atomically.
  progress.offered++;
  for(let start=0;start<members.length-2;start+=2)await h.send('P42 backing continuation',[page(start)]);
  const finalStart=members.length-2;assert(members.slice(finalStart).includes(ethRoot));
  const payment=sdk.getPayAccountGainInstruction({...setup.common,btc:setup.markets[0],eth:setup.markets[1],
    btcLedger:undefined,ethLedger:setup.ledgers[1],actor:setup.payer,margin:ethRoot,certificate,marketIndex:1,amount:1n});
  const beforeGain=await root(ethRoot),beforePool=await ledger(1);
  // Fail a later instruction after a successful last page and payment; every
  // certificate, root, consumed market and pool revision must roll back.
  const watched=[certificate,ethRoot,...setup.markets,...setup.ledgers];
  const preAtomic=await Promise.all(watched.map(h.read));
  const badPayment=sdk.getPayAccountGainInstruction({...setup.common,btc:setup.markets[0],eth:setup.markets[1],
    btcLedger:undefined,ethLedger:setup.ledgers[1],actor:setup.payer,margin:ethRoot,certificate,marketIndex:1,amount:0n});
  await h.send('P42 atomic final page payment rollback',[page(finalStart),payment,badPayment],[],sdk.CLEARING_ERROR__EXIT_COHORT);
  assert.deepEqual(await Promise.all(watched.map(h.read)),preAtomic);
  await h.send('P42 atomic final page and gain',[page(finalStart),payment]);
  progress.completed++;
  const afterGain=await root(ethRoot);assert.equal(afterGain.cash,beforeGain.cash+1n);
  assert.equal((await ledger(1)).settlement,beforePool.settlement-1n);
  assert.equal(afterGain.positions[1].virtualScaled,beforeGain.positions[1].virtualScaled
    -beforeGain.positions[1].lots*(afterGain.positions[1].fundingCheckpointScaled-beforeGain.positions[1].fundingCheckpointScaled)-1_000_000_000n);
  assert.deepEqual(await h.read(setup.custody),custodyBefore);assert.deepEqual(await h.read(setup.vault),vaultBefore);
  return {ethRoot,access,progress,extraFees:[13n,7n],gain:1n};
}
