import Fastify from 'fastify';
import {address} from '@solana/kit';
import {groupBalanceView} from '@rivalt/sdk';
import type {GroupIndexer} from './group-indexer.js';
import {integer} from './rpc.js';

const publicKey = {type:'string',pattern:'^[1-9A-HJ-NP-Za-km-z]{32,44}$'} as const;
const clockAddress = address('SysvarC1ock11111111111111111111111111111111');
const cursor = {type:'object',additionalProperties:false,properties:{after:{type:'string',pattern:'^(0|[1-9][0-9]{0,19})$'},limit:{type:'integer',minimum:1,maximum:100},latest:{type:'boolean'}}} as const;
/** Schema-2 read surface. Confirmed/host-clock hints cannot rewrite the finalized
 * projection; current risk views disclose their separate on-chain Clock input. */
export function groupApi(indexer: GroupIndexer) {
  const app = Fastify({logger:false});
  const healthy = async () => {
    const row = await indexer.store.snapshot();
    return Boolean(indexer.healthy && !indexer.ws?.error && row.synced_at && Date.now()-row.synced_at.getTime()<10000);
  };
  app.get('/live',async () => ({alive:true}));
  app.get('/ready',async (_,reply) => {
    const ready = await healthy(); return reply.code(ready ? 200 : 503).send({ready,runId:indexer.config.runId,schemaVersion:2});
  });
  app.addHook('preHandler',async (request,reply) => {
    if (request.url.startsWith('/v2/') && !await healthy()) return reply.code(503).send({error:'ProjectionUnavailable'});
  });
  const envelope = (row: Awaited<ReturnType<typeof indexer.store.snapshot>>) => ({schemaVersion:2,runId:indexer.config.runId,group:row.binding.group,
    deployment:{anchor:row.binding.anchor,genesis:row.binding.genesis,domain:row.binding.domain,profile:row.binding.profile},
    asOf:{commitment:'finalized',sequence:row.state.sequence,signature:row.checkpoint,slot:row.checkpoint_slot},
    units:{cash:'six-decimal collateral atoms',scaled:'1e9',markets:Object.values(row.state.markets).map(market => ({index:market.index,lotsPerUnit:market.lotsPerUnit,price:'collateral atoms/lot'}))}});
  app.get('/v2/group',async () => {
    const row = await indexer.store.snapshot();
    return {...envelope(row),state:row.state.group,markets:row.state.markets,makers:row.state.makers,resolution:row.state.resolution};
  });
  app.get<{Params:{owner:string}}>('/v2/portfolios/:owner',{schema:{params:{type:'object',required:['owner'],additionalProperties:false,properties:{owner:publicKey}}}},async request => {
    const row = await indexer.store.snapshot();
    return {...envelope(row),portfolios:Object.entries(row.state.portfolios).filter(([,portfolio]) => portfolio.owner === request.params.owner)
      .map(([key,portfolio]) => ({address:key,...portfolio,accounts:Object.entries(row.state.roots).filter(([,root]) => root.portfolio === key).map(([margin,root]) => ({address:margin,...root}))}))};
  });
  app.get<{Params:{margin:string}}>('/v2/accounts/:margin',{schema:{params:{type:'object',required:['margin'],additionalProperties:false,properties:{margin:publicKey}}}},async (request,reply) => {
    const row = await indexer.store.snapshot(), root = row.state.roots[request.params.margin];
    if (!root) return reply.code(404).send({error:'UnknownMarginAccount'});
    const response = await indexer.rpc.call('getAccountInfo',[clockAddress,
      {encoding:'base64',commitment:'finalized',...(row.checkpoint_slot ? {minContextSlot:integer(Number(row.checkpoint_slot))} : {})}]);
    integer(response.context.slot);
    if (response.value?.owner !== 'Sysvar1111111111111111111111111111111111111') throw new Error('Clock owner');
    const clock = Buffer.from(response.value.data[0],'base64');
    if (clock.length !== 40) throw new Error('Clock shape');
    const markets = row.state.group!.markets.map(key => row.state.markets[key]);
    const view = groupBalanceView(root,row.state.group!,markets,clock.readBigInt64LE(32),clock.readBigUInt64LE(0));
    return {...envelope(row),margin:request.params.margin,account:root,view,clockSource:'finalized-rpc-sysvar',clockContextSlot:String(response.context.slot),
      resolution:row.state.group?.mode === 3 ? {header:row.state.resolution!.header,row:row.state.resolution!.rows[root.id]} : null};
  });
  for (const endpoint of ['events','trades'] as const) app.get<{Querystring:{after?:string;limit?:number;latest?:boolean}}>(`/v2/${endpoint}`,{schema:{querystring:cursor}},async (request,reply) => {
    if(request.query.latest&&request.query.after!==undefined)return reply.code(400).send({error:'ChooseLatestOrCursor'});
    const client = await indexer.store.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const row = (await client.query('SELECT * FROM runs WHERE run_id=$1',[indexer.config.runId])).rows[0];
      const result = await client.query(`SELECT sequence::text,signature,slot::text,block_time::text,kind,payload FROM events
        WHERE run_id=$1 AND sequence>$2 ${endpoint === 'trades' ? "AND kind IN ('group-route','margin-route')" : ''}
        ORDER BY events.sequence ${request.query.latest?'DESC':'ASC'} LIMIT $3`,[indexer.config.runId,request.query.after ?? '0',request.query.limit ?? 50]);
      await client.query('COMMIT');
      const items=request.query.latest?result.rows.reverse():result.rows;
      return {...envelope(row),items,next:items.at(-1)?.sequence ?? null};
    } catch (error) {await client.query('ROLLBACK'); throw error;} finally {client.release();}
  });
  app.setErrorHandler((error,_,reply) => {
    if (error && typeof error === 'object' && 'validation' in error) return reply.code(400).send({error:'InvalidRequest'});
    return reply.code(503).send({error:'ReadUnavailable'});
  });
  return app;
}
