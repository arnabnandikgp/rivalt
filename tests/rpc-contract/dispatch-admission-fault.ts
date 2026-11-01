import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {createWriteStream} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import type {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {dispatchAccess} from '../../packages/services/src/dispatch.js';
import {eventually} from './wire.js';

/** Kill after SQL admission commits, before the first status response or send.
 * Only a pre-crash durable finalized-valid witness can permit later expiry. */
export async function dispatchAdmissionFault(runtime:AccountRuntime,config:{databaseUrl:string;rpcUrl:string;directory:string},requestId:string) {
  const parameters=[runtime.runId,requestId];
  const readOriginal=async()=>(await runtime.store.pool.query('SELECT * FROM service_intents WHERE run_id=$1 AND request_id=$2',parameters)).rows[0];
  const original=await readOriginal();assert.equal(original.status,'pending');assert.equal(original.blockhash_finalized_slot,null);
  await eventually(()=>runtime.rpc.call('isBlockhashValid',[original.blockhash,{commitment:'finalized'}]),
    response=>response.value===true,'admission fixture hash first becomes finalized-valid');
  const children:ChildProcess[]=[];let executor:ChildProcess|undefined,killed=false,broadcasts=0;
  const proxy=createServer(async(request,response)=>{
    try {
      let body='';for await(const chunk of request)body+=chunk;
      const call=JSON.parse(body);
      if(call.method==='getSignatureStatuses'&&call.params[0].includes(original.signature)&&!killed) {
        killed=true;executor!.kill('SIGKILL');response.destroy();return;
      }
      if(call.method==='sendTransaction'&&call.params[0]===original.wire)broadcasts++;
      const upstream=await fetch(config.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body});
      response.writeHead(upstream.status,{'content-type':'application/json'});response.end(await upstream.text());
    }catch{response.writeHead(503);response.end();}
  });
  try {
    await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
    const port=(proxy.address() as import('node:net').AddressInfo).port;
    const start=()=>{
      const child=spawn(process.execPath,['--import','tsx','packages/services/src/account-executor-main.ts'],{cwd:process.cwd(),
        env:{...process.env,RIVALT_ACCOUNT_PROFILE:'liquidity-execution-qualification',RIVALT_DATABASE_URL:config.databaseUrl,
          RIVALT_RUN_ID:runtime.runId,RIVALT_RPC_URL:`http://127.0.0.1:${port}`},stdio:['ignore','pipe','pipe']});
      const output=createWriteStream(`${config.directory}/admission-fault-${children.length}.log`);
      child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});child.once('exit',()=>output.end());
      children.push(child);executor=child;return child;
    };
    const first=start();await eventually(async()=>killed&&first.signalCode==='SIGKILL',Boolean,'executor killed immediately after admission');
    const committed=await readOriginal();
    assert.notEqual(committed.blockhash_finalized_slot,null,'Finalized-valid witness committed before crash');
    assert.equal(committed.attempts,0);assert.equal(committed.status,'pending');assert.equal(committed.wire,original.wire);
    const access=(await runtime.store.pool.query('SELECT address,writable FROM service_dispatch_access WHERE run_id=$1 AND request_id=$2',parameters)).rows;
    assert.deepEqual(access.sort((left,right)=>left.address.localeCompare(right.address)),dispatchAccess(original.wire));
    const deadline=Date.now()+60_000;
    while((await runtime.rpc.call('isBlockhashValid',[original.blockhash,{commitment:'finalized'}])).value) {
      assert(Date.now()<deadline,'Real finalized blockhash expiry');await delay(200);
    }
    start();const receipt=await eventually(()=>runtime.queue.get(requestId),row=>row?.status==='expired-unexecuted','restart proves unchanged economic authority after expiry');
    assert.equal(receipt.signature,original.signature);assert.equal(receipt.result.fee,null);assert.equal(receipt.result.economicEffect,'not-applied');
    assert.equal(broadcasts,0);
    assert.equal((await runtime.rpc.call('getSignatureStatuses',[[original.signature],{searchTransactionHistory:true}])).value[0],null);
    assert.equal((await runtime.store.pool.query('SELECT count(*) FROM service_dispatch_access WHERE run_id=$1 AND request_id=$2',parameters)).rows[0].count,'0');
    return {signature:original.signature,actualSignal:first.signalCode,finalizedWitnessSlot:committed.blockhash_finalized_slot,
      attemptsAtCrash:committed.attempts,accessRowsAtCrash:access.length,broadcasts,receipt};
  }finally{
    for(const child of children)if(child.exitCode===null&&child.signalCode===null) {
      child.kill('SIGTERM');await eventually(async()=>child.exitCode!==null||child.signalCode!==null,Boolean,'admission fault executor stopped').catch(()=>child.kill('SIGKILL'));
    }
    await new Promise<void>(resolve=>proxy.close(()=>resolve()));
  }
}
