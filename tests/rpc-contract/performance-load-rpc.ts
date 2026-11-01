// Bounded direct-RPC offered-load experiment, separate from durable queue capacity.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {cpus,release} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {getTransferSolInstruction,getCreateAccountInstruction} from '@solana-program/system';
import {TOKEN_PROGRAM_ADDRESS,getInitializeAccount3Instruction,getMintToInstruction,getTokenDecoder} from '@solana-program/token';
import type {Address} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {LiquidityIndexer} from '../../packages/indexer/src/liquidity-indexer.js';
import {ReconciliationAhead} from '../../packages/indexer/src/reconciliation-progress.js';
import {eventPayloads,json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {initializationSignature} from './liquidity-journal.js';
import {fixtureKey} from './harness.js';
import {auditFill} from './liquidity-continuation-model.js';
import {observedDistribution} from '../performance/receipt-metrics.js';

const directory=process.env.RIVALT_RUN_DIR!,databaseUrl=process.env.RIVALT_DATABASE_URL!;
assert(databaseUrl,'Actual PostgreSQL required');
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const payers=new Map<string,Keypair>();
const {h,rpc,ws,checks,flush,conformance}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{
  deferFinality:true,computeUnitLimit:label=>label.startsWith('load offer ')?800_000:400_000,
  observeOutcomes:label=>label.startsWith('load offer '),payerFor:label=>payers.get(label),
});
type Offer={id:number;workload:string;rate:number;dueMs:number;lagMs:number;trader:Address;marketIndex:0|1;side:0|1;lots:bigint;maker:number;
  eligible:boolean;constructed:boolean;submitted:boolean;reason:string|null;buildMs?:number;sourceModes?:string[];label:string};
