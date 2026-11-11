import assert from 'node:assert/strict';
import {appendFileSync,readFileSync,writeFileSync,createWriteStream} from 'node:fs';
import {execFileSync,fork} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import {address,getBase58Decoder} from '@solana/kit';
import {Connection,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {getTransferSolInstruction} from '@solana-program/system';
import {LiquidityIndexer,type LiquidityConfig} from '../../packages/indexer/src/liquidity-indexer.js';
import {LiquidityStore} from '../../packages/indexer/src/liquidity-store.js';
import {decodeAccountInvocations} from '../../packages/indexer/src/account-events.js';
import {accountApi} from '../../packages/indexer/src/account-api.js';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {AccountExecution} from '../../packages/services/src/account-execution.js';
import {fixtureKey} from './harness.js';

const runDir=process.env.RIVALT_RUN_DIR!,databaseUrl=process.env.RIVALT_DATABASE_URL!;
assert(databaseUrl,'Owned PostgreSQL required');
const diagnostic=process.env.RIVALT_INDEXER_DIAGNOSTIC==='live';
assert(process.env.RIVALT_INDEXER_DIAGNOSTIC===undefined||diagnostic,'Unknown diagnostic mode');
const delegateBatches=diagnostic?3:420,unrelatedCount=diagnostic?100:10_100;
const started=Date.now(),memory:number[]=[];
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,runDir,{
  deferFinality:true,computeUnitLimit:label=>label.startsWith('P52 delegate')?1_000_000:label.startsWith('P52 fill')?800_000:400_000,
});
let indexer:LiquidityIndexer|undefined,replay:LiquidityIndexer|undefined;
const cycles:any[]=[],faults:any[]=[];
async function catchUp(current:LiquidityIndexer,label:string){
  const deadline=Date.now()+180_000;
  do {
    const before=await current.store.snapshot(),begin=Date.now();await current.cycle();
    const after=await current.store.snapshot();memory.push(process.memoryUsage().rss);
    assert(BigInt(after.checkpoint_slot??0)>=BigInt(before.checkpoint_slot??0));
    cycles.push({label,covered:after.checkpoint_slot,published:after.published_checkpoint_slot,ready:current.healthy,ms:Date.now()-begin});
    console.log(json({stage:'coverage',...cycles.at(-1)}).trim());
    if(current.healthy)return;
    assert(Date.now()<deadline,'Bounded recovery did not become ready');
  }while(true);
}
try {
  const setup=await liquidityExecutionSetup(h,rpc,{verifyRejections:false});
  const {guard,root,route}=executionTestHelpers(h,setup),margin=setup.roots[0],owner=setup.traderOwner;
  for(let fill=0;fill<2;fill++){
    await setup.qualify();await h.send(`P52 fill ${fill}`,[await route({trader:margin,actor:owner,marketIndex:0,side:0,makers:[setup.instances[0]],lots:[1n]})],[owner]);
  }
  await flush();
  const anchor=String(checks.find(check=>check.label==='initialize fresh profile4 custody')!.signature);
  const config:LiquidityConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl,runId:'p52-progress',
    venue:setup.venue,anchor,profile:'liquidity-execution-qualification',pageSize:37,maxRecoveryTransactions:500};
  indexer=new LiquidityIndexer(config);await indexer.open();await catchUp(indexer,'initial');
  const initial=await indexer.store.published(),initialRoot=await root(margin);
  await indexer.close();indexer=undefined;
  let delegateInstructions=0;
  async function delegates(count:number){
    const startGuard=await guard(margin),expiry=await setup.slot()+100_000n;
    const instructions=Array.from({length:count},(_,offset)=>{
      const grant=(delegateInstructions+offset)%2===0;
      return sdk.getSetAccountDelegateInstruction({...setup.common,owner,margin,
        guard:{...startGuard,nonce:startGuard.nonce+BigInt(offset),stateVersion:startGuard.stateVersion+BigInt(offset)},
        delegate:grant?setup.updater.address:address('11111111111111111111111111111111'),expirySlot:grant?expiry:0n});
    });
    await h.send(`P52 delegate ${delegateInstructions}-${delegateInstructions+count}`,instructions,[owner]);delegateInstructions+=count;
  }
  // >4096 authentic scoped invocations, including multiple atomic instructions
  // per transaction. Authority changes leave cash/claims untouched.
  for(let batch=0;batch<delegateBatches;batch++)await delegates(10);
  const beforeRejection=await root(margin);
  const rejectedInstruction=sdk.getSetAccountDelegateInstruction({...setup.common,owner,margin,guard:await guard(margin),
    delegate:setup.updater.address,expirySlot:await setup.slot()+100_000n});
  await h.send('P52 reverted duplicate delegate',[rejectedInstruction,rejectedInstruction],[owner],sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  assert.deepEqual(await root(margin),beforeRejection);await flush();
  const failedSignature=String(checks.find(check=>check.label==='P52 reverted duplicate delegate')!.signature);
  // >10000 independently signed unrelated transactions. Their signatures and
  // complete finalized block bodies must all be retained, not filtered away.
  const connection=new Connection(config.rpcUrl,'confirmed'),sink=await fixtureKey('p52-unrelated-sink');
  await h.send('P52 fund unrelated transaction sink',[getTransferSolInstruction({source:setup.payer,destination:sink.address,amount:1_000_000n})]);
  const unrelated:string[]=[];
  for(let offset=0;offset<unrelatedCount;offset+=100){
    const {blockhash}=await connection.getLatestBlockhash('confirmed');
    const wires=await Promise.all(Array.from({length:Math.min(100,unrelatedCount-offset)},async(_,index)=>{
      const tx=new VersionedTransaction(new TransactionMessage({payerKey:setup.payer.publicKey,recentBlockhash:blockhash,
        instructions:[SystemProgram.transfer({fromPubkey:setup.payer.publicKey,toPubkey:sink.publicKey,lamports:offset+index+1})]}).compileToV0Message());
      await tx.sign([setup.payer]);return {signature:getBase58Decoder().decode(tx.signatures[0]),wire:Buffer.from(tx.serialize()).toString('base64')};
    }));
    appendFileSync(`${runDir}/unrelated-originals.jsonl`,wires.map(wire=>JSON.stringify(wire)).join('\n')+'\n');
    for(let first=0;first<wires.length;first+=16)await Promise.all(wires.slice(first,first+16).map(async entry=>{
      assert.equal(await rpc.call('sendTransaction',[entry.wire,{encoding:'base64',skipPreflight:true}]),entry.signature);unrelated.push(entry.signature);
    }));
    if(offset===0){const deadline=Date.now()+20_000;for(;;){
      const statuses=await rpc.call('getSignatureStatuses',[wires.map(entry=>entry.signature),{searchTransactionHistory:true}]);
      if(statuses.value.every((value:any)=>value?.confirmationStatus==='finalized')){for(const value of statuses.value)assert.equal(value.err,null);break;}
      assert(Date.now()<deadline,'First traffic batch finality');await delay(100);
    }}
    if(offset%1000===0)console.log(`Unrelated signed transactions submitted: ${offset+wires.length}`);
  }
  const finalityDeadline=Date.now()+30_000;
  for(let first=0;first<unrelated.length;first+=200)for(;;){
    const statuses=await rpc.call('getSignatureStatuses',[unrelated.slice(first,first+200),{searchTransactionHistory:true}]);
    if(statuses.value.every((value:any)=>value?.confirmationStatus==='finalized')){
      for(const value of statuses.value)assert.equal(value.err,null);break;
    }
    assert(Date.now()<finalityDeadline);await delay(100);
  }
  // Original-signature recovery remains available while publication is stale.
  await delay(Math.max(0,initial.synced_at!.getTime()+10_001-Date.now()));
  const execution=new AccountExecution(databaseUrl,config.runId,config.rpcUrl);
  let pendingOriginal:string;
  try {
    await execution.open();await assert.rejects(()=>execution.store.published(),/unavailable/);
    const instruction=sdk.getSetAccountDelegateInstruction({...setup.common,owner,margin,guard:await guard(margin),
      delegate:setup.updater.address,expirySlot:await setup.slot()+100_000n});
    const signed=await sdk.signCanonicalInstructions(connection,owner,[instruction],{computeUnitLimit:400_000,loadedAccountsDataSizeLimit:8*1024*1024});
    const wire=Buffer.from(signed.transaction.serialize()).toString('base64');
    const receipt=await execution.submit('p52-original-during-lag',wire);pendingOriginal=receipt.signature;
    const deadline=Date.now()+20_000;
    for(;;){await execution.execute();const result=await execution.queue.get(receipt.request_id);
      if(result.status==='finalized'){break;}
      assert(!['failed','expired-unexecuted'].includes(result.status),json(result));assert(Date.now()<deadline,'Original recovery timeout');await delay(250);
    }
    const retained=(await execution.store.pool.query('SELECT wire,signature FROM service_intents WHERE run_id=$1 AND request_id=$2',
      [config.runId,receipt.request_id])).rows[0];assert.equal(retained.wire,wire);assert.equal(retained.signature,pendingOriginal);
    const tx=await rpc.call('getTransaction',[pendingOriginal,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(tx.meta.err,null);assert.equal(tx.transaction[0],wire);delegateInstructions++;
  }finally{await execution.close();}
  // No credentials in the fixture configuration; inherited ignored environment
  // supplies the DB URL to each supervised child.
  const {databaseUrl:_,...publicConfig}=config;
  const configPath=`${runDir}/indexer-config.json`;writeFileSync(configPath,json(publicConfig),{mode:0o600});
  for(const mode of ['before','during','after']){
    const log=createWriteStream(`${runDir}/crash-${mode}.log`);
    const child=fork(new URL('./indexer-progress-worker.ts',import.meta.url),[configPath,mode],{execArgv:['--import','tsx'],silent:true});
    child.stdout!.pipe(log);child.stderr!.pipe(log);
    try {
      const message=await Promise.race([once(child,'message').then(([value])=>value),once(child,'exit').then(([code])=>{throw new Error(`Crash worker exited ${code}`);}),
        delay(60_000,undefined,{ref:false}).then(()=>{throw new Error('Crash boundary timeout');})]);
      assert(!message.error,message.error);assert.equal(message.boundary,mode);
      const exit=once(child,'exit');child.kill('SIGKILL');const [code,signal]=await exit;
      assert.equal(code,null);assert.equal(signal,'SIGKILL');faults.push({...message,signal});
      indexer=new LiquidityIndexer(config);await indexer.open();
      assert.equal((await indexer.store.snapshot()).checkpoint_slot,message.checkpoint,'Atomic crash checkpoint');
      assert.deepEqual((await indexer.store.snapshot()).published_state,initial.state,'Unreconciled crash cannot publish');
      await indexer.close();indexer=undefined;
    }finally{if(child.exitCode===null&&!child.signalCode)child.kill('SIGKILL');log.end();}
  }
  indexer=new LiquidityIndexer(config);await indexer.open();
  // Force an actual WS disconnect; the next cycle must reconnect and recover
  // from complete RPC history, not rely on retained notifications.
  const reconnects=indexer.metrics.reconnects;indexer.ws!.close();await delay(100);
  await catchUp(indexer,'backlog');assert(indexer.metrics.reconnects>reconnects);
  if(!diagnostic)assert(cycles.some(value=>value.label==='backlog'&&!value.ready));
  const settled=await indexer.store.published(),actual=await root(margin);
  assert.equal(actual.nonce,initialRoot.nonce+BigInt(delegateInstructions));assert.equal(actual.stateVersion,initialRoot.stateVersion+BigInt(delegateInstructions));
  assert.equal(settled.state.roots[margin].nonce,actual.nonce.toString());
  assert.equal(settled.state.roots[margin].cash,initial.state.roots[margin].cash);
  assert.deepEqual(settled.state.roots[margin].positions,initial.state.roots[margin].positions);
  const counts=(await indexer.store.pool.query(`SELECT
    (SELECT count(*) FROM transactions WHERE run_id=$1) AS transactions,
    (SELECT count(*) FROM envelopes WHERE run_id=$1) AS invocations,
    (SELECT count(*) FROM events WHERE run_id=$1) AS events,
    (SELECT count(*) FROM blocks WHERE run_id=$1) AS blocks,
    (SELECT count(*) FROM outbox WHERE run_id=$1) AS outbox,
    pg_database_size(current_database()) AS database_bytes`,[config.runId])).rows[0];
  assert(Number(counts.transactions)>(diagnostic?100:10_000));assert(Number(counts.invocations)>(diagnostic?30:4096));
  assert.equal(counts.events,settled.state.sequence);assert.equal(counts.events,counts.outbox);
  const retained=await indexer.store.pool.query('SELECT signature FROM transactions WHERE run_id=$1 AND signature=ANY($2)',[config.runId,unrelated]);
  assert.equal(retained.rowCount,unrelated.length);
  assert.equal((await indexer.store.pool.query('SELECT failed FROM transactions WHERE run_id=$1 AND signature=$2',[config.runId,failedSignature])).rows[0].failed,true);
  assert.equal((await indexer.store.pool.query('SELECT 1 FROM events WHERE run_id=$1 AND signature=$2',[config.runId,failedSignature])).rowCount,0);
  // Recheck a retained authentic block idempotently; then corrupt its bytes and
  // independently supplied projection. Neither may mutate a covered checkpoint.
  const block=await indexer.store.block(Number((await indexer.store.pool.query('SELECT slot FROM transactions WHERE run_id=$1 AND signature=$2',
    [config.runId,checks.find(check=>check.label==='P52 delegate 0-10')!.signature])).rows[0].slot));
  const invocations=block.transactions.flatMap(({signature,tx},position)=>decodeAccountInvocations(signature,tx,position,
    {...settled.binding,eventAuthority:indexer!.eventAuthority}));
  const fence={slot:Number(settled.checkpoint_slot),blockhash:settled.checkpoint!};
  await indexer.store.commit([block],invocations,fence,settled.checkpoint);
  const badBlock=structuredClone(block);badBlock.previousBlockhash='foreign';
  await assert.rejects(()=>indexer!.store.commit([badBlock],invocations,fence,settled.checkpoint),/Conflicting finalized block/);
  const badInvocations=structuredClone(invocations);assert(badInvocations.length>0);badInvocations[0].footerBytes='wrong';
  await assert.rejects(()=>indexer!.store.commit([block],badInvocations,fence,settled.checkpoint),/authenticated invocation/);
  assert.deepEqual((await indexer.store.snapshot()).state,settled.state);
  await assert.rejects(()=>indexer!.store.pool.query('UPDATE covered_checkpoints SET state_digest=state_digest WHERE run_id=$1',[config.runId]),/append-only/);
  await indexer.store.pool.query('CREATE DATABASE rivalt_p52_legacy');
  const legacyUrl=new URL(databaseUrl);legacyUrl.pathname='/rivalt_p52_legacy';
  const legacy=new LiquidityStore(legacyUrl.toString(),'legacy-format-check');
  try{
    await legacy.pool.query('CREATE TABLE schema_version(version integer PRIMARY KEY CHECK(version=2)); INSERT INTO schema_version VALUES(2)');
    await assert.rejects(()=>legacy.migrate(),/Fresh format-3 journal required/);
    assert.equal((await legacy.pool.query('SELECT version FROM schema_version')).rows[0].version,2);
  }finally{await legacy.close();}

  const ledger=settled.state.ledgers[setup.ledgers[0]];
  assert.deepEqual([ledger.insurance,ledger.fees,ledger.insuranceFeeRemainder],['6','20',2]);
  assert.equal(Object.values(settled.state.roots).reduce((sum,value)=>sum+BigInt(value.cash),0n)+26n,8_000_000n);
  const forged=structuredClone(settled);forged.state.roots[margin].cash='999999999';
  await assert.rejects(()=>indexer!.store.publish(forged,new Date()),/Uncovered/);
  await assert.rejects(()=>indexer!.store.publish(initial,new Date()),/regressing/);
  await assert.rejects(()=>indexer!.store.publish(settled,new Date(Date.now()-11_000)),/expired/);
  await catchUp(indexer,'after-integrity-checks');
  const api=accountApi(indexer);
  try{const response=await api.inject('/v4/trades?latest=true');assert.equal(response.statusCode,200);assert.equal(response.json().items.length,2);}finally{await api.close();}
  // Retain capture diagnostics before any live assertion can fail. Observed
  // account bytes are never changed by this trace; verification stays intact.
  const capture=(indexer as any).capture.bind(indexer);let captureTrace:any;
  (indexer as any).capture=async(snapshot:any,minimumSlot:number)=>{
    const witness=await capture(snapshot,minimumSlot),entry=witness.captured.get(margin);
    captureTrace={minimumSlot,reportedMax:witness.maxSlot,entities:witness.captured.size,candidateRevision:snapshot.state.revisions[margin].revision,
      capturedRevision:Buffer.from(entry.value.data[0],'base64').readBigUInt64LE(10).toString(),
      finalized:await rpc.call('getSlot',[{commitment:'finalized'}]),confirmed:await rpc.call('getSlot',[{commitment:'confirmed'}]),verified:false};
    const verify=witness.verify;witness.verify=async(state:any)=>{captureTrace.verified=true;return verify(state);};return witness;
  };
  // Continuous relevant writes fit in one account batch in this local cohort.
  // Account capture must be able to publish an actual common historical fence.
  let producing=true,producerError:unknown,produced=0;
  const producer=(async()=>{try{while(producing){await delegates(2);produced+=2;await delay(75);}}catch(error){producerError=error;}})();
  const live:{ready:boolean;covered:string|null;nonce:string|null}[]=[],liveDeadline=Date.now()+30_000;
  const publishedNonces=()=>new Set(live.filter(value=>value.ready).map(value=>value.nonce));
  try{while(Date.now()<liveDeadline&&publishedNonces().size<3){
    captureTrace=null;await indexer.cycle();const row=await indexer.store.snapshot();
    live.push({ready:indexer.healthy,covered:row.checkpoint_slot,nonce:row.published_state?.roots[margin].nonce??null});
    const trace={...live.at(-1),coveredRevision:row.state.revisions[margin].revision,capture:captureTrace};
    appendFileSync(`${runDir}/live-coverage.jsonl`,JSON.stringify(trace)+'\n');console.log(JSON.stringify({stage:'live-coverage',...trace}));await delay(100);
  }}
  finally{producing=false;await producer;await flush();}
  if(producerError)throw producerError;
  assert(produced>0);assert(publishedNonces().size>=3,'No advancing publications under continuous relevant writes');
  await catchUp(indexer,'final');const final=await indexer.store.published();
  const reconciliation=await indexer.reconcile();
  await indexer.store.pool.query('CREATE DATABASE rivalt_p52_replay');
  const replayUrl=new URL(databaseUrl);replayUrl.pathname='/rivalt_p52_replay';
  replay=new LiquidityIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p52-fresh-replay'});await replay.open();
  await catchUp(replay,'fresh-replay');assert.deepEqual((await replay.store.published()).state,final.state);
  const events=await indexer.store.pool.query('SELECT sequence::text,signature,bytes FROM events WHERE run_id=$1 ORDER BY sequence',[config.runId]);
  const replayEvents=await replay.store.pool.query('SELECT sequence::text,signature,bytes FROM events WHERE run_id=$1 ORDER BY sequence',[replay.config.runId]);
  assert.deepEqual(replayEvents.rows,events.rows);
  const summary={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    trackedDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
    build:JSON.parse(readFileSync(`${process.env.RIVALT_ARTIFACT_DIR}/build-manifest.json`,'utf8')),
    phaseAcceptance:!diagnostic,scope:diagnostic?'small live diagnostic only':'full bounded-progress qualification',
    elapsedMs:Date.now()-started,backlogCounts:counts,finalEventCount:events.rows.length,pendingOriginal,delegateInstructions,unrelated:unrelated.length,faults,cycles,live,produced,reconciliation,
    metrics:indexer.metrics,rpcMetrics:indexer.rpc.metrics,replayMetrics:replay.metrics,replayRpcMetrics:replay.rpc.metrics,peakRssBytes:Math.max(...memory),checks,state:final.state};
  writeFileSync(`${runDir}/summary.json`,json(summary));console.log(json({stage:diagnostic?'p52-live-diagnostic-pass':'p52-progress-pass',phaseAcceptance:!diagnostic,counts,delegateInstructions,elapsedMs:summary.elapsedMs}));
}finally{await replay?.close();await indexer?.close();try{await flush();}finally{ws.close();}}
