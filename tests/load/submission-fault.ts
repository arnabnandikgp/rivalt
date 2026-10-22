import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { getMintToInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import type { environment } from './environment.js';
import { wait } from './environment.js';

/** Real persisted-byte, missed-notification and lost-ack recovery before measurement. */
export async function submissionFault(e:Awaited<ReturnType<typeof environment>>){
  const actor=e.actors[0];
  await e.send('provision one actual test atom for submission recovery',[getMintToInstruction({mint:e.setup.mint.address,token:actor.token.address,mintAuthority:e.payer,amount:1n})]);
  const cash=sdk.getParticipantDecoder().decode((await e.read(actor.participant))!).cash;
  const ix=await sdk.getDepositInstructionAsync({...e.a,owner:actor.owner,participant:actor.participant,quoteMint:e.setup.mint.address,userToken:actor.token.address,amount:1n});
  const {transaction}=await sdk.signInstructions(e.connection,actor.owner,[ix]),wire=Buffer.from(transaction.serialize()).toString('base64'),requestId='fault:lost-ack';
  const post=async(value:any)=>fetch('http://127.0.0.1:18081/v1/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  await e.stop('executor');
  for(const prefix of ['funding','keeper','maker','maker-sync','order','risk']){
    const reserved=prefix+':public-probe';assert.equal((await post({requestId:reserved,wire})).status,400);assert.equal(await e.runtime.queue.get(reserved),null);
  }
  const response=await post({requestId,wire});assert.equal(response.status,200);const submitted=await response.json() as {signature:string};
  // No executor/listener existed at commit, so startup must discover the durable row.
  assert.equal((await e.runtime.queue.get(requestId)).status,'pending');
  let dropped=false,persistedBeforeBroadcast=false;
  const proxy=createServer(async(req,res)=>{
    try{
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks).toString(),q=JSON.parse(body);
      const target=q.method==='sendTransaction'&&q.params[0]===wire;
      if(target){const row=(await e.runtime.store.pool.query('SELECT wire FROM service_intents WHERE run_id=$1 AND request_id=$2',[e.runId,requestId])).rows[0];persistedBeforeBroadcast=row?.wire===wire;assert(persistedBeforeBroadcast);}
      const upstream=await fetch(e.url,{method:'POST',headers:{'content-type':'application/json'},body}),text=await upstream.text();
      if(target&&!dropped){dropped=true;e.children.get('executor')?.kill('SIGKILL');res.destroy();return;}
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
    await wait(()=>e.runtime.queue.get(requestId),r=>r.status==='finalized','original signature reconciles after restart');
    const tx=await e.rpc.call('getTransaction',[submitted.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);assert.equal(tx.meta.err,null);e.txLog(requestId,submitted.signature,tx);
    assert(persistedBeforeBroadcast);assert.equal(sdk.getParticipantDecoder().decode((await e.read(actor.participant))!).cash,cash+1n);
    const different=await sdk.signInstructions(e.connection,actor.owner,[await sdk.getDepositInstructionAsync({...e.a,owner:actor.owner,participant:actor.participant,quoteMint:e.setup.mint.address,userToken:actor.token.address,amount:2n})]);
    assert.equal((await post({requestId,wire:Buffer.from(different.transaction.serialize()).toString('base64')})).status,400);
    return {fault:'missed-notification-lost-ack-executor-kill',status:'pass',signature:submitted.signature,elapsedMs:Date.now()-started,
      persistedBeforeBroadcast,actualFee:String(tx.meta.fee),cashBefore:cash.toString(),cashAfter:(cash+1n).toString(),differentBytesRejected:true,reservedWorkerIdentitiesRejected:true};
  }finally{
    await e.stop('executor');await new Promise<void>((resolve,reject)=>{proxy.close(error=>error?reject(error):resolve());proxy.closeAllConnections();});e.start('executor');
  }
}
