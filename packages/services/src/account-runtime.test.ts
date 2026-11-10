import {expect,it,vi} from 'vitest';
import {createNoopSigner} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {accountFixture} from '../../sdk/src/account-test-fixture.js';
import {AccountQuoteUnavailable,AccountRuntime} from './account-runtime.js';

/** Exercise the actual order scheduling loop; quote/queue boundaries are doubles,
 * never evidence of financial admission, a signed transaction or a durable commit. */
async function fixture() {
  const test=await accountFixture(),trader=test.margins[0];
  const snapshot=await sdk.readAccountSnapshot(test.rpc,test.config,[trader],'confirmed');
  const root=snapshot.roots[trader],stored=root.book.orders[0];
  Object.assign(stored.order,{id:1n,version:1n,state:1,termsEpoch:1n,lots:100_000_000n,
    filled:0n,startSlot:1n,expirySlot:1000n});
  const available={available:true as const,instructions:[],guard:{stateVersion:9n}};
  const quote=vi.fn(async(..._args:Parameters<AccountRuntime['quote']>):Promise<unknown>=>available);
  const enqueue=vi.fn(async(..._args:Parameters<AccountRuntime['enqueue']>)=>undefined);
  const runtime={budget:async()=> 'order-budget',pendingBudget:async()=>false,
    discovery:async()=>({state:{members:[trader],roots:{[trader]:root}}}),
    snapshot:async()=>snapshot,quote,enqueue};
  const run=()=>AccountRuntime.prototype.orders.call(runtime as unknown as AccountRuntime,createNoopSigner(test.owner) as Keypair);
  return {root,available,quote,enqueue,runtime,run};
}

it('reads an unavailable source once per order per pass and retries after recovery',async()=>{
  const test=await fixture();
  test.quote.mockResolvedValueOnce({available:false,code:'required-market-source-unavailable',diagnostic:{}});
  expect(await test.run()).toEqual({status:'idle',reason:'no-admissible-triggered-order'});
  expect(test.quote.mock.calls.map(call=>call[4])).toEqual([100_000_000n]);
  expect(test.enqueue).not.toHaveBeenCalled();
  expect(await test.run()).toEqual({status:'queued',reason:'durable-account-order-fill'});
  expect(test.quote.mock.calls.map(call=>call[4])).toEqual([100_000_000n,100_000_000n]);
  expect(test.enqueue).toHaveBeenCalledTimes(1);
});

it.each(['maker-depth-or-whole-account-health','liquidity-search-budget-exhausted','quote-expiring'])(
  'keeps smaller probes after %s and queues just one accepted candidate',async code=>{
    const test=await fixture();test.quote.mockResolvedValueOnce({available:false,code,diagnostic:{}});
    expect(await test.run()).toEqual({status:'queued',reason:'durable-account-order-fill'});
    expect(test.quote.mock.calls.map(call=>call[4])).toEqual([100_000_000n,50_000_000n]);
    expect(test.enqueue).toHaveBeenCalledTimes(1);
    expect(test.enqueue.mock.calls[0][5]).toBe(true);
  });

it('stops probing after enqueue preflight rejects without attempting a smaller original',async()=>{
  const test=await fixture();test.enqueue.mockRejectedValueOnce(new Error('Risk action presently unavailable'));
  expect(await test.run()).toEqual({status:'idle',reason:'no-admissible-triggered-order'});
  expect(test.quote).toHaveBeenCalledTimes(1);expect(test.enqueue).toHaveBeenCalledTimes(1);
});

it('stops on typed quote refusal and propagates unexpected failures',async()=>{
  const test=await fixture();test.quote.mockRejectedValueOnce(new AccountQuoteUnavailable('unavailable',{}));
  expect(await test.run()).toEqual({status:'idle',reason:'no-admissible-triggered-order'});
  expect(test.quote).toHaveBeenCalledTimes(1);expect(test.enqueue).not.toHaveBeenCalled();
  test.quote.mockRejectedValueOnce(new Error('unexpected transport failure'));
  await expect(test.run()).rejects.toThrow('unexpected transport failure');
  expect(test.quote).toHaveBeenCalledTimes(2);expect(test.enqueue).not.toHaveBeenCalled();
});

it('continues to the next market order after one required source is unavailable',async()=>{
  const test=await fixture();
  test.root.book.orders[1]={...structuredClone(test.root.book.orders[0]),marketIndex:1};
  test.root.book.orders[1].order.id=2n;
  test.quote.mockResolvedValueOnce({available:false,code:'required-market-source-unavailable',diagnostic:{}});
  expect(await test.run()).toEqual({status:'queued',reason:'durable-account-order-fill'});
  expect(test.quote.mock.calls.map(call=>[call[2],call[4]])).toEqual([[0,100_000_000n],[1,100_000_000n]]);
  expect(test.enqueue).toHaveBeenCalledTimes(1);
});

it('preserves the pending-original fence before reading or quoting orders',async()=>{
  const test=await fixture();test.runtime.pendingBudget=async()=>true;
  expect(await test.run()).toEqual({status:'blocked',reason:'original-order-intent-pending'});
  expect(test.quote).not.toHaveBeenCalled();expect(test.enqueue).not.toHaveBeenCalled();
});
