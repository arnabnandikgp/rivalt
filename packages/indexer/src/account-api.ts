import Fastify from 'fastify';
import type {LiquidityIndexer} from './liquidity-indexer.js';

const publicKey={type:'string',pattern:'^[1-9A-HJ-NP-Za-km-z]{32,44}$'} as const;
/** Finalized accounting facts. Risk/transaction admission requires the direct SDK
 * and a current chain simulation; an indexed cash amount is not exit permission. */
export function accountApi(indexer:LiquidityIndexer) {
  const version=4,prefix=`/v${version}`;
  const app=Fastify({logger:false});
  const healthy=async()=>{
    const row=await indexer.store.snapshot();
    return Boolean(indexer.healthy&&!indexer.ws?.error&&row.synced_at&&Date.now()-row.synced_at.getTime()<10000);
  };
  app.get('/live',async()=>({alive:true}));
  app.get('/ready',async(_,reply)=>{const ready=await healthy();return reply.code(ready?200:503).send({ready,schemaVersion:version,runId:indexer.config.runId});});
  app.addHook('preHandler',async(request,reply)=>{
    if(request.url.startsWith(`${prefix}/`)&&!await healthy())return reply.code(503).send({error:'ProjectionUnavailable'});
  });
  const envelope=(row:Awaited<ReturnType<typeof indexer.store.snapshot>>)=>({schemaVersion:version,accountSchema:7,venue:row.binding.venue,
    deployment:{anchor:row.binding.anchor,genesis:row.binding.genesis,domain:row.binding.domain,profile:row.binding.profile,artifactSet:row.binding.artifactSet},
    asOf:{commitment:'finalized',cursor:row.state.sequence,cursorScope:'local-payload-stream',blockhash:row.checkpoint,slot:row.checkpoint_slot},
    units:{cash:'six-decimal collateral atoms',scaled:'1e9',price:'collateral atoms/lot'}});
  app.get(`${prefix}/venue`,async()=>{const row=await indexer.store.snapshot();return {...envelope(row),state:row.state.venue,custody:row.state.custody,
    safety:row.state.safety,markets:row.state.markets,ledgers:row.state.ledgers,makers:row.state.liquidity!.makers,resolution:row.state.resolution,
    ...(version===4?{liquidity:row.state.liquidity,fundingTrust:'restricted-publisher-attestation',makerScope:'internal-reference-makers'}:{})};});
  app.get<{Params:{owner:string}}>(`${prefix}/portfolios/:owner`,{schema:{params:{type:'object',required:['owner'],additionalProperties:false,properties:{owner:publicKey}}}},async request=>{
    const row=await indexer.store.snapshot();return {...envelope(row),portfolios:Object.entries(row.state.portfolios).filter(([,portfolio])=>portfolio.owner===request.params.owner)
      .map(([key,portfolio])=>({address:key,...portfolio,accounts:Object.entries(row.state.roots).filter(([,root])=>root.portfolio===key).map(([key,root])=>({address:key,...root}))}))};
  });
  app.get<{Params:{margin:string}}>(`${prefix}/accounts/:margin`,{schema:{params:{type:'object',required:['margin'],additionalProperties:false,properties:{margin:publicKey}}}},async(request,reply)=>{
    const row=await indexer.store.snapshot(),account=row.state.roots[request.params.margin];
    if(!account)return reply.code(404).send({error:'UnknownMarginAccount'});
    return {...envelope(row),account,fundedCash:account.cash,positiveUnpaidMarginCredit:'0',correlationDiscount:'0',
      admission:'RequiresCurrentAccountChecksAndSimulation',resolution:row.state.safety?.mode===2?{stage:row.state.resolution!.stage,
        row:row.state.resolution!.rows[account.id]??null}:null};
  });
  for(const endpoint of ['events','trades'] as const)app.get<{Querystring:{after?:string;limit?:number;latest?:boolean}}>(`${prefix}/${endpoint}`,
    {schema:{querystring:{type:'object',additionalProperties:false,properties:{latest:{type:'boolean'},after:{type:'string',pattern:'^(0|[1-9][0-9]{0,19})$'},limit:{type:'integer',minimum:1,maximum:100}}}}},async(request,reply)=>{
      if(request.query.latest&&request.query.after!==undefined)return reply.code(400).send({error:'InvalidRequest'});
      const client=await indexer.store.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const row=(await client.query('SELECT * FROM runs WHERE run_id=$1',[indexer.config.runId])).rows[0];
        const result=await client.query(`SELECT sequence::text,signature,slot::text,block_time::text,kind,payload FROM events
          WHERE run_id=$1 AND sequence>$2 ${endpoint==='trades'?`AND kind='${version===4?'LiquidityRouteExecutedV4':'AccountRouteExecutedV3'}'`:''}
          ORDER BY events.sequence ${request.query.latest?'DESC':'ASC'} LIMIT $3`,[indexer.config.runId,request.query.after??'0',request.query.limit??50]);
        await client.query('COMMIT');const items=request.query.latest?result.rows.reverse():result.rows;
        return {...envelope(row),items,next:items.at(-1)?.sequence??null};
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    });
  app.setErrorHandler((error,_,reply)=>{
    if(error&&typeof error==='object'&&'validation' in error)return reply.code(400).send({error:'InvalidRequest'});
    return reply.code(503).send({error:'ReadUnavailable'});
  });
  return app;
}
