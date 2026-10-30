import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {dispatchDatabaseCases} from './dispatch-db-cases.js';

const directory=process.env.RIVALT_RUN_DIR!;assert(directory);
// Database-only follow-up: do not open the runtime or claim a new RPC run.
const runtime=new AccountRuntime(readFileSync(`${directory}/postgres.env.url`,'utf8').trim(),'p40a-dispatch','http://127.0.0.1:18941');
try {
  const cases=await dispatchDatabaseCases(runtime.store.pool,runtime.runId);
  writeFileSync(`${directory}/dispatch-database.json`,JSON.stringify({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),...cases},null,2)+'\n');
  console.log('PostgreSQL read/write matrix, durable lease and safe upgrade checks passed');
}finally{await runtime.close();}
