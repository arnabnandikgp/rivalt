import { setTimeout as delay } from 'node:timers/promises';
import { testDeployment } from '@rivalt/sdk';
import { Indexer } from './index.js';
import { api } from './api.js';
const required = (key:string) => { const value=process.env[key];if(!value)throw new Error(`Missing ${key}`);return value; };
const chain = testDeployment(process.env.RIVALT_CHAIN).chain;
const indexer = new Indexer({chain,rpcUrl:required('RIVALT_RPC_URL'),wsUrl:required('RIVALT_WS_URL'),databaseUrl:required('RIVALT_DATABASE_URL'),
  runId:required('RIVALT_RUN_ID'),market:required('RIVALT_MARKET'),anchor:required('RIVALT_INIT_SIGNATURE'),maxRecoveryTransactions:Number(process.env.RIVALT_HISTORY_LIMIT??'10000')});
const app = api(indexer);
let stopping = false;
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{stopping=true;});
try {
  await indexer.open();
  await app.listen({host:'127.0.0.1',port:Number(process.env.RIVALT_API_PORT??18080)});
  while(!stopping) {
    try { await indexer.cycle(); } catch { app.log.error({code:'RecoveryRequired'},'indexing cycle failed; retrying from durable checkpoint'); }
    await delay(1000);
  }
} finally {await app.close();await indexer.close();}
