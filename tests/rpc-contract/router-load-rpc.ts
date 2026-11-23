// Matched independently timed wallet offers, with one real closed claimant on both arms.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import * as sdk from '@rivalt/sdk';
import {eventPayloads,json} from '../../packages/indexer/src/events.js';
import {LiquidityIndexer} from '../../packages/indexer/src/liquidity-indexer.js';
import {accountServiceApi} from '../../packages/services/src/account-service-api.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {conflicts,transactionLocks} from '../performance/lock-model.js';
import {observedDistribution} from '../performance/receipt-metrics.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {routerBuild} from './execution-router-build.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {backingStep} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

function knob(name:string, fallback:number, min:number, max:number) {
  const value=Number(process.env[name]??fallback);
  assert(Number.isSafeInteger(value)&&value>=min&&value<=max,'Invalid '+name);
  return value;
}
const transport=process.env.RIVALT_LOAD_TRANSPORT??'rpc';
assert(transport==='rpc'||transport==='relay','Choose rpc or relay');
const arm=process.env.RIVALT_SETTLEMENT_ARM;
assert(arm==='active'||arm==='offered-only','Choose active or offered-only');
const traders=knob('RIVALT_LOAD_TRADERS',6,2,32),count=knob('RIVALT_LOAD_OFFERS',18,2,200);
const gap=knob('RIVALT_LOAD_GAP_MS',280,30,2000),seed=knob('RIVALT_LOAD_SEED',117,1,100000);
const refresh=knob('RIVALT_LOAD_REFRESH_MS',2400,2100,5000),btcPercent=knob('RIVALT_LOAD_BTC_PERCENT',75,0,100);
const maxLots=knob('RIVALT_LOAD_MAX_LOTS',3,1,32),thinDepth=knob('RIVALT_LOAD_FIRST_MAKER_LOTS',2,1,4096);
let random=seed;
const next=()=>{random=(Math.imul(1664525,random)+1013904223)>>>0;return random;};
const trace=Array.from({length:count},(_,id)=>({id,dueMs:id*gap,trader:1+id%traders,
  market:(next()%100<btcPercent?0:1) as 0|1,side:(next()>>>31) as 0|1,lots:1n+BigInt(next()%maxLots)}));
