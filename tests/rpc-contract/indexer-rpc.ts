import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Connection } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import { Indexer, type Config } from '../../packages/indexer/src/index.js';
import { api } from '../../packages/indexer/src/api.js';
import { decode, json, PROGRAM } from '../../packages/indexer/src/events.js';
import { addresses, payerKey } from './custody-cases.js';
import { eventually, WireRpc } from './wire.js';

const dir=process.env.RIVALT_RUN_DIR!,url=process.env.RIVALT_RPC_URL!;
assert.equal(new URL(url).hostname,'127.0.0.1');
const custody=JSON.parse(readFileSync(`${dir}/custody.json`,'utf8'));
const a=await addresses(),rpc=new WireRpc(url);
const config:Config={rpcUrl:url,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
  runId:dir.split('/').at(-1)!,market:a.market,anchor:custody.checks.find((x:any)=>x.label==='initialize custody market').signature,pageSize:3};
let indexer=new Indexer(config);
const checks:string[]=[];
const record=(name:string)=>{checks.push(name);console.log(`Indexer: ${name}`);};
const child=(file:string)=>new Promise<void>((resolve,reject)=>{
  const p=spawn(process.execPath,['--import','tsx',file],{stdio:'inherit',env:process.env});
  p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error(`${file} exited ${code}`)));
});
const retry=async()=>{
  let last:unknown;
  for(let n=0;n<30;n++){try{await indexer.cycle();return;}catch(error){last=error;await delay(100);}}
  throw last;
};
let app:ReturnType<typeof api>|undefined;
try {
  await indexer.open();
  const contender=new Indexer(config);
  try{await assert.rejects(()=>contender.open(),/already has an indexer/);}finally{await contender.close();}
  record('exclusive PostgreSQL indexer lease');
  const originalCall=indexer.rpc.call.bind(indexer.rpc);
  const tailSignature=custody.checks.filter((c:any)=>c.status==='pass'&&c.eventCount>0).at(-1).signature;
  indexer.rpc.call=async(method,params=[])=>{
    const result=await originalCall(method,params);
    return method==='getTransaction'&&params[0]===tailSignature?{...result,meta:{...result.meta,innerInstructions:[]}}:result;
  };
  await assert.rejects(()=>indexer.cycle(),/Reconciliation sequence differs/);
  assert.equal((await indexer.store.snapshot()).checkpoint,null);
  indexer.rpc.call=originalCall;
  record('missing final critical event cannot advance checkpoint past incomplete state');
  await indexer.store.pool.query(`CREATE FUNCTION fail_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected crash before checkpoint'; END $$;
    CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON runs FOR EACH ROW WHEN (NEW.checkpoint IS NOT NULL) EXECUTE FUNCTION fail_checkpoint()`);
  await assert.rejects(()=>indexer.cycle(),/injected crash/);
  const rolled=await indexer.store.snapshot();assert.equal(rolled.checkpoint,null);assert.equal(rolled.state.sequence,'0');
  assert.equal((await indexer.store.pool.query('SELECT count(*) FROM events')).rows[0].count,'0');
  assert.equal((await indexer.store.pool.query('SELECT count(*) FROM outbox')).rows[0].count,'0');
  assert(Number((await indexer.store.pool.query('SELECT count(*) FROM observations')).rows[0].count)>0);
  await indexer.store.pool.query('DROP TRIGGER fail_checkpoint ON runs; DROP FUNCTION fail_checkpoint()');
  await retry();record('projection/events/outbox/checkpoint roll back together; observations survive');
  assert.equal((await indexer.store.snapshot()).state.sequence,'10');assert(indexer.metrics.pages>1);
  record('bootstrap paginates real finalized history to initialization');
  let running=true, backgroundError:unknown;
  const indexing=(async()=>{while(running){try{await indexer.cycle();}catch(error){backgroundError=error;}await delay(100);}})();
  try{await child('tests/rpc-contract/maker-rpc.ts');}finally{running=false;await indexing;}
  await retry();
  assert(indexer.metrics.notifications>0);record('live WS notices and finalized polling index real maker/custody transactions');
  const beforeDisconnect=await indexer.store.snapshot();
  const firstMetrics={...indexer.metrics};
  await indexer.close();
  await child('tests/rpc-contract/route-rpc.ts');
  indexer=new Indexer(config);await indexer.open();await retry();
  const after=await indexer.store.snapshot();assert(BigInt(after.state.sequence)>BigInt(beforeDisconnect.state.sequence));
  const reconciliation=await indexer.reconcile();
  const route=JSON.parse(readFileSync(`${dir}/route-rpc.json`,'utf8'));
  assert.equal(reconciliation.actualVault,route.tokenBalance.value.amount);
  assert.equal(after.state.sequence,route.finalMarket.sequence);
  assert.equal(after.state.market.totalCash,route.finalMarket.totalCash);
  record('offline signed routes recovered after process restart; all participants and vault reconcile');

  const rows=(await indexer.store.pool.query('SELECT signature,payload FROM transactions WHERE run_id=$1',[config.runId])).rows;
  const txs=rows.map(r=>({signature:r.signature,tx:r.payload}));
  const events=txs.flatMap(t=>decode(t.signature,t.tx,indexer.eventAuthority));
  const failed=txs.filter(t=>t.tx.meta.err!==null);
  assert(failed.length>0);
  const failedRoute=JSON.parse(readFileSync(`${dir}/route-failed-transactions.json`,'utf8')).find((x:any)=>x.label.startsWith('later instruction rolls back'));
  assert(failed.some(t=>t.signature===failedRoute.history.transaction.signatures[0]));
  assert.equal(events.filter(e=>e.type==='route').length,route.events.filter((e:any)=>e.trader!==undefined).length);
  record('failed transactions retained in journal; reverted route events excluded from projections');
  await indexer.store.commit([...txs].reverse(),[...events].reverse().concat(events),null,after.checkpoint);
  assert.deepEqual((await indexer.store.snapshot()).state,after.state);await retry();
  const count=(await indexer.store.pool.query('SELECT count(*) FROM events WHERE run_id=$1',[config.runId])).rows[0].count;
  assert.equal(count,after.state.sequence);record('duplicate/reordered finalized observations do not duplicate balances or fills');
  await assert.rejects(()=>indexer.store.pool.query('DELETE FROM events WHERE run_id=$1',[config.runId]),/append-only/);
  record('SQL journal mutation rejected');

  app=api(indexer);const apiUrl=await app.listen({host:'127.0.0.1',port:0});
  const request=async(path:string)=>{const r=await fetch(apiUrl+path);return{status:r.status,body:await r.json()};};
  assert.equal((await request('/ready')).status,200);
  const market=(await request('/v1/market')).body;assert.equal(market.asOf.sequence,after.state.sequence);
  const trader=events.find(e=>e.type==='route')!.data.trader;
  const balance=(await request(`/v1/balances/${trader}`)).body;
  assert.equal(balance.cash,after.state.participants[trader].cash);assert.equal(balance.withdrawableCash,'0');
  assert.equal(balance.positiveUnpaidMarginCredit,'0');
  const trades=(await request('/v1/trades?limit=100')).body;
  assert.equal(trades.items.length,events.filter(e=>e.type==='route').length);
  assert.equal((await request('/v1/orders')).body.supported,false);
  assert.equal((await request('/v1/trades?limit=101')).status,400);
  const times=trades.items.filter((t:any)=>t.block_time!==null).map((t:any)=>Number(t.block_time));
  assert(times.length>0);
  const candles=(await request(`/v1/candles?from=${Math.min(...times)}&to=${Math.max(...times)+1}`)).body;
  assert.equal(candles.items.reduce((sum:number,c:any)=>sum+c.trades,0),trades.items.length);
  assert.equal(candles.items.reduce((sum:bigint,c:any)=>sum+BigInt(c.volumeQuote),0n),trades.items.reduce((sum:bigint,t:any)=>sum+BigInt(t.payload.grossQuote),0n));
  record('actual-fill candles count each route once and retain exact rational prices');
  record('real HTTP API exposes decimal balances, actual aggregate fills, capability gates and bounded cursors');

  // Fault injection wraps a real RPC response; it never supplies financial success state.
  const call=indexer.rpc.call.bind(indexer.rpc);
  indexer.rpc.call=async(method,params=[])=>{
    if(method==='getSignaturesForAddress')return[];
    return call(method,params);
  };
  await assert.rejects(()=>indexer.cycle(),/History gap/);
  assert.equal((await indexer.store.snapshot()).checkpoint,after.checkpoint);
  assert.equal((await request('/v1/market')).status,503);
  indexer.rpc.call=call;await retry();record('pruned history explicitly blocks readiness without checkpoint advance');
  indexer.rpc.call=async(method,params=[])=>method==='getTransaction'?null:call(method,params);
  await assert.rejects(()=>indexer.cycle(),/History gap/);indexer.rpc.call=call;await retry();
  record('missing transaction metadata fails closed and recovers');
  indexer.ws!.socket.close();await delay(50);await retry();record('WS disconnect reconnects before history catch-up');
  await app.close();app=undefined;

  // Run binding is immutable even to ordinary direct SQL updates.
  const wrong=new Indexer({...config,runId:config.runId+'-binding'});await wrong.open();
  try{await assert.rejects(()=>wrong.store.pool.query(`UPDATE runs SET binding=jsonb_set(binding,'{anchorHash}','"different-chain"') WHERE run_id=$1`,[wrong.config.runId]),/immutable run binding/);}
  finally{await wrong.close();}
  record('run identity is immutable in PostgreSQL');

  // Exercise a real extra signed transaction while the service is absent.
  const payer=await payerKey(),connection=new Connection(url,'confirmed');
  await indexer.close();
  const {transaction}=await sdk.signInstructions(connection,payer,[await sdk.getSetCustodyPauseInstructionAsync({...a,authority:payer,paused:true})]);
  const signature=await rpc.call('sendTransaction',[Buffer.from(transaction.serialize()).toString('base64'),{encoding:'base64',skipPreflight:true}]);
  const pauseStatus=await eventually(()=>rpc.call('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]),x=>x.value[0]?.confirmationStatus==='finalized','offline pause');
  assert.equal(pauseStatus.value[0].err,null);
  indexer=new Indexer(config);await indexer.open();await retry();
  assert.equal((await indexer.store.snapshot()).state.market.paused,true);
  record('additional offline signed market change recovered without replaying old cash');
  const final=await indexer.store.snapshot();
  await indexer.close();
  execFileSync('container',['stop',process.env.RIVALT_PG_CONTAINER!],{stdio:'ignore'});
  execFileSync('container',['start',process.env.RIVALT_PG_CONTAINER!],{stdio:'ignore'});
  for(let i=0;i<60;i++){
    try{execFileSync('container',['exec',process.env.RIVALT_PG_CONTAINER!,'pg_isready','-U','rivalt','-d','rivalt'],{stdio:'ignore'});break;}
    catch{if(i===59)throw new Error('PostgreSQL restart readiness');await delay(100);}
  }
  indexer=new Indexer(config);await indexer.open();await retry();
  assert.deepEqual((await indexer.store.snapshot()).state,final.state);
  record('PostgreSQL process restart preserves journal, checkpoint and projections on bound volume');
  await indexer.store.pool.query('CREATE DATABASE rivalt_rebuild');
  const rebuildUrl=new URL(config.databaseUrl);rebuildUrl.pathname='/rivalt_rebuild';
  const rebuilt=new Indexer({...config,databaseUrl:rebuildUrl.toString()});
  let rebuildMetrics;
  try{await rebuilt.open();await rebuilt.cycle();assert.deepEqual((await rebuilt.store.snapshot()).state,final.state);
    const {slot:_rebuiltSlot,...rebuiltValues}=await rebuilt.reconcile();
    const {slot:_originalSlot,...originalValues}=await indexer.reconcile();
    assert.deepEqual(rebuiltValues,originalValues);rebuildMetrics=rebuilt.metrics;
  }finally{await rebuilt.close();}
  record('fresh PostgreSQL database rebuilt from RPC matches every projection and vault');
  const report={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    sourceDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',runId:config.runId,
    postgres:(await indexer.store.pool.query('SELECT version()')).rows[0].version,checks,firstMetrics,recoveryMetrics:indexer.metrics,rebuildMetrics,
    canonicalTransactions:txs.length,failedTransactions:failed.length,events:count,finalSequence:final.state.sequence,
    reconciliation:await indexer.reconcile(),finalState:final.state,api:{market,balance,trades,candles},offlinePauseSignature:signature};
  writeFileSync(`${dir}/indexer-rpc.json`,json(report)+'\n');
  console.log(`P05: ${checks.length} integration checks passed against real Surfpool RPC/WS and PostgreSQL.`);
}finally{await app?.close();await indexer.close();}
