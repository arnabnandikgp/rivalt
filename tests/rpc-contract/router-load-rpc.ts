// Matched independently timed wallet offers, with one real closed claimant on both arms.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import * as sdk from '@rivalt/sdk';
import {Connection,VersionedTransaction} from '@solana/web3.js';
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
function marketPayments(wire:string) {
  const message=VersionedTransaction.deserialize(Buffer.from(wire,'base64')).message;
  return message.compiledInstructions.flatMap(instruction=>{
    if(message.staticAccountKeys[instruction.programIdIndex].address!==sdk.CLEARING_PROGRAM_ADDRESS ||
      !Buffer.from(instruction.data.subarray(0,8)).equals(Buffer.from(sdk.PAY_ACCOUNT_GAIN_DISCRIMINATOR)))return [];
    const payment=sdk.getPayAccountGainInstructionDataDecoder().decode(instruction.data);
    return [{marketIndex:payment.marketIndex,amount:payment.amount}];
  });
}
const transport=process.env.RIVALT_LOAD_TRANSPORT??'rpc';
assert(transport==='rpc'||transport==='relay','Choose rpc or relay');
const arm=process.env.RIVALT_SETTLEMENT_ARM;
assert(arm==='active'||arm==='offered-only','Choose active or offered-only');
const traders=knob('RIVALT_LOAD_TRADERS',6,2,32),count=knob('RIVALT_LOAD_OFFERS',18,2,200);
const gap=knob('RIVALT_LOAD_GAP_MS',280,30,2000),seed=knob('RIVALT_LOAD_SEED',117,1,100000);
const refresh=knob('RIVALT_LOAD_REFRESH_MS',2400,2100,5000),btcPercent=knob('RIVALT_LOAD_BTC_PERCENT',75,0,100);
const followEth=knob('RIVALT_LOAD_FOLLOW_ETH',0,0,1)===1;
const walletOrder = process.env.RIVALT_LOAD_WALLET_ORDER ?? 'independent';
assert(walletOrder === 'independent' || walletOrder === 'confirmed', 'Choose independent or confirmed wallet preparation');
const rotatingAsks=knob('RIVALT_LOAD_ROTATE_ASKS',0,0,1)===1;
assert(!rotatingAsks || (btcPercent===100 && !followEth),'Rotating asks requires a BTC buy-only trace');
const sponsorMaker = knob('RIVALT_LOAD_SPONSOR_BTC_MAKER_ONE', 0, 0, 1) === 1;
assert(!sponsorMaker || (rotatingAsks && walletOrder === 'confirmed' && arm === 'active'),
  'Maker storage comparison requires the confirmed-wallet active BTC workload');
const maxLots=knob('RIVALT_LOAD_MAX_LOTS',3,1,32),thinDepth=knob('RIVALT_LOAD_FIRST_MAKER_LOTS',2,1,4096);
let random=seed;
const next=()=>{random=(Math.imul(1664525,random)+1013904223)>>>0;return random;};
const trace=Array.from({length:count},(_,id)=>({id,dueMs:id*gap,trader:1+id%traders,
  market:(next()%100<btcPercent?0:1) as 0|1,side:(rotatingAsks?0:(next()>>>31)) as 0|1,lots:1n+BigInt(next()%maxLots)}));
