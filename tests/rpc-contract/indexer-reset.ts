import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Indexer } from '../../packages/indexer/src/index.js';
import { json } from '../../packages/indexer/src/events.js';
import { WireRpc, eventually } from './wire.js';
const root=process.env.RIVALT_RUN_DIR!,dir=`${root}/reset`;
mkdirSync(dir,{recursive:true});
const report=JSON.parse(readFileSync(`${root}/indexer-rpc.json`,'utf8'));
const oldCustody=JSON.parse(readFileSync(`${root}/custody.json`,'utf8'));
const ports=[18897,18898,18080];
for(const port of ports)await new Promise<void>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(()=>resolve()));});
const rpcUrl=`http://127.0.0.1:${ports[0]}`,wsUrl=`ws://127.0.0.1:${ports[1]}`;
const rpc=new WireRpc(rpcUrl);
const log=openSync(`${dir}/surfpool.log`,'w'),apiLog=openSync(`${dir}/api.log`,'w');
const runtime=spawn('surfpool',['start','--offline','--no-deploy','--no-tui','--no-studio','--port',String(ports[0]),'--ws-port',String(ports[1]),
  '--slot-time',process.env.RIVALT_SLOT_TIME??'100','--airdrop-keypair-path','.local/keys/payer.json','--log-path',`${dir}/logs`],{stdio:['ignore',log,log]});
let daemon:ChildProcess|undefined;
const stop=async(p:ChildProcess)=>{if(p.exitCode!==null||p.signalCode!==null)return;const done=new Promise<void>(resolve=>p.once('exit',()=>resolve()));p.kill('SIGTERM');
  const timeout=setTimeout(()=>p.kill('SIGKILL'),15000);await done;clearTimeout(timeout);};
const run=async(file:string,env:NodeJS.ProcessEnv)=>new Promise<void>((resolve,reject)=>{const p=spawn(process.execPath,['--import','tsx',file],{env,stdio:'inherit'});p.once('error',reject);p.once('exit',c=>c===0?resolve():reject(new Error(`${file} ${c}`)));});
try{
  await eventually(async()=>{if(runtime.exitCode!==null)throw new Error('reset runtime exited');try{return await rpc.call('getHealth');}catch{return null;}},x=>x==='ok','new Surfpool');
  execFileSync('solana-keygen',['new','--silent','--no-bip39-passphrase','--outfile',`${dir}/deploy-buffer.json`],{stdio:'ignore'});
  execFileSync('solana',['program','deploy','target/deploy/clearing.so','--buffer',`${dir}/deploy-buffer.json`,'--program-id','.local/keys/clearing.json','--keypair','.local/keys/payer.json','--url',rpcUrl,'--use-rpc','--output','json'],{stdio:['ignore',log,log]});
  const env={...process.env,RIVALT_RUN_DIR:dir,RIVALT_RPC_URL:rpcUrl,RIVALT_WS_URL:wsUrl};
  await run('tests/rpc-contract/custody-rpc.ts',env);
  const fresh=JSON.parse(readFileSync(`${dir}/custody.json`,'utf8'));
  const anchor=fresh.checks.find((c:any)=>c.label==='initialize custody market').signature;
  const oldAnchor=oldCustody.checks.find((c:any)=>c.label==='initialize custody market').signature;
  assert.notEqual(anchor,oldAnchor);
  const config={rpcUrl,wsUrl,databaseUrl:process.env.RIVALT_DATABASE_URL!,runId:report.runId,market:fresh.result.addresses.market,anchor:oldAnchor,pageSize:3};
  const old=new Indexer(config);
  try{await assert.rejects(()=>old.open(),/History gap/);}finally{await old.close();}
  const rebound=new Indexer({...config,anchor});
  try{await assert.rejects(()=>rebound.open(),/Incompatible run binding/);}finally{await rebound.close();}
  const newConfig={...config,anchor,runId:report.runId+'-reset'};
  const next=new Indexer(newConfig);
  let reconciliation;
  try{await next.open();await next.cycle();reconciliation=await next.reconcile();
    assert.equal(reconciliation.sequence,'10');assert.equal(reconciliation.actualVault,'10007');
    const original=(await next.store.pool.query('SELECT state FROM runs WHERE run_id=$1',[report.runId])).rows[0].state;
    assert.deepEqual(original,report.finalState);
  }finally{await next.close();}
  daemon=spawn(process.execPath,['--import','tsx','packages/indexer/src/main.ts'],{env:{...env,RIVALT_RUN_ID:newConfig.runId,
    RIVALT_MARKET:newConfig.market,RIVALT_INIT_SIGNATURE:anchor,RIVALT_API_PORT:String(ports[2])},stdio:['ignore',apiLog,apiLog]});
  const apiUrl=`http://127.0.0.1:${ports[2]}`;
  await eventually(async()=>{try{return(await fetch(apiUrl+'/ready')).status;}catch{return 0;}},x=>x===200,'service CLI readiness');
  assert.match(await(await fetch(apiUrl+'/metrics')).text(),/rivalt_indexer_cycles_total/);
  const market=await(await fetch(apiUrl+'/v1/market')).json();assert.equal(market.asOf.sequence,'10');
  await stop(daemon);assert.equal(daemon.exitCode,0);
  writeFileSync(`${root}/indexer-reset.json`,json({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    sourceDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',oldAnchor,newAnchor:anchor,oldRun:report.runId,newRun:newConfig.runId,
    checks:['actual new Surfpool rejects missing old anchor','existing DB refuses replacement binding','new run projects only its own custody history','original projection unchanged','CLI API readiness/metrics and graceful SIGTERM'],reconciliation})+'\n');
  console.log('P05: actual fresh Surfpool cannot inherit old database state; new run and standalone service CLI pass.');
}finally{if(daemon)await stop(daemon);await stop(runtime);closeSync(log);closeSync(apiLog);}
