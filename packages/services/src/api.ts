import Fastify from 'fastify';
import * as sdk from '@rivalt/sdk';
import { address } from '@solana/kit';
import { Runtime, QuoteUnavailable } from './runtime.js';
import { userAuthority } from './queue.js';
import { publicRequestId } from './quote-window.js';
import { json } from '../../indexer/src/events.js';

export function api(runtime:Runtime){
  const app=Fastify({logger:false,bodyLimit:8192});
  app.setReplySerializer(json);
  app.setErrorHandler((error,_request,reply)=>reply.code(400).send(error instanceof QuoteUnavailable?{error:error.message,code:error.code}:{error:'Request unavailable or invalid; no implied execution'}));
  app.get('/live',async()=>({live:true}));
  app.get('/ready',async(_q,reply)=>{try{await runtime.snapshot();return {ready:true};}catch{return reply.code(503).send({ready:false});}});
  app.post('/v1/quote',async(request)=>{
    const b=request.body as any;
    if(!b || ![0,1].includes(b.side) || typeof b.lots!=='string' || !/^[1-9][0-9]{0,3}$/.test(b.lots))throw new Error('Quote bounds');
    return runtime.quote(address(b.owner),b.side,BigInt(b.lots));
  });
  app.post('/v1/submit',async(request)=>{
    const b=request.body as any,requestId=publicRequestId(b?.requestId),binding=await runtime.environment();
    const authority=userAuthority(b?.wire,binding.market,runtime.deployment.clearing);
    const r=await runtime.queue.put(requestId,b.wire,authority);
    return {requestId:r.request_id,signature:r.signature,status:r.status};
  });
  app.get<{Params:{id:string}}>('/v1/submissions/:id',async(request,reply)=>{
    const r=await runtime.queue.get(request.params.id);return r??reply.code(404).send({error:'Unknown submission'});
  });
  app.get('/v1/resolution',async()=>{const s=await runtime.snapshot();return{slot:s.slot,sequence:s.m.sequence,frozen:s.m.mode===3,resolution:s.resolutionState};});
  app.get('/v1/orders',async()=>{
    const s=await runtime.snapshot();
    return {slot:s.slot,sequence:s.m.sequence,sourceMode:s.sourceMode,orders:Object.entries(s.participants).flatMap(([participant,p])=>p.book.orders.filter(o=>o.id>0n).map(o=>({participant,...o,
      effectiveRemaining:sdk.orderRemaining(p,o,s.m.termsEpoch,s.slot),triggerEligible:sdk.orderRemaining(p,o,s.m.termsEpoch,s.slot)>0n&&(s.sourceMode==='Normal'||(s.sourceMode==='Degraded'&&o.reduceOnly))&&sdk.orderTriggered(o,s.risk.referencePrice,s.slot),
      group:o.groupId>0n?p.book.groups.find(g=>g.id===o.groupId):null})))};
  });
  app.get('/v1/operators',async()=>{
    const s=await runtime.snapshot();
    return {slot:s.slot,makers:s.makers.map(x=>({makerId:x.r.makerId,owner:x.r.owner,online:x.online,approved:x.approved,quarantined:x.r.quarantined,cash:x.balance.cash,lots:x.balance.lots,quoteEpoch:x.state.quoteEpoch,expirySlot:x.state.expirySlot})),
      budgets:(await runtime.store.pool.query('SELECT name,wallet,cap,committed,spent FROM service_budgets WHERE run_id=$1 ORDER BY name',[runtime.runId])).rows};
  });
  return app;
}