const selection='bounded-router-candidate',directory=process.env.RIVALT_RUN_DIR!,url=process.env.RIVALT_RPC_URL!;
const wsUrl=process.env.RIVALT_WS_URL!,database=process.env.RIVALT_DATABASE_URL!,runId='p55b2-application';
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const build=routerBuild();
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(url,wsUrl,directory,{deferFinality:true});
const runtime=new AccountRuntime(database,runId,url,4,selection),api=accountServiceApi(runtime);
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined,indexer:LiquidityIndexer|undefined;
let settling=false;
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
  let cheaperDeepMaker=0;
  const setup=await liquidityExecutionSetup(h,rpc,{independentTraders:true,traderCount:traders+1,
    marketCheckpoints:true,marginLayout:'ledger-lanes',shape,verifyRejections:false,
    anchorOffset:instance=>cheaperDeepMaker && (instance===1||instance===2) && instance!==cheaperDeepMaker?2n:0n});
  const {root,route,withCheckpoints}=executionTestHelpers(h,setup),creditor=setup.roots[0],owner=setup.traderOwners[0];
  let makerStorage;
  if (sponsorMaker) {
    const capital = setup.instances[1].capital;
    const beforeBytes = (await h.read(capital))!;
    const original = sdk.decodeProfitAttribution(beforeBytes, true);
    assert.equal(original.width, 128);
    assert.equal(original.credit, null);
    const slotBytes = 256;
    const newSize = beforeBytes.length + 2 * (slotBytes - original.width) + 40;
    const existingLamports = BigInt((await rpc.call('getBalance', [capital, {commitment:'confirmed'}])).value);
    const rent = await h.rent(newSize) - existingLamports;
    assert(rent > 0n);
    const registration = await setup.instances[1].registrationState();
    assert.equal(registration.instance, 1);
    assert.equal(registration.market, setup.markets[0]);
    assert.equal(registration.capital, capital);
    await h.send('maker funds BTC quote capacity', [await sdk.getManageProfitCapacityInstructionAsync({
      ...setup.common, margin:capital, actor:setup.owner, payer:setup.owner, previousContributor:setup.owner.address,
      slotBytes, revision:original.root.revision, maxPayment:rent
    })], [setup.owner]);
    const grown = sdk.decodeProfitAttribution((await h.read(capital))!, true);
    assert.equal(grown.width, slotBytes);
    assert.deepEqual(grown.credit, {contributor:setup.owner.address, lamports:rent});
    assert.deepEqual(grown.root.positions, original.root.positions);
    assert.equal(grown.root.cash, original.root.cash);
    makerStorage = { capital, width:grown.width, rent, contributor:setup.owner.address };
  }
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
  // Ask clearing itself if the already-funded BTC claim can be paid, before
  // offering any trade or starting either worker. Simulation cannot credit cash.
  const payment=sdk.getPayAccountGainInstruction({...common,actor:setup.payer,margin:creditor,certificate,marketIndex:0,amount:996n});
  const {transaction}=await sdk.signCanonicalInstructions(new Connection(url),setup.payer,await withCheckpoints(payment),
    {computeUnitLimit:800_000,loadedAccountsDataSizeLimit:8*1024*1024});
  const wire=Buffer.from(transaction.serialize()).toString('base64');
  const payable=await rpc.call('simulateTransaction',[wire,{encoding:'base64',sigVerify:true,commitment:'confirmed',
    accounts:{encoding:'base64',addresses:[creditor,setup.ledgers[0]]}}]);
  writeFileSync(directory+'/opening-claim-simulation.json',json({wire,result:payable}));
  assert.equal(payable.value.err,null,'Clearing must admit the actual BTC payout at workload start');
  const simulatedRoot=sdk.getMarginAccountDecoder().decode(Buffer.from(payable.value.accounts[0].data[0],'base64'));
  const simulatedLedger=sdk.getMarketLedgerDecoder().decode(Buffer.from(payable.value.accounts[1].data[0],'base64'));
  assert.deepEqual([simulatedRoot.cash-before.cash,simulatedRoot.positions[0].virtualScaled,simulatedLedger.settlement],[996n,0n,0n]);
  assert.equal((await root(creditor)).cash,before.cash,'A simulation must not pay the real claimant');
  const startSlot=await setup.slot();
  const start=clock(),since=()=>Math.round(clock()-start);
  const finalizedAt=new Map<string,number>();
  const confirmations = new Map<string, { slot: number; succeeded: boolean }>();
  const at=async(ms:number)=>{await delay(Math.max(0,ms-since()));};
  let paidMs:number|undefined,pollsUnavailable=0;
  const polls:Record<string,unknown>[]=[],originals=new Map<number,{time:number;subscription:number;signature:string;wire:string}>();
  const signedOffers=new Map<string,number>();
  background(async()=>{while(running){await indexer!.cycle();await delay(80);}});
  background(async()=>{while(running){await runtime.execute();await delay(45);}});
  background(async()=>{while(running){
    const outstanding=[...originals.values()].map(original=>original.signature).filter(signature=>!finalizedAt.has(signature));
    if(outstanding.length){
      const statuses=await rpc.call('getSignatureStatuses',[outstanding,{searchTransactionHistory:true}]);
      statuses.value.forEach((status:{confirmationStatus:string;slot:number;err:unknown}|null,index:number)=>{
        if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
          confirmations.set(outstanding[index], { slot: status.slot, succeeded: status.err === null });
        }
        if(status?.confirmationStatus==='finalized')finalizedAt.set(outstanding[index],since());
      });
    }
    await delay(50);
  }});
  background(async()=>{while(running){
    if(settlement&&scheduling){
      settling=true;
      try{polls.push({ms:since(),...await runtime.settle(setup.payer)});}
      catch(error){if(!(error instanceof Error && error.message==='Reconciled projection unavailable'))throw error;pollsUnavailable++;}
      finally{settling=false;}
    }
    if(paidMs===undefined){const state=await root(creditor);
      if(state.cash===before.cash+996n && state.positions[0].virtualScaled===0n)paidMs=since();}
    await delay(80);
  }});
  background(async()=>{for(let round=1;running;round++){await at(round*refresh);if(running){
    if(rotatingAsks)cheaperDeepMaker=round%2+1;
    await setup.sample();
  }}});
  // Schedule every arrival before waiting on the previous original for that wallet.
  const queues = new Map<number, Promise<unknown>>();
  const lastOriginal = new Map<number, { id: number; signature: string; nonce: bigint }>();
  async function prepareOffer(offer: typeof trace[number], arrival: Promise<number>, prior?: Promise<unknown>) {
    const entered = await arrival;
    await prior;
    healthy();
    const previous = walletOrder === 'confirmed' ? lastOriginal.get(offer.trader) : undefined;
    const deadline = clock() + 30_000;
    while (previous && !confirmations.has(previous.signature)) {
      healthy();
      assert(clock() < deadline, 'Previous wallet original did not confirm before the workload deadline');
      await delay(10);
    }
    const confirmation = previous && confirmations.get(previous.signature);
    const prepareMs = since();
    const actor = setup.traderOwners[offer.trader], trader = setup.roots[offer.trader];
    const snapshot = await client.tradeSnapshot(trader, offer.market);
    const nonce = snapshot.roots[trader].nonce;
    if (previous && confirmation) {
      assert(snapshot.contextSlot >= BigInt(confirmation.slot), 'Snapshot predates the confirmed original');
      if (confirmation.succeeded) assert(nonce > previous.nonce, 'Snapshot reused the previous fill nonce');
    }
    const timing = { entered, prepareMs, previousId: previous?.id ?? null,
      previousSlot: confirmation?.slot ?? null, snapshotSlot: snapshot.contextSlot, nonce };
    const expectedGross=offer.lots*((offer.market===0?61_000n:30_000n)+(offer.side===0?2n:-2n));
    const expectedFee=(expectedGross+4999n)/5000n;
    const order=await client.marketOrder({snapshot,trader,
      marketIndex:offer.market,side:offer.side,lots:offer.lots,reduceOnly:false,maxFee:expectedFee,
      allInLimit:offer.side===0?expectedGross+expectedFee:expectedGross-expectedFee},actor.address);
    let prepared;
    try{prepared=await client.prepare('Load offer '+offer.id,actor.address,order.instructions);}
    catch(error){
      if(!(error instanceof Error && error.message.startsWith('Preview rejected:')))throw error;
      return {...offer,...timing,expectedGross,expectedFee,previewRefusal:error.message,previewRefusedMs:since()};
    }
    await prepared.transaction.sign([actor]);
    const intent=await client.signed(prepared,prepared.transaction);
    assert(!signedOffers.has(intent.signature),`Offers ${signedOffers.get(intent.signature)} and ${offer.id} produced the same signed transaction`);
    signedOffers.set(intent.signature,offer.id);
    const subscription=await ws.call('signatureSubscribe',[intent.signature,{commitment:'finalized'}]);
    originals.set(offer.id,{time:since(),subscription,signature:intent.signature,wire:intent.wire});
    if(transport==='rpc'){
      writeFileSync(directory+'/wallet-original-'+offer.id+'.json',json(intent));
      await client.broadcast(intent);
    }else {
      const response=await api.inject({method:'POST',url:'/v4/submit',payload:{requestId:'load:'+offer.id,wire:intent.wire}});
      assert.equal(response.statusCode,200,response.body);assert.equal(response.json().signature,intent.signature);
    }
    if (walletOrder === 'confirmed') lastOriginal.set(offer.trader, { id: offer.id, signature: intent.signature, nonce });
    return {...offer,...timing,expectedGross,expectedFee,previewRefusal:null,previewRefusedMs:null};
  }
  const offers = await Promise.all(trace.map(offer => {
    const arrival = at(offer.dueMs).then(since);
    const task = prepareOffer(offer, arrival, queues.get(offer.trader));
    if (walletOrder === 'confirmed') queues.set(offer.trader, task);
    return task;
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
  const boundary=await statuses(),end=since(),during=boundary.filter(row=>row.budget!==null).length;
  if(arm==='offered-only'){
    const wallets=boundary.filter(row=>row.request_id.startsWith('load:'));
    writeFileSync(directory+'/control-boundary.json',json(wallets.map(({request_id,signature,status})=>({request_id,signature,status}))));
    assert.equal(during,0);assert.equal((await root(creditor)).cash,before.cash);
    assert.equal(wallets.length,originals.size,'Control is missing a signed original');
    assert(wallets.every(row=>terminal.has(row.status)),'Control cannot start settlement with unresolved orders');
  }
  settlement=true;
  while(paidMs===undefined&&since()<end+180_000){healthy();await delay(100);}
  const sampled=await rpc.call('getMultipleAccounts',[[creditor,setup.ledgers[0]],{encoding:'base64',commitment:'confirmed'}]);
  const payoutObservationMs=since();
  const observedCreditor=sdk.getMarginAccountDecoder().decode(Buffer.from(sampled.value[0].data[0],'base64'));
  const fundedAtoms=observedCreditor.cash-before.cash;
  const outstanding=observedCreditor.positions[0].virtualScaled;
  assert(fundedAtoms>=0n && fundedAtoms<=996n && fundedAtoms*1_000_000_000n+outstanding===996_000_000_000n);
  const pool=sdk.getMarketLedgerDecoder().decode(Buffer.from(sampled.value[1].data[0],'base64')).settlement;
  if(paidMs===undefined && fundedAtoms===996n)paidMs=payoutObservationMs;
  const payout={slot:sampled.context.slot,status:fundedAtoms===996n?'full':fundedAtoms>0n?'partial':'unpaid',fundedAtoms,outstanding,pool};
  writeFileSync(directory+'/btc-payment-at-boundary.json',json(payout));
  let ethPayment: {signature:string;ms:number;amount:bigint}|undefined;
  if(followEth && fundedAtoms===996n){
    const checked=new Set<string>();
    while(!ethPayment && since()<payoutObservationMs+300_000){
      healthy();
      const finalized=(await runtime.store.pool.query(
        "SELECT signature,wire FROM service_intents WHERE run_id=$1 AND status='finalized' AND (request_id LIKE 'keeper:gain:%:1:%' OR request_id LIKE 'keeper:proof:1:%')",[runId])).rows;
      for(const row of finalized){
        if(checked.has(row.signature))continue;
        checked.add(row.signature);
        const payment=marketPayments(row.wire).find(entry=>entry.marketIndex===1 && entry.amount>0n);
        if(payment){
          const receipt=await rpc.call('getTransaction',[row.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
          assert(receipt && receipt.meta.err===null && receipt.transaction[0]===row.wire);
          ethPayment={signature:row.signature,amount:payment.amount,ms:since()};break;
        }
      }
      if(!ethPayment)await delay(500);
    }
    writeFileSync(directory+'/eth-payment-followup.json',json({ethPayment,observedThroughMs:since()}));
  }
  scheduling=false;
  // An already-started poll can still publish its original after scheduling is turned off.
  while(settling){healthy();await delay(50);}
  const drainDeadline=clock()+10_000;
  const serviceRows=async()=>(await statuses()).filter(row=>!row.request_id.startsWith('load:'));
  while((await serviceRows()).some(row=>!terminal.has(row.status))&&clock()<drainDeadline){healthy();await delay(100);}
  const finalService=await serviceRows();
  writeFileSync(directory+'/service-drain.json',json(finalService.map(({request_id,signature,status})=>({request_id,signature,status}))));
  running=false;await Promise.all(loops);healthy();await flush();
  await indexer.close();indexer=undefined;
  const rows=await statuses();
  type Receipt={id:string;signature:string;attempts:number;slot:number;error:unknown;bytes:number;cu:number;
    fee:number;locks:ReturnType<typeof transactionLocks>;role:'trader'|'settlement';offer?:number;observedFinalMs?:number;lots?:bigint;legs?:number[];ms?:number};
  const receipts:Receipt[]=[];
  for(const row of rows){
    const receipt=await rpc.call('getTransaction',[row.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    if(!receipt){assert(!['finalized','failed'].includes(row.status));continue;}
    assert.notEqual(row.status,'expired-unexecuted','Verified expiry conflicts with a finalized receipt');
    assert.equal(receipt.transaction[0],row.wire);
    writeFileSync(directory+'/landed-'+row.signature+'.json',json(receipt));
    const wire=Buffer.from(row.wire,'base64'),locks=transactionLocks(wire);
    const base={id:String(row.request_id),signature:row.signature,attempts:row.attempts,slot:receipt.slot,error:receipt.meta.err,
      bytes:wire.length,cu:Number(receipt.meta.computeUnitsConsumed),fee:Number(receipt.meta.fee),locks};
    if(!row.request_id.startsWith('load:')){receipts.push({...base,role:'settlement'});continue;}
    const offer=offers[Number(row.request_id.slice(5))],original=originals.get(offer.id)!;
    assert.deepEqual((await ws.notification(original.subscription)).params.result.value.err,receipt.meta.err);
    let legs:number[]=[];
    if(!receipt.meta.err){
      const parsed=await rpc.call('getTransaction',[row.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
      writeFileSync(directory+'/parsed-'+row.signature+'.json',json(parsed));
      const fill=eventPayloads(row.signature,parsed,setup.common.eventAuthority).find(({payload})=>payload.subarray(0,8).equals(Buffer.from(sdk.LIQUIDITY_ROUTE_FEE_RECORDED_EVENT_DISCRIMINATOR)));
      assert(fill);const event=sdk.getLiquidityRouteFeeRecordedEventDecoder().decode(fill.payload);
      assert.deepEqual([event.side,event.lots,event.grossQuote,event.fee],[offer.side,offer.lots,offer.expectedGross,offer.expectedFee]);
      legs=event.legs.map(leg=>leg.instance);
    }
    receipts.push({...base,role:'trader',offer:offer.id,observedFinalMs:finalizedAt.get(row.signature),lots:offer.lots,legs,ms:(finalizedAt.get(row.signature)??since())-original.time});
  }
  const successful=receipts.filter(row=>row.role==='trader'&&!row.error);
  const landedWallets=new Set(receipts.filter(row=>row.role==='trader').map(row=>row.signature));
  const expiredWallets=new Set(rows.filter(row=>row.request_id.startsWith('load:')&&row.status==='expired-unexecuted').map(row=>row.signature));
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
    trace,offers,arrived,end,rotatingAsks,followEth,walletOrder,makerStorage:makerStorage??null,ethPayment:ethPayment??null,payout,paidMs:paidMs??null,payoutObservationMs,during,pollsUnavailable,polls,receipts,operator,overlaps,events:replay.events,
    counts:{offered:offers.length,signed:originals.size,previewRefused:offers.length-originals.size,
      filled:successful.length,refused:receipts.filter(row=>row.role==='trader'&&row.error).length,
      expired:expiredWallets.size,
      unresolved:[...signedOffers.keys()].filter(signature=>!landedWallets.has(signature)&&!expiredWallets.has(signature)).length,
      fillLots:successful.reduce((sum,row)=>sum+(row.lots??0n),0n)},
    cu:dist(successful.map(row=>row.cu)),finalizedMs:dist(successful.flatMap(row=>row.ms===undefined?[]:[row.ms])),
    generatorLagMs:dist(offers.map(offer=>offer.entered-offer.dueMs)),
    fees:{trader:receipts.filter(row=>row.role==='trader').reduce((sum,row)=>sum+row.fee,0),
      settlement:receipts.filter(row=>row.role==='settlement').reduce((sum,row)=>sum+row.fee,0)}};
  writeFileSync(directory+'/router-load.json',json(result));console.log(json(result.counts));
  assert(finalService.every(row=>terminal.has(row.status)),'Settlement drain ended with non-terminal service originals');
  if(followEth)assert(ethPayment,'The ETH claimant did not receive cash within the follow-up window');
  // The prespecified mixed-market case qualifies only with a real full payment.
  // A pressure measurement may record a partial payment when other claims consumed the pool.
  if(rotatingAsks){
    assert(fundedAtoms>0n && (fundedAtoms===996n || pool===0n),'Missing BTC payment with available pool cash');
  }else{
    assert.equal(fundedAtoms,996n,'Mixed-market qualification requires the real BTC cash credit');
  }
}finally{
  running=false;await Promise.allSettled(loops);await api.close();await indexer?.close();await runtime.close();await journal?.close();
  try{await flush();}finally{ws.close();}
}
