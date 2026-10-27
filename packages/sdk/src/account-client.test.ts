import {it,expect} from 'vitest';
import type {ReadonlyUint8Array,Instruction} from '@solana/kit';
import * as sdk from './index.js';
import {accountFixture as environment} from './account-test-fixture.js';

it('reads only selected roots and uses one coherent final batch without a registry scan',async()=>{
  const fixture=await environment(),snapshot=await sdk.readAccountSnapshot(fixture.rpc,fixture.config,[fixture.margins[0]]);
  expect(fixture.batches).toHaveLength(2);expect(fixture.batches[1]).toHaveLength(12);
  expect(fixture.batches.flat()).not.toContain(fixture.margins[1]);
  expect(snapshot.roots[fixture.margins[0]].cash).toBe(50_000n);expect(snapshot.actualVault).toBe(100_010n);
  expect(sdk.accountGuard(snapshot,fixture.margins[0])).toEqual({safetyEpoch:2n,venueTermsEpoch:1n,nonce:4n,stateVersion:9n});
});
it('does not invalidate selected-account discovery when an unrelated event advances custody',async()=>{
  const fixture=await environment(),original=fixture.rpc.call;
  fixture.rpc.call=async(method,params)=>{
    if(fixture.batches.length===1) {
      const current=sdk.getCustodyV3Decoder().decode(Buffer.from(fixture.accounts.get(fixture.custody).data[0],'base64'));
      fixture.put(fixture.custody,sdk.getCustodyV3Encoder().encode({...current,sequence:8n}));
    }return original(method,params);
  };
  const snapshot=await sdk.readAccountSnapshot(fixture.rpc,fixture.config,fixture.margins);
  expect(snapshot.custodyState.sequence).toBe(8n);expect(Object.keys(snapshot.roots)).toHaveLength(2);
  expect(fixture.batches[1]).toHaveLength(13);
});
it('builds one atomic funded withdrawal with only root-local authority guards',async()=>{
  const fixture=await environment(),client=new sdk.AccountUserClient(fixture.config),snapshot=await sdk.readAccountSnapshot(fixture.rpc,fixture.config,[fixture.margins[0]]);
  const plan=await client.exit(snapshot,fixture.owner,fixture.margins[0],fixture.config.mint,17n);
  expect(plan.instructions).toHaveLength(1);
  expect(sdk.getWithdrawFundedAccountV3InstructionDataDecoder().decode(plan.instructions[0].data!)).toMatchObject({amount:17n,guard:{safetyEpoch:2n,venueTermsEpoch:1n,nonce:4n,stateVersion:9n}});
  expect(plan.instructions[0].accounts!.some(account=>account.address===fixture.margins[1])).toBe(false);
  snapshot.roots[fixture.margins[0]].positions[0].virtualScaled=999_000_000_000n;
  await expect(client.exit(snapshot,fixture.owner,fixture.margins[0],fixture.config.mint,50_001n)).rejects.toThrow(/Funded exit/);
  snapshot.safetyState.mode=2;await expect(client.exit(snapshot,fixture.owner,fixture.margins[0],fixture.config.mint,1n)).rejects.toThrow(/Funded exit/);
});
it('checks ownership, same-owner allocation and live delegated stale-source cancellation',async()=>{
  const fixture=await environment(),client=new sdk.AccountUserClient(fixture.config),snapshot=await sdk.readAccountSnapshot(fixture.rpc,fixture.config,fixture.margins);
  const [donor,recipient]=fixture.margins;
  const transfer=await client.transfer(snapshot,fixture.owner,donor,recipient,17n);
  expect(sdk.getTransferFundedAccountV3InstructionDataDecoder().decode(transfer.data!).amount).toBe(17n);
  const actor=fixture.config.mint;Object.assign(snapshot.roots[donor],{delegate:actor,delegateExpirySlot:101n});
  Object.assign(snapshot.roots[donor].book.orders[0],{marketIndex:1});Object.assign(snapshot.roots[donor].book.orders[0].order,{id:1n,version:2n,state:1});
  const cancel=await client.cancel(snapshot,actor,donor,1n,2n);
  expect(sdk.getManageAccountOrderV3InstructionDataDecoder().decode(cancel.data!).operation).toEqual({__kind:'Cancel',id:1n,version:2n,protectionGroup:false});
  snapshot.slot=101n;await expect(client.cancel(snapshot,actor,donor,1n,2n)).rejects.toThrow(/Live account/);
  await expect(client.exit(snapshot,actor,donor,fixture.config.mint,1n)).rejects.toThrow(/Owner margin/);
  snapshot.roots[recipient].owner=actor;await expect(client.transfer(snapshot,fixture.owner,donor,recipient,1n)).rejects.toThrow(/Owner margin/);
});
it('rejects foreign schema, missing portfolio identity, aliased roots and excess scope',async()=>{
  const fixture=await environment();
  await expect(sdk.readAccountSnapshot(fixture.rpc,fixture.config,[fixture.margins[0],fixture.margins[0]])).rejects.toThrow(/distinct/);
  const bytes=Buffer.from(fixture.accounts.get(fixture.margins[0]).data[0],'base64');bytes[0]^=1;fixture.put(fixture.margins[0],bytes);
  await expect(sdk.readAccountSnapshot(fixture.rpc,fixture.config,[fixture.margins[0]])).rejects.toThrow(/discriminator/);
  bytes[0]^=1;fixture.put(fixture.margins[0],bytes);fixture.accounts.delete(fixture.portfolio);
  await expect(sdk.readAccountSnapshot(fixture.rpc,fixture.config,[fixture.margins[0]])).rejects.toThrow(/foreign/);
});
it('rejects cross-profile configs and selects explicit measured compute envelopes',async()=>{
  const {config}=await environment();expect(sdk.accountUserConfig(config).version).toBe(3);
  expect(()=>sdk.accountUserConfig({...config,version:2 as 3})).toThrow(/qualified local/);
  expect(()=>sdk.accountUserConfig({...config,rpcUrl:config.rpcUrl+'?secret=x'})).toThrow(/credentials/);
  const instruction=(data:ReadonlyUint8Array):Instruction=>({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,accounts:[],data});
  expect(Buffer.from(sdk.accountWalletInstructions([instruction(sdk.WITHDRAW_FUNDED_ACCOUNT_V3_DISCRIMINATOR)])[0].data!).readUInt32LE(1)).toBe(400_000);
  expect(Buffer.from(sdk.accountWalletInstructions([instruction(sdk.EXECUTE_ACCOUNT_ROUTE_V3_DISCRIMINATOR)])[0].data!).readUInt32LE(1)).toBe(600_000);
  expect(()=>sdk.accountWalletInstructions([instruction(sdk.FREEZE_ACCOUNTS_V3_DISCRIMINATOR)])).toThrow(/Unsupported/);
});
it('makes closed-claim netting explicit and binds the source market certificate',async()=>{
  const fixture=await environment(),client=new sdk.AccountUserClient(fixture.config),snapshot=await sdk.readAccountSnapshot(fixture.rpc,fixture.config,[fixture.margins[0]]);
  const instruction=await client.netClosedClaims(snapshot,fixture.owner,fixture.margins[0],0,7n);
  expect(sdk.getNetAccountClaimsV3InstructionDataDecoder().decode(instruction.data!)).toMatchObject({sourceMarket:0,amount:7n});
  const [certificate]=await sdk.findBackingV3Pda(fixture.config.venue,0);
  expect(instruction.accounts!.some(account=>account.address===certificate)).toBe(true);
  snapshot.roots[fixture.margins[0]].positions[0].lots=1n;
  await expect(client.netClosedClaims(snapshot,fixture.owner,fixture.margins[0],0,7n)).rejects.toThrow(/flat cross/);
});


