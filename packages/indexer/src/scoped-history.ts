/** Active schema-6 causal ordering for the finalized journal.
 * Input must come from authenticated, complete finalized transaction envelopes.
 * A SQL commit still owns deduplication, payload projection and checkpointing. */
export type EntityRevision={kind:number;revision:string};
export type ScopedRead=EntityRevision&{account:string};
export type ScopedWrite={account:string;kind:number;before:string;after:string};
export type ScopedEnvelope={signature:string;slot:bigint;transactionIndex:number;
  outer:number;invocation:number;reads:ScopedRead[];writes:ScopedWrite[]};
export type RevisionVector=Record<string,EntityRevision>;

const u64Maximum=(1n<<64n)-1n;
function revision(value:string) {
  if(!/^(0|[1-9][0-9]*)$/.test(value)||BigInt(value)>u64Maximum)throw new Error('Invalid scoped revision');
  return BigInt(value);
}
function ordinal(value:number) {
  if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid scoped position');
}
type Dependency={kind:number;before:bigint;after:bigint};
type AtomicTransaction={signature:string;slot:bigint;transactionIndex:number;envelopes:ScopedEnvelope[];
  dependencies:Map<string,Dependency>};

function atomicTransactions(envelopes:readonly ScopedEnvelope[]) {
  if(envelopes.length>4096)throw new Error('Scoped history batch exceeds bound');
  const grouped=new Map<string,AtomicTransaction>();
  for(const envelope of envelopes) {
    if(!envelope.signature||envelope.slot<0n||envelope.slot>u64Maximum)throw new Error('Invalid scoped identity');
    ordinal(envelope.transactionIndex);ordinal(envelope.outer);ordinal(envelope.invocation);
    let transaction=grouped.get(envelope.signature);
    if(!transaction) {
      transaction={...envelope,envelopes:[],dependencies:new Map()};grouped.set(envelope.signature,transaction);
    }
    if(transaction.slot!==envelope.slot||transaction.transactionIndex!==envelope.transactionIndex)
      throw new Error('Conflicting transaction position');
    transaction.envelopes.push(envelope);
  }
  const positions=new Set<string>();
  for(const transaction of grouped.values()) {
    const position=`${transaction.slot}/${transaction.transactionIndex}`;
    if(positions.has(position))throw new Error('Duplicate canonical transaction position');positions.add(position);
    transaction.envelopes.sort((left,right)=>left.outer-right.outer||left.invocation-right.invocation);
    const invocations=new Set<string>();
    for(const envelope of transaction.envelopes) {
      const invocation=`${envelope.outer}/${envelope.invocation}`;
      if(invocations.has(invocation))throw new Error('Duplicate scoped invocation');invocations.add(invocation);
      if(envelope.writes.length===0||envelope.reads.length+envelope.writes.length>32)
        throw new Error('Scoped entity count');
      const accounts=new Set<string>();
      const touch=(account:string,kind:number,before:bigint,after:bigint)=>{
        if(!account||accounts.has(account)||!Number.isInteger(kind)||kind<0||kind>16)
          throw new Error('Duplicate or invalid scoped entity');
        accounts.add(account);
        const previous=transaction.dependencies.get(account);
        if(previous&&(previous.kind!==kind||previous.after!==before))throw new Error('Nonatomic scoped transaction');
        transaction.dependencies.set(account,{kind,before:previous?.before??before,after});
      };
      for(const read of envelope.reads) {
        const value=revision(read.revision);if(value===0n)throw new Error('Uninitialized scoped read');
        touch(read.account,read.kind,value,value);
      }
      for(const write of envelope.writes) {
        const before=revision(write.before),after=revision(write.after);
        if(after!==before+1n)throw new Error('Nonconsecutive scoped mutation');
        touch(write.account,write.kind,before,after);
      }
    }
  }
  return [...grouped.values()];
}

/** Causal revisions determine ordering; canonical block position breaks only
 * independent ties. An external reader cannot interleave two instructions of
 * one signed transaction. Read-before-write anti-dependencies matter as much as
 * write predecessors. A missing/cyclic batch produces no candidate result. */
export function orderScopedTransactions(envelopes:readonly ScopedEnvelope[],initial:RevisionVector) {
  const transactions=atomicTransactions(envelopes),edges=transactions.map(()=>new Set<number>()),degrees=transactions.map(()=>0);
  const entities=new Map<string,{transaction:number;dependency:Dependency}[]>();
  transactions.forEach((transaction,index)=>transaction.dependencies.forEach((dependency,account)=>{
    const entries=entities.get(account)??[];entries.push({transaction:index,dependency});entities.set(account,entries);
  }));
  const edge=(from:number,to:number)=>{
    if(from===to||edges[from].has(to))return;
    if(transactions[from].slot>transactions[to].slot)throw new Error('Scoped dependency reverses finalized slots');
    edges[from].add(to);degrees[to]++;
  };
  for(const [account,entries] of entities) {
    const prior=initial[account],start=prior?revision(prior.revision):0n,kind=prior?.kind??entries[0].dependency.kind;
    if(entries.some(({dependency})=>dependency.kind!==kind||dependency.before<start))throw new Error('Scoped identity or prefix conflict');
    const writes=entries.filter(({dependency})=>dependency.after>dependency.before)
      .sort((left,right)=>left.dependency.before<right.dependency.before?-1:left.dependency.before>right.dependency.before?1:0);
    let cursor=start;
    for(const [index,write] of writes.entries()) {
      if(write.dependency.before!==cursor)throw new Error('Missing or competing scoped predecessor');
      if(index)edge(writes[index-1].transaction,write.transaction);
      cursor=write.dependency.after;
    }
    for(const read of entries.filter(({dependency})=>dependency.after===dependency.before)) {
      const value=read.dependency.before,producer=writes.find(write=>write.dependency.after===value),consumer=writes.find(write=>write.dependency.before===value);
      if(value!==start&&!producer||!prior&&value===0n)throw new Error('Missing or interleaved scoped read');
      if(producer)edge(producer.transaction,read.transaction);
      if(consumer)edge(read.transaction,consumer.transaction);
    }
  }
  const compare=(left:number,right:number)=>{
    const a=transactions[left],b=transactions[right];
    return a.slot<b.slot?-1:a.slot>b.slot?1:a.transactionIndex-b.transactionIndex;
  };
  const ready=transactions.map((_,index)=>index).filter(index=>degrees[index]===0),ordered:AtomicTransaction[]=[];
  while(ready.length) {
    ready.sort(compare);const index=ready.shift()!;ordered.push(transactions[index]);
    for(const target of edges[index])if(--degrees[target]===0)ready.push(target);
  }
  if(ordered.length!==transactions.length)throw new Error('Cyclic scoped history');
  const revisions=structuredClone(initial);
  for(const transaction of ordered)for(const [account,dependency] of transaction.dependencies) {
    if(BigInt(revisions[account]?.revision??'0')!==dependency.before)throw new Error('Scoped order does not match prefix');
    revisions[account]={kind:dependency.kind,revision:dependency.after.toString()};
  }
  return {transactions:ordered.map(transaction=>({signature:transaction.signature,envelopes:transaction.envelopes})),revisions};
}
