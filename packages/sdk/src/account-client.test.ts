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
it('preserves actual Clock separately from a lagging Surfpool RPC commitment context',async()=>{
  const fixture=await environment();
  const clock=Buffer.from(fixture.accounts.get(sdk.ACCOUNT_CLOCK).data[0],'base64');
  clock.writeBigUInt64LE(101n,0);
  fixture.accounts.get(sdk.ACCOUNT_CLOCK).data[0]=clock.toString('base64');
  const snapshot=await sdk.readAccountSnapshot(fixture.rpc,fixture.config,[fixture.margins[0]]);
  expect(snapshot.slot).toBe(101n);expect(snapshot.contextSlot).toBe(100n);
});
it('does not invalidate selected-account discovery when an unrelated invocation advances custody revision',async()=>{
  const fixture=await environment(),original=fixture.rpc.call;
  fixture.rpc.call=async(method,params)=>{
    if(fixture.batches.length===1) {
      const current=sdk.getCustodyDecoder().decode(Buffer.from(fixture.accounts.get(fixture.custody).data[0],'base64'));
      fixture.put(fixture.custody,sdk.getCustodyEncoder().encode({...current,revision:8n}));
    }return original(method,params);
  };
  const snapshot=await sdk.readAccountSnapshot(fixture.rpc,fixture.config,fixture.margins);
  expect(snapshot.custodyState.revision).toBe(8n);expect(Object.keys(snapshot.roots)).toHaveLength(2);
  expect(fixture.batches[1]).toHaveLength(13);
});
it('builds one atomic funded withdrawal with only root-local authority guards',async()=>{
  const fixture=await environment(),client=new sdk.AccountUserClient(fixture.config),snapshot=await sdk.readAccountSnapshot(fixture.rpc,fixture.config,[fixture.margins[0]]);
  const plan=await client.exit(snapshot,fixture.owner,fixture.margins[0],fixture.config.mint,17n);
  expect(plan.instructions).toHaveLength(1);
  expect(sdk.getWithdrawFundedAccountInstructionDataDecoder().decode(plan.instructions[0].data!)).toMatchObject({amount:17n,guard:{safetyEpoch:2n,venueTermsEpoch:1n,nonce:4n,stateVersion:9n}});
  expect(plan.instructions[0].accounts!.some(account=>account.address===fixture.margins[1])).toBe(false);
  snapshot.roots[fixture.margins[0]].positions[0].virtualScaled=999_000_000_000n;
  await expect(client.exit(snapshot,fixture.owner,fixture.margins[0],fixture.config.mint,50_001n)).rejects.toThrow(/Funded exit/);
  snapshot.safetyState.mode=2;await expect(client.exit(snapshot,fixture.owner,fixture.margins[0],fixture.config.mint,1n)).rejects.toThrow(/Funded exit/);
});
it('checks ownership, same-owner allocation and live delegated stale-source cancellation',async()=>{
  const fixture=await environment(),client=new sdk.AccountUserClient(fixture.config),snapshot=await sdk.readAccountSnapshot(fixture.rpc,fixture.config,fixture.margins);
  const [donor,recipient]=fixture.margins;
  const transfer=await client.transfer(snapshot,fixture.owner,donor,recipient,17n);
  expect(sdk.getTransferFundedAccountInstructionDataDecoder().decode(transfer.data!).amount).toBe(17n);
  const actor=fixture.config.mint;Object.assign(snapshot.roots[donor],{delegate:actor,delegateExpirySlot:101n});
  Object.assign(snapshot.roots[donor].book.orders[0],{marketIndex:1});Object.assign(snapshot.roots[donor].book.orders[0].order,{id:1n,version:2n,state:1});
  const cancel=await client.cancel(snapshot,actor,donor,1n,2n);
  expect(sdk.getManageAccountOrderInstructionDataDecoder().decode(cancel.data!).operation).toEqual({__kind:'Cancel',id:1n,version:2n,protectionGroup:false});
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
  const {config}=await environment();expect(sdk.accountUserConfig(config).version).toBe(4);
  expect(()=>sdk.accountUserConfig({...config,version:3} as unknown as sdk.AccountUserConfig)).toThrow(/qualified local/);
  expect(()=>sdk.accountUserConfig({...config,rpcUrl:config.rpcUrl+'?secret=x'})).toThrow(/credentials/);
  const instruction=(data:ReadonlyUint8Array):Instruction=>({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,accounts:[],data});
  expect(Buffer.from(sdk.accountWalletInstructions([instruction(sdk.WITHDRAW_FUNDED_ACCOUNT_DISCRIMINATOR)])[0].data!).readUInt32LE(1)).toBe(400_000);
  expect(Buffer.from(sdk.accountWalletInstructions([instruction(sdk.EXECUTE_LIQUIDITY_ROUTE_DISCRIMINATOR)])[0].data!).readUInt32LE(1)).toBe(800_000);
  expect(()=>sdk.accountWalletInstructions([instruction(sdk.FREEZE_ACCOUNTS_DISCRIMINATOR)])).toThrow(/Unsupported/);
  // Frozen pre-RC2 route ID: an old signed intent cannot become a new action.
  const oldRoute = Uint8Array.from([195,172,220,84,16,82,29,7]);
  expect(()=>sdk.accountWalletInstructions([instruction(oldRoute)])).toThrow(/Unsupported/);
});
it('makes closed-claim netting explicit and binds the source market certificate',async()=>{
  const fixture=await environment(),client=new sdk.AccountUserClient(fixture.config),snapshot=await sdk.readAccountSnapshot(fixture.rpc,fixture.config,[fixture.margins[0]]);
  const instruction=await client.netClosedClaims(snapshot,fixture.owner,fixture.margins[0],0,7n);
  expect(sdk.getNetAccountClaimsInstructionDataDecoder().decode(instruction.data!)).toMatchObject({sourceMarket:0,amount:7n});
  const [certificate]=await sdk.deriveSettlementCertificate(fixture.config.venue,0);
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
  expect(calls).toHaveLength(1);expect(calls[0]).toHaveLength(10);expect(calls[0].slice(0,3)).toEqual([fixture.portfolio,...fixture.margins]);
  const other=await client.ownerAccounts(fixture.owner,3);expect(other.accounts).toEqual([]);expect(other.portfolio.account).toBeNull();
  const root=sdk.getMarginAccountDecoder().decode(Buffer.from(fixture.accounts.get(fixture.margins[0]).data[0],'base64'));
  fixture.put(fixture.margins[0],sdk.getMarginAccountEncoder().encode({...root,owner:fixture.config.mint}));
  await expect(client.ownerAccounts(fixture.owner,0)).rejects.toThrow('Owner account identity mismatch');
});

