import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {createWriteStream} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import * as sdk from '@rivalt/sdk';
import {AccountExecution} from '../../packages/services/src/account-execution.js';
import {accountUserAuthority} from '../../packages/services/src/account-ingress.js';
import {eventually} from './wire.js';
import type {accountRuntimeHarness} from './account-runtime-harness.js';
import type {accountServiceSetup} from './account-service-setup.js';

export async function accountQueueFault(config:{databaseUrl:string;runId:string;rpcUrl:string;directory:string},
  setup:Awaited<ReturnType<typeof accountServiceSetup>>, transport:Awaited<ReturnType<typeof accountRuntimeHarness>>, client:sdk.AccountUserClient) {
  const execution=new AccountExecution(config.databaseUrl,config.runId,config.rpcUrl);
  let executor:ChildProcess|undefined, dropped=false, persistedBeforeBroadcast=false;
  let expectedWire='', expectedSignature='';
  const proxy=createServer(async(request,response)=>{
    try {
      let body='';for await(const chunk of request)body+=chunk;
      const call=JSON.parse(body);
      if(call.method==='sendTransaction' && call.params[0]===expectedWire){
        const row=(await execution.store.pool.query('SELECT wire FROM service_intents WHERE run_id=$1 AND signature=$2',[config.runId,expectedSignature])).rows[0];
        assert.equal(row?.wire,expectedWire);persistedBeforeBroadcast=true;
      }
      const upstream=await fetch(config.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body});
      const payload=await upstream.text();
      if(call.method==='sendTransaction' && call.params[0]===expectedWire && !dropped){dropped=true;executor?.kill('SIGKILL');response.destroy();return;}
      response.writeHead(upstream.status,{'content-type':'application/json'});response.end(payload);
    } catch {response.writeHead(503);response.end();}
  });
  const children:ChildProcess[]=[];
  const stop=async(child:ChildProcess)=>{
    if(child.exitCode!==null||child.signalCode!==null)return;
    child.kill('SIGTERM');
    await eventually(async()=>child.exitCode!==null||child.signalCode!==null,Boolean,'owned account executor stop');
  };
  try {
    await execution.open();
    await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
    const endpoint=proxy.address();assert(endpoint&&typeof endpoint!=='string');
    const url=`http://127.0.0.1:${endpoint.port}`;
    const start=()=>{
      const child=spawn(process.execPath,['--import','tsx','packages/services/src/account-executor-main.ts'],{
        cwd:process.cwd(),env:{...process.env,RIVALT_RPC_URL:url,RIVALT_RUN_ID:config.runId,RIVALT_DATABASE_URL:config.databaseUrl},stdio:['ignore','pipe','pipe']});
      const output=createWriteStream(`${config.directory}/account-executor-${children.length}.log`);
      child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});child.once('exit',()=>output.end());
      children.push(child);executor=child;return child;
    };
    const before=(await client.snapshot([setup.cross])).roots[setup.cross];
    const instruction=await client.deposit(await client.snapshot([setup.cross]),setup.owner.address,setup.cross,setup.operators[0].token.address,2n);
    const {transaction}=await sdk.signInstructions(execution.connection,setup.owner,[sdk.routeComputeBudget(),sdk.zeroPriorityFee(),instruction]);
    expectedWire=Buffer.from(transaction.serialize()).toString('base64');
    const requestId='account-wallet-lost-ack';
    const submitted=await execution.submit(requestId,expectedWire);expectedSignature=submitted.signature;
    assert.deepEqual(submitted.authority,accountUserAuthority(expectedWire,setup.venue));
    const first=start();
    await eventually(async()=>dropped&&first.signalCode==='SIGKILL',Boolean,'actual account executor killed after accepted broadcast');
    start();
    const finalized=await eventually(()=>execution.queue.get(requestId),row=>row?.status==='finalized','original account signature recovered');
    assert.equal(finalized.signature,expectedSignature);assert(persistedBeforeBroadcast);
    assert.equal((await execution.submit(requestId,expectedWire)).signature,expectedSignature);
    const other=await sdk.signInstructions(execution.connection,setup.owner,[sdk.routeComputeBudget(),sdk.zeroPriorityFee(),await client.deposit(await client.snapshot([setup.cross]),setup.owner.address,setup.cross,setup.operators[0].token.address,3n)]);
    await assert.rejects(()=>execution.submit(requestId,Buffer.from(other.transaction.serialize()).toString('base64')),/different signed bytes/);
    const after=(await client.snapshot([setup.cross])).roots[setup.cross];
    assert.equal(after.cash-before.cash,2n,'one original deposit effect');
    const canonical=await transport.rpc.call('getTransaction',[expectedSignature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(canonical.transaction[0],expectedWire);assert.equal(canonical.meta.err,null);
    await assert.rejects(()=>execution.submit('funding:0:reserved',expectedWire),/public request/);

    const budget=await execution.budget('funding',setup.payer,0),snapshot=await client.snapshot([setup.cross]);
    const stamp=snapshot.marketStates[0].observationSequence;
    await execution.enqueue(`funding:0:${stamp}`,[sdk.fundingComputeBudget(),sdk.getSampleAccountOracleV3Instruction(setup.sampleAccounts(0))],
      setup.payer,budget,{kind:'accountObservation',venue:setup.venue,account:setup.markets[0],value:stamp.toString()});
    const sampled=await eventually(()=>execution.queue.get(`funding:0:${stamp}`),row=>row?.status==='finalized','budgeted original account sample');
    const fee=(await execution.store.pool.query('SELECT cap::text,committed::text,spent::text FROM service_budgets WHERE run_id=$1 AND name=$2',[config.runId,budget])).rows[0];
    assert.equal(fee.committed,'0');assert.equal(fee.spent,sampled.result.fee);
    const unknown=(await execution.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[config.runId])).rows[0].count;
    assert.equal(unknown,'0');
    return {signature:expectedSignature,fee:finalized.result.fee,persistedBeforeBroadcast,droppedAcknowledgement:dropped,actualExecutorSigkill:first.signalCode,
      cashDelta:'2',duplicateEffect:false,operatorSignature:sampled.signature,budget:fee,unresolved:unknown};
  } finally {
    for(const child of children)await stop(child).catch(()=>{child.kill('SIGKILL');});
    await new Promise<void>(resolve=>proxy.close(()=>resolve()));
    await execution.close();await delay(10);
  }
}
