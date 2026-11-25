import {expect,it} from 'vitest';
import {testAddress} from '../test-support/liquidity-fixture.js';
import {readCoherentAccounts} from './coherent-accounts.js';

const keys = Array.from({length:201},(_,index) => testAddress(index+1));
it('discards the entire mixed-slot read and fences all three replacement batches', async () => {
  const slots = [10,11,10,12,12,12];
  const fences: number[] = [];
  const rpc = {async call(_method: string, params: unknown[] = []) {
    const [chunk,config] = params as [string[],{minContextSlot:number}];
    fences.push(config.minContextSlot);
    expect(chunk.length).toBeLessThanOrEqual(100);
    const slot = slots.shift();
    return {context:{slot},value:chunk.map(key => [slot,key])};
  }};
  const result = await readCoherentAccounts(rpc,keys,'confirmed',9n);
  expect(fences).toEqual([9,9,9,11,11,11]);
  expect(result.value).toEqual(keys.map(key => [12,key]));
});
it('rejects when reads never converge', async () => {
  let slot=10;
  const rpc={async call(_method:string,params:unknown[] = []) {
    return {context:{slot:slot++},value:params[0]};
  }};
  await expect(readCoherentAccounts(rpc,keys,'finalized',10n)).rejects.toThrow(/different RPC slots/);
});
