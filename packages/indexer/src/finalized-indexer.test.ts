import {expect,it,vi} from 'vitest';
import {FinalizedIndexer,FINALIZED_BLOCK_READ_WIDTH} from './finalized-indexer.js';
import {hash,type JournalEvent} from './events.js';
import {orderScopedTransactions,type RevisionVector} from './scoped-history.js';
import {publishedSnapshot,type JournalBinding,type JournalStore,type JournalInvocation} from './store.js';
import {CLEARING_PROGRAM_ADDRESS} from '@rivalt/sdk';

type State={sequence:string;cash:number;revisions:RevisionVector};
function fixture(limit=20,pageSize=100) {
  const binding:JournalBinding={schema:8,venue:'test',genesis:'local',domain:'test',anchor:'tx1',anchorHash:hash({signatures:['tx1']}),program:'test'};
  const state:State={sequence:'1',cash:7,revisions:{root:{kind:5,revision:'1'}}};
  let durable:any={binding,state,checkpoint:'block1',checkpoint_slot:'1',published_state:null,published_checkpoint:null,published_checkpoint_slot:null,synced_at:null,error:null};
  const blocks=new Map<number,any>();let head=2;
  const projection={apply(initial:State,invocations:JournalInvocation<JournalEvent>[]) {
    const ordered=orderScopedTransactions(invocations,initial.revisions);
    return {state:{sequence:String(BigInt(initial.sequence)+BigInt(invocations.length)),cash:initial.cash+7*invocations.length,revisions:ordered.revisions},invocations};
  }};
  const store={snapshot:vi.fn(async()=>structuredClone(durable)),observe:vi.fn(async()=>{}),health:vi.fn(async(error)=>{durable.error=error;durable.synced_at=null;}),
    commit:vi.fn(async(chunk:any[],invocations:any[],fence:any,expected:any)=>{
      expect(expected).toBe(durable.checkpoint);
      durable={...durable,state:projection.apply(durable.state,invocations).state,checkpoint:fence.blockhash,checkpoint_slot:String(fence.slot)};
      for(const block of chunk)blocks.set(block.slot,structuredClone(block));
    }),
    async *blocksAfter(start:number,end:number){for(const [slot,block] of blocks)if(slot>start&&slot<=end)yield block;},
    publish:vi.fn(async(candidate:any,capturedAt:Date)=>{durable={...durable,published_state:candidate.state,published_checkpoint:candidate.checkpoint,
      published_checkpoint_slot:candidate.checkpoint_slot,synced_at:capturedAt,error:null};}),pool:{query:vi.fn(async()=>({rows:[]}))},projection};
  class Indexer extends FinalizedIndexer<State,JournalBinding,JournalEvent> {
    protected async initializeBinding(){return binding;}
    protected decodeTransaction(signature:string,transaction:any,transactionIndex:number) {
      const slot=transaction.slot;
      return [{signature,slot:BigInt(slot),transactionIndex,outer:0,invocation:0,reads:[],writes:[{account:'root',kind:5,before:String(slot-1),after:String(slot)}],
        instruction:'test',venue:'test',domain:'test',payloads:[],footerInner:0,footerBytes:'test',events:[]}];
    }
    async capture(){const observed=head;return {maxSlot:observed,matches:(candidate:State)=>candidate.revisions.root.revision===String(observed),verify:async(_state:State)=>{}};}
    async reconcile(){}
  }
  const indexer=new Indexer({rpcUrl:'http://127.0.0.1:1',wsUrl:'ws://127.0.0.1:2',databaseUrl:'unused',runId:'test',anchor:'tx1',maxRecoveryTransactions:limit,pageSize},
    store as unknown as JournalStore<State,JournalBinding,JournalEvent>);
  indexer.ws={buffer:[]} as any;
  const rpc=vi.spyOn(indexer.rpc,'call').mockImplementation(async(method,params:any=[])=>{
    if(method==='getGenesisHash')return 'local';
    if(method==='getTransaction')return {slot:1,meta:{err:null},transaction:{signatures:['tx1']}};
    if(method==='getSlot')return head;
    if(method==='getBlocks')return Array.from({length:params[1]-params[0]+1},(_,index)=>params[0]+index);
    if(method==='getBlock')return {blockhash:`block${params[0]}`,parentSlot:params[0]-1,previousBlockhash:`block${params[0]-1}`,blockTime:100,
      signatures:[`tx${params[0]}`],transactions:[{meta:{err:null},transaction:{signatures:[`tx${params[0]}`],message:{accountKeys:[CLEARING_PROGRAM_ADDRESS]}}}]};
    throw new Error(`Unexpected RPC ${method}`);
  });
  return {indexer,store,rpc,state,durable:()=>durable,setHead:(value:number)=>{head=value;}};
}
it('bounds parallel reads and commits complete blocks despite out-of-order responses',async()=>{
  const test=fixture(30);test.setHead(20);const original=test.rpc.getMockImplementation()!;
  let active=0,maximum=0;const completed:number[]=[];
  test.rpc.mockImplementation(async(method,params:any=[])=>{
    if(method!=='getBlock')return original(method,params);
    active++;maximum=Math.max(maximum,active);
    await new Promise(resolve=>setTimeout(resolve,(FINALIZED_BLOCK_READ_WIDTH-((params[0]-2)%FINALIZED_BLOCK_READ_WIDTH))*2));
    completed.push(params[0]);active--;return original(method,params);
  });
  await test.indexer.cycle();
  expect(maximum).toBe(2*FINALIZED_BLOCK_READ_WIDTH);expect(active).toBe(0);expect(completed[0]).not.toBe(2);
  expect(test.store.commit.mock.calls.map(call=>call[0][0].slot)).toEqual(Array.from({length:19},(_,index)=>index+2));
  expect(test.indexer.healthy).toBe(true);expect(test.state.cash).toBe(7);
});
it('makes durable progress across work budgets and uses the configured block page size',async()=>{
  const test=fixture(2,2);test.setHead(6);
  await test.indexer.cycle();expect(test.durable().checkpoint).toBe('block3');expect(test.indexer.healthy).toBe(false);
  await test.indexer.cycle();expect(test.durable().checkpoint).toBe('block5');
  await test.indexer.cycle();expect(test.durable().checkpoint).toBe('block6');expect(test.indexer.healthy).toBe(true);
  expect(test.store.commit).toHaveBeenCalledTimes(5);expect(test.store.publish).toHaveBeenCalledTimes(1);
  for(const [,params] of test.rpc.mock.calls.filter(([method])=>method==='getBlocks'))expect(Number(params![1])-Number(params![0])+1).toBeLessThanOrEqual(2);
});
it('publishes only the common witnessed revision fence, never an overwritten older snapshot',async()=>{
  const test=fixture();
  test.indexer.capture=async()=>{test.setHead(4);return {maxSlot:4,matches:(state:State)=>state.revisions.root.revision==='3',verify:async(state:State)=>{expect(state.cash).toBe(21);}};};
  await test.indexer.cycle();
  expect(test.durable().checkpoint).toBe('block4');expect(test.durable().state.cash).toBe(28);
  expect(test.durable().published_checkpoint).toBe('block3');expect(test.durable().published_state.cash).toBe(21);
});
it('retains coverage without publication when captured revisions have no common fence',async()=>{
  const test=fixture();test.indexer.capture=async()=>{test.setHead(4);return {maxSlot:4,matches:()=>false,verify:async()=>{throw new Error('must not verify');}};};
  await test.indexer.cycle();expect(test.durable().checkpoint).toBe('block4');expect(test.indexer.healthy).toBe(false);
  expect(test.store.publish).not.toHaveBeenCalled();expect(test.indexer.metrics.pending).toBe(1);
});
it('rejects financial byte mismatches but retains independently authenticated coverage',async()=>{
  const test=fixture();test.indexer.capture=async()=>({maxSlot:2,matches:()=>true,verify:async()=>{throw new Error('Economic mismatch');}});
  await expect(test.indexer.cycle()).rejects.toThrow('Economic mismatch');
  expect(test.durable().checkpoint).toBe('block2');expect(test.store.publish).not.toHaveBeenCalled();expect(test.indexer.healthy).toBe(false);
});
it('drains all in-flight reads before retrying a failed batch',async()=>{
  const test=fixture();test.setHead(10);const original=test.rpc.getMockImplementation()!;let active=0,finished=0;
  test.rpc.mockImplementation(async(method,params:any=[])=>{
    if(method!=='getBlock')return original(method,params);
    active++;
    try {if(params[0]===2&&params[1].transactionDetails==='full')throw new Error('body unavailable');
      await new Promise(resolve=>setTimeout(resolve,10));return original(method,params);
    }finally{active--;finished++;}
  });
  await expect(test.indexer.cycle()).rejects.toThrow('body unavailable');
  expect(active).toBe(0);expect(finished).toBe(2*FINALIZED_BLOCK_READ_WIDTH);expect(test.store.commit).not.toHaveBeenCalled();
});
for(const defect of ['missing-head','missing-parent','changed-parent','duplicate-slot','missing-body'] as const)
  it(`rejects ${defect} without publishing partial coverage`,async()=>{
    const test=fixture();test.setHead(4);const original=test.rpc.getMockImplementation()!;
    test.rpc.mockImplementation(async(method,params:any=[])=>{
      if(method==='getBlocks') {
        if(defect==='missing-head')return [2,3];if(defect==='missing-parent')return [2,4];if(defect==='duplicate-slot')return [2,2,3,4];
      }
      if(method==='getBlock'&&params[0]===3) {
        if(defect==='missing-body')return null;
        if(defect==='changed-parent')return {...await original(method,params),previousBlockhash:'foreign'};
      }
      return original(method,params);
    });
    await expect(test.indexer.cycle()).rejects.toThrow();expect(test.store.publish).not.toHaveBeenCalled();expect(test.indexer.healthy).toBe(false);
  });
