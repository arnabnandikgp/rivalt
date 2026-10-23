import Fastify from 'fastify';
import {oracleMode,effectiveFunding,orderRemaining,orderTriggered} from '@rivalt/sdk';
import type { Indexer } from './index.js';
import { balance } from './projection.js';
import { integer } from './rpc.js';

const cursorSchema = { type:'object', additionalProperties:false, properties:{ after:{type:'string',pattern:'^(0|[1-9][0-9]{0,19})$'},limit:{type:'integer',minimum:1,maximum:100} } } as const;
export function api(indexer: Indexer) {
  const app = Fastify({ logger: { redact:['req.headers.authorization'] } });
  app.get('/live', async () => ({ alive:true }));
  app.get('/ready', async (_, reply) => {
    const row = await indexer.store.snapshot();
    const ready = indexer.healthy && !indexer.ws?.error && row.synced_at && Date.now()-row.synced_at.getTime()<10_000;
    return reply.code(ready ? 200 : 503).send({ready:Boolean(ready),runId:indexer.config.runId,sequence:row.state.sequence,error:row.error});
  });
  app.get('/metrics', async (_,reply) => reply.type('text/plain; version=0.0.4').send(
    Object.entries(indexer.metrics).map(([key,value])=>`# TYPE rivalt_indexer_${key}_total counter\nrivalt_indexer_${key}_total ${value}\n`).join('')+
    `# TYPE rivalt_indexer_ready gauge\nrivalt_indexer_ready ${indexer.healthy&&!indexer.ws?.error?1:0}\n`));
  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/v1/')) return;
    const row = await indexer.store.snapshot();
    if (!indexer.healthy || indexer.ws?.error || !row.synced_at || Date.now()-row.synced_at.getTime()>=10_000)
      return reply.code(503).send({error:'ProjectionUnavailable',reason:row.error,sequence:row.state.sequence});
  });
  const envelope = (row: Awaited<ReturnType<typeof indexer.store.snapshot>>) => ({schemaVersion:1,runId:indexer.config.runId,
    market:indexer.config.market,deployment:{anchor:row.binding.anchor,genesis:row.binding.genesis,domain:row.binding.domain},asOf:{commitment:'finalized',sequence:row.state.sequence,signature:row.checkpoint,slot:row.checkpoint_slot},
    units:{cash:'collateral atoms (1e6/token)',lots:'1e6/BTC',price:'collateral atoms/lot',scaled:'1e9'},
    capabilities:{routes:[1,2].includes(row.state.market?.mode)&&!row.state.market?.paused ? indexer.deployment.chain === 'solana:devnet' ? 'devnet-test-profile' : 'local-test-profile' : 'disabled',funding:row.state.market?.mode===2,orders:row.state.market?.mode===2,settlement:[1,2].includes(row.state.market?.mode)&&!row.state.market?.paused,resolution:row.state.market?.mode===3}});
  app.get('/v1/resolution',async()=>{const row=await indexer.store.snapshot();return {...envelope(row),frozen:row.state.market?.mode===3,resolution:row.state.resolution??null};});
  app.get('/v1/market', async () => {
    const row = await indexer.store.snapshot();
    const slot = integer(await indexer.rpc.call('getSlot',[{commitment:'processed'}]));
    const risk = row.state.risk;
    const now=BigInt(Math.floor(Date.now()/1000)),mode=oracleMode(row.state.market,risk,now,BigInt(slot));
    return {...envelope(row),state:row.state.market,risk,makers:row.state.makers,evaluatedAtSlot:String(slot),sourceMode:mode,clockSource:'host-wall-clock-preview',fundingIndexScaled:effectiveFunding(row.state.market,risk,now,BigInt(slot)).toString(),
      valuationStatus:row.state.market?.mode===3?'FrozenResolution':risk ? BigInt(slot)>=BigInt(risk.validFrom)&&BigInt(slot)<BigInt(risk.validUntil) ? 'FreshTestObservation':'ExpiredTestObservation':'NoObservation'};
  });
  app.get<{Params:{participant:string}}>('/v1/balances/:participant', {
    schema:{params:{type:'object',required:['participant'],additionalProperties:false,properties:{participant:{type:'string',pattern:'^[1-9A-HJ-NP-Za-km-z]{32,44}$'}}}},
  }, async (request, reply) => {
    const row = await indexer.store.snapshot(), p = row.state.participants[request.params.participant];
    if (!p) return reply.code(404).send({error:'UnknownParticipant'});
    const slot = integer(await indexer.rpc.call('getSlot',[{commitment:'processed'}]));
    return {...envelope(row),participant:request.params.participant,...balance(p,row.state,BigInt(slot))};
  });
  app.get<{Querystring:{after?:string;limit?:number;participant?:string}}>('/v1/orders',{schema:{querystring:{...cursorSchema,properties:{...cursorSchema.properties,participant:{type:'string',pattern:'^[1-9A-HJ-NP-Za-km-z]{32,44}$'}}}}},async request=>{
    const row=await indexer.store.snapshot(),slot=BigInt(integer(await indexer.rpc.call('getSlot',[{commitment:'finalized'}]))),risk=row.state.risk;
    const supported=row.state.market?.mode===2,mode=oracleMode(row.state.market,risk,BigInt(Math.floor(Date.now()/1000)),slot);
    const orders=Object.entries(row.state.participants).flatMap(([participant,p])=>p.book.orders.map((o:any,i:number)=>({participant,slotIndex:i,cursor:String(p.id*4+i+1),...o,
      effectiveRemaining:orderRemaining(p,o,BigInt(row.state.market.termsEpoch),slot).toString(),
      triggerEligible:orderRemaining(p,o,BigInt(row.state.market.termsEpoch),slot)>0n&&(mode==='Normal'||(mode==='Degraded'&&o.reduceOnly))&&orderTriggered(o,BigInt(risk?.referencePrice??0),slot),
      group:BigInt(o.groupId)>0n?p.book.groups.find((g:any)=>g.id===o.groupId):null})))
      .filter(o=>o.id!=='0'&&BigInt(o.cursor)>BigInt(request.query.after??0)&&(!request.query.participant||o.participant===request.query.participant))
      .sort((a,b)=>Number(a.cursor)-Number(b.cursor)).slice(0,request.query.limit??50);
    return {...envelope(row),supported,sourceMode:mode,orders,next:orders.at(-1)?.cursor??null,history:'/v1/events',evaluatedAtSlot:slot.toString()};
  });
  app.get<{Querystring:{from:number;to:number}}>('/v1/candles', {schema:{querystring:{type:'object',required:['from','to'],additionalProperties:false,
    properties:{from:{type:'integer',minimum:0,maximum:9007199254740991},to:{type:'integer',minimum:0,maximum:9007199254740991}}}}}, async(request,reply)=>{
    const {from,to}=request.query;
    if(to<=from||to-from>86400)return reply.code(400).send({error:'WindowMustBeAtMostOneDay'});
    const client=await indexer.store.pool.connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const row=(await client.query('SELECT * FROM runs WHERE run_id=$1',[indexer.config.runId])).rows[0];
      const fills=(await client.query(`SELECT sequence::text,payload,block_time::text FROM events WHERE run_id=$1 AND kind='route'
        AND (block_time IS NULL OR (block_time >= $2 AND block_time < $3)) ORDER BY events.sequence`,[indexer.config.runId,from,to])).rows;
      const buckets=new Map<number,any>();let unplacedTrades=0;
      for(const fill of fills){
        if(fill.block_time===null){unplacedTrades++;continue;}
        const time=Math.floor(Number(fill.block_time)/60)*60,e=fill.payload;
        const price={numerator:e.grossQuote,denominator:e.lots};
        let c=buckets.get(time);
        if(!c){c={start:String(time),open:price,high:price,low:price,close:price,volumeLots:'0',volumeQuote:'0',trades:0};buckets.set(time,c);}
        const cmp=(x:any,y:any)=>BigInt(x.numerator)*BigInt(y.denominator)-BigInt(y.numerator)*BigInt(x.denominator);
        if(cmp(price,c.high)>0n)c.high=price;if(cmp(price,c.low)<0n)c.low=price;c.close=price;
        c.volumeLots=(BigInt(c.volumeLots)+BigInt(e.lots)).toString();c.volumeQuote=(BigInt(c.volumeQuote)+BigInt(e.grossQuote)).toString();c.trades++;
      }
      await client.query('COMMIT');
      return {...envelope(row),source:'actual-aggregate-route-fills',intervalSeconds:60,from:String(from),to:String(to),
        missingBuckets:'no-trades; never forward-filled',unplacedTrades,items:[...buckets.values()].sort((a,b)=>Number(a.start)-Number(b.start))};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  });
  for (const endpoint of ['trades','events'] as const) app.get<{Querystring:{after?:string;limit?:number;latest?:boolean}}>(`/v1/${endpoint}`,{schema:{querystring:{...cursorSchema,properties:{...cursorSchema.properties,latest:{type:'boolean'}}}}},async (request,reply) => {
    if(request.query.latest&&request.query.after!==undefined)return reply.code(400).send({error:'LatestCannotUseAfter'});
    // Snapshot and rows share one SQL snapshot, even while a backfill commits.
    const client = await indexer.store.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const row = (await client.query('SELECT * FROM runs WHERE run_id=$1',[indexer.config.runId])).rows[0];
      const result = await client.query(`SELECT sequence::text,signature,slot::text,block_time::text,payload FROM events
        WHERE run_id=$1 AND sequence>$2 ${endpoint==='trades' ? "AND kind='route'" : ''} ORDER BY events.sequence ${request.query.latest?'DESC':'ASC'} LIMIT $3`,
      [indexer.config.runId,request.query.after??'0',request.query.limit??50]);
      await client.query('COMMIT');
      return {...envelope(row),items:request.query.latest?result.rows.reverse():result.rows,next:request.query.latest?null:result.rows.at(-1)?.sequence ?? null};
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  });
  app.setErrorHandler((error, _, reply) => {
    if (error && typeof error === 'object' && 'validation' in error) return reply.code(400).send({error:'InvalidRequest'});
    // Database URLs and transport errors never reach callers/logs.
    app.log.error({code:'ReadFailed'},'read request failed'); return reply.code(503).send({error:'ReadUnavailable'});
  });
  return app;
}
