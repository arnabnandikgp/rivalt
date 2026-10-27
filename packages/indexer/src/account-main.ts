import {setTimeout as delay} from 'node:timers/promises';
import {AccountIndexer} from './account-indexer.js';
import {accountApi} from './account-api.js';
const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value;};
if(required('RIVALT_ACCOUNT_PROFILE')!=='account-safety-qualification')throw new Error('Explicit qualified local account profile required');
const indexer=new AccountIndexer({rpcUrl:required('RIVALT_RPC_URL'),wsUrl:required('RIVALT_WS_URL'),databaseUrl:required('RIVALT_DATABASE_URL'),
  runId:required('RIVALT_RUN_ID'),venue:required('RIVALT_VENUE'),anchor:required('RIVALT_INIT_SIGNATURE'),profile:'account-safety-qualification'});
const app=accountApi(indexer);let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping=true;});
try {
  await indexer.open();await app.listen({host:'127.0.0.1',port:Number(process.env.RIVALT_API_PORT??18092)});
  while(!stopping){try{await indexer.cycle();}catch{console.error('Account indexer recovery required; checkpoint retained');}await delay(1000);}
}finally{await app.close();await indexer.close();}
