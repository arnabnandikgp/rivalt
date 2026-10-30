import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,statfsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {address} from '@solana/kit';
import {Keypair} from '@solana/web3.js';
import {getCreateAccountInstruction,getTransferSolInstruction} from '@solana-program/system';
import {TOKEN_PROGRAM_ADDRESS,getInitializeAccount3Instruction,getMintToInstruction} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {LiquidityIndexer} from '../../indexer/src/liquidity-indexer.js';
import {accountApi} from '../../indexer/src/account-api.js';
import {AccountRuntime} from '../../services/src/account-runtime.js';
import {accountServiceApi} from '../../services/src/account-service-api.js';
import {liquidityExecutionSetup} from '../../../tests/rpc-contract/liquidity-execution-setup.js';
import {DemoProcesses} from './processes.js';
import {demoTransport,until} from './transport.js';
import {DemoFaucet,FaucetUnavailable} from './faucet.js';
import {CONTAINER,IMAGE,RUNTIME,DEMO_ROOT,UI,json,publicRequest} from './config.js';

process.umask(0o077);
const session=new Date().toISOString().replaceAll(/[^0-9]/g,'')+'-'+randomBytes(4).toString('hex');
const token=randomBytes(32).toString('hex'),password=randomBytes(24).toString('hex');
const logs=`${DEMO_ROOT}/sessions/${session}`;
mkdirSync(RUNTIME,{recursive:false,mode:0o700});mkdirSync(logs,{recursive:true,mode:0o700});
writeFileSync(RUNTIME+'/owner.json',json({kind:'rivalt-local-demo-v1',session,token,pid:process.pid}),{mode:0o600});
const processes=new DemoProcesses(logs,text=>text.replaceAll(password,'[redacted]').replaceAll(token,'[redacted]'));
let state='starting',stage='preflight',failure='',stopping=false;
let publicConfig:sdk.AccountUserConfig|undefined,indexer:LiquidityIndexer|undefined,runtime:AccountRuntime|undefined;
let readApi:ReturnType<typeof accountApi>|undefined,executionApi:ReturnType<typeof accountServiceApi>|undefined;
let transport:Awaited<ReturnType<typeof demoTransport>>|undefined,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>|undefined;
let sourceLoop:Promise<void>|undefined,monitor:NodeJS.Timeout|undefined,lease:NodeJS.Timeout|undefined;
const faucet=new DemoFaucet();
const status=()=>({kind:'rivalt-local-demo-v1',session,state,stage,error:failure||undefined,url:UI,
  deployment:publicConfig?{venue:publicConfig.venue,genesis:publicConfig.genesis}:undefined,
  sessionMinutes:60,logs,warning:'Synthetic prices, internal makers and valueless local test collateral. Stop ends this chain; reset starts fresh.'});