it('does not mistake notifications beyond coverage for omitted transactions',async()=>{
  const test=fixture();test.store.pool.query.mockResolvedValueOnce({rows:[{signature:'tx3'}]} as any);const original=test.rpc.getMockImplementation()!;
  test.rpc.mockImplementation(async(method,params)=>method==='getSignatureStatuses'?{value:[{confirmationStatus:'finalized',slot:3}]}:original(method,params));
  await test.indexer.cycle();expect(test.indexer.healthy).toBe(true);
});
it('rejects an omitted independent transaction using the complete signature manifest',async()=>{
  const test=fixture(),original=test.rpc.getMockImplementation()!;
  test.rpc.mockImplementation(async(method,params:any=[])=>{
    const value=await original(method,params);
    return method==='getBlock'&&params[1].transactionDetails==='signatures'?{...value,signatures:['tx2','unseen-writer']}:value;
  });
  await expect(test.indexer.cycle()).rejects.toThrow(/signature manifest/);expect(test.store.publish).not.toHaveBeenCalled();
});
it('serves only published data and cannot renew freshness with later coverage',async()=>{
  const test=fixture();await test.indexer.cycle();const row=test.durable();
  expect(publishedSnapshot<State,JournalBinding>({...row,state:{...row.state,cash:999}}).state.cash).toBe(14);
  expect(()=>publishedSnapshot({...row,synced_at:new Date(Date.now()-10_001)})).toThrow(/unavailable/);
  expect(()=>publishedSnapshot({...row,published_state:null})).toThrow(/unavailable/);
});

