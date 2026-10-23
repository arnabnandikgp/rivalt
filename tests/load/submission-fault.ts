import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { getMintToInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import type { environment } from './environment.js';
import { decode } from '../../packages/indexer/src/events.js';
import { wait } from './environment.js';

/** Real persisted-byte, missed-notification and lost-ack recovery before measurement. */
export async function submissionFault(e:Awaited<ReturnType<typeof environment>>,requestId='fault:lost-ack'){
  const actor=e.actors[0];
  await e.send('provision one actual test atom for submission recovery',[getMintToInstruction({mint:e.setup.mint.address,token:actor.token.address,mintAuthority:e.payer,amount:1n})]);
  const cash=sdk.getParticipantDecoder().decode((await e.read(actor.participant))!).cash,tokenBefore=(await e.read(actor.token.address))!.readBigUInt64LE(64);
  const ix=await sdk.getDepositInstructionAsync({...e.a,owner:actor.owner,participant:actor.participant,quoteMint:e.setup.mint.address,userToken:actor.token.address,amount:1n});
  const {transaction}=await sdk.signInstructions(e.connection,actor.owner,[ix]),wire=Buffer.from(transaction.serialize()).toString('base64');
  const post=async(value:any)=>fetch('http://127.0.0.1:18081/v1/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  await e.stop('executor');
  for(const prefix of ['funding','keeper','maker','maker-sync','order','risk']){
    const reserved=prefix+':public-probe';assert.equal((await post({requestId:reserved,wire})).status,400);assert.equal(await e.runtime.queue.get(reserved),null);
  }
  const response=await post({requestId,wire});assert.equal(response.status,200);const submitted=await response.json() as {signature:string};
  // No executor/listener existed at commit, so startup must discover the durable row.
  assert.equal((await e.runtime.queue.get(requestId)).status,'pending');
  let dropped=false,persistedBeforeBroadcast=false,recoverAt=0;const outageMs=15_000;
  const proxy=createServer(async(req,res)=>{
    try{
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks).toString(),q=JSON.parse(body);
      if(Date.now()<recoverAt&&(['getSignatureStatuses','isBlockhashValid','sendTransaction'].includes(q.method)||(q.method==='getTransaction'&&q.params[0]===submitted.signature))){res.writeHead(503);res.end('Injected submission RPC interruption');return;}
      const target=q.method==='sendTransaction'&&q.params[0]===wire;
      if(target){const row=(await e.runtime.store.pool.query('SELECT wire FROM service_intents WHERE run_id=$1 AND request_id=$2',[e.runId,requestId])).rows[0];persistedBeforeBroadcast=row?.wire===wire;assert(persistedBeforeBroadcast);}
      const upstream=await fetch(e.url,{method:'POST',headers:{'content-type':'application/json'},body}),text=await upstream.text();
      if(target&&!dropped){dropped=true;recoverAt=Date.now()+outageMs;e.children.get('executor')?.kill('SIGKILL');res.destroy();return;}
      res.setHeader('content-type','application/json');res.end(text);
    }catch{res.destroy();}
  });
  await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const proxyUrl=`http://127.0.0.1:${(proxy.address() as {port:number}).port}`,started=Date.now();
  try{
    const child=e.start('executor',{RIVALT_RPC_URL:proxyUrl});
    await wait(async()=>dropped&&child.signalCode==='SIGKILL',Boolean,'lost acknowledgement and actual executor death');
    await e.stop('executor');e.start('executor',{RIVALT_RPC_URL:proxyUrl});
    const duplicate=await post({requestId,wire});assert.equal(duplicate.status,200);assert.equal((await duplicate.json() as any).signature,submitted.signature);
    assert(['pending','unresolved'].includes((await e.runtime.queue.get(requestId)).status));
    await wait(()=>e.runtime.queue.get(requestId),r=>r.status==='finalized','original signature reconciles after restart and RPC interruption');
    const tx=await e.rpc.call('getTransaction',[submitted.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);assert.equal(tx.meta.err,null);e.txLog(requestId,submitted.signature,tx);
    assert(persistedBeforeBroadcast);const cashAfter=sdk.getParticipantDecoder().decode((await e.read(actor.participant))!).cash;
    const deposit=decode(submitted.signature,tx,e.a.eventAuthority).filter(x=>x.type==='custody'&&x.data.participant===actor.participant);
    assert.equal(deposit.length,1);assert.equal(deposit[0].data.amount,'1');assert.equal((await e.read(actor.token.address))!.readBigUInt64LE(64),tokenBefore-1n);
    if(requestId==='fault:lost-ack')assert.equal(cashAfter,cash+1n); // Initial idle-account proof; sustained trades/settlements may change cash concurrently.
    const different=await sdk.signInstructions(e.connection,actor.owner,[await sdk.getDepositInstructionAsync({...e.a,owner:actor.owner,participant:actor.participant,quoteMint:e.setup.mint.address,userToken:actor.token.address,amount:2n})]);
    assert.equal((await post({requestId,wire:Buffer.from(different.transaction.serialize()).toString('base64')})).status,400);
    return {fault:'missed-notification-lost-ack-executor-kill',status:'pass',signature:submitted.signature,elapsedMs:Date.now()-started,
      persistedBeforeBroadcast,rpcInterruptionMs:outageMs,originalSignatureAfterInterruption:true,actualFee:String(tx.meta.fee),cashBefore:cash.toString(),cashAfter:cashAfter.toString(),cashDeltaIsolated:requestId==='fault:lost-ack',depositEvent:deposit[0],userTokenDelta:'-1',differentBytesRejected:true,reservedWorkerIdentitiesRejected:true};
  }finally{
    await e.stop('executor');await new Promise<void>((resolve,reject)=>{proxy.close(error=>error?reject(error):resolve());proxy.closeAllConnections();});e.start('executor');
  }
}
