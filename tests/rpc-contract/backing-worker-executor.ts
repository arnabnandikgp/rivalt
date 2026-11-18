import {setTimeout as delay} from 'node:timers/promises';
import {BackingWorkerRuntime} from './backing-worker-runtime.js';
const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value;};
const runtime=new BackingWorkerRuntime(required('RIVALT_DATABASE_URL'),required('RIVALT_RUN_ID'),required('RIVALT_RPC_URL'));
let stopped=false;for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopped=true;});
try {await runtime.open();while(!stopped){await runtime.execute();await delay(100);}}
finally {await runtime.close();}
