import {expect,it,vi} from 'vitest';
import {FinalizedIndexer,MAX_RECONCILIATION_CATCHUPS,MAX_HISTORY_READ_RESTARTS} from './finalized-indexer.js';
import {compareReconciliationSequence,ReconciliationAhead} from './reconciliation-progress.js';
import {hash,type JournalEvent} from './events.js';
import type {JournalBinding,JournalStore} from './store.js';

type State={sequence:string;cash:number};
function fixture(checkpoint:string|null='tx1',limit=20){
  const binding:JournalBinding={schema:1,genesis:'local',domain:'test',anchor:'tx1',anchorHash:hash({signatures:['tx1']}),program:'test'};
  const state:State={sequence:checkpoint?'1':'0',cash:checkpoint?7:0};
  const store={snapshot:vi.fn(async()=>({binding,state,checkpoint})),observe:vi.fn(async()=>{}),health:vi.fn(async()=>{}),commit:vi.fn(async(..._args:Parameters<JournalStore<State,JournalBinding,JournalEvent>['commit']>)=>{}),
    pool:{query:vi.fn(async()=>({rows:[]}))},projection:{project(candidate:State,event:JournalEvent){
      if(BigInt(event.data.sequence)!==BigInt(candidate.sequence)+1n)throw new Error('Event gap or duplicate');
      candidate.sequence=event.data.sequence;candidate.cash+=7;
    }}};
  class Indexer extends FinalizedIndexer<State,JournalBinding,JournalEvent>{
    protected async initializeBinding(){return binding;}
    protected decodeTransaction(signature:string,transaction:any){return [{signature,data:{sequence:String(transaction.slot)}} as JournalEvent];}
    async reconcile(_snapshot?:{state:State;binding:JournalBinding}){}
  }
  const indexer=new Indexer({rpcUrl:'http://127.0.0.1:1',wsUrl:'ws://127.0.0.1:2',databaseUrl:'unused',runId:'test',anchor:'tx1',maxRecoveryTransactions:limit,pageSize:2},store as unknown as JournalStore<State,JournalBinding,JournalEvent>);
  indexer.ws={buffer:[]} as any;
  let head=2;
  const rpc=vi.spyOn(indexer.rpc,'call').mockImplementation(async(method,params:any=[])=>{
    if(method==='getGenesisHash')return 'local';
    if(method==='getTransaction')return {slot:Number(params[0].slice(2)),meta:{err:null},transaction:{signatures:[params[0]]}};
    if(method==='getSignaturesForAddress'){
      const start=params[1].before?Number(params[1].before.slice(2))-1:head;
      return Array.from({length:Math.min(2,start)},(_,index)=>({signature:`tx${start-index}`,slot:start-index,err:null}));
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  return {indexer,store,rpc,state,setHead:(value:number)=>{head=value;}};
}
it('extends only the newly finalized tail and commits one independently expected candidate',async()=>{
  const test=fixture();let calls=0;
  test.indexer.reconcile=async snapshot=>{
    if(calls++===0){expect(snapshot!.state).toEqual({sequence:'2',cash:14});test.setHead(4);compareReconciliationSequence(4n,2n);}
    expect(snapshot!.state).toEqual({sequence:'4',cash:28});
  };
  await test.indexer.cycle();
  expect(test.indexer.metrics.catchups).toBe(1);expect(test.indexer.healthy).toBe(true);
  expect(test.store.commit).toHaveBeenCalledTimes(1);
  expect(test.store.commit.mock.calls[0]).toEqual([
    expect.arrayContaining([expect.objectContaining({signature:'tx2'}),expect.objectContaining({signature:'tx3'}),expect.objectContaining({signature:'tx4'})]),
    expect.any(Array),{signature:'tx4',slot:4,err:null},'tx1']);
  expect(test.rpc.mock.calls.filter(([method,params])=>method==='getTransaction'&&(params as any)[0]==='tx2')).toHaveLength(1);
  expect(test.state).toEqual({sequence:'1',cash:7});
});
it('includes the initialization anchor exactly once on a fresh journal',async()=>{
  const test=fixture(null);test.indexer.reconcile=async snapshot=>{expect(snapshot!.state).toEqual({sequence:'2',cash:14});};
  await test.indexer.cycle();expect(test.store.commit.mock.calls[0][0]).toHaveLength(2);
});
for(const error of [new Error('Economic mismatch'),(()=>{try{compareReconciliationSequence(1n,2n);}catch(error){return error as Error;}throw new Error('Expected failure');})()])
  it(`does not retry or commit ${error.message}`,async()=>{
    const test=fixture();test.indexer.reconcile=async()=>{throw error;};
    await expect(test.indexer.cycle()).rejects.toThrow(error.message);
    expect(test.indexer.metrics.catchups).toBe(0);expect(test.indexer.metrics.historyRestarts).toBe(0);expect(test.store.commit).not.toHaveBeenCalled();expect(test.indexer.healthy).toBe(false);
  });
it('bounds continuous advances without exposing an unreconciled checkpoint',async()=>{
  const test=fixture();let observed=2n;
  test.indexer.reconcile=async()=>{test.setHead(Number(++observed));throw new ReconciliationAhead(observed-1n,observed);};
  await expect(test.indexer.cycle()).rejects.toThrow(ReconciliationAhead);
  expect(test.indexer.metrics.catchups).toBe(MAX_RECONCILIATION_CATCHUPS);
  expect(test.indexer.metrics.fetched).toBe(4);expect(test.store.commit).not.toHaveBeenCalled();expect(test.indexer.healthy).toBe(false);
});
it('does not interpret a missing finalized tail as success',async()=>{
  const test=fixture();test.indexer.reconcile=async()=>{throw new ReconciliationAhead(2n,3n);};
  await expect(test.indexer.cycle()).rejects.toThrow(ReconciliationAhead);
  expect(test.indexer.metrics.fetched).toBe(1);expect(test.store.commit).not.toHaveBeenCalled();
});
it('keeps the history bound cumulative across catch-up extensions',async()=>{
  const test=fixture('tx1',2);test.indexer.reconcile=async()=>{test.setHead(4);throw new ReconciliationAhead(2n,4n);};
  await expect(test.indexer.cycle()).rejects.toThrow(/batch bound/);expect(test.store.commit).not.toHaveBeenCalled();
});

for(const persistent of [false,true])it(`${persistent?'bounds persistent':'discards transient'} overlapping finalized history pages`,async()=>{
  const test=fixture();const original=test.rpc.getMockImplementation()!;let reads=0;
  test.rpc.mockImplementation(async(method,params:any=[])=>{
    if(method==='getSignaturesForAddress'&&(persistent||reads++===0))return [
      {signature:'tx2',slot:2,err:null},{signature:'tx2',slot:2,err:null},
    ];
    return original(method,params);
  });
  if(persistent) {
    await expect(test.indexer.cycle()).rejects.toThrow(/History pagination repeated/);
    expect(test.indexer.metrics.historyRestarts).toBe(MAX_HISTORY_READ_RESTARTS);
    expect(test.store.commit).not.toHaveBeenCalled();expect(test.indexer.healthy).toBe(false);
  } else {
    await test.indexer.cycle();expect(test.indexer.metrics.historyRestarts).toBe(1);
    expect(test.store.commit).toHaveBeenCalledTimes(1);expect(test.indexer.healthy).toBe(true);
    expect(test.store.commit.mock.calls[0][0].map(row=>row.signature)).toEqual(['tx2']);
  }
});
for(const persistent of [false,true])it(`${persistent?'rejects persistent':'rescans transient'} missing critical history without retaining a partial candidate`,async()=>{
  const test=fixture();test.setHead(4);const original=test.rpc.getMockImplementation()!;let heads=0;
  test.rpc.mockImplementation(async(method,params:any=[])=>{
    if(method==='getSignaturesForAddress'&&!params[1].before&&(persistent||heads++===0))return [
      {signature:'tx4',slot:4,err:null},{signature:'tx2',slot:2,err:null},
    ];
    return original(method,params);
  });
  const candidates:State[]=[];test.indexer.reconcile=async snapshot=>{candidates.push(structuredClone(snapshot!.state));};
  if(persistent) {
    await expect(test.indexer.cycle()).rejects.toThrow(/History critical sequence gap: expected 3, observed 4/);
    expect(test.indexer.metrics.historyRestarts).toBe(MAX_HISTORY_READ_RESTARTS);
    expect(test.store.commit).not.toHaveBeenCalled();expect(test.indexer.healthy).toBe(false);
    expect(candidates).toEqual([]);
  } else {
    await test.indexer.cycle();expect(test.indexer.metrics.historyRestarts).toBe(1);
    expect(candidates).toEqual([{sequence:'4',cash:28}]);expect(test.store.commit).toHaveBeenCalledTimes(1);
    expect(test.store.commit.mock.calls[0][0].map(row=>row.signature)).toEqual(['tx4','tx3','tx2']);
  }
  expect(test.state).toEqual({sequence:'1',cash:7});
});

it('never retries conflicting duplicate critical sequences as an incomplete read',async()=>{
  const test=fixture();test.setHead(3);
  vi.spyOn(test.indexer as any,'decodeTransaction').mockImplementation((signature:any)=>[
    {signature,data:{sequence:'2'}} as JournalEvent,
  ]);
  await expect(test.indexer.cycle()).rejects.toThrow(/Event gap or duplicate/);
  expect(test.indexer.metrics.historyRestarts).toBe(0);
  expect(test.store.commit).not.toHaveBeenCalled();expect(test.indexer.healthy).toBe(false);
});
