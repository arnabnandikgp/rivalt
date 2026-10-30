import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {createWriteStream} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import type {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {eventually} from './wire.js';
import {dispatchAccess} from '../../packages/services/src/dispatch.js';

/** Kill a real executor after upstream accepted the original, before its HTTP
 * acknowledgement. Restart must retrieve that original, never rebuild it. */
export async function liquidityQueueFault(runtime:AccountRuntime,config:{databaseUrl:string;rpcUrl:string;directory:string},requestId:string) {
  const original=(await runtime.store.pool.query('SELECT * FROM service_intents WHERE run_id=$1 AND request_id=$2',[runtime.runId,requestId])).rows[0];
  assert(original&&original.status==='pending');
  let executor:ChildProcess|undefined,dropped=false,persisted=false;
  const children:ChildProcess[]=[],broadcasts:string[]=[];
  const proxy=createServer(async(request,response)=>{
    try {
      let body='';for await(const chunk of request)body+=chunk;
      const call=JSON.parse(body);
      if(call.method==='sendTransaction'&&call.params[0]===original.wire) {
        const row=(await runtime.store.pool.query('SELECT wire FROM service_intents WHERE run_id=$1 AND request_id=$2',[runtime.runId,requestId])).rows[0];
        assert.equal(row.wire,original.wire);
        const access=(await runtime.store.pool.query('SELECT address,writable FROM service_dispatch_access WHERE run_id=$1 AND request_id=$2',[runtime.runId,requestId])).rows;
        assert.deepEqual(access.sort((a,b)=>a.address.localeCompare(b.address)),dispatchAccess(original.wire),'Durable access committed before crash');
        persisted=true;broadcasts.push(call.params[0]);
      }
      const upstream=await fetch(config.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body});
      const payload=await upstream.text();
      if(call.method==='sendTransaction'&&call.params[0]===original.wire&&!dropped){dropped=true;executor?.kill('SIGKILL');response.destroy();return;}
      response.writeHead(upstream.status,{'content-type':'application/json'});response.end(payload);
    }catch{response.writeHead(503);response.end();}
  });
  const stop=async(child:ChildProcess)=>{
    if(child.exitCode!==null||child.signalCode!==null)return;
    child.kill('SIGTERM');await eventually(async()=>child.exitCode!==null||child.signalCode!==null,Boolean,'canonical executor stopped');
  };
  try {
    await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
    const port=(proxy.address() as import('node:net').AddressInfo).port;
    const start=()=>{
      const child=spawn(process.execPath,['--import','tsx','packages/services/src/account-executor-main.ts'],{cwd:process.cwd(),
        env:{...process.env,RIVALT_ACCOUNT_PROFILE:'liquidity-execution-qualification',RIVALT_DATABASE_URL:config.databaseUrl,
          RIVALT_RUN_ID:runtime.runId,RIVALT_RPC_URL:`http://127.0.0.1:${port}`},stdio:['ignore','pipe','pipe']});
      const output=createWriteStream(`${config.directory}/executor-fault-${requestId.replaceAll(':','-')}-${children.length}.log`);
      child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});child.once('exit',()=>output.end());
      children.push(child);executor=child;return child;
    };
    const first=start();await eventually(async()=>dropped&&first.signalCode==='SIGKILL',Boolean,'actual lost acknowledgement and executor death');
    start();const receipt=await eventually(()=>runtime.queue.get(requestId),row=>['finalized','failed'].includes(row?.status),'original canonical receipt recovered');
    assert.equal(receipt.signature,original.signature);assert(persisted);assert(broadcasts.length>=1&&broadcasts.every(wire=>wire===original.wire));
    const transaction=await runtime.rpc.call('getTransaction',[original.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(transaction.transaction[0],original.wire);
    return {signature:original.signature,receipt,persistedBeforeBroadcast:persisted,droppedAcknowledgement:dropped,actualSignal:first.signalCode,
      broadcasts:broadcasts.length,originalWireBytes:Buffer.from(original.wire,'base64').length,fee:transaction.meta.fee,error:transaction.meta.err};
  }finally{for(const child of children)await stop(child).catch(()=>child.kill('SIGKILL'));await new Promise<void>(resolve=>proxy.close(()=>resolve()));await delay(10);}
}