it('requires explicit schema-10 deployment selection independently of profile version', async () => {
  const fixture = await environment();
  expect(sdk.accountUserConfig(fixture.config).accountSchema).toBe(10);
  expect(() => sdk.accountUserConfig({...fixture.config, accountSchema: 9 as 10})).toThrow(/Explicit qualified/);
  expect(sdk.accountUserConfig({...fixture.config,deployment:'selected'}).deployment).toBe('selected');
  expect(()=>sdk.accountUserConfig({...fixture.config,deployment:'old-baseline'} as unknown as sdk.AccountUserConfig)).toThrow(/Explicit qualified/);
  const {accountSchema: _schema, ...missing} = fixture.config;
  expect(() => sdk.accountUserConfig(missing as sdk.AccountUserConfig)).toThrow(/Explicit qualified/);
});

it('keeps Registered and permanently retired identities distinct with exact high member IDs',async()=>{
  const fixture=await environment(),client=new sdk.AccountUserClient(fixture.config);
  client.rpc.call=fixture.rpc.call;
  const read=(key:string)=>Buffer.from(fixture.accounts.get(key).data[0],'base64');
  const first=sdk.getMarginAccountDecoder().decode(read(fixture.margins[0]));
  fixture.put(fixture.margins[0],sdk.getMarginAccountEncoder().encode({...first,id:(1n<<54n)+1n,lifecycle:1,cash:0n}));
  const last=sdk.getMarginAccountDecoder().decode(read(fixture.margins[1]));
  fixture.put(fixture.margins[1],sdk.getMarginTombstoneEncoder().encode({schemaVersion:10,revision:5n,
    venue:last.venue,portfolio:last.portfolio,owner:last.owner,child:1,id:(1n<<54n)+2n,activationGeneration:7n,bump:last.bump}));
  const portfolio=sdk.getPortfolioDecoder().decode(read(fixture.portfolio));
  fixture.put(fixture.portfolio,sdk.getPortfolioEncoder().encode({...portfolio,activeChildren:1}));
  const result=await client.ownerAccounts(fixture.owner);
  expect(result.accounts.map(([,root])=>[root.lifecycle,root.id])).toEqual([[1,(1n<<54n)+1n]]);
  expect(result.retired.map(([,root])=>[root.child,root.id])).toEqual([[1,(1n<<54n)+2n]]);
  expect(result.contextSlot).toBe(100n);expect(fixture.batches).toHaveLength(1);
  fixture.put(fixture.portfolio,sdk.getPortfolioEncoder().encode({...portfolio,activeChildren:2}));
  await expect(client.ownerAccounts(fixture.owner)).rejects.toThrow(/Incomplete owner namespace/);
  fixture.accounts.delete(fixture.portfolio);
  await expect(client.ownerAccounts(fixture.owner)).rejects.toThrow(/without a portfolio/);
});
it('fails owner discovery closed on missing children, mixed domains and retired identity substitution',async()=>{
  for(const mutation of ['missing','foreign','retired','truncated']) {
    const fixture=await environment(),client=new sdk.AccountUserClient(fixture.config);
    client.rpc.call=fixture.rpc.call;
    const key=fixture.margins[1],root=sdk.getMarginAccountDecoder().decode(Buffer.from(fixture.accounts.get(key).data[0],'base64'));
    if(mutation==='missing')fixture.accounts.delete(key);
    if(mutation==='foreign')fixture.put(key,sdk.getMarginAccountEncoder().encode({...root,venue:fixture.config.mint}));
    if(mutation==='retired')fixture.put(key,sdk.getMarginTombstoneEncoder().encode({schemaVersion:10,revision:1n,
      venue:root.venue,portfolio:root.portfolio,owner:root.owner,child:7,id:root.id,activationGeneration:1n,bump:root.bump}));
    if(mutation==='truncated')client.rpc.call=async()=>({context:{slot:100},value:[]});
    await expect(client.ownerAccounts(fixture.owner)).rejects.toThrow();
  }
});
