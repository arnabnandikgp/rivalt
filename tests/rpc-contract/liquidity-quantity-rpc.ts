// Large quantities are exercised only through signed instructions on a fresh
// qualified local deployment. No financial state is installed by a fixture.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import type {Address,Instruction} from '@solana/kit';
import {findAssociatedTokenPda,getCreateAssociatedTokenInstruction,TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {LiquidityStore} from '../../packages/indexer/src/liquidity-store.js';
import {goldenShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {resolveLiquidityCohort} from './liquidity-resolution-cases.js';
import {digestEvents,fetchScopedHistory,journalBinding,initializationSignature} from './liquidity-journal.js';

const runDir=process.env.RIVALT_RUN_DIR!,databaseUrl=process.env.RIVALT_DATABASE_URL!;
assert(databaseUrl,'Owned real PostgreSQL is required');
const serialize=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,runDir,{
  deferFinality:true,computeUnitLimit:label=>label.startsWith('P32 safety')?1_200_000:label.startsWith('P49 route')?800_000:400_000,
});
let store:LiquidityStore|undefined,replay:LiquidityStore|undefined;
try {
  const regions=(offset:bigint)=>Array.from({length:8},(_,index)=>({endLots:BigInt(index+1)*12_500_000n,offset,slope:0n}));
  const shape={...goldenShape,skewTick:0n,longCap:100_000_000n,shortCap:100_000_000n,
    bidCount:8,askCount:8,bids:regions(2n),asks:regions(3n)};
  const setup=await liquidityExecutionSetup(h,rpc,{shape,makerCash:2_000_000_000_000n,traderCash:2_000_000_000_000n});
  const {root,guard,route}=executionTestHelpers(h,setup);
  const owner=setup.traderOwner,[cross,isolated]=setup.roots;
  const common={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const roots=[...setup.instances.map(maker=>maker.capital),...setup.roots];
  const [reserveDestination]=await findAssociatedTokenPda({owner:setup.payer.address,mint:setup.mint.address,tokenProgram:TOKEN_PROGRAM_ADDRESS});
  await h.send('create test reserve destination',[getCreateAssociatedTokenInstruction({payer:setup.payer,ata:reserveDestination,
    owner:setup.payer.address,mint:setup.mint.address})]);
  const tracked=[...new Set([...setup.tracked,...roots,...setup.configurations,setup.resolution,setup.work,...setup.pages,
    reserveDestination,setup.mint.address,setup.traderToken.address])];
  const raw=async()=>Object.fromEntries(await Promise.all(tracked.map(async key=>[key,(await h.read(key))!.toString('base64')])));
  const reject=async(label:string,instruction:Instruction,error=sdk.CLEARING_ERROR__RESOLUTION,signers:typeof owner[]=[])=>{
    const before=await raw();await h.send(`P49 route ${label}`,[instruction],signers,error);
    assert.deepEqual(await raw(),before,`${label}: complete rollback`);
  };
  const manage=async(margin:Address,operation:sdk.OrderActionArgs)=>sdk.getManageAccountOrderInstruction({
    ...common,actor:owner,margin,guard:await guard(margin),marketIndex:0,operation});
  const withdraw=async(margin:Address,amount:bigint,signer=owner,token=setup.traderToken.address)=>
    sdk.getWithdrawFundedAccountInstruction({...common,owner:signer,margin,quoteMint:setup.mint.address,userToken:token,guard:await guard(margin),amount});
  const financialSteps:unknown[]=[];
  const sendRoute=async(label:string,margin:Address,marketIndex:0|1,side:0|1,quantities:bigint[],indices:number[],
    stored?:{id:bigint;version:bigint;filled:bigint})=>{
    await setup.fresh();
    const instruction=await route({trader:margin,actor:stored?setup.payer:owner,marketIndex,side,
      makers:indices.map(index=>setup.instances[index]),lots:quantities,allInLimit:side===0?sdk.MAX_CASH_ATOMS:0n,
      maxFee:sdk.MAX_CASH_ATOMS,stored});
    const before=await raw();await h.send(`P49 route ${label}`,[instruction],stored?[]:[owner]);
    financialSteps.push({label:`fill ${label}`,before,after:await raw(),trader:margin,marketIndex,side,
      anchor:marketIndex===0?setup.sourcePrices.btc/1_000_000n:setup.sourcePrices.eth/100_000n,
      legs:indices.map((index,leg)=>({capital:setup.instances[index].capital,lots:quantities[leg]}))});
    return instruction;
  };
  await setup.sample();
  // Same account shape at old and expanded quantities, including the complete
  // 100m position / 200m paired gross numeric boundary, with eight curve regions.
  await sendRoute('maximum singleton open',isolated,0,0,[100_000_000n],[1]);
  assert.equal((await root(isolated)).positions[0].lots,100_000_000n);
  await reject('action above numeric domain',await route({trader:isolated,actor:owner,marketIndex:0,side:1,
    makers:[setup.instances[1],setup.instances[2]],lots:[100_000_000n,1n],allInLimit:0n,maxFee:sdk.MAX_CASH_ATOMS}),sdk.CLEARING_ERROR__ROUTE_INTENT,[owner]);
  await sendRoute('maximum singleton close',isolated,0,1,[100_000_000n],[1]);
  assert.equal((await root(isolated)).positions[0].lots,0n);

  // SDK selection itself must build an executable large allocation. The flat
  // quoted price and aggregate fee are independently specified, not re-quoted.
  await setup.sample();
  const built=await sdk.buildLiquidityRoute({snapshot:await setup.snapshot(isolated),trader:isolated,
    marketIndex:0,side:0,lots:1_000_000n,allInLimit:60_015_000_600n,maxFee:12_000_600n},owner.address);
  assert(built);assert.equal(built.allocation.grossQuote,60_003_000_000n);assert.equal(built.allocation.fee,12_000_600n);
  const beforeSdk=await raw();await h.send('P49 route SDK million-lot allocation',built.instructions,[owner]);
  financialSteps.push({label:'fill SDK million',before:beforeSdk,after:await raw(),trader:isolated,marketIndex:0,side:0,anchor:60_000n,
    legs:built.allocation.legs.map(leg=>({capital:setup.instances.find(maker=>maker.registration===leg.registration)!.capital,lots:leg.lots}))});
  const protectedState=await root(isolated),slot=await setup.slot();
  const protection={side:1,lots:1_000_000n,limit:50_000n,feeBudget:15_000_000n,startSlot:slot,expirySlot:slot+2000n,
    reduceOnly:true,generation:protectedState.positions[0].generation};
  await h.send('protect million-lot existing exposure',[await manage(isolated,{__kind:'Protect',expectedId:1n,
    takeProfit:{...protection,trigger:1,threshold:65_000n},stopLoss:{...protection,trigger:2,threshold:55_000n}})],[owner]);
  assert((await root(isolated)).reserved>0n);
  await reject('reservation prevents excessive cash exit',await withdraw(isolated,(await root(isolated)).cash-1n),sdk.CLEARING_ERROR__ARITHMETIC,[owner]);
  await h.send('cash transfer with large protective reservation',[sdk.getTransferFundedAccountInstruction({...common,
    owner,donor:isolated,recipient:cross,guard:await guard(isolated),amount:1_000_000n})],[owner]);
  await sendRoute('manual reduction clips protective eligibility',isolated,0,1,[200_000n],[0]);
  assert.equal((await root(isolated)).positions[0].lots,800_000n);
  assert.equal((await root(isolated)).book.protections[0].protection.remaining,1_000_000n);
  setup.sourcePrices.btc=54_000_000_000n;await setup.qualify();
  await sendRoute('large stored stop partial',isolated,0,1,[400_001n],[0],{id:2n,version:1n,filled:0n});
  const stopped=await root(isolated),stop=stopped.book.orders.find(entry=>entry.order.id===2n)!.order;
  assert.equal(stop.filled,400_001n);assert.equal(stopped.book.protections[0].protection.remaining,599_999n);
  await reject('protection cannot exceed remaining position',await route({trader:isolated,actor:setup.payer,marketIndex:0,side:1,
    makers:[setup.instances[0]],lots:[400_000n],stored:{id:2n,version:1n,filled:400_001n}}),sdk.CLEARING_ERROR__ORDER_STATE);
  await sendRoute('large stored stop final',isolated,0,1,[399_999n],[0],{id:2n,version:1n,filled:400_001n});
  assert.equal((await root(isolated)).positions[0].lots,0n);
  assert((await root(isolated)).book.orders.every(entry=>![1,2].includes(entry.order.state)));

  setup.sourcePrices.btc=60_000_000_000n;await setup.qualify();
  const entrySlot=await setup.slot(),terms={side:0,lots:1_000_000n,limit:66_000n,feeBudget:13_000_000n,
    startSlot:entrySlot,expirySlot:entrySlot+2000n,reduceOnly:false,generation:0n,trigger:0,threshold:0n};
  await h.send('place million-lot entry order',[await manage(cross,{__kind:'Place',expectedId:1n,terms})],[owner]);
  assert((await root(cross)).reserved>0n);
  await sendRoute('entry partial two maker programs',cross,0,0,[200_000n,200_001n],[0,2],{id:1n,version:1n,filled:0n});
  await sendRoute('entry final two maker programs',cross,0,0,[299_999n,300_000n],[0,2],{id:1n,version:1n,filled:400_001n});
  const filled=(await root(cross)).book.orders.find(entry=>entry.order.id===1n)!.order;
  assert.equal(filled.feeCharged,12_000_600n);assert.equal(filled.notional,60_003_000_000n);
  await setup.sample();await sendRoute('ETH cross with whole-account funding',cross,1,0,[500_000n,500_000n],[3,5]);
  await h.send('funded withdrawal keeps large cross account initial margin',[await withdraw(cross,(await root(cross)).cash-10_500_000_000n)],[owner]);
  setup.sourcePrices.btc=52_000_000_000n;await setup.qualify();
  const liquidate=async(lots:bigint)=>sdk.getLiquidateAccountInstruction({...common,target:cross,receiver:isolated,
    receiverOwner:owner,targetGuard:await guard(cross),receiverGuard:await guard(isolated),marketIndex:0,lots,price:52_000n});
  await reject('liquidation cannot exceed target',await liquidate(1_000_001n),sdk.CLEARING_ERROR__ARITHMETIC,[owner]);
  const beforeLiquidation=await raw(),liquidation=await liquidate(500_000n);
  await h.send('P49 route half-million funded liquidation',[liquidation],[owner]);
  const afterLiquidation=await raw();assert.equal((await root(cross)).positions[0].lots,500_000n);
  assert.equal((await root(isolated)).positions[0].lots,500_000n);
  await reject('liquidation guard cannot replay',liquidation,sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE,[owner]);

  const sources={primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed};
  setup.sourcePrices.btc=40_000_000_000n;setup.sourcePrices.eth=2_000_000_000n;await setup.fresh();
  await h.send('freeze complete large-quantity cohort',[sdk.getFreezeAccountsInstruction({...setup.safetyCommon,...sources,
    caller:setup.payer,target:cross,safetyEpoch:sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!).epoch,
    resolutionEpoch:sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!).epoch,emergency:false})]);
  const frozenAccounts=await raw();
  await resolveLiquidityCohort(h,setup,roots,reject);
  const completedAccounts=await raw();
  await h.send('resolved large-cohort funded exit',[await withdraw(roots[0],100n,setup.owner,setup.token.address)],[setup.owner]);
  const resolvedAccounts=await raw();
  const capture={scenario:'two-market-resolved',venue:setup.venue,custody:setup.custody,safety:setup.safety,registry:setup.registry,
    vault:setup.vault,mint:setup.mint.address,userTokens:[setup.token.address,setup.traderToken.address],reserveDestination,
    resolution:setup.resolution,work:setup.work,pages:setup.pages,roots,markets:setup.markets,ledgers:setup.ledgers,
    financialSteps,liquidationSteps:[{target:cross,receiver:isolated,lots:500_000n,price:52_000n,before:beforeLiquidation,after:afterLiquidation}],
    frozenAccounts,completedAccounts,resolvedAccounts,rawAccounts:resolvedAccounts};
  writeFileSync(`${runDir}/financial-capture.json`,serialize(capture));
  execFileSync('python3',['tests/financial/large-quantity-reference.py',`${runDir}/financial-capture.json`],{stdio:'inherit'});
  execFileSync('python3',['tests/financial/account-safety-reference.py',`${runDir}/financial-capture.json`],{stdio:'inherit'});
  await flush();
  const anchor=await initializationSignature(rpc,checks.map(check=>String(check.signature)),setup.deployment.eventAuthority);
  const history=()=>fetchScopedHistory(rpc,anchor,setup.deployment.eventAuthority,setup.venue,setup.domain.toString('hex'));
  const original=await history(),binding=await journalBinding(rpc,anchor,original,setup.venue,setup.domain.toString('hex'));
  store=new LiquidityStore(databaseUrl,'p49-large');await store.migrate();await store.bind(binding);
  await store.commit(original.blocks,original.invocations,original.head,null);
  const projection=await store.snapshot();
  assert.equal(digestEvents((await store.pool.query('SELECT bytes FROM events WHERE run_id=$1 ORDER BY sequence',[store.runId])).rows),original.digest);
  for(const key of roots)assert.equal(projection.state.roots[key].cash,(await root(key)).cash.toString());
  await store.pool.query('CREATE DATABASE rivalt_p49_replay');
  const replayUrl=new URL(databaseUrl);replayUrl.pathname='/rivalt_p49_replay';
  replay=new LiquidityStore(replayUrl.toString(),'p49-fresh');await replay.migrate();await replay.bind(binding);
  const refetched=await history();await replay.commit(refetched.blocks,refetched.invocations,refetched.head,null);
  assert.deepEqual((await replay.snapshot()).state,projection.state,'Fresh PostgreSQL replay equals finalized projection');
  writeFileSync(`${runDir}/summary.json`,serialize({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    trackedDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
    build:JSON.parse(readFileSync(`${process.env.RIVALT_ARTIFACT_DIR}/build-manifest.json`,'utf8')),checks,binding,
    eventCount:original.events.length,projection:projection.state}));
  console.log(serialize({stage:'large-quantity-rpc-ws-postgres-pass',outcomes:checks.length,events:original.events.length}));
} finally {await replay?.close();await store?.close();try{await flush();}finally{ws.close();}}