it('discovers only canonical children of the selected owner portfolio and rejects substituted roots',async()=>{
  const fixture=await environment(),client=new sdk.AccountUserClient(fixture.config),calls:string[][]=[];
  client.rpc.call=async(method,params=[])=>{
    const keys=method==='getAccountInfo'?[params[0] as string]:params[0] as string[];
    calls.push(keys);return {context:{slot:100},value:method==='getAccountInfo'?fixture.accounts.get(keys[0])??null:keys.map(key=>fixture.accounts.get(key)??null)};
  };
  const owned=await client.ownerAccounts(fixture.owner,0);
  expect(owned.accounts.map(([key])=>key)).toEqual(fixture.margins);
  expect(calls).toEqual([[fixture.portfolio],fixture.margins]);
  const other=await client.ownerAccounts(fixture.owner,3);expect(other.accounts).toEqual([]);expect(other.portfolio.account).toBeNull();
  const root=sdk.getMarginAccountV3Decoder().decode(Buffer.from(fixture.accounts.get(fixture.margins[0]).data[0],'base64'));
  fixture.put(fixture.margins[0],sdk.getMarginAccountV3Encoder().encode({...root,owner:fixture.config.mint}));
  await expect(client.ownerAccounts(fixture.owner,0)).rejects.toThrow('Owner account identity mismatch');
});
