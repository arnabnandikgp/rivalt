import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {VersionedTransaction,type Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {LiquidityIndexer} from '../../packages/indexer/src/liquidity-indexer.js';
import type {WireRpc,WireSubscriptions} from './wire.js';

type Intent={request_id:string;signature:string;wire:string;status:string};
const runId='p55b2-application';
export async function groupedWorkerDriver(url:string,wsUrl:string,database:string,venue:string,anchor:string,
  payer:Keypair,rpc:WireRpc,ws:WireSubscriptions) {
  const indexer=new LiquidityIndexer({rpcUrl:url,wsUrl,databaseUrl:database,runId,venue,anchor,
    deployment:'grouped-credit',profile:'liquidity-execution-qualification',pageSize:128,maxRecoveryTransactions:1024});
  await indexer.open();
  let running=true, error:unknown;
  const indexing=(async()=>{
    while(running) { await indexer.cycle(); await delay(100); }
  })().catch(cause=>{error=cause;});
  const healthy=()=>{if(error)throw error;};
  const probes:{at:number;units:number;log?:string;error:unknown}[]=[];
  const serviceInstance=()=>{
    const service=new AccountRuntime(database,runId,url,4,'grouped-credit');
    const call=service.rpc.call.bind(service.rpc);
    service.rpc.call=async(method,params=[])=>{
      const result=await call(method,params);
      if(method==='simulateTransaction' && (params[1] as {sigVerify?:boolean}).sigVerify===false)
        probes.push({at:Date.now(),units:result.value.unitsConsumed,error:result.value.err,
          log:result.value.logs?.find((line:string)=>line.startsWith('Program log: coverage target='))});
      return result;
    };
    return service;
  };
  let service=serviceInstance();
  const subscriptions=new Map<string,number>();
  const turns:{at:number;ms:number;reason:string}[]=[];
  const intents=async()=>(await service.store.pool.query<Intent>('SELECT request_id,signature,wire,status FROM service_intents WHERE run_id=$1 ORDER BY request_id',[runId])).rows;
  async function dispatch() {
    for(const row of await intents())if(row.status==='pending'&&!subscriptions.has(row.signature))
      subscriptions.set(row.signature,await ws.call('signatureSubscribe',[row.signature,{commitment:'finalized'}]));
    await service.execute();
  }
  return {probes,turns,intents,healthy,
    async ready(){
      const deadline=Date.now()+600_000;
      while(!indexer.healthy){healthy();assert(Date.now()<deadline,'No fresh reconciled publication');await delay(100);}
      await service.open();
    },
    async restart(){await service.close();service=serviceInstance();await service.open();},
    async tick() {
      healthy();await dispatch();
      const at=Date.now();
      try {const result=await service.settle(payer);turns.push({at,ms:Date.now()-at,reason:result.reason});}
      catch(cause){if(!(cause instanceof Error && cause.message==='Reconciled projection unavailable'))throw cause;
        turns.push({at,ms:Date.now()-at,reason:'awaiting-reconciled-projection'});}
      await dispatch();
    },
    async drain() {
      const deadline=Date.now()+45_000;
      while((await intents()).some(row=>['pending','unresolved'].includes(row.status))){
        healthy();assert(Date.now()<deadline,'Pending worker original');await dispatch();await delay(100);
      }
      const receipts=[];
      for(const row of await intents()){
        const tx=await rpc.call('getTransaction',[row.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
        assert(tx && tx.transaction[0]===row.wire,'Finalized original bytes');
        assert.deepEqual((await ws.notification(subscriptions.get(row.signature)!)).params.result.value.err,tx.meta.err);
        const message=VersionedTransaction.deserialize(Buffer.from(row.wire,'base64')).message;
        const cleared=message.compiledInstructions.filter(ix=>message.staticAccountKeys[ix.programIdIndex].address===sdk.CLEARING_PROGRAM_ADDRESS);
        assert(!cleared.some(ix=>[sdk.CHECK_MARKET_BACKING_DISCRIMINATOR,sdk.INITIALIZE_MARKET_BACKING_DISCRIMINATOR].some(
          tag=>Buffer.from(ix.data.slice(0,8)).equals(Buffer.from(tag)))));
        const gain=cleared.find(ix=>Buffer.from(ix.data.slice(0,8)).equals(Buffer.from(sdk.PAY_ACCOUNT_GAIN_DISCRIMINATOR)));
        if(gain)assert.equal(gain.accountKeyIndexes.length,20);
        const budget=message.compiledInstructions.find(ix=>message.staticAccountKeys[ix.programIdIndex].address==='ComputeBudget111111111111111111111111111111' && ix.data[0]===2);
        const limit=message.version===1?message.transactionConfig?.computeUnitLimit:budget && Buffer.from(budget.data).readUInt32LE(1);
        assert(limit && limit>=tx.meta.computeUnitsConsumed);
        receipts.push({id:row.request_id,signature:row.signature,status:row.status,slot:tx.slot,error:tx.meta.err,
          cu:tx.meta.computeUnitsConsumed,limit,amount:gain?sdk.getPayAccountGainInstructionDataDecoder().decode(gain.data).amount:undefined,
          coverage:tx.meta.logMessages.find((line:string)=>line.startsWith('Program log: coverage target='))});
      }
      return receipts;
    },
    async close(){running=false;await indexing;try{await indexer.close();}finally{await service.close();}healthy();},
    metrics:indexer.metrics};
}
