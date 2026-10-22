import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { Runtime } from './runtime.js';
import { api } from './api.js';
import { ExecutorWake } from './executor-wake.js';
const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value;};
const role=required('RIVALT_SERVICE_ROLE'),url=required('RIVALT_RPC_URL');
const sampleCadence=process.env.RIVALT_FUNDING_INTERVAL_SECONDS??'2';
if(!/^[2-5]$/.test(sampleCadence))throw new Error('Local funding cadence must be 2–5 seconds');
if(!['api','executor','settlement','maker-a','maker-b','funding','orders','risk'].includes(role))throw new Error('Unknown service role');
if(new URL(url).hostname!=='127.0.0.1')throw new Error('P06 services are local test profile only');
const margin=process.env.RIVALT_QUOTE_DISPATCH_MARGIN_SECONDS??'0';
if(!/^[01]$/.test(margin))throw new Error('Local quote dispatch margin must be 0 or 1 second');
const runtime=new Runtime(required('RIVALT_DATABASE_URL'),required('RIVALT_RUN_ID'),url,process.env.RIVALT_BUDGET_PROFILE??'smoke',BigInt(sampleCadence),BigInt(margin));await runtime.open();
const key=['settlement','maker-a','maker-b','funding','orders','risk'].includes(role)?await Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(required('RIVALT_SIGNER_PATH'),'utf8')))):null;
const app=role==='api'?api(runtime):null;
if(app)await app.listen({host:'127.0.0.1',port:Number(process.env.RIVALT_SERVICE_PORT??18081)});
let stop=false;process.on('SIGTERM',()=>{stop=true;});process.on('SIGINT',()=>{stop=true;});
console.log(JSON.stringify({role,pid:process.pid,status:'started'}));
const inbox=role==='executor'?new ExecutorWake(runtime.store.pool,runtime.runId):null;
let lastError=false;
while(!stop){
  const observed=inbox?.version??0;
  try{
    // A failed LISTEN connection must not stop the authoritative periodic scan.
    await inbox?.connect().catch(()=>{});
    if(role==='executor')await runtime.execute();
    else if(role==='risk')await runtime.riskWork(key!);
    else if(role==='orders')await runtime.orders(key!);
    else if(role==='funding')await runtime.funding(key!,BigInt(sampleCadence));
    else if(role==='settlement')await runtime.settle(key!);
    else if(role.startsWith('maker-'))await runtime.maker(role==='maker-a'?0:1,key!);
    if(lastError)console.log(JSON.stringify({role,status:'recovered'}));lastError=false;
  }catch{if(!lastError)console.log(JSON.stringify({role,status:'unavailable'}));lastError=true;}
  if(inbox)await inbox.wait(observed);else await new Promise(resolve=>setTimeout(resolve,250));
}
await inbox?.close();await app?.close();await runtime.close();console.log(JSON.stringify({role,status:'stopped'}));