const offers:Offer[]=[],ramps:unknown[]=[],indexSamples:unknown[]=[],producerSamples:unknown[]=[];
let indexer:LiquidityIndexer|undefined,replay:LiquidityIndexer|undefined,running=false,producer:Promise<void>|undefined,indexing:Promise<void>|undefined;
let backgroundError:unknown;
const metric=(values:number[])=>values.length?observedDistribution(values):null;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{verifyRejections:false}),helper=executionTestHelpers(h,setup);
  const ethOwner=await fixtureKey('p44-load-independent-eth-owner'),ethToken=await fixtureKey('p44-load-eth-token');
  await h.send('load fund independent owner',[getTransferSolInstruction({source:setup.payer,destination:ethOwner.address,amount:1_000_000_000n})]);
  await h.send('load mint independent ETH collateral',[getCreateAccountInstruction({payer:setup.payer,newAccount:ethToken,
    lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),getInitializeAccount3Instruction({account:ethToken.address,mint:setup.mint.address,owner:ethOwner.address}),
    getMintToInstruction({mint:setup.mint.address,token:ethToken.address,mintAuthority:setup.payer,amount:1_000_000n})],[ethToken]);
  const [portfolio]=await sdk.deriveAccountPortfolio(setup.venue,ethOwner.address,0),[ethRoot]=await sdk.deriveMarginAccount(portfolio,1);
  await h.send('load create independent ETH portfolio',[await sdk.getCreatePortfolioInstructionAsync({...setup.common,owner:ethOwner,portfolio,index:0})],[ethOwner]);
  await h.send('load register independent isolated ETH',[await sdk.getRegisterMarginInstructionAsync({...setup.common,owner:ethOwner,portfolio,margin:ethRoot,subaccountIndex:1,mode:1,isolatedMarketIndex:1,role:0})],[ethOwner]);
  await h.send('load deposit independent ETH collateral',[await sdk.getDepositAccountInstructionAsync({...setup.common,owner:ethOwner,margin:ethRoot,quoteMint:setup.mint.address,userToken:ethToken.address,amount:1_000_000n})],[ethOwner]);
  await setup.qualify();await flush();
  const allRoots=[...setup.instances.map(maker=>maker.capital),...setup.roots,ethRoot],initial=await Promise.all(allRoots.map(helper.root));
  const anchor=await initializationSignature(rpc,checks.map(check=>String(check.signature)),setup.deployment.eventAuthority);
  const config={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl,runId:'p44-load',venue:setup.venue,anchor,profile:'liquidity-execution-qualification' as const,pageSize:100};
  indexer=new LiquidityIndexer(config);await indexer.open();await indexer.cycle();
  running=true;
  producer=(async()=>{while(running){const started=performance.now();await setup.sample();producerSamples.push({elapsedMs:performance.now()-started,at:Date.now()});await delay(50);}})().catch(error=>{backgroundError??=error;});
  indexing=(async()=>{while(running){const started=performance.now();try{await indexer!.cycle();indexSamples.push({at:Date.now(),elapsedMs:performance.now()-started,metrics:structuredClone(indexer!.metrics)});}
    catch(error){indexSamples.push({at:Date.now(),reason:String(error)});if(!(error instanceof ReconciliationAhead))backgroundError??=error;}await delay(250);}})();
  const origin=performance.now(),pending=new Set<Promise<void>>();
  async function execute(offer:Offer,actor:Keypair){
    const started=performance.now();
    const snapshot=await sdk.readAccountTradeSnapshot(rpc,setup.identity,offer.trader,offer.marketIndex,'confirmed');
    offer.sourceModes=snapshot.marketStates.map(market=>sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot));
    const required=snapshot.roots[offer.trader].positions.map((position,index)=>position.lots!==0n||position.virtualScaled!==0n||index===offer.marketIndex);
    const unavailable=required.findIndex((needed,index)=>needed&&offer.sourceModes![index]!=='Normal');
    if(unavailable>=0){offer.reason=`required-market-${unavailable}-${offer.sourceModes[unavailable]}`;return;}
    // Explicit selected-maker intents: not an allocator/optimal-routing benchmark.
    // All signed limits and actual whole-account financial admission still apply.
    const maker=snapshot.liquidity!.adapters.find(maker=>maker.registrationState.instance===offer.maker);
    if(!maker||maker.unavailable){offer.reason=`maker:${maker?.unavailable??'missing'}`;return;}
    offer.eligible=true;
    const instruction=await helper.route({trader:offer.trader,actor,marketIndex:offer.marketIndex,side:offer.side,
      makers:[setup.instances[offer.marketIndex*3+offer.maker]],lots:[offer.lots],minimalMarkets:true});
    offer.constructed=true;offer.buildMs=performance.now()-started;payers.set(offer.label,actor);
    await h.send(offer.label,[instruction],[actor]);offer.submitted=true;
  }
  for(const workload of ['same-cross-concentrated','same-market-spread','disjoint-isolated']) {
    for(const rate of [2,8,32]) {
      const first=offers.length,start=performance.now()+100,total=rate*8;
      for(let index=0;index<total;index++) {
        const due=start+index*1000/rate;await delay(Math.max(0,due-performance.now()));
        if(backgroundError)throw backgroundError;
        const marketIndex=(workload==='disjoint-isolated'&&index%2===1?1:0) as 0|1;
        const trader=marketIndex===1?ethRoot:workload==='same-cross-concentrated'||workload==='same-market-spread'&&index%2===0?setup.roots[0]:setup.roots[1];
        const id=offers.length,offer:Offer={id,label:`load offer ${id}`,workload,rate,dueMs:due-origin,lagMs:Math.max(0,performance.now()-due),trader,marketIndex,
          side:(Math.floor(index/2)%2) as 0|1,lots:1n+BigInt(Math.floor(index/4)%2),maker:workload==='same-market-spread'?index%3:0,
          eligible:false,constructed:false,submitted:false,reason:null};offers.push(offer);
        if(pending.size>=4){offer.reason='generator-inflight-limit';continue;}
        let task:Promise<void>;task=execute(offer,marketIndex===1?ethOwner:setup.traderOwner).catch(error=>{offer.reason=`unexpected:${String(error)}`;backgroundError??=error;})
          .finally(()=>{pending.delete(task);appendFileSync(`${directory}/offers.ndjson`,json(offer));});pending.add(task);
      }
      await delay(Math.max(0,start+8000-performance.now()));await Promise.all(pending);await flush();if(backgroundError)throw backgroundError;
      const cohort=offers.slice(first),landed=cohort.flatMap(offer=>checks.filter(check=>check.label===offer.label));
      for(const offer of cohort){const check=landed.find(check=>check.label===offer.label);if(check?.error)offer.reason=`onchain:${JSON.stringify(check.error)}`;}
      const successes=landed.filter(check=>check.error===null),latency=metric(landed.map(check=>Number(check.signedToConfirmedMs)));
      const degraded=successes.length/cohort.length<0.9||(latency?.p95??Infinity)>500||Math.max(...cohort.map(offer=>offer.lagMs))>250;
      ramps.push({workload,rate,durationMs:performance.now()-start,offered:cohort.length,eligible:cohort.filter(offer=>offer.eligible).length,
        constructed:cohort.filter(offer=>offer.constructed).length,simulated:landed.length,submitted:landed.length,finalizedSuccess:successes.length,
        rejected:landed.length-successes.length,expired:0,unresolved:0,unsubmitted:cohort.length-landed.length,
        reasons:Object.fromEntries([...new Set(cohort.map(offer=>offer.reason).filter(Boolean))].map(reason=>[reason,cohort.filter(offer=>offer.reason===reason).length])),
        generatorLagMs:metric(cohort.map(offer=>offer.lagMs)),buildMs:metric(cohort.flatMap(offer=>offer.buildMs===undefined?[]:[offer.buildMs])),
        signedToConfirmedMs:latency,signedToFinalizedMs:metric(landed.map(check=>Number(check.signedToFinalizedMs))),
        finalizedReceiptFetchMs:metric(landed.map(check=>Number(check.finalizedReceiptFetchMs))),finalizedToWsAuditMs:metric(landed.map(check=>Number(check.finalizedToWsAuditMs))),degraded});
      writeFileSync(`${directory}/ramps.json`,json(ramps));if(degraded)break;
    }
  }
  running=false;await Promise.all([producer,indexing]);await flush();if(backgroundError)throw backgroundError;
  // Independent per-root replay sorted by authoritative root version, not async
  // submit order. Reverted invocations contribute no economic transition.
  const changes=new Map<number,{after:sdk.MarginAccountSnapshot;offer:Offer;gross:bigint;fee:bigint;trader:boolean}[]>(),fees=[0n,0n];
  for(const offer of offers.filter(offer=>offer.submitted)){
    const index=checks.findIndex(check=>check.label===offer.label),check=checks[index];assert(check);
    const transaction=JSON.parse(readFileSync(`${directory}/transaction-${index}.json`,'utf8'));if(transaction.meta.err)continue;
    const payload=eventPayloads(String(check.signature),transaction,setup.common.eventAuthority).map(event=>event.payload)
      .find(payload=>sdk.hex(payload.subarray(0,8))===sdk.hex(sdk.LIQUIDITY_ROUTE_EXECUTED_EVENT_DISCRIMINATOR));assert(payload);
    const event=sdk.getLiquidityRouteExecutedEventDecoder().decode(payload),reference=offer.marketIndex===0?60_000n:30_000n;
    const gross=offer.lots*(reference+(offer.side===0?3n:-2n)),fee=(gross+4999n)/5000n;
    assert.equal(event.grossQuote,gross);assert.equal(event.fee,fee);assert.equal(event.legs.length,1);assert.equal(event.legs[0].instance,offer.maker);
    assert.equal(event.insuranceCredit,(fee+BigInt(event.carryBefore))/4n);assert.equal(BigInt(event.carryAfter),(fee+BigInt(event.carryBefore))%4n);fees[offer.marketIndex]+=fee;
    for(const [offset,after] of event.rootStates.entries())changes.set(after.id,[...changes.get(after.id)??[],{after,offer,gross,fee:offset===0?fee:0n,trader:offset===0}]);
  }
  const finalRoots=await Promise.all(allRoots.map(helper.root));
  for(const before of initial){let previous=before;for(const change of (changes.get(before.id)??[]).sort((a,b)=>a.after.stateVersion<b.after.stateVersion?-1:1)){
    assert.equal(change.after.stateVersion,previous.stateVersion+1n);auditFill(previous,change.after,change.offer.side,change.offer.lots,change.gross,change.fee,change.trader,change.offer.marketIndex);
    previous={...previous,...change.after};}
    const final=finalRoots.find(root=>root.id===before.id)!;assert.equal(final.cash,previous.cash);assert.deepEqual(final.positions,previous.positions);assert.equal(final.stateVersion,previous.stateVersion);
  }
  const ledgers=await Promise.all(setup.ledgers.map(async key=>sdk.getMarketLedgerDecoder().decode((await h.read(key))!))),markets=await Promise.all([0,1].map(setup.marketState));
  for(const marketIndex of [0,1]){assert.equal(finalRoots.reduce((sum,root)=>sum+root.positions[marketIndex].lots,0n),0n);
    assert.equal(finalRoots.reduce((sum,root)=>{const position=root.positions[marketIndex];return sum+position.virtualScaled-position.lots*(markets[marketIndex].fundingIndexScaled-position.fundingCheckpointScaled);},0n),0n);
    assert.equal(ledgers[marketIndex].insurance,fees[marketIndex]/4n);assert.equal(ledgers[marketIndex].fees,fees[marketIndex]-fees[marketIndex]/4n);assert.equal(BigInt(ledgers[marketIndex].insuranceFeeRemainder),fees[marketIndex]%4n);}
  const cash=finalRoots.reduce((sum,root)=>sum+root.cash,0n),custody=sdk.getCustodyDecoder().decode((await h.read(setup.custody))!);
  assert.equal(cash+fees[0]+fees[1],9_000_000n);assert.equal(custody.allocatedVault,cash+ledgers.reduce((sum,ledger)=>sum+ledger.insurance+ledger.fees+ledger.settlement,0n));
  assert.equal(getTokenDecoder().decode((await h.read(setup.vault))!).amount,custody.allocatedVault);
  await indexer.cycle();const state=(await indexer.store.snapshot()).state,reconciliation=await indexer.reconcile();
  await indexer.store.pool.query('CREATE DATABASE p44_load_replay');const replayUrl=new URL(databaseUrl);replayUrl.pathname='/p44_load_replay';
  replay=new LiquidityIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p44-load-replay'});await replay.open();await replay.cycle();assert.deepEqual((await replay.store.snapshot()).state,state);
  const parity=await conformance.finish(directory,[],h.read);
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),revision);
  assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
  const summary={revision,trackedDirty:false,build:JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json','utf8')),runtime:await rpc.call('getVersion'),
    host:{cpu:cpus()[0].model,cores:cpus().length,os:release(),node:process.version},scope:'Direct selected-maker RPC offers with concurrent actual source/reprice/report transactions and live PostgreSQL; separate from durable-queue capacity or validator TPS',
    policy:{rates:[2,8,32],windowSeconds:8,maxInflight:4,stop:'offered success below 90%, confirmed p95 over 500 ms, or generator lag over 250 ms; each workload stops independently',fullBooksAndWideResources:'separate pinned acceptance constituents'},
    offers,ramps,checks,parity,producerSamples,indexSamples,reconciliation,replayMetrics:replay.metrics,financial:{fees,cash,actualVault:custody.allocatedVault,independentRootTransitions:true},resource:process.resourceUsage(),memory:process.memoryUsage()};
  writeFileSync(`${directory}/summary.json`,json(summary));console.log(json({stage:'p44-load-pass',offered:offers.length,ramps,reconciliation}));
}finally{running=false;await Promise.allSettled([producer,indexing].filter(Boolean));await replay?.close();await indexer?.close();try{await flush();}finally{ws.close();}}
