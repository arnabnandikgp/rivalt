import {it,expect} from 'vitest';
import * as sdk from './index.js';
import {accountFixture} from './account-test-fixture.js';

it('reads profile-4 funded balances and builds a direct exit without any maker dependency',async()=>{
  const fixture=await accountFixture();
  const venue=sdk.getVenueDecoder().decode(Buffer.from(fixture.accounts.get(fixture.config.venue).data[0],'base64'));
  fixture.put(fixture.config.venue,sdk.getVenueEncoder().encode({...venue,profileVersion:4}));
  const config={...fixture.config,version:4 as const,profile:'liquidity-execution-qualification' as const};
  const client=new sdk.LiquidityUserClient(config),snapshot=await sdk.readLiquiditySnapshot(fixture.rpc,config,[fixture.margins[0]]);
  expect(fixture.batches[1]).toHaveLength(12);expect(snapshot.liquidity).toBeUndefined();
  const exit=await client.exit(snapshot,fixture.owner,fixture.margins[0],config.mint,17n);
  expect(exit.instructions).toHaveLength(1);expect(sdk.getWithdrawFundedAccountInstructionDataDecoder().decode(exit.instructions[0].data!)).toMatchObject({amount:17n,guard:{stateVersion:9n}});
  await expect(sdk.readAccountSnapshot(fixture.rpc,config,[fixture.margins[0]])).rejects.toThrow(/profile/);
  snapshot.roots[fixture.margins[0]].positions[0].virtualScaled=999_000_000_000n;
  await expect(client.exit(snapshot,fixture.owner,fixture.margins[0],config.mint,50_001n)).rejects.toThrow(/Funded exit/);
});
it('keeps profile-4 public identity explicit and rejects credentials or cross-profile substitution',async()=>{
  const fixture=await accountFixture(),config={...fixture.config,version:4 as const,profile:'liquidity-execution-qualification' as const};
  expect(sdk.liquidityUserConfig(config).version).toBe(4);
  expect(()=>sdk.accountUserConfig(config as unknown as sdk.AccountUserConfig)).toThrow(/qualified/);
  expect(()=>sdk.liquidityUserConfig(fixture.config as unknown as sdk.LiquidityUserConfig)).toThrow(/qualified/);
  expect(()=>sdk.liquidityUserConfig({...config,rpcUrl:config.rpcUrl+'?secret=x'})).toThrow(/credentials/);
});
