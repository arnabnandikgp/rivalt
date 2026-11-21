// Measure the search required by a populated successor freeze, using only signed financial actions.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import {getAddressEncoder} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {recoverySettlementCalculation} from '../../packages/services/src/recovery-witness.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {financialRoots} from './membership-scan-helper.js';
import {qualifySettlementPlan} from './scalable-settlement-plan-rpc.js';
import {qualifySettlementApplication} from './scalable-settlement-application-rpc.js';
import {populatedKeeperExit} from './populated-keeper-exit.js';
import {verifyJointPayment,type JointReference} from './populated-joint-payment.js';
import {verifyPopulatedOriginalRates} from './populated-original-rates.js';
import {verifyPartitionedInputs} from './partitioned-recovery-pages.js';
import {verifyProfitBuild,verifyPartitionedBuild} from './profit-attribution-build.js';
import {populateDefaultCohort} from './scaled-default-setup.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory=process.env.RIVALT_RUN_DIR!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const probe=process.env.RIVALT_SETTLEMENT_PROBE!;
const automatic=probe==='profit-attribution-successor-populated-keeper';
const jointSettlement=probe==='profit-attribution-joint-settlement';
const pairSchedule=jointSettlement||probe==='profit-attribution-pair-schedule';
const winnerScan=pairSchedule||probe==='profit-attribution-winner-allocations';
const foreignCaps=winnerScan||probe==='profit-attribution-foreign-caps';
const originalBudgets=foreignCaps||process.env.RIVALT_SETTLEMENT_PROBE==='profit-attribution-original-budgets';
const originalRates=originalBudgets||process.env.RIVALT_SETTLEMENT_PROBE==='profit-attribution-populated-rates';
const partitioned=originalRates||process.env.RIVALT_SETTLEMENT_PROBE==='profit-attribution-partitioned-population';
const build=partitioned?verifyPartitionedBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,probe):verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,false,false,false,false,'successor');
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>1_000_000,heapSize:label=>(automatic||jointSettlement)&&/joint|certified settlement register|P54C/.test(label)?131_072:undefined});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{marginLayout:'ledger-lanes',marketCheckpoints:true,verifyRejections:false,
    makerCash:50_000_000n,traderDeposits:[400_000n,1_000_000n]});
  const {root,route,guard,classify,withCheckpoints}=executionTestHelpers(h,setup);
  for(const maker of setup.instances) {
    const bytes=(await h.read(maker.capital))!;
    const expandedSize=bytes.length+40+2*(256-128);
    const balance=BigInt((await rpc.call('getBalance',[maker.capital,{commitment:'confirmed'}])).value);
    const maxPayment=await h.rent(expandedSize)-balance;
    await h.send('sponsor populated maker attribution',[await sdk.getManageProfitCapacityInstructionAsync({
      ...setup.common,margin:maker.capital,actor:setup.owner,payer:setup.owner,previousContributor:setup.owner.address,
      slotBytes:256,revision:(await root(maker.capital)).revision,maxPayment})],[setup.owner]);
  }
  const cohort=await populateDefaultCohort(h,setup,128);
  const trader=setup.roots[0],actor=setup.traderOwner;
  for(const marketIndex of [0,1] as const) {
    await setup.sample();
    const fill=await route({trader,actor,marketIndex,side:0,makers:[setup.instances[marketIndex*3]],lots:[marketIndex===0?40n:20n]});
    await h.send('open cross default trigger',await withCheckpoints(fill),[actor]);
  }
  const target=cohort.additional.find(member=>member.ordinal>=64&&member.market===0&&member.mode===1&&Math.floor(member.ordinal/2)%2===0)!.margin;
  setup.sourcePrices.btc=53_500_000_000n;
  await setup.qualify();
  const transfer=sdk.getLiquidateAccountInstruction({...setup.common,btc:setup.markets[0],eth:setup.markets[1],
    target,receiver:setup.roots[1],receiverOwner:actor,targetGuard:await guard(target),receiverGuard:await guard(setup.roots[1]),
    marketIndex:0,price:53_500n,lots:1n});
  await h.send('liquidate one populated lot into funded receiver',await withCheckpoints(transfer),[actor]);
  setup.sourcePrices.btc=40_000_000_000n;
  setup.sourcePrices.eth=2_000_000_000n;
  await setup.freshSources();
  const sources={primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed};
  const source=async()=>sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const freeze=sdk.getFreezeAccountsInstruction({...setup.safetyCommon,...sources,caller:setup.payer,target:trader,
    members:(await sdk.deriveMemberPage(setup.venue,(await root(trader)).id/64n))[0],
    safetyEpoch:sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!).epoch,resolutionEpoch:(await source()).epoch,emergency:false});
  await h.send('freeze populated successor',[classify(0),classify(1),...await Promise.all([setup.checkpoint(0),setup.checkpoint(1)]),freeze]);
  await flush();
  const initial=await source();
  assert.equal(initial.stage,2);assert.equal(initial.count,128n);
  const members=await financialRoots(h,setup.venue,setup.registry);
  const rows=await Promise.all(members.map(async key=>{
    const {root:account,histories}=sdk.decodeProfitAttribution((await h.read(key))!,true);
    return {id:account.id,cash:account.cash,lots:account.positions.map(position=>position.lots),
      claims:account.positions.map((position,index)=>position.virtualScaled+position.lots*(
        initial.prices[index]*1_000_000_000n-initial.funding[index]+position.fundingCheckpointScaled)),
      history:histories.map(bytes=>Array.from(bytes))};
  }));
  assert.deepEqual(await source(),initial);
  assert.equal(rows.length,128);
  const active=rows.filter(row=>row.lots.some(value=>value!==0n)).length;
  assert.equal(active,120);
  const book={rows,pools:initial.poolsBefore,insurance:initial.insuranceBefore};
  const {rounds,orders}=recoverySettlementCalculation(book,[],0n);
  const expected=JSON.parse(execFileSync('python3',['tests/financial/settlement_rpc_reference.py'],{input:json(book),encoding:'utf8'}));
  assert.deepEqual(rounds.map(round=>round.map(String)),expected.evaluations.map((pass:{proposal:string[]})=>pass.proposal));
  assert.deepEqual(orders.map(order=>order.map(String)),expected.plan.orders);
  const [rates,...additionalRates]=rounds;
  const request={venue:Array.from(getAddressEncoder().encode(setup.venue)),epoch:initial.epoch,rows,marks:initial.prices,
    fees:initial.feesBefore,pools:book.pools,insurance:book.insurance,budget:65536,original:{rates,additionalRates,orders:orders.map(order=>order.map(Number))}};
  writeFileSync(directory+'/population-input.json',json(request));
  const dimensions=JSON.parse(execFileSync('target/release/rivalt-recovery-selector',['--dimensions'],{input:json(request),encoding:'utf8'}));
  assert.equal(dimensions.rankBits,(BigInt(dimensions.schedules)-1n).toString(2).replace(/^0$/,'').length);
  const pageInputs=partitioned?await verifyPartitionedInputs(h,setup,members,expected.debtorWriteoffs.map((row:string[])=>row.map(BigInt)),originalRates?20:4,originalBudgets):null;
  if(pageInputs) {
    assert.deepEqual(pageInputs.edgesByMarket,dimensions.edgesByMarket);
    assert.equal(pageInputs.schedules,dimensions.schedules);
  }
  const protection=foreignCaps?JSON.parse(execFileSync('python3',['tests/financial/protection_scan_reference.py'],{input:json(request),encoding:'utf8'})):undefined;
  const winnerReference=winnerScan?JSON.parse(execFileSync('python3',['tests/financial/winner_scan_reference.py'],{input:json(request),encoding:'utf8'})):undefined;
  const pairReference=pairSchedule?JSON.parse(execFileSync('python3',['tests/financial/pair_schedule_reference.py'],{input:json(request),encoding:'utf8'})):undefined;
  const originalRateResult=originalRates?await verifyPopulatedOriginalRates(h,setup,rows,members,BigInt(expected.common),
    originalBudgets?expected.debtorWriteoffs.map((row:string[])=>row.map(BigInt)):undefined,protection,winnerReference,pairReference):null;
  const reference:JointReference|undefined=jointSettlement?JSON.parse(execFileSync('python3',['tests/financial/joint_payment_reference.py'],{input:json(request),encoding:'utf8'})):undefined;
  let jointPayment,terminal;
  if(automatic) {
    assert.equal(process.env.RIVALT_SUCCESSOR_BUILD,'unified-recovery-candidate');
    const expectedJoint:JointReference=JSON.parse(execFileSync('python3',['tests/financial/joint_payment_reference.py'],{input:json(request),encoding:'utf8'}));
    journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
    await journal.checkpoint('keeper-frozen-cohort',true);
    terminal=await populatedKeeperExit(h,setup,members,expectedJoint);
  } else if(reference) {
    assert(originalRateResult?.pairSchedules && originalRateResult.winnerProofs && pairReference);
    const {prepared,rates,pages,limbs,pairSchedules,winnerProofs}=originalRateResult;
    jointPayment=await verifyJointPayment(h,setup,prepared,rates,pages,limbs,pairSchedules,winnerProofs,pairReference,reference);
    const tracked=[prepared,rates,setup.vault,setup.resolution,...pages,...members];
    const frozen=await Promise.all(rows.map(async(row,index)=>({...row,key:members[index],root:await root(members[index])})));
    const changed=frozen.map((row,index)=>({...row,claims:row.claims.map((claim,m)=>claim+BigInt(reference.deltas[index][m])*1_000_000_000n)}));
    const reject:Parameters<typeof qualifySettlementPlan>[0]['reject']=async(label,ix,error=sdk.CLEARING_ERROR__RESOLUTION)=>{
      await h.send(label,[ix],[],error);
    };
    const {plan,continuations,state}=await qualifySettlementPlan({h,setup,prepared,rates,epoch:initial.epoch,
      operatorWindows:true,expected:reference.plan,rows:changed,rowPages:pages,limbPages:limbs,tracked,reject});
    assert.deepEqual(state.insuranceSpent.map(String),reference.spent);
    const application=await qualifySettlementApplication({h,setup,prepared,rates,plan,epoch:initial.epoch,
      rowPages:pages,rows:frozen,expected:reference.plan,tracked,reject,stopBeforeExitAndRecovery:true,
      checkpoint:async(name)=>{writeFileSync(directory+'/joint-'+name+'.json',json(await source()));}});
    const ordinal=frozen.findIndex((row,i)=>row.root.owner===setup.traderOwner.address && BigInt(reference.plan.cash[i])>0n);
    assert(ordinal>=0,'test trader has a funded terminal payout');
    const margin=members[ordinal],amount=BigInt(reference.plan.cash[ordinal]);
    const token=async(key:typeof margin)=>getTokenDecoder().decode((await h.read(key))!).amount;
    const before=await token(setup.traderToken.address), vault=await token(setup.vault);
    const withdraw=sdk.getWithdrawFundedAccountInstruction({...setup.common,btc:setup.markets[0],eth:setup.markets[1],
      owner:setup.traderOwner,margin,userToken:setup.traderToken.address,quoteMint:setup.mint.address,amount,guard:await guard(margin)});
    await h.send('reject trading checkpoint during terminal exit',await withCheckpoints(withdraw),[setup.traderOwner],sdk.CLEARING_ERROR__PROFILE);
    assert.equal(await token(setup.traderToken.address),before);
    assert.equal(await token(setup.vault),vault);
    await h.send('withdraw full certified joint wallet payout',[withdraw],[setup.traderOwner]);
    assert.equal(await token(setup.traderToken.address),before+amount);
    assert.equal(await token(setup.vault),vault-amount);
    assert.equal((await root(margin)).cash,0n);
    terminal={continuations,applied:frozen.length,appliedCash:application.appliedCash,spent:application.insuranceSpent,
      wallet:setup.traderToken.address,ordinal,withdrawn:amount,vaultAfter:await token(setup.vault)};

  }
  await flush();
  journal??=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  await journal.checkpoint(terminal?'joint-wallet-exit':'population-freeze',true);
  const replay=await journal.finish();
  const report={revision,build,pageInputs,originalRateResult,jointPayment,terminal,active,members:members.length,positions:rows.flatMap(row=>row.lots).filter(value=>value!==0n).length,
    crossAccounts:cohort.additional.filter(member=>member.mode===0).length+1,trades:cohort.trades+2,
    maxRateBits:Math.max(...rounds.flat().map(value=>value.toString(2).length)),dimensions,
    freezeSignature:checks.find(check=>check.label==='freeze populated successor')!.signature,transactions:checks.length,replayedEvents:replay.events};
  writeFileSync(directory+'/population-result.json',json(report));
  console.log('Populated successor freeze',json({...report,pageInputs:pageInputs?{...pageInputs,schedules:undefined}:null,dimensions:{...dimensions,schedules:undefined}}));
} finally {await journal?.close();try{await flush();}finally{ws.close();}}