it('charges empty blocks to the work budget without requiring a financial event',async()=>{
  const test=fixture(2);test.setHead(10);const original=test.rpc.getMockImplementation()!;
  test.rpc.mockImplementation(async(method,params)=>{
    const value=await original(method,params);return method==='getBlock'?{...value,signatures:[],transactions:[]}:value;
  });
  await test.indexer.cycle();expect(test.durable().checkpoint).toBe('block3');
  expect(test.store.commit).toHaveBeenCalledTimes(2);expect(test.durable().state.cash).toBe(7);expect(test.indexer.healthy).toBe(false);
});
it('commits an oversized complete block atomically even when it exceeds the remaining transaction budget',async()=>{
  const test=fixture(1),original=test.rpc.getMockImplementation()!;
  test.rpc.mockImplementation(async(method,params)=>{
    const value=await original(method,params);if(method!=='getBlock')return value;
    return {...value,signatures:[...value.signatures,'unrelated'],transactions:[...value.transactions,
      {meta:{err:null},transaction:{signatures:['unrelated'],message:{accountKeys:[]}}}]};
  });
  await test.indexer.cycle();expect(test.store.commit).toHaveBeenCalledTimes(1);
  expect(test.store.commit.mock.calls[0][0][0].transactions).toHaveLength(2);
  expect(test.indexer.healthy).toBe(true);expect(test.durable().published_state.cash).toBe(14);
});
