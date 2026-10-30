import {expect,it} from 'vitest';
import {address,getAddressEncoder,getProgramDerivedAddress,type Address,type Instruction,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from './index.js';

/** Independent byte fixtures test consumer identity/coherence, not program acceptance. */
async function environment(count=2){
  const domain='12'.repeat(32),[group,groupBump]=await sdk.findGroupPda({domain:Buffer.from(domain,'hex')});
  const [[registry,registryBump],[vault,vaultBump],[guard,guardBump],[resolution,resolutionBump],...marketPdas]=await Promise.all([
    sdk.findInitializeGroupV2RegistryPda({group}),sdk.findClassifyGroupSurplusV2VaultPda({group}),sdk.findGroupExitGuardPda({group}),
    sdk.findGroupResolutionPda({group}),sdk.findGroupMarketPda(group,0),sdk.findGroupMarketPda(group,1)]);
  const mint=address('11111111111111111111111111111111'),accounts=new Map<string,{owner:string;data:[string,string]}>();
  const put=(key:string,bytes:ArrayLike<number>,owner:string=sdk.CLEARING_PROGRAM_ADDRESS)=>accounts.set(key,{owner,data:[Buffer.from(bytes).toString('base64'),'base64']});
  const empty=<Value>(decoder:{fixedSize:number;decode:(bytes:Uint8Array)=>Value})=>decoder.decode(new Uint8Array(decoder.fixedSize));
  const members:Address[]=[],owners:Address[]=[];
  for(let index=0;index<count;index++){
    const [owner]=await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[new TextEncoder().encode(`sdk-owner-${index}`)]});
    const [portfolio,portfolioBump]=await sdk.findGroupPortfolioPda({group,owner,index:0});
    const [root,rootBump]=await sdk.findMarginPda({portfolio,subaccountIndex:0});
    members.push(root);owners.push(owner);
    put(root,sdk.getMarginAccountV2Encoder().encode({...empty(sdk.getMarginAccountV2Decoder()),schemaVersion:2,group,owner,portfolio,
      subaccountIndex:0,mode:0,role:0,isolatedMarketIndex:255,id:index,bump:rootBump,cash:100n}));
    put(portfolio,sdk.getPortfolioV2Encoder().encode({schemaVersion:2,group,owner,index:0,children:1,bump:portfolioBump}));
  }
  put(group,sdk.getClearingGroupV2Encoder().encode({...empty(sdk.getClearingGroupV2Decoder()),schemaVersion:2,profileVersion:2,
    domain:Buffer.from(domain,'hex'),quoteMint:mint,vault,markets:marketPdas.map(([key])=>key),marketCount:2,sequence:1n,mode:2,
    totalCash:BigInt(count)*100n,allocatedVault:BigInt(count)*100n,bump:groupBump,vaultBump}));
  put(registry,sdk.getGroupRegistryV2Encoder().encode({schemaVersion:2,group,count,members,bump:registryBump}));
  marketPdas.forEach(([key,bump],index)=>put(key,sdk.getGroupMarketV2Encoder().encode({...empty(sdk.getGroupMarketV2Decoder()),schemaVersion:2,group,index,
    lotsPerUnit:index===0?1_000_000n:100_000n,bump})));
  put(guard,sdk.getGroupExitGuardV2Encoder().encode({...empty(sdk.getGroupExitGuardV2Decoder()),schemaVersion:2,group,bump:guardBump}));
  const resolutionEmpty=sdk.getGroupResolutionV2Decoder().decode(new Uint8Array(423));
  put(resolution,sdk.getGroupResolutionV2Encoder().encode({...resolutionEmpty,schemaVersion:2,group,bump:resolutionBump}));
  const mintBytes=Buffer.alloc(82);mintBytes[44]=6;mintBytes[45]=1;put(mint,mintBytes,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const token=Buffer.alloc(165);token.set(getAddressEncoder().encode(mint),0);token.set(getAddressEncoder().encode(group),32);token.writeBigUInt64LE(BigInt(count)*100n,64);token[108]=1;
  put(vault,token,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const clock=Buffer.alloc(40);clock.writeBigUInt64LE(10n,0);clock.writeBigInt64LE(100n,32);put(sdk.GROUP_CLOCK,clock,'Sysvar1111111111111111111111111111111111111');
  const batches:string[][]=[];
  const rpc={call:async(method:string,params:unknown[]=[])=>{
    expect(method).toBe('getMultipleAccounts');const keys=params[0] as string[];batches.push(keys);
    return {context:{slot:100},value:keys.map(key=>accounts.get(key)??null)};
  }};
  const config:sdk.GroupUserConfig={version:2,chain:'solana:localnet',profile:'cross-safety-qualification',rpcUrl:'http://127.0.0.1:1',wsUrl:'ws://127.0.0.1:2',
    genesis:mint,anchor:'1'.repeat(88),anchorHash:'00'.repeat(32),group,mint,domain};
  return {config,accounts,rpc,batches,members,owners,guard,put};
}

it('reads the complete 64-member group with bounded requests and one cash owner per root',async()=>{
  const fixture=await environment(64),snapshot=await sdk.readGroupSnapshot(fixture.rpc,fixture.config);
  expect(snapshot.members).toHaveLength(64);expect(Object.keys(snapshot.portfolios)).toHaveLength(64);
  expect(snapshot.actualVault).toBe(6400n);expect(fixture.batches.every(batch=>batch[0]===fixture.config.group&&batch.length<=100)).toBe(true);
  expect(fixture.batches.reduce((count,batch)=>count+batch.length,0)).toBeGreaterThan(100);
});
it('rejects a group mutation between dependency requests and wrong root discriminators',async()=>{
  const fixture=await environment();const original=fixture.rpc.call;
  fixture.rpc.call=async(method,params)=>{
    if(fixture.batches.length===1){const data=fixture.accounts.get(fixture.config.group)!;const state=sdk.getClearingGroupV2Decoder().decode(Buffer.from(data.data[0],'base64'));
      fixture.put(fixture.config.group,sdk.getClearingGroupV2Encoder().encode({...state,sequence:2n}));}
    return original(method,params);
  };
  await expect(sdk.readGroupSnapshot(fixture.rpc,fixture.config)).rejects.toThrow(/changed during snapshot/);
  fixture.rpc.call=original;const data=fixture.accounts.get(fixture.members[0])!,bytes=Buffer.from(data.data[0],'base64');bytes[0]^=1;fixture.put(fixture.members[0],bytes);
  await expect(sdk.readGroupSnapshot(fixture.rpc,fixture.config)).rejects.toThrow(/discriminator/);
});
it('builds certificates separately from exits and does not treat positive unpaid claims as cash',async()=>{
  const fixture=await environment(),client=new sdk.GroupUserClient(fixture.config),snapshot=await sdk.readGroupSnapshot(fixture.rpc,fixture.config);
  const plan=await client.exit(snapshot,fixture.owners[0],fixture.members[0],fixture.config.mint,1n);
  expect(plan.verificationOnly).toBe(true);expect(plan.instructions).toHaveLength(2);
  expect(sdk.getCheckGroupExitV2InstructionDataDecoder().decode(plan.instructions[1].data!).start).toBe(0);
  expect(plan.instructions[1].accounts!.slice(-2).every(account=>account.role===0)).toBe(true);
  Object.assign(snapshot.certificate!,{sequence:1n,observations:[0n,0n],count:2,next:2});
  const exit=await client.exit(snapshot,fixture.owners[0],fixture.members[0],fixture.config.mint,1n);
  expect(exit.verificationOnly).toBe(false);expect(sdk.getGroupTradingCashV2InstructionDataDecoder().decode(exit.instructions[0].data!)).toMatchObject({withdraw:true,amount:1n});
  snapshot.roots[fixture.members[0]].positions[0].virtualScaled=10_000_000_000n;
  await expect(client.exit(snapshot,fixture.owners[0],fixture.members[0],fixture.config.mint,101n)).rejects.toThrow(/Funded exit/);
  const deposit=await client.deposit(snapshot,fixture.owners[0],fixture.members[0],fixture.config.mint,1n);
  expect(sdk.getGroupTradingCashV2InstructionDataDecoder().decode(deposit.data!)).toMatchObject({withdraw:false});
});
it('rejects a stale exposed certificate but permits a completely flat stale-price exit',async()=>{
  const fixture=await environment(),snapshot=await sdk.readGroupSnapshot(fixture.rpc,fixture.config);
  Object.assign(snapshot.certificate!,{sequence:1n,observations:[0n,0n],count:2,next:2});
  expect(sdk.groupExitProof(snapshot).complete).toBe(true);
  snapshot.certificate!.grossLots=[1n,1n];expect(()=>sdk.groupExitProof(snapshot)).toThrow(/price expired/);
  snapshot.certificate!.grossLots=[0n,0n];snapshot.certificate!.fundingBounds[1]=[1n,2n];expect(()=>sdk.groupExitProof(snapshot)).toThrow(/funding expired/);
});
it('binds owner transfers and delegated cancellation to one root without requiring a fresh price',async()=>{
  const fixture=await environment(),client=new sdk.GroupUserClient(fixture.config),snapshot=await sdk.readGroupSnapshot(fixture.rpc,fixture.config);
  await expect(client.transfer(snapshot,fixture.owners[0],fixture.members[0],fixture.members[1],1n)).rejects.toThrow(/Owner margin/);
  const root=snapshot.roots[fixture.members[0]];root.delegate=fixture.owners[1];root.delegateExpirySlot=20n;
  Object.assign(root.book.orders[0],{marketIndex:1});Object.assign(root.book.orders[0].order,{id:1n,version:2n,state:1});
  const cancel=await client.cancel(snapshot,fixture.owners[1],fixture.members[0],1n,2n);
  expect(sdk.getManageMarginOrderV2InstructionDataDecoder().decode(cancel.data!).operation).toEqual({__kind:'Cancel',id:1n,version:2n,protectionGroup:false});
  snapshot.slot=20n;await expect(client.cancel(snapshot,fixture.owners[1],fixture.members[0],1n,2n)).rejects.toThrow(/Live account/);
});
it('uses distinct measured transaction budgets and rejects arbitrary two-action envelopes',()=>{
  const instruction=(data:ReadonlyUint8Array):Instruction=>({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,accounts:[],data});
  expect(sdk.hex(sdk.groupWalletInstructions([instruction(sdk.EXECUTE_MARGIN_ROUTE_V2_DISCRIMINATOR)])[0].data!)).toBe('02c0270900');
  expect(sdk.hex(sdk.groupWalletInstructions([instruction(sdk.TRANSFER_TRADING_CASH_V2_DISCRIMINATOR),instruction(sdk.EXECUTE_MARGIN_ROUTE_V2_DISCRIMINATOR)])[0].data!)).toBe('0260ae0a00');
  expect(()=>sdk.groupWalletInstructions([instruction(sdk.DEPOSIT_GROUP_V2_DISCRIMINATOR),instruction(sdk.EXECUTE_MARGIN_ROUTE_V2_DISCRIMINATOR)])).toThrow(/Only explicit/);
});
it('requires the exact pinned initialization hash and retains local-only deployment scope',async()=>{
  const fixture=await environment(),client=new sdk.GroupUserClient(fixture.config);
  client.rpc.call=async method=>method==='getGenesisHash'?fixture.config.genesis:{meta:{err:null},transaction:{signatures:[fixture.config.anchor]}};
  await expect(client.environment()).rejects.toThrow(/history mismatch/);
  expect(()=>sdk.groupUserConfig({...fixture.config,chain:'solana:devnet'} as any)).toThrow(/qualified local/);
  expect(()=>sdk.groupUserConfig({...fixture.config,rpcUrl:'http://127.0.0.1:1/?api-key=redacted'})).toThrow(/credentials/);
});

it('reads owned classic collateral exactly and rejects substituted owners/mints/programs/layouts',async()=>{
  const fixture=await environment(),client=new sdk.GroupUserClient(fixture.config),owner=fixture.owners[0];
  const bytes=Buffer.alloc(165);bytes.set(getAddressEncoder().encode(fixture.config.mint));bytes.set(getAddressEncoder().encode(owner),32);bytes.writeBigUInt64LE(123_456n,64);bytes[108]=1;
  const row={pubkey:fixture.members[0],account:{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:[bytes.toString('base64'),'base64']}};
  client.rpc.call=async(method,params)=>{expect(method).toBe('getTokenAccountsByOwner');expect(params?.[1]).toEqual({mint:fixture.config.mint});return {value:[row]};};
  expect(await client.walletTokens(owner)).toEqual([{address:fixture.members[0],amount:123456n}]);
  for(const offset of [0,32]){const altered=Buffer.from(bytes);altered[offset]^=1;row.account.data[0]=altered.toString('base64');await expect(client.walletTokens(owner)).rejects.toThrow(/owner\/mint/);}
  row.account.data[0]=Buffer.concat([bytes,Buffer.alloc(1)]).toString('base64');await expect(client.walletTokens(owner)).rejects.toThrow(/layout/);
  row.account.owner=sdk.CLEARING_PROGRAM_ADDRESS;await expect(client.walletTokens(owner)).rejects.toThrow(/Foreign collateral/);
});
it('discovers an empty owner portfolio before its first root and authenticates immutable identity',async()=>{
  const fixture=await environment(),client=new sdk.GroupUserClient(fixture.config),owner=fixture.owners[0];
  const [portfolio,bump]=await sdk.findGroupPortfolioPda({group:fixture.config.group,owner,index:0});
  let value:any=null;
  client.rpc.call=async(method,params)=>{expect(method).toBe('getAccountInfo');expect(params?.[0]).toBe(portfolio);return {value};};
  expect((await client.ownerPortfolio(owner)).account).toBeNull();
  const state={schemaVersion:2,group:fixture.config.group,owner,index:0,children:0,bump};
  value={owner:sdk.CLEARING_PROGRAM_ADDRESS,data:[Buffer.from(sdk.getPortfolioV2Encoder().encode(state)).toString('base64'),'base64']};
  expect((await client.ownerPortfolio(owner)).account?.children).toBe(0);
  value.data[0]=Buffer.from(sdk.getPortfolioV2Encoder().encode({...state,index:1})).toString('base64');
  await expect(client.ownerPortfolio(owner)).rejects.toThrow(/identity/);
});
