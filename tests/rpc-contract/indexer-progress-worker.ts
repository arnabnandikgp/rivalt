// Real subprocess death at SQL boundaries; no fabricated financial effects.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LiquidityIndexer} from '../../packages/indexer/src/liquidity-indexer.js';

const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const mode=process.argv[3];
const indexer=new LiquidityIndexer({...config,databaseUrl:process.env.RIVALT_DATABASE_URL!});
const stop=async(boundary:string)=>{
  process.send?.({boundary,checkpoint:(await indexer.store.snapshot()).checkpoint_slot});
  await new Promise(()=>{}); // Supervisor must SIGKILL, not graceful close.
};
try {
  await indexer.open();
  const commit=indexer.store.commit.bind(indexer.store);
  indexer.store.commit=async(...args)=>{
    const relevant=args[1].length>0;
    if(relevant&&mode==='before')await stop(mode);
    // Pause after every SQL write but before COMMIT, proving rollback when the
    // process dies with an actual open PostgreSQL transaction.
    const connect=indexer.store.pool.connect.bind(indexer.store.pool);
    if(relevant&&mode==='during')indexer.store.pool.connect=((callback?:any)=>{
      // pg.Pool.query uses connect(callback); preserve that overload for the
      // independent checkpoint read while the writer is paused before COMMIT.
      if(callback)return connect(callback);
      return connect().then(client=>{const query=client.query.bind(client);
      client.query=(async(...queryArgs:any[])=>{
        if(queryArgs[0]==='COMMIT')await stop(mode);
        return (query as any)(...queryArgs);
      }) as typeof client.query;
      return client;});
    }) as typeof indexer.store.pool.connect;
    await commit(...args);
    if(relevant&&mode==='after')await stop(mode);
  };
  for(let cycle=0;cycle<100;cycle++)await indexer.cycle();
  assert.fail('Fault boundary never reached');
}catch(error){process.send?.({error:String(error)});process.exitCode=1;}
finally{await indexer.close();}
