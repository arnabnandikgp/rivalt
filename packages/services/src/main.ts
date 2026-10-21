import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { Runtime } from './runtime.js';
import { api } from './api.js';
const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value;};
const role=required('RIVALT_SERVICE_ROLE'),url=required('RIVALT_RPC_URL');
if(!['api','executor','settlement','maker-a','maker-b','funding','orders','risk'].includes(role))throw new Error('Unknown service role');
if(new URL(url).hostname!=='127.0.0.1')throw new Error('P06 services are local test profile only');
const runtime=new Runtime(required('RIVALT_DATABASE_URL'),required('RIVALT_RUN_ID'),url);await runtime.open();
const key=['settlement','maker-a','maker-b','funding','orders','risk'].includes(role)?await Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(required('RIVALT_SIGNER_PATH'),'utf8')))):null;
const app=role==='api'?api(runtime):null;
if(app)await app.listen({host:'127.0.0.1',port:Number(process.env.RIVALT_SERVICE_PORT??18081)});
let stop=false;process.on('SIGTERM',()=>{stop=true;});process.on('SIGINT',()=>{stop=true;});
console.log(JSON.stringify({role,pid:process.pid,status:'started'}));
let lastError=false;
while(!stop){
  try{
    if(role==='executor')await runtime.execute();
    else if(role==='risk')await runtime.riskWork(key!);
    else if(role==='orders')await runtime.orders(key!);
    else if(role==='funding')await runtime.funding(key!);
    else if(role==='settlement')await runtime.settle(key!);
    else if(role.startsWith('maker-'))await runtime.maker(role==='maker-a'?0:1,key!);
    if(lastError)console.log(JSON.stringify({role,status:'recovered'}));lastError=false;
  }catch{if(!lastError)console.log(JSON.stringify({role,status:'unavailable'}));lastError=true;}
  await new Promise(resolve=>setTimeout(resolve,250));
}
await app?.close();await runtime.close();console.log(JSON.stringify({role,status:'stopped'}));
