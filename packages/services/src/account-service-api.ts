import Fastify from 'fastify';
import {address} from '@solana/kit';
import {json} from '../../indexer/src/events.js';
import type {AccountRuntime} from './account-runtime.js';
import {AccountQuoteUnavailable} from './account-runtime.js';

/** Execution service is separate from the finalized account read API. Exact signed
 * intents are persisted before broadcast; quoted instructions grant no authority. */
export function accountServiceApi(runtime:AccountRuntime){
  const prefix=`/v${runtime.profile}`;
  const app=Fastify({logger:false,bodyLimit:8192});app.setReplySerializer(json);
  app.setErrorHandler((error,_,reply)=>reply.code(400).send(error instanceof AccountQuoteUnavailable?
    {error:'QuoteUnavailable',code:error.code,diagnostic:error.diagnostic}:{error:'RequestUnavailableOrInvalid'}));
  app.get('/live',async()=>({live:true}));
  app.get('/ready',async(_,reply)=>{try{await runtime.snapshot();return {ready:true,schemaVersion:runtime.profile};}catch{return reply.code(503).send({ready:false});}});
  app.post(`${prefix}/quote`,async request=>{
    const input=request.body as any;
    if(!input||![0,1].includes(input.marketIndex)||![0,1].includes(input.side)||typeof input.lots!=='string'||!/^[1-9][0-9]{0,3}$/.test(input.lots)||BigInt(input.lots)>4608n)throw new Error('Invalid account quote');
    const quote=await runtime.quote(address(input.actor),address(input.margin),input.marketIndex,input.side,BigInt(input.lots));
    if(!quote.available)return quote;
    return {...quote,instructions:quote.instructions.map(instruction=>({programAddress:instruction.programAddress,
      accounts:instruction.accounts?.map(account=>({address:account.address,role:account.role})),data:Buffer.from(instruction.data??[]).toString('base64')}))};
  });
  app.post(`${prefix}/submit`,async request=>{
    const input=request.body as any;if(!input||typeof input.wire!=='string')throw new Error('Invalid signed intent');
    const result=await runtime.submit(input.requestId,input.wire);
    return {requestId:result.request_id,signature:result.signature,status:result.status};
  });
  app.get<{Params:{id:string}}>(`${prefix}/submissions/:id`,async(request,reply)=>{
    const row=await runtime.queue.get(request.params.id);return row??reply.code(404).send({error:'UnknownSubmission'});
  });
  app.get(`${prefix}/operators`,async()=>({schemaVersion:runtime.profile,makers:await runtime.heartbeats(),
    budgets:(await runtime.store.pool.query('SELECT name,wallet,cap,committed,spent FROM service_budgets WHERE run_id=$1 ORDER BY name',[runtime.runId])).rows}));
  return app;
}
