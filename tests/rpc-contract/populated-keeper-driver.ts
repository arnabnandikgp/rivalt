// Isolated producer/executor for the restart qualification. Only the RPC, SQL
// journal, local payer and venue identity are supplied to the real risk worker.
import assert from 'node:assert/strict';
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import {address} from '@solana/kit';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {readAccountResolution} from '../../packages/services/src/account-worker-state.js';
import {payerKey} from './harness.js';
import {eventually,WireRpc,WireSubscriptions} from './wire.js';

const mode=process.argv[2],venue=address(process.argv[3]),directory=process.env.RIVALT_RUN_DIR!;
assert(mode==='interrupt'||mode==='resume');
const rpc=new WireRpc(process.env.RIVALT_RPC_URL!),ws=new WireSubscriptions(process.env.RIVALT_WS_URL!);
const runtime=new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',rpc.url,4,'unified-recovery-candidate');
const key=await payerKey();
const call=runtime.rpc.call.bind(runtime.rpc);
runtime.rpc.call=async(method,params=[])=>{
  const response=await call(method,params);
  if(method==='simulateTransaction'&&response.value?.err)
    writeFileSync(directory+'/last-worker-preflight.json',JSON.stringify({err:response.value.err,logs:response.value.logs}));
  return response;
};
const pending=async()=>(await runtime.store.pool.query<{request_id:string;wire:string;signature:string}>(
  "SELECT request_id,wire,signature FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[runtime.runId])).rows;
try {
  await ws.ready();await runtime.open();
  let resume=mode==='resume';
  for(let step=0;step<4000;step++) {
    const state=await readAccountResolution(runtime.rpc,venue);
    if(state.header.stage===11) {
      assert(mode==='resume'&&!resume);
      const budget=await runtime.store.pool.query('SELECT spent,committed FROM service_budgets WHERE run_id=$1 AND name=$2',[runtime.runId,'liquidity-risk']);
      assert.equal(budget.rows[0].committed,'0');
      writeFileSync(directory+'/populated-worker-budget.json',JSON.stringify(budget.rows[0]));
      break;
    }
    let existing=await pending();
    if(resume) {
      assert.equal(existing.length,1);
      assert.deepEqual(existing[0],JSON.parse(readFileSync(directory+'/interrupted-intent.json','utf8')));
      resume=false;
    } else {
      assert.equal(existing.length,0);
      const result=await runtime.riskWork(key);
      assert.equal(result.status,'queued',JSON.stringify({result,source:state.header.stage,prepared:state.preparedState.stage,rates:state.ratesState.stage,plan:state.planState.stage}));
      existing=await pending();assert.equal(existing.length,1);
    }
    const [intent]=existing;
    if(mode==='interrupt' && intent.request_id.includes(':joint-verify-')) {
      writeFileSync(directory+'/interrupted-intent.json',JSON.stringify(intent));
      process.kill(process.pid,'SIGKILL');
    }
    const subscription=await ws.call('signatureSubscribe',[intent.signature,{commitment:'finalized'}]);
    const receipt=await eventually(async()=>{await runtime.queue.step(intent.request_id);return runtime.queue.get(intent.request_id);},
      value=>['finalized','failed'].includes(value?.status),'populated keeper finality');
    assert.equal(receipt.status,'finalized');
    const notification=await ws.notification(subscription);
    assert.equal(notification.params.result.value.err,null);
    const tx=await rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(tx.transaction[0],intent.wire);assert.equal(tx.meta.err,null);
    assert(tx.meta.computeUnitsConsumed>0);
    appendFileSync(directory+'/populated-worker.jsonl',JSON.stringify({request:intent.request_id,signature:intent.signature,wire:intent.wire,
      compute:tx.meta.computeUnitsConsumed,fee:tx.meta.fee,slot:tx.slot,notification})+'\n');
  }
  assert.equal((await readAccountResolution(runtime.rpc,venue)).header.stage,11);
} finally {ws.close();await runtime.close();}
