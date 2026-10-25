import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {writeFileSync,openSync,closeSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import type {Keypair} from '@solana/web3.js';
import type {GroupRuntime} from '../../packages/services/src/group-runtime.js';
import type {GroupConfig} from '../../packages/indexer/src/group-indexer.js';

export async function until<T>(read:()=>Promise<T>,accept:(value:T)=>boolean,label:string,timeout=30_000):Promise<T>{
  const deadline=Date.now()+timeout;let last:unknown;
  while(Date.now()<deadline){try{const value=await read();last=value;if(accept(value))return value;}catch(error){last=error;}await delay(100);}
  throw new Error(`${label}: ${last instanceof Error?last.message:JSON.stringify(last)}`);
}
/** Real owned processes and an acknowledgement-loss proxy; no mocked chain state. */
export class WorkloadActors {
  readonly children:ChildProcess[]=[];
  readonly faults:{kind:string;at:number;[key:string]:unknown}[]=[];
  executor:ChildProcess|undefined;
  expectedWire='';expectedSignature='';dropped=false;persistedBeforeBroadcast=false;
  proxyUrl='';
  readonly proxy=createServer(async(request,response)=>{
    try {
      let body='';for await(const chunk of request)body+=chunk;
      const call=JSON.parse(body),target=call.method==='sendTransaction'&&call.params[0]===this.expectedWire;
      if(target){const row=(await this.runtime.store.pool.query('SELECT wire FROM service_intents WHERE run_id=$1 AND signature=$2',[this.config.runId,this.expectedSignature])).rows[0];
        assert.equal(row?.wire,this.expectedWire);this.persistedBeforeBroadcast=true;}
      const upstream=await fetch(this.config.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body,signal:AbortSignal.timeout(10_000)}),payload=await upstream.text();
      if(target&&!this.dropped){this.dropped=true;const previous=this.executor;previous?.kill('SIGKILL');response.destroy();
        this.faults.push({kind:'accepted-broadcast-acknowledgement-lost-executor-killed',at:Date.now(),pid:previous?.pid,signature:this.expectedSignature});return;}
      response.writeHead(upstream.status,{'content-type':'application/json'});response.end(payload);
    }catch{response.writeHead(503);response.end();}
  });
  constructor(readonly config:GroupConfig,readonly runtime:GroupRuntime,readonly directory:string){}
  async open(){await new Promise<void>(resolve=>this.proxy.listen(0,'127.0.0.1',resolve));const endpoint=this.proxy.address();assert(endpoint&&typeof endpoint!=='string');this.proxyUrl=`http://127.0.0.1:${endpoint.port}`;}
  start(role:'maker'|'funding'|'executor'|'indexer',key?:Keypair,marketIndex?:number,makerId?:number){
    const identity=`${role}-${marketIndex??'group'}-${makerId??'none'}-${this.children.length}`;
    const environment:NodeJS.ProcessEnv={...process.env,RIVALT_RPC_URL:role==='executor'?this.proxyUrl:this.config.rpcUrl,
      RIVALT_WS_URL:this.config.wsUrl,RIVALT_DATABASE_URL:this.config.databaseUrl,RIVALT_RUN_ID:this.config.runId,
      RIVALT_GROUP:this.config.group,RIVALT_INIT_SIGNATURE:this.config.anchor,RIVALT_GROUP_PROFILE:'cross-safety-qualification',RIVALT_API_PORT:'18096'};
    if(key){const path=`${this.directory}/signer-${identity}.json`;writeFileSync(path,JSON.stringify([...key.secretKey]),{mode:0o600});
      Object.assign(environment,{RIVALT_GROUP_ROLE:role,RIVALT_MARKET_INDEX:String(marketIndex),RIVALT_MAKER_ID:String(makerId),RIVALT_SIGNER_PATH:path});}
    const entry=role==='indexer'?'packages/indexer/src/group-main.ts':`packages/services/src/${role==='executor'?'group-executor-main':'group-worker-main'}.ts`;
    const descriptor=openSync(`${this.directory}/${identity}.log`,'w');
    const child=spawn(process.execPath,['--import','tsx',entry],{cwd:process.cwd(),env:environment,stdio:['ignore',descriptor,descriptor]});closeSync(descriptor);
    this.children.push(child);if(role==='executor')this.executor=child;return child;
  }
  async stop(child:ChildProcess,kill=false){if(child.exitCode!==null||child.signalCode!==null)return;
    child.kill(kill?'SIGKILL':'SIGTERM');await until(async()=>child.exitCode!==null||child.signalCode!==null,Boolean,'owned worker stop');}
  async close(){for(const child of this.children)await this.stop(child).catch(()=>child.kill('SIGKILL'));await new Promise<void>(resolve=>this.proxy.close(()=>resolve()));}
}
