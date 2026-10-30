import {expect,it,vi} from 'vitest';
import {FinalizedIndexer,MAX_RECONCILIATION_CATCHUPS} from './finalized-indexer.js';
import {compareReconciliationRevision,ReconciliationAhead} from './reconciliation-progress.js';
import {hash,type JournalEvent} from './events.js';
import {orderScopedTransactions,type RevisionVector} from './scoped-history.js';
import type {JournalBinding,JournalStore,JournalInvocation} from './store.js';
import {CLEARING_PROGRAM_ADDRESS} from '@rivalt/sdk';

type State={sequence:string;cash:number;revisions:RevisionVector};
function fixture(limit=20) {
  const binding:JournalBinding={schema:5,venue:'test',genesis:'local',domain:'test',anchor:'tx1',anchorHash:hash({signatures:['tx1']}),program:'test'};
  const state:State={sequence:'1',cash:7,revisions:{root:{kind:5,revision:'1'}}};
  const store={snapshot:vi.fn(async()=>({binding,state,checkpoint:'block1',checkpoint_slot:'1'})),observe:vi.fn(async()=>{}),health:vi.fn(async()=>{}),
    commit:vi.fn(async(..._args:Parameters<JournalStore<State,JournalBinding,JournalEvent>['commit']>)=>{}),
    pool:{query:vi.fn(async()=>({rows:[]}))},projection:{apply(initial:State,invocations:JournalInvocation<JournalEvent>[]) {
      const ordered=orderScopedTransactions(invocations,initial.revisions);
      return {state:{sequence:String(BigInt(initial.sequence)+BigInt(invocations.length)),cash:initial.cash+7*invocations.length,revisions:ordered.revisions},invocations};
    }}};
  class Indexer extends FinalizedIndexer<State,JournalBinding,JournalEvent> {
    protected async initializeBinding(){return binding;}
    protected decodeTransaction(signature:string,transaction:any,transactionIndex:number) {
      const slot=transaction.slot;
      return [{signature,slot:BigInt(slot),transactionIndex,outer:0,invocation:0,reads:[],writes:[{account:'root',kind:5,before:String(slot-1),after:String(slot)}],
        instruction:'test',venue:'test',domain:'test',payloads:[],footerInner:0,footerBytes:'test',events:[]}];
    }
    async reconcile(_snapshot?:{state:State;binding:JournalBinding}){}
  }
  const indexer=new Indexer({rpcUrl:'http://127.0.0.1:1',wsUrl:'ws://127.0.0.1:2',databaseUrl:'unused',runId:'test',anchor:'tx1',maxRecoveryTransactions:limit},
    store as unknown as JournalStore<State,JournalBinding,JournalEvent>);
  indexer.ws={buffer:[]} as any;
  let head=2;
  const rpc=vi.spyOn(indexer.rpc,'call').mockImplementation(async(method,params:any=[])=>{
    if(method==='getGenesisHash')return 'local';
    if(method==='getTransaction')return {slot:1,meta:{err:null},transaction:{signatures:['tx1']}};
    if(method==='getSlot')return head;
    if(method==='getBlocks')return Array.from({length:params[1]-params[0]+1},(_,index)=>params[0]+index);
    if(method==='getBlock')return {blockhash:`block${params[0]}`,parentSlot:params[0]-1,previousBlockhash:`block${params[0]-1}`,blockTime:100,
      transactions:[{meta:{err:null},transaction:{signatures:[`tx${params[0]}`],message:{accountKeys:[CLEARING_PROGRAM_ADDRESS]}}}]};
    throw new Error(`Unexpected RPC ${method}`);
  });
  return {indexer,store,rpc,state,setHead:(value:number)=>{head=value;}};
}
it('extends only finalized blocks beyond the accepted candidate and preserves the durable state until commit',async()=>{
  const test=fixture();let calls=0;
  test.indexer.reconcile=async snapshot=>{
    if(calls++===0){expect(snapshot!.state.cash).toBe(14);test.setHead(4);compareReconciliationRevision(4n,2n);}
    expect(snapshot!.state).toEqual({sequence:'4',cash:28,revisions:{root:{kind:5,revision:'4'}}});
  };
  await test.indexer.cycle();
  expect(test.indexer.metrics.catchups).toBe(1);expect(test.indexer.healthy).toBe(true);
  expect(test.store.commit).toHaveBeenCalledTimes(1);
  expect(test.store.commit.mock.calls[0][0].map(block=>block.slot)).toEqual([2,3,4]);
  expect(test.store.commit.mock.calls[0].slice(2)).toEqual([{slot:4,blockhash:'block4'},'block1']);
  expect(test.rpc.mock.calls.filter(([method,params])=>method==='getBlock'&&(params as any)[0]===2)).toHaveLength(1);
  expect(test.state.cash).toBe(7);
});
for(const message of ['Economic mismatch','Finalized revision is behind'])it(`never retries ${message}`,async()=>{
  const test=fixture();test.indexer.reconcile=async()=>{throw new Error(message);};
  await expect(test.indexer.cycle()).rejects.toThrow(message);
  expect(test.indexer.metrics.catchups).toBe(0);expect(test.store.commit).not.toHaveBeenCalled();
});
it('bounds continuous relevant advances and never commits an unreconciled prefix',async()=>{
  const test=fixture();let observed=2n;
  test.indexer.reconcile=async()=>{test.setHead(Number(++observed));throw new ReconciliationAhead(observed-1n,observed);};
  await expect(test.indexer.cycle()).rejects.toThrow(ReconciliationAhead);
  expect(test.indexer.metrics.catchups).toBe(MAX_RECONCILIATION_CATCHUPS);expect(test.indexer.metrics.fetched).toBe(4);
  expect(test.store.commit).not.toHaveBeenCalled();
});
it('enforces the cumulative transaction limit across catchups',async()=>{
  const test=fixture(2);test.indexer.reconcile=async()=>{test.setHead(4);throw new ReconciliationAhead(2n,4n);};
  await expect(test.indexer.cycle()).rejects.toThrow(/transaction bound/);expect(test.store.commit).not.toHaveBeenCalled();
});
for(const defect of ['missing-head','missing-parent','changed-parent','duplicate-slot','missing-body'] as const)
  it(`rejects ${defect} even when WS/address hints could appear complete`,async()=>{
    const test=fixture();test.setHead(4);const original=test.rpc.getMockImplementation()!;
    test.rpc.mockImplementation(async(method,params:any=[])=>{
      if(method==='getBlocks') {
        if(defect==='missing-head')return [2,3];
        if(defect==='missing-parent')return [2,4];
        if(defect==='duplicate-slot')return [2,2,3,4];
      }
      if(method==='getBlock'&&params[0]===3) {
        if(defect==='missing-body')return null;
        if(defect==='changed-parent')return {...await original(method,params),previousBlockhash:'foreign'};
      }
      return original(method,params);
    });
    await expect(test.indexer.cycle()).rejects.toThrow();expect(test.store.commit).not.toHaveBeenCalled();expect(test.indexer.healthy).toBe(false);
  });
it('does not treat a newer notification outside the block fence as a history gap',async()=>{
  const test=fixture();test.store.pool.query.mockResolvedValueOnce({rows:[{signature:'tx3'}]} as any);
  const original=test.rpc.getMockImplementation()!;
  test.rpc.mockImplementation(async(method,params)=>method==='getSignatureStatuses'?{value:[{confirmationStatus:'finalized',slot:3}]}:original(method,params));
  await test.indexer.cycle();expect(test.indexer.healthy).toBe(true);
});
