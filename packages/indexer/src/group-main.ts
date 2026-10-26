import {setTimeout as delay} from 'node:timers/promises';
import {GroupIndexer} from './group-indexer.js';
import {groupApi} from './group-api.js';

const required = (name: string) => {const value=process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value;};
if (required('RIVALT_GROUP_PROFILE') !== 'cross-safety-qualification') throw new Error('Explicit local qualified group profile required');
const indexer = new GroupIndexer({rpcUrl:required('RIVALT_RPC_URL'),wsUrl:required('RIVALT_WS_URL'),databaseUrl:required('RIVALT_DATABASE_URL'),
  runId:required('RIVALT_RUN_ID'),group:required('RIVALT_GROUP'),anchor:required('RIVALT_INIT_SIGNATURE'),profile:'cross-safety-qualification'});
const app = groupApi(indexer);
let stopping = false;
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,() => {stopping=true;});
try {
  await indexer.open();
  await app.listen({host:'127.0.0.1',port:Number(process.env.RIVALT_API_PORT ?? 18090)});
  while (!stopping) {
    try {await indexer.cycle();} catch {console.error('Group indexer recovery required; durable checkpoint retained');}
    await delay(1000);
  }
} finally {await app.close(); await indexer.close();}