const selection='execution-router-candidate',directory=process.env.RIVALT_RUN_DIR!,url=process.env.RIVALT_RPC_URL!;
const wsUrl=process.env.RIVALT_WS_URL!,database=process.env.RIVALT_DATABASE_URL!,runId='p55b2-application';
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const build=routerBuild();
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(url,wsUrl,directory,{deferFinality:true});
const runtime=new AccountRuntime(database,runId,url,4,selection),api=accountServiceApi(runtime);
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined,indexer:LiquidityIndexer|undefined;
let running=true,settlement=arm==='active',scheduling=true;
const loops:Promise<void>[]=[],errors:unknown[]=[];
function background(task:()=>Promise<void>){loops.push(task().catch(error=>{errors.push(error);running=false;}));}
function healthy(){if(errors.length)throw errors[0];}
const clock=()=>performance.now();
const dist=(values:number[])=>values.length?observedDistribution(values):null;
try {
  // A shallow first maker and two deeper ones have the same known marginal price.
  const shape=(instance:number)=>{
    if(instance!==0)return symmetricPayoutShape;
    const regions=symmetricPayoutShape.asks.map((region,index)=>index===0?{...region,endLots:BigInt(thinDepth)}:region);
    return {...symmetricPayoutShape,asks:regions,bids:regions,shortCap:BigInt(thinDepth),longCap:BigInt(thinDepth)};
  };
  const setup=await liquidityExecutionSetup(h,rpc,{independentTraders:true,traderCount:traders+1,
    marketCheckpoints:true,marginLayout:'ledger-lanes',shape,verifyRejections:false});
  const {root,route,withCheckpoints}=executionTestHelpers(h,setup),creditor=setup.roots[0],owner=setup.traderOwners[0];
  const [certificate]=await sdk.deriveSettlementCertificate(setup.venue,0);
  const common={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  await setup.sample();
  await h.send('open claimant position',[await route({actor:owner,trader:creditor,marketIndex:0,side:0,
    lots:[1n],makers:[setup.instances[0]],minimalMarkets:true,marketLane:true})],[owner]);
  setup.sourcePrices.btc=61_000_000_000n;
  await setup.qualify();
  await h.send('fund the closed gain pool',await withCheckpoints(sdk.getCollectAccountLossInstruction({...common,
    actor:setup.payer,margin:setup.instances[0].capital,marketIndex:0,amount:996n})));
  await h.send('initialize backing certificate',[sdk.getInitializeMarketBackingInstruction({...common,payer:setup.payer,certificate,marketIndex:0})]);
  for(let step=0;!sdk.getSettlementCertificateDecoder().decode((await h.read(certificate))!).complete;step++){
    assert(step<100+traders*3);
    if(step%4===0)await setup.sample();
    const nextPage=await backingStep(h,{...common,certificate,ledger:setup.ledgers[0]},step===0);
    await h.send('backing page '+step,await withCheckpoints(nextPage.instruction));
  }
  await setup.sample();
  await h.send('close against a different funded maker',[await route({actor:owner,trader:creditor,marketIndex:0,side:1,
    lots:[1n],makers:[setup.instances[2]],minimalMarkets:true,marketLane:true,reduceOnly:true,
    generation:(await root(creditor)).positions[0].generation})],[owner]);
  const before=await root(creditor);
  assert.deepEqual([before.cash,before.positions[0].lots,before.positions[0].virtualScaled],[999_974n,0n,996_000_000_000n]);
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  await journal.checkpoint('ready',true);
  await runtime.open();
  const {binding}=await runtime.store.snapshot();
  indexer=new LiquidityIndexer({rpcUrl:url,wsUrl,databaseUrl:database,runId,venue:setup.venue,anchor:binding.anchor,
    deployment:selection,profile:'liquidity-execution-qualification'});
  await indexer.open();
  const client=new sdk.AccountUserClient({version:4,accountSchema:10,deployment:selection,chain:'solana:localnet',
    profile:'liquidity-execution-qualification',rpcUrl:url,wsUrl,genesis:binding.genesis,venue:setup.venue,mint:setup.mint.address,
    anchor:binding.anchor,anchorHash:binding.anchorHash,domain:binding.domain});
  const walletRpc=client.rpc.call.bind(client.rpc);
  let previewIndex=0;
  client.rpc.call=async(method,params=[])=>{
    const value=await walletRpc(method,params);
    if(method==='simulateTransaction')writeFileSync(directory+'/wallet-preview-'+(previewIndex++)+'.json',
      json({wire:params[0],slot:value.context.slot,error:value.value.err,cu:value.value.unitsConsumed,logs:value.value.logs}));
    return value;
  };
  await client.environment();
  // SQL replay and artifact verification can outlast the oracle's held window.
  // Both arms must actually reach Normal before starting the offered trace.
  await setup.qualify();
  const ready=await client.snapshot([creditor],'confirmed');
  assert.deepEqual(ready.marketStates.map(market=>sdk.accountSourceMode(ready.safetyState,market,ready.now,ready.slot)),['Normal','Normal']);
  const startSlot=await setup.slot();
  const start=clock(),since=()=>Math.round(clock()-start);
  const finalizedAt=new Map<string,number>();
  const at=async(ms:number)=>{await delay(Math.max(0,ms-since()));};
  let paidMs:number|undefined,pollsUnavailable=0;
  const polls:Record<string,unknown>[]=[],originals=new Map<number,{time:number;subscription:number;signature:string;wire:string}>();
  background(async()=>{while(running){await indexer!.cycle();await delay(80);}});
  background(async()=>{while(running){await runtime.execute();await delay(45);}});
  background(async()=>{while(running){
    const outstanding=[...originals.values()].map(original=>original.signature).filter(signature=>!finalizedAt.has(signature));
    if(outstanding.length){
      const statuses=await rpc.call('getSignatureStatuses',[outstanding,{searchTransactionHistory:true}]);
      statuses.value.forEach((status:{confirmationStatus:string}|null,index:number)=>{
        if(status?.confirmationStatus==='finalized')finalizedAt.set(outstanding[index],since());
      });
    }
    await delay(50);
  }});
  background(async()=>{while(running){
    if(settlement&&scheduling){
      try{polls.push({ms:since(),...await runtime.settle(setup.payer)});}
      catch(error){if(!(error instanceof Error && error.message==='Reconciled projection unavailable'))throw error;pollsUnavailable++;}
    }
    if(paidMs===undefined){const state=await root(creditor);
      if(state.cash===before.cash+996n && state.positions[0].virtualScaled===0n)paidMs=since();}
    await delay(80);
  }});
  background(async()=>{for(let round=1;running;round++){await at(round*refresh);if(running)await setup.sample();}});
  const offers=await Promise.all(trace.map(async offer=>{
    await at(offer.dueMs);healthy();
    const entered=since(),actor=setup.traderOwners[offer.trader],trader=setup.roots[offer.trader];
    const expectedGross=offer.lots*((offer.market===0?61_000n:30_000n)+(offer.side===0?2n:-2n));
    const expectedFee=(expectedGross+4999n)/5000n;
    const order=await client.marketOrder({snapshot:await client.tradeSnapshot(trader,offer.market),trader,
      marketIndex:offer.market,side:offer.side,lots:offer.lots,reduceOnly:false,maxFee:expectedFee,
      allInLimit:offer.side===0?expectedGross+expectedFee:expectedGross-expectedFee},actor.address);
    let prepared;
    try{prepared=await client.prepare('Load offer '+offer.id,actor.address,order.instructions);}
    catch(error){
      if(!(error instanceof Error && error.message.startsWith('Preview rejected:')))throw error;
      return {...offer,entered,expectedGross,expectedFee,previewRefusal:error.message};
    }
    await prepared.transaction.sign([actor]);
    const intent=await client.signed(prepared,prepared.transaction),subscription=await ws.call('signatureSubscribe',[intent.signature,{commitment:'finalized'}]);
    originals.set(offer.id,{time:since(),subscription,signature:intent.signature,wire:intent.wire});
    if(transport==='rpc'){
      await client.broadcast(intent);
      writeFileSync(directory+'/wallet-original-'+offer.id+'.json',json(intent));
    }else {
      const response=await api.inject({method:'POST',url:'/v4/submit',payload:{requestId:'load:'+offer.id,wire:intent.wire}});
      assert.equal(response.statusCode,200,response.body);assert.equal(response.json().signature,intent.signature);
    }
    return {...offer,entered,expectedGross,expectedFee,previewRefusal:null};
  }));
  writeFileSync(directory+'/offers.json',json(offers));
  assert(originals.size>0,'No wallet preview admitted; see offers and wallet-preview records');
  const arrived=since();
  const statuses=async()=>{
    const rows=(await runtime.store.pool.query(
      'SELECT request_id,signature,status,attempts,wire,budget FROM service_intents WHERE run_id=$1 ORDER BY request_id',[runId])).rows;
    if(transport==='relay')return rows;
    const submitted=[...originals.entries()];
    const seen=await rpc.call('getSignatureStatuses',[submitted.map(([,row])=>row.signature),{searchTransactionHistory:true}]);
    return [...rows,...submitted.map(([id,row],index)=>{
      const landed=seen.value[index];
      const status=landed?.confirmationStatus==='finalized'?(landed.err?'failed':'finalized'):'unresolved';
      return {request_id:'load:'+id,signature:row.signature,status,attempts:1,wire:row.wire,budget:null};
    })];
  };
  const terminal=new Set(['finalized','failed','expired-unexecuted']);
  const deadline=clock()+30_000;
  while(clock()<deadline){
    healthy();const wallets=(await statuses()).filter(row=>row.request_id.startsWith('load:'));
    for(const row of wallets)if(['failed','finalized'].includes(row.status)&&!finalizedAt.has(row.signature))finalizedAt.set(row.signature,since());
    if(wallets.length===originals.size&&wallets.every(row=>terminal.has(row.status)))break;
    await delay(50);
  }
  const end=since(),during=(await statuses()).filter(row=>row.budget!==null).length;
  if(arm==='offered-only'){assert.equal(during,0);assert.equal((await root(creditor)).cash,before.cash);}
  settlement=true;
  while(paidMs===undefined&&since()<end+55_000){healthy();await delay(100);}
  const payoutObservationMs=since();
  scheduling=false;
  while((await statuses()).some(row=>!terminal.has(row.status))&&since()<payoutObservationMs+10_000){healthy();await delay(100);}
  running=false;await Promise.all(loops);healthy();await flush();
  await indexer.close();indexer=undefined;
  const rows=await statuses();
  type Receipt={id:string;signature:string;attempts:number;slot:number;error:unknown;bytes:number;cu:number;
    fee:number;locks:ReturnType<typeof transactionLocks>;role:'trader'|'settlement';offer?:number;lots?:bigint;legs?:number[];ms?:number};
  const receipts:Receipt[]=[];
  for(const row of rows){
    const receipt=await rpc.call('getTransaction',[row.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    if(!receipt){assert(!['finalized','failed'].includes(row.status));continue;}
    assert.equal(receipt.transaction[0],row.wire);
    const wire=Buffer.from(row.wire,'base64'),locks=transactionLocks(wire);
    const base={id:String(row.request_id),signature:row.signature,attempts:row.attempts,slot:receipt.slot,error:receipt.meta.err,
      bytes:wire.length,cu:Number(receipt.meta.computeUnitsConsumed),fee:Number(receipt.meta.fee),locks};
    if(!row.request_id.startsWith('load:')){receipts.push({...base,role:'settlement'});continue;}
    const offer=offers[Number(row.request_id.slice(5))],original=originals.get(offer.id)!;
    assert.deepEqual((await ws.notification(original.subscription)).params.result.value.err,receipt.meta.err);
    let legs:number[]=[];
    if(!receipt.meta.err){
      const parsed=await rpc.call('getTransaction',[row.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
      const fill=eventPayloads(row.signature,parsed,setup.common.eventAuthority).find(({payload})=>payload.subarray(0,8).equals(Buffer.from(sdk.LIQUIDITY_ROUTE_EXECUTED_EVENT_DISCRIMINATOR)));
      assert(fill);const event=sdk.getLiquidityRouteExecutedEventDecoder().decode(fill.payload);
      assert.deepEqual([event.side,event.lots,event.grossQuote,event.fee],[offer.side,offer.lots,offer.expectedGross,offer.expectedFee]);
      legs=event.legs.map(leg=>leg.instance);
    }
    receipts.push({...base,role:'trader',offer:offer.id,lots:offer.lots,legs,ms:finalizedAt.get(row.signature)!-original.time});
  }
  const successful=receipts.filter(row=>row.role==='trader'&&!row.error);
  assert(successful.length>0,'No successful market order');
  const operator=[];
  for(const check of checks.filter(row=>String(row.label).includes('six maker publications')||String(row.label).includes('two-market reports'))){
    const tx=await rpc.call('getTransaction',[check.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    if(BigInt(tx.slot)>startSlot)operator.push({label:check.label,fee:tx.meta.fee,slot:tx.slot,signature:check.signature});
  }
  const overlaps=receipts.filter(row=>row.role==='settlement').map(worker=>({id:worker.id,
    conflicts:receipts.filter(row=>row.role==='trader').map(trader=>conflicts(trader.locks,worker.locks).length)}));
  await journal.checkpoint('drained',true);const replay=await journal.finish();
  const result={revision,program:sdk.accountDeployment(selection).programRevision,arm,transport,seed,traders,gap,refresh,thinDepth,maxLots,btcPercent,
    trace,offers,arrived,end,paidMs:paidMs??null,payoutObservationMs,during,pollsUnavailable,polls,receipts,operator,overlaps,events:replay.events,
    counts:{offered:offers.length,signed:originals.size,previewRefused:offers.length-originals.size,
      filled:successful.length,refused:receipts.filter(row=>row.role==='trader'&&row.error).length,
      expired:rows.filter(row=>row.request_id.startsWith('load:')&&row.status==='expired-unexecuted').length,
      unresolved:rows.filter(row=>row.request_id.startsWith('load:')&&!terminal.has(row.status)).length,
      fillLots:successful.reduce((sum,row)=>sum+(row.lots??0n),0n)},
    cu:dist(successful.map(row=>row.cu)),finalizedMs:dist(successful.flatMap(row=>row.ms===undefined?[]:[row.ms])),
    generatorLagMs:dist(offers.map(offer=>offer.entered-offer.dueMs)),
    fees:{trader:receipts.filter(row=>row.role==='trader').reduce((sum,row)=>sum+row.fee,0),
      settlement:receipts.filter(row=>row.role==='settlement').reduce((sum,row)=>sum+row.fee,0)}};
  writeFileSync(directory+'/router-load.json',json(result));console.log(json(result.counts));
}finally{
  running=false;await Promise.allSettled(loops);await api.close();await indexer?.close();await runtime.close();await journal?.close();
  try{await flush();}finally{ws.close();}
}
