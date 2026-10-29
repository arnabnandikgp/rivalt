import {setTimeout as delay} from 'node:timers/promises';
import {AccountIndexer} from './account-indexer.js';
import {accountApi} from './account-api.js';
import {LiquidityIndexer} from './liquidity-indexer.js';
const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value;};
const profile=required('RIVALT_ACCOUNT_PROFILE');
if(!['account-safety-qualification','liquidity-execution-qualification'].includes(profile))throw new Error('Explicit qualified local account profile required');
const config={rpcUrl:required('RIVALT_RPC_URL'),wsUrl:required('RIVALT_WS_URL'),databaseUrl:required('RIVALT_DATABASE_URL'),
  runId:required('RIVALT_RUN_ID'),venue:required('RIVALT_VENUE'),anchor:required('RIVALT_INIT_SIGNATURE')};
const indexer=profile==='liquidity-execution-qualification'?new LiquidityIndexer({...config,profile}):new AccountIndexer({...config,profile:'account-safety-qualification'});
const app=accountApi(indexer);let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping=true;});
try {
  await indexer.open();await app.listen({host:'127.0.0.1',port:Number(process.env.RIVALT_API_PORT??18092)});
  while(!stopping){try{await indexer.cycle();}catch{console.error('Account indexer recovery required; checkpoint retained');}await delay(1000);}
}finally{await app.close();await indexer.close();}
