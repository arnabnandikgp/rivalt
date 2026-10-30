import {expect,it} from 'vitest';
import {AccountRole} from '@solana/kit';
import * as sdk from './index.js';
import {accountFixture,accountTradeFixture} from './account-test-fixture.js';

it('derives the complete union including fractional claims, expired stored authority and a receiving account',async()=>{
  const fixture=await accountFixture(),snapshot=await sdk.readAccountSnapshot(fixture.rpc,fixture.config,fixture.margins);
  const [cross,recipient]=fixture.margins.map(key=>structuredClone(snapshot.roots[key]));
  expect(sdk.requiredAccountMarkets([cross,recipient])).toBe(0);
  cross.positions[0].lots=1n;expect(sdk.requiredAccountMarkets([cross])).toBe(1);
  recipient.positions[1].virtualScaled=-1n;expect(sdk.requiredAccountMarkets([cross,recipient])).toBe(3);
  recipient.positions[1].virtualScaled=1n;expect(sdk.requiredAccountMarkets([recipient])).toBe(2);
  recipient.positions[1].virtualScaled=0n;
  cross.book.orders[0].marketIndex=1;Object.assign(cross.book.orders[0].order,{state:1,expirySlot:1n});
  expect(sdk.requiredAccountMarkets([cross])).toBe(3);
  cross.book.orders[0].order.state=6;cross.book.protections[0].marketIndex=1;
  Object.assign(cross.book.protections[0].protection,{id:1n,remaining:1n});
  expect(sdk.requiredAccountMarkets([cross])).toBe(1);
  expect(sdk.requiredAccountMarkets([recipient],1)).toBe(1);
});

it('omits both flat withdrawal markets and retains an order requested market in compiled metas',async()=>{
  const fixture=await accountFixture(),snapshot=await sdk.readAccountSnapshot(fixture.rpc,fixture.config,fixture.margins);
  const client=new sdk.AccountUserClient(fixture.config);
  const exit=await client.exit(snapshot,fixture.owner,fixture.margins[0],fixture.config.mint,17n);
  for(const market of snapshot.markets)expect(exit.instructions[0].accounts!.some(meta=>meta.address===market)).toBe(false);
  const order=await client.manageOrder(snapshot,fixture.owner,fixture.margins[0],0,sdk.orderAction('Cleanup'));
  expect(order.accounts!.find(meta=>meta.address===snapshot.markets[0])?.role).toBe(AccountRole.WRITABLE);
  expect(order.accounts!.some(meta=>meta.address===snapshot.markets[1])).toBe(false);
  snapshot.roots[fixture.margins[1]].positions[1].virtualScaled=-1n;
  const transfer=await client.transfer(snapshot,fixture.owner,fixture.margins[0],fixture.margins[1],1n);
  expect(transfer.accounts!.some(meta=>meta.address===snapshot.markets[0])).toBe(false);
  expect(transfer.accounts!.find(meta=>meta.address===snapshot.markets[1])?.role).toBe(AccountRole.WRITABLE);
});

it('builds a BTC-only route without ETH while preserving selected financial admission',async()=>{
  const fixture=await accountTradeFixture(),snapshot=await sdk.readAccountTradeSnapshot(fixture.rpc,fixture.config,fixture.margins[0],0);
  const plan=await sdk.buildLiquidityRoute({snapshot,trader:fixture.margins[0],marketIndex:0,side:0,lots:1n,
    allInLimit:11_000n,maxFee:10n},fixture.owner);
  expect(plan).not.toBeNull();
  expect(plan!.instructions[0].accounts!.some(meta=>meta.address===snapshot.markets[1])).toBe(false);
  expect(plan!.instructions[0].accounts!.find(meta=>meta.address===snapshot.markets[0])?.role).toBe(AccountRole.WRITABLE);
});
