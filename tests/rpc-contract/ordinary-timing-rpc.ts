// Timestamp confirmed account changes separately from finalized wire and database checks.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {json} from '../../packages/indexer/src/events.js';
import {LiquidityIndexer} from '../../packages/indexer/src/liquidity-indexer.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {backingStep} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {successorSelection,verifyProfitBuild} from './profit-attribution-build.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!,url=process.env.RIVALT_RPC_URL!,wsUrl=process.env.RIVALT_WS_URL!;
const probe=process.env.RIVALT_SETTLEMENT_PROBE!;
const successor=probe.startsWith('profit-attribution-successor-');
const selection=successor?successorSelection():'integrated-recovery-candidate';
const delayed=probe.endsWith('-delayed-payout');
const database=process.env.RIVALT_DATABASE_URL!, runId='p55b2-application';
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const build=verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,false,false,false,false,successor?'successor':'integrated');
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(url,wsUrl,directory,{deferFinality:true});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined,indexer:LiquidityIndexer|undefined,worker:AccountRuntime|undefined;
let observing=true,dispatch=true,loopError:unknown;
let unavailableProjectionPolls=0;
let settlementLoop:Promise<void>|undefined;
const loops:Promise<void>[]=[];
function supervise(run:()=>Promise<void>){loops.push(run().catch(error=>{loopError=error;observing=false;}));}
function checkLoops(){if(loopError)throw loopError;}
const stages:Record<string,number>={};
const mark=(label:string)=>{stages[label]=performance.now();};
try{
  const setup=await liquidityExecutionSetup(h,rpc,{shape:symmetricPayoutShape,marginLayout:'ledger-lanes',marketCheckpoints:true,verifyRejections:false});
  const {root,guard,route,withCheckpoints}=executionTestHelpers(h,setup);
  const [trader]=setup.roots,owner=setup.traderOwner,[makerA,,makerB]=setup.instances;
  assert.notEqual(makerA.pricingProgram,makerB.pricingProgram);
  const common={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const [certificate]=await sdk.deriveSettlementCertificate(setup.venue,0);
  const proof=async()=>sdk.getSettlementCertificateDecoder().decode((await h.read(certificate))!);
  const pool=async()=>sdk.decodeFeeLedger((await h.read(setup.ledgers[0]))!).state.settlement;
  const wallet=async()=>getTokenDecoder().decode((await h.read(setup.traderToken.address))!).amount;
  const vault=async()=>getTokenDecoder().decode((await h.read(setup.vault))!).amount;
  const initialWallet=await wallet(),initialVault=await vault(),initialCash=(await root(trader)).cash;
  const openPrice=60_002n,closePrice=60_998n,gain=closePrice-openPrice;
  const fees=(openPrice+4999n)/5000n+(closePrice+4999n)/5000n,net=gain-fees;
  const order=async(close:boolean)=>route({trader,actor:owner,marketIndex:0,side:close?1:0,lots:[1n],
    makers:[close?makerB:makerA],marketLane:true,minimalMarkets:true,allInLimit:close?closePrice-13n:openPrice+13n,maxFee:13n,
    reduceOnly:close,generation:close?(await root(trader)).positions[0].generation:undefined});
  await setup.sample();
  await h.send('open timed cross-maker position',[await order(false)],[owner]);
  setup.sourcePrices.btc=61_000_000_000n;await setup.qualify();
  if(!delayed)await h.send('collect available maker loss before close',await withCheckpoints(sdk.getCollectAccountLossInstruction({
    ...common,actor:setup.payer,margin:makerA.capital,marketIndex:0,amount:gain})));
  assert.equal(await pool(),delayed?0n:gain);
  await h.send('initialize timing certificate',[sdk.getInitializeMarketBackingInstruction({...common,payer:setup.payer,certificate,marketIndex:0})]);
  for(let step=0;!(await proof()).complete;step++){
    assert(step<60,'Eight-member backing scan did not complete');
    if(step%4===0)await setup.sample();
    const next=await backingStep(h,{...common,certificate,ledger:setup.ledgers[0]},step===0);
    await h.send('prepare certificate '+step,await withCheckpoints(next.instruction));
  }
  assert.equal((await proof()).next,8n);
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  await journal.checkpoint('before-timed-close',true);
  const service=()=>new AccountRuntime(database,runId,url,4,selection);
  worker=service();await worker.open();
  const {binding}=await worker.store.snapshot();
  indexer=new LiquidityIndexer({rpcUrl:url,wsUrl,databaseUrl:database,runId,venue:setup.venue,anchor:binding.anchor,
    deployment:selection,profile:'liquidity-execution-qualification'});
  await indexer.open();
  supervise(async()=>{while(observing){await indexer!.cycle();await delay(100);}});
  await setup.sample();
  const source=await worker.snapshot([trader]);
  const registry=sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!);
  assert(sdk.accountBackingStatus(source,registry,await proof()).payable,'Backing certificate must be ready before measurement');
  const intents=async()=>(await worker!.store.pool.query<{request_id:string;status:string;signature:string;wire:string}>(
    'SELECT request_id,status,signature,wire FROM service_intents WHERE run_id=$1 ORDER BY request_id',[runId])).rows;
  const subscriptions=new Map<string,number>();
  async function dispatchOriginals(){
    for(const row of await intents())if(row.status==='pending'&&!subscriptions.has(row.signature))
      subscriptions.set(row.signature,await ws.call('signatureSubscribe',[row.signature,{commitment:'finalized'}]));
    await worker!.execute();
  }
  // The worker is active before either close. The delayed case deliberately
  // interrupts dispatch with an original durably signed and still unbroadcast.
  mark('ready');if(!delayed)mark('fundsAvailable');
  const first=await worker.settle(setup.payer);
  assert.deepEqual(first,{status:'queued',reason:'funded-account-loss'});
  const [original]=await intents();assert.equal(original.status,'pending');
  const startSettlement=()=>{
    settlementLoop=(async()=>{while(observing&&dispatch){
      await dispatchOriginals();
      if(dispatch){
        try{await worker!.settle(setup.payer);}
        catch(error){
          // As in the worker process, a poll with no published view submits
          // nothing. Keep the timer running through the next reconciliation.
          if(!(error instanceof Error && error.message==='Reconciled projection unavailable'))throw error;
          unavailableProjectionPolls++;
        }
      }
      await delay(250);
    }})().catch(error=>{loopError=error;observing=false;});
    loops.push(settlementLoop);
  };
  if(!delayed)startSettlement();
  mark('closeSubmitted');await h.send('close timed position against different maker',[await order(true)],[owner]);mark('closeConfirmed');
  const closed=await root(trader);
  assert.deepEqual([closed.positions[0].lots,closed.positions[0].virtualScaled,closed.cash],[0n,gain*1_000_000_000n,initialCash-fees]);
  if(delayed){
    assert.equal(await pool(),0n);
    const seen=await rpc.call('getSignatureStatuses',[[original.signature],{searchTransactionHistory:true}]);
    assert.equal(seen.value[0],null);
    await worker.close();mark('stopped');
    await delay(1500);
    worker=service();await worker.open();mark('resumed');
    const [recovered]=await intents();assert.deepEqual(recovered,original);
    startSettlement();
  }
  supervise(async()=>{while(observing){await delay(1000);if(observing)await setup.sample();}});
  const deadline=performance.now()+60_000;
  while(performance.now()<deadline){
    checkLoops();
    const [amount,account]=await Promise.all([pool(),root(trader)]);
    if(stages.fundsAvailable===undefined&&amount>=gain)mark('fundsAvailable');
    if(account.positions[0].virtualScaled===0n&&account.cash===initialCash+net){mark('cashConfirmed');break;}
    await delay(40);
  }
  checkLoops();assert(stages.fundsAvailable!==undefined&&stages.cashConfirmed!==undefined,'Timed settlement missed backed cash or trader payment');
  assert.equal(await wallet(),initialWallet);
  mark('withdrawSubmitted');
  await h.send('withdraw timed net profit',await withCheckpoints(sdk.getWithdrawFundedAccountInstruction({...common,owner,margin:trader,
    userToken:setup.traderToken.address,quoteMint:setup.mint.address,amount:net,guard:await guard(trader)})),[owner]);
  mark('walletConfirmed');
  assert.deepEqual([await wallet(),await vault(),(await root(trader)).cash],[initialWallet+net,initialVault-net,initialCash]);
  // Finish every original already admitted. This includes any gain paid to maker B.
  dispatch=false;await settlementLoop;checkLoops();
  await eventually(async()=>{checkLoops();await dispatchOriginals();return intents();},
    rows=>rows.every(row=>row.status==='finalized'),'finalized settlement originals');
  observing=false;await Promise.all(loops);checkLoops();await flush();
  await indexer.close();indexer=undefined;
  const receipts=[];
  for(const row of await intents()){
    const confirmed=await rpc.call('getTransaction',[row.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(confirmed.transaction[0],row.wire);assert.equal(confirmed.meta.err,null);
    assert.equal((await ws.notification(subscriptions.get(row.signature)!)).params.result.value.err,null);
    receipts.push({id:row.request_id,signature:row.signature,slot:confirmed.slot,cu:confirmed.meta.computeUnitsConsumed,fee:confirmed.meta.fee});
  }
  for(const label of ['close timed position against different maker','withdraw timed net profit']){
    const check=checks.find(check=>check.label===label)!;
    const tx=await rpc.call('getTransaction',[check.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(tx.meta.err,null);receipts.push({id:label,signature:check.signature,slot:tx.slot,cu:tx.meta.computeUnitsConsumed,fee:tx.meta.fee});
  }
  await journal.checkpoint('timed-wallet-exit',true);
  const replay=await journal.finish();
  const result={revision,artifact:build.revision,delayed,unavailableProjectionPolls,fees,gain,net,events:replay.events,receipts,
    relativeToCloseMs:Object.fromEntries(Object.entries(stages).map(([key,time])=>[key,Math.round(time-stages.closeConfirmed)]))};
  writeFileSync(directory+'/ordinary-timing.json',json(result));console.log(json(result));
}finally{
  observing=false;await Promise.all(loops);await indexer?.close();await worker?.close();await journal?.close();
  try{await flush();}finally{ws.close();}
}
