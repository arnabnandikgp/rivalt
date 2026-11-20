// Check a bounded page and its predecessor against independently reconstructed
// per-signature charges from finalized signed routes. Reads only retained state.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LiquidityStore} from '../../packages/indexer/src/liquidity-store.js';
import {ledgerTradeReceipts} from '../../packages/indexer/src/ledger-trades.js';

const directory=process.env.RIVALT_RUN_DIR!;
const expected=JSON.parse(readFileSync(directory+'/reconstructed-fees.json','utf8')) as {signature:string;insurance:string;retained:string}[];
const store=new LiquidityStore(readFileSync(directory+'/postgres.env.url','utf8').trim(),'p55b2-application');
const client=await store.pool.connect();
try{
  const run=store.runId;
  const {rows:[published]}=await client.query('SELECT published_state->>\'sequence\' AS cursor FROM runs WHERE run_id=$1',[run]);
  const bySignature=new Map(expected.map(row=>[row.signature,row]));
  const seen=new Set<string>();
  let cursor='0';
  while(true){
    const {rows}=await ledgerTradeReceipts(client,run,cursor,5,published.cursor);
    if(rows.length===0)break;
    for(const row of rows){
      const total=BigInt(row.prior),fee=BigInt(row.payload.fee),credit=(total+fee)/4n-total/4n;
      const target=bySignature.get(row.signature);
      assert(target&&!seen.has(row.signature));
      assert.deepEqual([String(credit),String(fee-credit)],[target.insurance,target.retained]);
      seen.add(row.signature);cursor=row.sequence;
    }
  }
  assert.equal(seen.size,expected.length);
  const last=await ledgerTradeReceipts(client,run,'0',1,published.cursor,true);
  assert.equal(last.rows[0].sequence,cursor);
  console.log(JSON.stringify({verified:seen.size,pageSize:5,lastSequence:cursor}));
}finally{client.release();await store.close();}
