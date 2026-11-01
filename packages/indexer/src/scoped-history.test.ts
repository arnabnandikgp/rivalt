import {expect,it} from 'vitest';
import {orderScopedTransactions,type ScopedEnvelope} from './scoped-history.js';

const root=(revision:string)=>({kind:5,revision});
function event(signature:string,transactionIndex:number,writes:[string,string,string][],reads:[string,string][]=[],outer=0):ScopedEnvelope {
  return {signature,slot:10n,transactionIndex,outer,invocation:0,
    writes:writes.map(([account,before,after])=>({account,kind:5,before,after})),
    reads:reads.map(([account,revision])=>({account,kind:5,revision}))};
}
it('uses scoped predecessors for same-slot writes and ledger position only for independent ties',()=>{
  const result=orderScopedTransactions([event('later',0,[['a','2','3']]),event('independent',1,[['b','0','1']]),
    event('first',2,[['a','1','2']])],{a:root('1')});
  expect(result.transactions.map(transaction=>transaction.signature)).toEqual(['independent','first','later']);
  expect(result.revisions).toEqual({a:root('3'),b:root('1')});
});
it('honors a read-before-write dependency that a writable-only graph would miss',()=>{
  const result=orderScopedTransactions([event('writer',0,[['a','1','2']]),event('reader',1,[['b','0','1']],[['a','1']])],{a:root('1')});
  expect(result.transactions.map(transaction=>transaction.signature)).toEqual(['reader','writer']);
});
it('keeps all instructions of a signed transaction atomic, even when callbacks arrive shuffled',()=>{
  const result=orderScopedTransactions([event('batch',1,[['a','2','3']],[['b','1']],1),
    event('batch',1,[['a','1','2']]),event('next',0,[['b','1','2']],[['a','3']])],{a:root('1'),b:root('1')});
  expect(result.transactions.map(transaction=>transaction.signature)).toEqual(['batch','next']);
  expect(result.transactions[0].envelopes.map(envelope=>envelope.outer)).toEqual([0,1]);
  expect(result.revisions).toEqual({a:root('3'),b:root('2')});
});
it('rejects missing, competing and transaction-interleaved history without changing the input vector',()=>{
  const initial={a:root('1')};
  for(const envelopes of [
    [event('gap',0,[['a','2','3']])],
    [event('one',0,[['a','1','2']]),event('two',1,[['a','1','2']])],
    [event('batch',0,[['a','1','2']]),event('batch',0,[['a','2','3']],[],1),event('interleaved',1,[['b','0','1']],[['a','2']])],
  ])expect(()=>orderScopedTransactions(envelopes,initial)).toThrow();
  expect(initial).toEqual({a:root('1')});
});
it('rejects cyclic cross-account reads and dependencies from a future finalized slot',()=>{
  expect(()=>orderScopedTransactions([event('one',0,[['a','1','2']],[['b','1']]),event('two',1,[['b','1','2']],[['a','1']])],
    {a:root('1'),b:root('1')})).toThrow('Cyclic');
  expect(()=>orderScopedTransactions([{...event('first',0,[['a','1','2']]),slot:11n},event('later',1,[['a','2','3']])],
    {a:root('1')})).toThrow('reverses finalized slots');
});
it('rejects alias, kind, noncanonical integer, overflow and duplicate invocation errors',()=>{
  const valid=event('one',0,[['a','1','2']]);
  for(const invalid of [
    {...valid,reads:[{account:'a',kind:5,revision:'1'}]},
    {...valid,writes:[{account:'a',kind:6,before:'1',after:'2'}]},
    {...valid,writes:[{account:'a',kind:5,before:'01',after:'2'}]},
    {...valid,writes:[{account:'a',kind:5,before:'18446744073709551615',after:'18446744073709551616'}]},
  ])expect(()=>orderScopedTransactions([invalid],{a:root('1')})).toThrow();
  expect(()=>orderScopedTransactions([valid,valid],{a:root('1')})).toThrow('Duplicate scoped invocation');
});
