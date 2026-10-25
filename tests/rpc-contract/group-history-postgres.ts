/** Real PostgreSQL ordering regression across decimal digit boundaries. */
import assert from 'node:assert/strict';
import {GroupStore} from '../../packages/indexer/src/group-store.js';
import {groupApi} from '../../packages/indexer/src/group-api.js';
import type {GroupIndexer} from '../../packages/indexer/src/group-indexer.js';
const store=new GroupStore(process.env.RIVALT_DATABASE_URL!,'p21-history-order');
const client=await store.pool.connect();
const row={binding:{group:'fixture',profile:'cross-safety-qualification'},state:{sequence:'1001',markets:{}},synced_at:new Date()};
// Only the run envelope is a fixture. The endpoint's SQL, limit, predicate,
// numeric ordering and output text serialization execute in PostgreSQL 18.6.
const adapter={async query(sql:string,params?:unknown[]){return sql.startsWith('SELECT * FROM runs')?{rows:[row]}:client.query(sql,params);},release(){}};
const indexer={healthy:true,ws:{error:null},config:{runId:'p21-history-order'},store:{async snapshot(){return row;},pool:{async connect(){return adapter;}}}};
const app=groupApi(indexer as unknown as GroupIndexer);
try{
  await client.query('CREATE TEMP TABLE events (sequence numeric(20,0),run_id text,signature text,slot numeric(20,0),block_time bigint,kind text,payload jsonb)');
  for(const sequence of ['9','10','99','100','101','999','1000','1001'])await client.query("INSERT INTO events VALUES($1,'p21-history-order','signature',1,0,'margin-route','{}')",[sequence]);
  const latest=await app.inject('/v2/trades?latest=true&limit=4');assert.equal(latest.statusCode,200);
  assert.deepEqual(latest.json().items.map((item:any)=>item.sequence),['101','999','1000','1001']);
  const cursor=await app.inject('/v2/events?after=9&limit=3');assert.equal(cursor.statusCode,200);
  assert.deepEqual(cursor.json().items.map((item:any)=>item.sequence),['10','99','100']);assert.equal(cursor.json().next,'100');
  console.log(JSON.stringify({postgresHistoryOrdering:'pass',latest:latest.json().items.map((item:any)=>item.sequence),cursor:cursor.json().items.map((item:any)=>item.sequence)}));
}finally{await app.close();client.release();await store.close();}
