import Fastify from 'fastify';
import {address} from '@solana/kit';
import {json} from '../../indexer/src/events.js';
import type {GroupRuntime} from './group-runtime.js';
import {GroupQuoteUnavailable} from './group-quote.js';

/** Execution service is separate from the finalized group read API. Exact signed
 * intents are persisted before broadcast; quoted instructions grant no authority. */
export function groupServiceApi(runtime:GroupRuntime){
  const app=Fastify({logger:false,bodyLimit:8192});app.setReplySerializer(json);
  app.setErrorHandler((error,_,reply)=>reply.code(400).send(error instanceof GroupQuoteUnavailable?
    {error:'QuoteUnavailable',code:error.code,diagnostic:error.diagnostic}:{error:'RequestUnavailableOrInvalid'}));
  app.get('/live',async()=>({live:true}));
  app.get('/ready',async(_,reply)=>{try{await runtime.snapshot();return {ready:true,schemaVersion:2};}catch{return reply.code(503).send({ready:false});}});
  app.post('/v2/quote',async request=>{
    const input=request.body as any;
    if(!input||![0,1].includes(input.marketIndex)||![0,1].includes(input.side)||typeof input.lots!=='string'||!/^[1-9][0-9]{0,3}$/.test(input.lots)||BigInt(input.lots)>4608n)throw new Error('Invalid group quote');
    const quote=await runtime.quote(address(input.actor),address(input.margin),input.marketIndex,input.side,BigInt(input.lots));
    if(!quote.available)return quote;
    return {...quote,instructions:quote.instructions.map(instruction=>({programAddress:instruction.programAddress,
      accounts:instruction.accounts?.map(account=>({address:account.address,role:account.role})),data:Buffer.from(instruction.data??[]).toString('base64')}))};
  });
  app.post('/v2/submit',async request=>{
    const input=request.body as any;if(!input||typeof input.wire!=='string')throw new Error('Invalid signed intent');
    const result=await runtime.submit(input.requestId,input.wire);
    return {requestId:result.request_id,signature:result.signature,status:result.status};
  });
  app.get<{Params:{id:string}}>('/v2/submissions/:id',async(request,reply)=>{
    const row=await runtime.queue.get(request.params.id);return row??reply.code(404).send({error:'UnknownSubmission'});
  });
  app.get('/v2/operators',async()=>{
    const snapshot=await runtime.snapshot();
    return {schemaVersion:2,group:snapshot.group,sequence:snapshot.state.sequence,slot:snapshot.slot,makers:snapshot.makers.map(maker=>({
      marketIndex:maker.marketIndex,makerId:maker.makerId,owner:maker.registrationState.owner,capital:maker.registrationState.capital,
      online:maker.online,approved:maker.approved,synchronized:maker.synchronized,quarantined:maker.registrationState.quarantined,
      cash:maker.capital.cash,positions:maker.capital.positions,quoteEpoch:maker.state.quoteEpoch,expirySlot:maker.state.expirySlot})),
      budgets:(await runtime.store.pool.query('SELECT name,wallet,cap,committed,spent FROM service_budgets WHERE run_id=$1 ORDER BY name',[runtime.runId])).rows};
  });
  return app;
}