async function shutdown(reason:string,exitCode=0){
  if(stopping)return;stopping=true;state='stopping';stage=reason;
  if(monitor)clearInterval(monitor);if(lease)clearTimeout(lease);
  writeFileSync(RUNTIME+'/ended.json',json({...status(),state:exitCode?'failed':'stopped'}));
  await Promise.allSettled([readApi?.close(),executionApi?.close()]);
  await processes.stop();
  await Promise.allSettled([indexer?.close(),runtime?.close()]);
  try{execFileSync('container',['stop',CONTAINER],{stdio:'pipe',timeout:15000});}catch{}
  try{execFileSync('container',['delete',CONTAINER],{stdio:'pipe',timeout:15000});}catch{}
  control.close();process.exit(exitCode);
}
const control=createServer(async(request,response)=>{
  response.setHeader('content-type','application/json');response.setHeader('cache-control','no-store');
  const finish=(code:number,value:unknown)=>{response.writeHead(code);response.end(json(value));};
  try {
    if(request.method==='GET'&&request.url==='/status'){
      let health:unknown={ready:false};
      if(state==='ready'&&runtime&&indexer)try{
        const snapshot=await runtime.snapshot();
        health={indexed:indexer.healthy,wsSubscribed:indexer.ws?.acknowledged??false,
          sourceModes:snapshot.marketStates.map(market=>sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot)),
          makers:(await runtime.heartbeats()).map(maker=>({market:maker.market_index,maker:maker.maker_id,online:maker.online})),
          budgets:(await runtime.store.pool.query('SELECT name,cap::text,spent::text,committed::text FROM service_budgets WHERE run_id=$1',[runtime.runId])).rows};
      }catch{health={ready:false,reason:'Current chain/projection check unavailable'};}
      finish(200,{...status(),health});return;
    }
    const authorized=request.headers.authorization===`Bearer ${token}`;
    if(request.method==='POST'&&request.url==='/stop'&&authorized){finish(200,{stopping:true});void shutdown('user stop');return;}
    if(request.method!=='POST'||request.url!=='/faucet'){finish(404,{error:'Unknown demo operation'});return;}
    if(!publicRequest(request.headers.origin,request.headers.host)){finish(403,{error:'Local demo origin required'});return;}
    if(state!=='ready'||!setup||!transport){finish(503,{error:'Demo is not ready'});return;}
    let body='';for await(const chunk of request){body+=chunk;if(body.length>2048){finish(413,{error:'Request too large'});return;}}
    const input=JSON.parse(body);assert(input.genesis===publicConfig!.genesis,'Wrong demo deployment');
    const owner=address(input.owner),demo=transport,mint=setup.mint.address;
    const funding=await faucet.fund(owner,async()=>{
      const tokenAccount=await Keypair.generate();
      const instructions=[
        getTransferSolInstruction({source:demo.payer,destination:owner,amount:1_000_000_000n}),
        getCreateAccountInstruction({payer:demo.payer,newAccount:tokenAccount,lamports:await demo.h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
        getInitializeAccount3Instruction({account:tokenAccount.address,mint,owner}),
        getMintToInstruction({mint,token:tokenAccount.address,mintAuthority:demo.payer,amount:1_000_000_000n}),
      ];
      return async()=>{
        const history=await demo.send('demo wallet faucet',instructions,[tokenAccount],'finalized');
        return {signature:history.transaction.signatures[0],tokenAccount:tokenAccount.address,amount:'1000',unit:'test USD'};
      };
    });
    finish(200,funding);
  }catch(error){finish(error instanceof FaucetUnavailable?error.status:400,{error:error instanceof Error?error.message:'Demo request failed'});}
});
control.listen(18094,'127.0.0.1');
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>void shutdown(signal));
async function ready(url:string){return until(()=>fetch(url,{signal:AbortSignal.timeout(1000)}).then(response=>response.ok).catch(()=>false),Boolean,url,60000);}
function child(name:string,script:string,environment:NodeJS.ProcessEnv){
  const process=processes.start(name,globalThis.process.execPath,['--import','tsx',script],environment);
  process.once('exit',()=>{if(!stopping)void shutdown(`${name} exited; inspect ${name}.log`,1);});return process;
}
try {
  for(const artifact of sdk.LIQUIDITY_ARTIFACTS){
    const file=readFileSync(`.local/liquidity-execution/${artifact.name.replaceAll('-','_')}.so`);
    assert.equal(file.length,artifact.bytes);assert.equal(createHash('sha256').update(file).digest('hex'),artifact.sha256,`Unqualified ${artifact.name}`);
  }
  const disk=statfsSync(DEMO_ROOT);assert(disk.bavail*disk.bsize>1024**3,'At least 1 GiB free disk is required');
  stage='production UI build';
  await processes.run('ui-build','pnpm',['build:trader']);
  stage='local RPC';
  const rpcUrl='http://127.0.0.1:18931',wsUrl='ws://127.0.0.1:18932';
  const surfpool=processes.start('surfpool','surfpool',['start','--offline','--no-deploy','--no-tui','--no-studio',
    '--disable-instruction-profiling','--port','18931','--ws-port','18932','--slot-time','50',
    '--airdrop-keypair-path','.local/keys/payer.json','--log-level','warn','--log-path',logs+'/surfpool']);
  surfpool.once('exit',()=>{if(!stopping)void shutdown('local chain ended',1);});
  transport=await demoTransport(rpcUrl,logs+'/provisioning.ndjson');
  await until(()=>transport!.rpc.call('getHealth').catch(()=>null),value=>value==='ok','local RPC');
  stage='program deployment';
  for(const program of ['clearing','maker_a','maker_b','oracle_fixture']){
    const key=program.replaceAll('_','-'),buffer=`${RUNTIME}/buffer-${key}.json`;
    await processes.run(`buffer-${key}`,'solana-keygen',['new','--silent','--no-bip39-passphrase','--outfile',buffer]);
    await processes.run(`deploy-${key}`,'solana',['program','deploy',`.local/liquidity-execution/${program}.so`,'--buffer',buffer,
      '--program-id',`.local/keys/${key}.json`,'--keypair','.local/keys/payer.json','--url',rpcUrl,'--use-rpc','--max-sign-attempts','20','--output','json']);
  }
  stage='PostgreSQL';mkdirSync(RUNTIME+'/postgres-data',{mode:0o700});
  writeFileSync(RUNTIME+'/postgres.env',`POSTGRES_USER=rivalt\nPOSTGRES_DB=rivalt\nPOSTGRES_PASSWORD=${password}\n`,{mode:0o600});
  await processes.run('postgres-launch','container',['run','--detach','--name',CONTAINER,'--platform','linux/arm64','--cpus','2','--memory','512M',
    '--publish','127.0.0.1:15443:5432','--env-file',RUNTIME+'/postgres.env','--volume',`${RUNTIME}/postgres-data:/var/lib/postgresql`,IMAGE]);
  await until(async()=>{try{execFileSync('container',['exec',CONTAINER,'pg_isready','-U','rivalt','-d','rivalt'],{stdio:'pipe',timeout:2000});return true;}catch{return false;}},Boolean,'PostgreSQL');
  const databaseUrl=`postgresql://rivalt:${password}@127.0.0.1:15443/rivalt`;
  stage='signed venue provisioning';setup=await liquidityExecutionSetup(transport.h,transport.rpc,{verifyRejections:false,makerCash:500_000_000n});
  const anchor=transport.anchor();await until(()=>transport!.rpc.call('getTransaction',[anchor,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]),Boolean,'initialization finality');
  stage='finalized indexer';
  const config={rpcUrl,wsUrl,databaseUrl,runId:'interactive-'+session,venue:setup.venue,anchor,profile:'liquidity-execution-qualification' as const};
  indexer=new LiquidityIndexer(config);await indexer.open();await indexer.cycle();
  const {binding}=await indexer.store.snapshot();
  publicConfig={version:4,chain:'solana:localnet',profile:config.profile,rpcUrl,wsUrl,genesis:binding.genesis,anchor,
    anchorHash:binding.anchorHash,venue:setup.venue,mint:setup.mint.address,domain:binding.domain};
  writeFileSync(RUNTIME+'/deployment.json',json(publicConfig),{mode:0o600});
  writeFileSync(RUNTIME+'/private-config.json',json(config),{mode:0o600});
  runtime=new AccountRuntime(databaseUrl,config.runId,rpcUrl);await runtime.open();
  readApi=accountApi(indexer);await readApi.listen({host:'127.0.0.1',port:18092});
  executionApi=accountServiceApi(runtime);await executionApi.listen({host:'127.0.0.1',port:18093});
  const environment={...process.env,RIVALT_RPC_URL:rpcUrl,RIVALT_WS_URL:wsUrl,RIVALT_DATABASE_URL:databaseUrl,RIVALT_RUN_ID:config.runId,RIVALT_ACCOUNT_PROFILE:config.profile,RIVALT_FUNDING_INTERVAL_SECONDS:'2'};
  child('executor','packages/services/src/account-executor-main.ts',environment);
  const worker=(name:string,role:string,key:Keypair,marketIndex?:number,makerId?:number)=>{
    const path=RUNTIME+`/signer-${name}.json`;writeFileSync(path,JSON.stringify([...key.secretKey]),{mode:0o600});
    child(name,'packages/services/src/account-worker-main.ts',{...environment,RIVALT_ACCOUNT_ROLE:role,RIVALT_SIGNER_PATH:path,
      RIVALT_MARKET_INDEX:marketIndex===undefined?undefined:String(marketIndex),RIVALT_MAKER_ID:makerId===undefined?undefined:String(makerId)});
  };
  for(const market of [0,1]){
    for(const maker of [0,1,2])worker(`maker-${market}-${maker}`,'maker',setup.updater,market,maker);
    worker(`funding-${market}`,'funding',setup.updater,market);
  }
  worker('orders','orders',setup.payer);worker('settlement','settlement',setup.payer);worker('risk','risk',setup.payer);
  // Ordinary risk probing/default remains active; no receiver is invented.
  // The demo does not orchestrate forced insolvency or authority recovery.
  transport.finishProvisioning();
  // Match the standalone indexer: leave one second after each completed cycle.
  // Readiness still fails closed during reconciliation; never compress its
  // healthy interval or skip the disk guard while an indexing cycle is busy.
  void (async()=>{while(!stopping){
    try{await indexer!.cycle();}catch{if(!stopping)console.error('Indexer recovery required; durable checkpoint retained');}
    await delay(1000);
  }})();
  monitor=setInterval(()=>{
    if(stopping)return;
    const disk=statfsSync(DEMO_ROOT);if(disk.bavail*disk.bsize<768*1024**2)void shutdown('low disk guard',1);
  },1000);
  sourceLoop=(async()=>{while(!stopping){await setup!.freshSources();await delay(2000);}})();
  sourceLoop.catch(()=>{if(!stopping)void shutdown('synthetic source publisher failed; original retained',1);});
  stage='UI and source readiness';
  const ui=processes.start('ui',process.execPath,['apps/trader/node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','18083','--strictPort','apps/trader'],{
    ...environment,RIVALT_TRADER_CONFIG:RUNTIME+'/deployment.json',RIVALT_SERVICE_ORIGIN:'http://127.0.0.1:18093',
    RIVALT_INDEXER_ORIGIN:'http://127.0.0.1:18092',RIVALT_LOCAL_DEMO:'1'});
  ui.once('exit',()=>{if(!stopping)void shutdown('UI process exited',1);});
  const client=new sdk.AccountUserClient(publicConfig);
  await until(()=>client.snapshot([setup!.roots[0]],'confirmed'),snapshot=>snapshot.marketStates.every(market=>sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot)==='Normal'),'fresh Normal sources',60000);
  await until(()=>runtime!.heartbeats(),makers=>makers.length===6&&makers.every(maker=>maker.online),'six internal makers',30000);
  await ready(UI+'/rivalt-config.json');await ready('http://127.0.0.1:18092/ready');
  state='ready';stage='interactive';writeFileSync(RUNTIME+'/ready.json',json(status()));console.log(json(status()));
  // One bounded interactive session prevents unattended disk/budget growth;
  // this is a usability lease, never an endurance qualification.
  lease=setTimeout(()=>void shutdown('60-minute interactive session ended'),60*60*1000);
}catch(error){failure=error instanceof Error?error.message:'Startup failed';console.error(failure);await shutdown(failure,1);}
