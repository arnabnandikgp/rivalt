import assert from 'node:assert/strict';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {createWriteStream,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import type {Address,Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {AccountIndexer,type AccountConfig} from '../../packages/indexer/src/account-indexer.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {accountServiceApi} from '../../packages/services/src/account-service-api.js';
import {json} from '../../packages/indexer/src/events.js';
import {accountRuntimeHarness} from './account-runtime-harness.js';
import {accountServiceSetup} from './account-service-setup.js';
import {accountQueueFault} from './account-queue-fault.js';
import {ReconciliationAhead} from '../../packages/indexer/src/reconciliation-progress.js';

const directory=process.env.RIVALT_RUN_DIR!,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim());
const startedDirty=dirty(),transport=await accountRuntimeHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory);
const children:ChildProcess[]=[],observations:unknown[]=[],wallets:unknown[]=[],restarts:unknown[]=[];
let indexer:AccountIndexer|undefined,replay:AccountIndexer|undefined,runtime:AccountRuntime|undefined;
let indexing=false,feeding=false,feedPaused=false,feedBtc=60_000_000_000n,indexLoop:Promise<void>|undefined,feedLoop:Promise<void>|undefined;
let api:ReturnType<typeof accountServiceApi>|undefined;
async function until<Value>(read:()=>Promise<Value>,accept:(value:Value)=>boolean,label:string,seconds=30) {
  const deadline=Date.now()+seconds*1000;let last:Value|undefined;
  while(Date.now()<deadline){last=await read();if(accept(last))return last;await delay(100);}
  writeFileSync(`${directory}/timeout.json`,json({label,last}));throw new Error(`Timed out: ${label}`);
}
const stop=async(child:ChildProcess)=>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  child.kill('SIGTERM');await until(async()=>child.exitCode!==null||child.signalCode!==null,Boolean,'owned account worker stop',15);
};
try {
  const setup=await accountServiceSetup(transport.h,'durable-workers',720n);await transport.finalize();
  const anchor=transport.checks.find(check=>check.label==='setup fresh clearing venue')!.signature as string;
  const config:AccountConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
    runId:'p27-workers',venue:setup.venue,anchor,profile:'account-safety-qualification'};
  indexer=new AccountIndexer(config);await indexer.open();await indexer.cycle();const {binding}=await indexer.store.snapshot();
  const client=new sdk.AccountUserClient({version:3,chain:'solana:localnet',profile:'account-safety-qualification',rpcUrl:config.rpcUrl,wsUrl:config.wsUrl,
    genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,venue:setup.venue,mint:setup.mint.address,domain:binding.domain});
  writeFileSync(`${directory}/public-deployment.json`,json(client.config));
  runtime=new AccountRuntime(config.databaseUrl,config.runId,config.rpcUrl);await runtime.open();
  const faults=await accountQueueFault({...config,directory},setup,transport,client);await indexer.cycle();
  writeFileSync(`${directory}/queue-fault.json`,json(faults));
  // Initial valid 720-slot epochs last through activation. Wait for their actual
  // expiry; the program correctly prohibits shortening an already-live epoch.
  const expiries=await Promise.all(setup.makers.flat().map(async maker=>sdk.makerA.getMakerAccountConfigDecoder().decode((await transport.h.read(maker.config))!).state.expirySlot));
  const lastExpiry=expiries.reduce((left,right)=>left>right?left:right);
  await until(()=>transport.h.slot(),slot=>slot>=lastExpiry,'actual initial maker epoch expiry',60);
  const start=(role:'maker'|'funding'|'orders'|'settlement'|'risk'|'executor',key?:Keypair,marketIndex?:number,makerId?:number,receiver?:Address)=>{
    const identity=`${role}-${marketIndex??'venue'}-${makerId??'none'}-${children.length}`;
    const environment:NodeJS.ProcessEnv={...process.env,RIVALT_RPC_URL:config.rpcUrl,RIVALT_DATABASE_URL:config.databaseUrl,RIVALT_RUN_ID:config.runId};
    if(key) {
      const path=`${directory}/signer-${identity}.json`;writeFileSync(path,JSON.stringify(Array.from(key.secretKey)),{mode:0o600});
      Object.assign(environment,{RIVALT_ACCOUNT_ROLE:role,RIVALT_MARKET_INDEX:String(marketIndex),RIVALT_MAKER_ID:String(makerId),RIVALT_SIGNER_PATH:path});
      if(receiver)environment.RIVALT_RECEIVER_MARGIN=receiver;
    }
    const child=spawn(process.execPath,['--import','tsx',`packages/services/src/account-${role==='executor'?'executor':'worker'}-main.ts`],
      {cwd:process.cwd(),env:environment,stdio:['ignore','pipe','pipe']});
    const output=createWriteStream(`${directory}/${identity}.log`);child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});
    child.once('exit',()=>output.end());children.push(child);return child;
  };
  const startIndex=()=>{
    indexing=true;indexLoop=(async()=>{while(indexing){try{await indexer!.cycle();}catch(error){
      observations.push({kind:'indexer-cycle-retry',expected:error instanceof ReconciliationAhead,message:String(error)});
    }await delay(250);}})();
  };
  startIndex();
  feeding=true;feedLoop=(async()=>{while(feeding){if(!feedPaused)for(let feed=0;feed<6;feed++)await setup.publish(feed,{price:feed===0||feed===2?feedBtc:feed===1||feed===3?1_000_000n:3_000_000_000n});await delay(1000);}})();
  const executor=start('executor'),makers:ChildProcess[]=[];
  for(const market of [0,1])for(const maker of [0,1])makers.push(start('maker',setup.operators[maker+1].owner,market,maker));
  const funding=[0,1].map(market=>start('funding',setup.payer,market));
  await until(()=>runtime!.heartbeats(),rows=>rows.length===4&&rows.every(row=>row.online),'four live market makers');
  await until(async()=>(await runtime!.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND budget LIKE 'account-maker-%' AND status='finalized'",[config.runId])).rows[0].count,
    count=>Number(count)>=8,'four actual maker publications and separate owner syncs',40);
  async function normal(price=60_000n) {
    return until(()=>client.snapshot([setup.cross],'confirmed'),snapshot=>snapshot.marketStates[0].referencePrice===price&&
      snapshot.marketStates.every(market=>sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot)==='Normal'),'real Normal source recovery',40);
  }
  await normal();
  makers[0].kill('SIGKILL');await until(async()=>makers[0].signalCode==='SIGKILL',Boolean,'actual maker kill');
  const replacement=start('maker',setup.operators[1].owner,0,0);
  await until(()=>runtime!.heartbeats(),rows=>rows.some(row=>row.market_index===0&&row.maker_id===0&&row.process_id===replacement.pid),'maker heartbeat restart');
  restarts.push({role:'maker',before:makers[0].pid,after:replacement.pid});
  api=accountServiceApi(runtime);const endpoint=await api.listen({host:'127.0.0.1',port:0});
  async function wallet(label:string,instructions:Instruction[]) {
    const prepared=await client.prepare(label,setup.owner.address,instructions);await prepared.transaction.sign([setup.owner]);
    const intent=await client.signed(prepared,prepared.transaction),requestId=`wallet-${wallets.length}`;
    const response=await fetch(`${endpoint}/v3/submit`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId,wire:intent.wire})});
    assert.equal(response.status,200,await response.text());
    const result=await until(()=>runtime!.queue.get(requestId),row=>['failed','finalized'].includes(row?.status),label);
    assert.equal(result.status,'finalized',json(result));assert.equal(result.signature,intent.signature);
    const actual=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(actual.transaction[0],intent.wire);assert.equal(actual.meta.err,null);
    wallets.push({label,signature:intent.signature,wire:intent.wire,bytes:Buffer.from(intent.wire,'base64').length,computeUnits:actual.meta.computeUnitsConsumed});
    writeFileSync(`${directory}/wallets.json`,json(wallets));return actual;
  }
  const root=async(margin=setup.cross)=>(await client.snapshot([margin],'confirmed')).roots[margin];
  const deposit=async(amount:bigint)=>wallet('durable owner deposit',[await client.deposit(await client.snapshot([setup.cross]),setup.owner.address,setup.cross,setup.operators[0].token.address,amount)]);
  await deposit(2_000_000n);
  async function route(lots:bigint,side:0|1=0) {
    await normal();const snapshot=await client.tradeSnapshot(setup.cross,0);
    const response=await fetch(`${endpoint}/v3/quote`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor:setup.owner.address,margin:setup.cross,marketIndex:0,side,lots:lots.toString()})});
    const offered=await response.json();
    writeFileSync(`${directory}/latest-route-input.json`,json({snapshot,lots,side,offered}));
    assert.equal(response.status,200,json(offered));assert(offered.available,json(offered));
    // Build the actual wallet instruction locally from authenticated state, not
    // from HTTP-supplied writable accounts or economics.
    const quote=await client.route({snapshot,trader:setup.cross,marketIndex:0,side,lots,maxFee:10_000n,allInLimit:side===0?10_000_000n:0n},setup.owner.address);
    assert(quote);await wallet('durable BTC route',quote.instructions);
  }
  await route(50n);let snapshot=await client.snapshot([setup.cross],'confirmed');
  assert.equal(snapshot.roots[setup.cross].positions[0].lots,50n);
  await wallet('existing-position TP for order process',[await client.manageOrder(snapshot,setup.owner.address,setup.cross,0,
    sdk.groupOrderAction('Place',{expectedId:1n,terms:{side:1,lots:50n,limit:59_000n,feeBudget:10_000n,startSlot:snapshot.slot,
      expirySlot:snapshot.slot+2000n,trigger:1,threshold:59_999n,reduceOnly:true,generation:snapshot.roots[setup.cross].positions[0].generation}}))]);
  const orderWorker=start('orders',setup.payer);
  await until(()=>root(),value=>value.positions[0].lots===0n,'actual order process TP fill');await stop(orderWorker);
  assert.equal((await root()).reserved,0n);
  const settlement=start('settlement',setup.payer);
  await until(async()=>Promise.all(setup.roots.map(async margin=>root(margin))),values=>values.every(value=>value.positions.every(position=>
    position.lots===0n&&position.virtualScaled>-1_000_000_000n&&position.virtualScaled<1_000_000_000n)),'actual loss collection and certified maker gains',60);
  await stop(settlement);
  await until(async()=>(await runtime!.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND budget IN ('account-settlement','account-orders') AND status IN ('pending','unresolved')",[config.runId])).rows[0].count,
    count=>count==='0','settlement and order original history');
  snapshot=await client.snapshot([setup.cross],'confirmed');
  const exitAmount=snapshot.roots[setup.cross].cash-400_000n;
  await wallet('atomic owner cash allocation before risk scenario',(await client.exit(snapshot,setup.owner.address,setup.cross,setup.operators[0].token.address,exitAmount)).instructions);
  await route(50n);feedBtc=54_000_000_000n;await normal(54_000n);
  const [resolution]=await sdk.findVenueComponentV3Pda(setup.venue,'resolution'),[work]=await sdk.findVenueComponentV3Pda(setup.venue,'resolution-work');
  const pages=await Promise.all(Array.from({length:32},async(_,index)=>(await sdk.findResolutionPageV3Pda(setup.venue,index))[0]));
  const rawKeys=[setup.venue,setup.custody,setup.safety,setup.vault,setup.registry,setup.mint.address,...setup.roots,...setup.markets,...setup.ledgers,
    ...setup.operators.map(operator=>operator.token.address),resolution,work,...pages];
  const raw=async()=>{
    const response=await transport.rpc.call('getMultipleAccounts',[rawKeys,{encoding:'base64',commitment:'confirmed'}]);
    return Object.fromEntries(rawKeys.map((key,index)=>[key,response.value[index]?.data[0]??null]));
  };
  const liquidationBefore=await raw(),targetBefore=await root();
  assert(BigInt(client.balance(await client.snapshot([setup.cross],'confirmed'),setup.cross).maintenanceDeficitScaled!)>0n);
  const liquidation=start('risk',setup.owner,undefined,undefined,setup.roots[0]);
  await until(()=>root(),value=>value.positions[0].lots<targetBefore.positions[0].lots,'consenting receiver process liquidation',40);
  await stop(liquidation);
  await until(async()=>(await runtime!.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND budget='account-risk' AND status IN ('pending','unresolved')",[config.runId])).rows[0].count,count=>count==='0','liquidation original history');
  const liquidationAfter=await raw();
  writeFileSync(`${directory}/liquidation-capture.json`,json({target:setup.cross,receiver:setup.roots[0],before:liquidationBefore,after:liquidationAfter}));
  // The risk budget is payer-bound. The same explicitly consenting local owner
  // continues permissionless default work; no inferred receiver or authority.
  feedBtc=60_000_000_000n;await normal();
  const residual=(await root()).positions[0].lots;if(residual>0n)await route(residual,1);
  // Liquidation transfers exposure and a fee; it does not magically settle the
  // target's closed loss. Fund the next scenario's *risk equity*, not just cash.
  const riskView=client.balance(await client.snapshot([setup.cross],'confirmed'),setup.cross);
  assert(riskView.riskEquityScaled!==null);
  const shortfall=400_000n*1_000_000_000n-BigInt(riskView.riskEquityScaled);
  if(shortfall>0n)await deposit((shortfall+999_999_999n)/1_000_000_000n);
  await route(50n);feedBtc=40_000_000_000n;
  await until(async()=>{const bytes=await transport.h.read(setup.feeds[0].feed);return bytes;},bytes=>Boolean(bytes),'fresh fixture source');
  await delay(1500);
  let risk=start('risk',setup.owner);
  const header=async()=>sdk.getResolutionV3Decoder().decode((await transport.h.read(resolution))!);
  await until(header,value=>value.stage===2,'permissionless authenticated account default',40);
  feedPaused=true;
  const frozenAccounts=await raw();
  const captures:{[key:string]:unknown}={roots:setup.roots,markets:setup.markets,ledgers:setup.ledgers,custody:setup.custody,vault:setup.vault,
    mint:setup.mint.address,userTokens:setup.operators.map(operator=>operator.token.address),resolution,work,pages,
    liquidation:{target:setup.cross,receiver:setup.roots[0],before:liquidationBefore,after:liquidationAfter},frozenAccounts};
  writeFileSync(`${directory}/financial-capture.json`,json(captures));
  const restartedStages=new Set<number>();const deadline=Date.now()+240_000;
  while((await header()).stage!==11) {
    assert(Date.now()<deadline,'Bounded worker default completion');
    const current=await header();
    const checkpoint=current.stage===4&&current.proposalUploaded>0||current.stage===5&&current.cursor>0&&current.cursor<current.count||
      current.stage===9&&current.cursor>0&&current.cursor<current.count;
    if(checkpoint&&!restartedStages.has(current.stage)) {
      const previous=risk;risk.kill('SIGKILL');await until(async()=>previous.signalCode==='SIGKILL',Boolean,'actual risk process kill');
      restartedStages.add(current.stage);risk=start('risk',setup.owner);restarts.push({role:'risk',stage:current.stage,cursor:current.cursor,uploaded:current.proposalUploaded,before:previous.pid,after:risk.pid});
      if(current.stage===5) {
        indexing=false;await indexLoop;await indexer.close();indexer=new AccountIndexer(config);await indexer.open();await indexer.cycle();startIndex();
        observations.push({kind:'indexer-reopened-during-verification'});
      }
    }
    await delay(100);
  }
  await stop(risk);assert.deepEqual([...restartedStages].sort(),[4,5,9]);
  captures.completedAccounts=await raw();writeFileSync(`${directory}/financial-capture.json`,json(captures));
  feedPaused=false;risk=start('risk',setup.owner);
  await until(async()=>sdk.getSafetyV3Decoder().decode((await transport.h.read(setup.safety))!),safety=>safety.recoverySince>0n&&
    safety.recoveryLast-safety.recoverySince>=6n,'real sustained source recovery',35);
  await stop(risk);
  const current=await runtime.snapshot();
  // Source publication and this signed setup instruction must not race the raw
  // harness recorder. Stop only the fixture producer; production risk checks stay.
  feeding=false;await feedLoop;
  await transport.send('explicit authority resumes completed recovery',[sdk.getRecoverAccountsV3Instruction({...current,
    primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,guardCollateral:setup.feeds[3].feed,
    primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed,caller:setup.payer,epoch:(await header()).epoch,resume:true})]);
  captures.recoveredAccounts=await raw();
  await wallet('source-independent recovered account cash exit',(await client.exit(await client.snapshot([setup.roots[0]],'confirmed'),setup.owner.address,
    setup.roots[0],setup.operators[0].token.address,100n)).instructions);
  captures.finalAccounts=await raw();writeFileSync(`${directory}/financial-capture.json`,json(captures));
  for(const child of children.filter(child=>child!==executor))await stop(child);
  await until(async()=>(await runtime!.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[config.runId])).rows[0].count,count=>count==='0','all worker original outcomes');
  await stop(executor);indexing=false;await indexLoop;await transport.finalize();await indexer.cycle();
  assert(!observations.some(value=>(value as any).kind==='indexer-cycle-retry'&&!(value as any).expected),
    'No financial/identity projection failure may be hidden by later snapshots');
  // Actual unbroadcast original expires on the real validator. Its unchanged
  // finalized root proves no economic effect, never a fee refund from no history.
  const expirySnapshot=await runtime.snapshot([setup.roots[0]]),expiryRoot=expirySnapshot.roots[setup.roots[0]];
  const expiryInstruction=sdk.getWithdrawFundedAccountV3Instruction({...expirySnapshot,owner:setup.owner,margin:setup.roots[0],
    quoteMint:setup.mint.address,userToken:setup.operators[0].token.address,guard:sdk.accountGuard(expirySnapshot,setup.roots[0]),amount:1n});
  const budget=await runtime.budget('risk',setup.owner),expiryId='risk:deliberately-unbroadcast-expiry';
  await runtime.enqueue(expiryId,[sdk.routeComputeBudget(),expiryInstruction],setup.owner,budget,
    {kind:'accountStateVersion',venue:setup.venue,account:setup.roots[0],value:expiryRoot.stateVersion.toString()});
  const expiredOriginal=(await runtime.store.pool.query('SELECT signature,blockhash,wire FROM service_intents WHERE run_id=$1 AND request_id=$2',[config.runId,expiryId])).rows[0];
  await until(()=>transport.rpc.call('isBlockhashValid',[expiredOriginal.blockhash,{commitment:'finalized'}]),value=>value.value===false,'actual finalized blockhash expiry',60);
  await runtime.queue.step(expiryId);assert.equal((await runtime.queue.get(expiryId)).status,'expired-unexecuted');
  assert.equal((await root(setup.roots[0])).cash,expiryRoot.cash);assert.equal((await root(setup.roots[0])).stateVersion,expiryRoot.stateVersion);
  const final=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  const intents=(await runtime.store.pool.query('SELECT request_id,signature,wire,status,budget,result FROM service_intents WHERE run_id=$1 ORDER BY created_at',[config.runId])).rows;
  const fees=new Map<string,bigint>();
  for(const intent of intents) {
    if(intent.request_id===expiryId){assert.equal(intent.status,'expired-unexecuted');continue;}
    assert(['finalized','failed'].includes(intent.status),json(intent));
    const actual=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(actual.transaction[0],intent.wire);assert.equal(String(actual.meta.fee),intent.result.fee);
    assert.equal(JSON.stringify(actual.meta.err),JSON.stringify(intent.result.error));
    if(intent.budget)fees.set(intent.budget,(fees.get(intent.budget)??0n)+BigInt(actual.meta.fee));
    writeFileSync(`${directory}/worker-finalized-${intents.indexOf(intent)}.json`,json(actual));
  }
  const budgets=(await runtime.store.pool.query('SELECT name,cap::text,committed::text,spent::text FROM service_budgets WHERE run_id=$1 ORDER BY name',[config.runId])).rows;
  for(const budget of budgets){assert.equal(budget.committed,budget.name==='account-risk'?'20000':'0');assert.equal(BigInt(budget.spent),fees.get(budget.name)??0n);}
  for(const budget of budgets.filter(budget=>budget.name.startsWith('account-maker-')))assert(BigInt(budget.spent)>=10_000n,'Publication and clearing sync actually cost separate network fees');
  await indexer.store.pool.query('CREATE DATABASE rivalt_p27_workers_replay');const replayUrl=new URL(config.databaseUrl);replayUrl.pathname='/rivalt_p27_workers_replay';
  replay=new AccountIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p27-workers-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,final.state);await replay.reconcile();
  const audit=execFileSync('python3',['tests/financial/account-workers-reference.py',`${directory}/financial-capture.json`],{encoding:'utf8'});
  writeFileSync(`${directory}/independent-audit.txt`,audit);
  writeFileSync(`${directory}/summary.json`,json({revision,trackedDirty:startedDirty||dirty(),scope:'P27 durable account workers and recovery',binding,
    wallets,intents,budgets,faults,restarts,observations,reconciliation,freshReplay:true,ws:indexer.metrics.notifications,checks:transport.checks,audit,
    expiredOriginal:{...expiredOriginal,feeReservationRetained:'20000',economicEffect:'not-applied'}}));
  console.log(json({stage:'account-workers-pass',transactions:intents.length,restarts,reconciliation,audit}));
} finally {
  feeding=false;indexing=false;await feedLoop?.catch(()=>{});await indexLoop?.catch(()=>{});
  for(const child of children)await stop(child).catch(()=>child.kill('SIGKILL'));
  await api?.close();await replay?.close();await indexer?.close();await runtime?.close();transport.close();
}
