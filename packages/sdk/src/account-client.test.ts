import {it,expect} from 'vitest';
import {address,getAddressEncoder,getProgramDerivedAddress,type Address,type ReadonlyUint8Array,type Instruction} from '@solana/kit';
import * as sdk from './index.js';

/** Bounded codec/consumer vectors. Actual signed financial acceptance is separate. */
async function environment() {
  const domain='34'.repeat(32),[venue,bump]=await sdk.deriveAccountVenue(Buffer.from(domain,'hex'));
  const [[custody,custodyBump],[safety,safetyBump],[vault,vaultBump],...marketPdas]=await Promise.all([
    sdk.findVenueComponentV3Pda(venue,'custody'),sdk.findVenueComponentV3Pda(venue,'safety'),sdk.findVenueComponentV3Pda(venue,'vault'),
    sdk.findMarketV3Pda(venue,0),sdk.findMarketV3Pda(venue,1)]);
  const ledgerPdas=await Promise.all(marketPdas.map(([market])=>sdk.findLedgerV3Pda(market)));
  const [owner]=await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('p27-unit-owner')]});
  const [portfolio,portfolioBump]=await sdk.deriveAccountPortfolio(venue,owner,0);
  const margins=await Promise.all([0,1].map(index=>sdk.findMarginV3Pda(portfolio,index)));
  const mint=address('11111111111111111111111111111111'),accounts=new Map<string,any>();
  const put=(key:string,data:ReadonlyUint8Array|Uint8Array,owner:string=sdk.CLEARING_PROGRAM_ADDRESS)=>accounts.set(key,{owner,data:[Buffer.from(data).toString('base64'),'base64']});
  const empty=<Value>(decoder:{fixedSize:number;decode(bytes:Uint8Array):Value})=>decoder.decode(new Uint8Array(decoder.fixedSize));
  put(venue,sdk.getVenueV3Encoder().encode({...empty(sdk.getVenueV3Decoder()),schemaVersion:3,profileVersion:3,domain:Buffer.from(domain,'hex'),
    quoteMint:mint,vault,markets:marketPdas.map(([key])=>key),marketCount:2,insuranceFeeShareBps:2500,termsEpoch:1n,configEpoch:1n,bump,vaultBump}));
  put(custody,sdk.getCustodyV3Encoder().encode({schemaVersion:3,venue,totalCash:100_000n,allocatedVault:100_010n,sequence:7n,liabilityVersions:[1n,1n],bump:custodyBump}));
  put(safety,sdk.getSafetyV3Encoder().encode({schemaVersion:3,venue,mode:1,paused:false,epoch:2n,resolutionEpoch:0n,recoverySince:0n,recoveryLast:0n,bump:safetyBump}));
  for(const [index,[key,marketBump]] of marketPdas.entries()) {
    put(key,sdk.getMarketV3Encoder().encode({...empty(sdk.getMarketV3Decoder()),schemaVersion:3,venue,index,lotsPerUnit:index===0?1_000_000n:100_000n,
      crossEligible:true,termsEpoch:1n,configEpoch:1n,bump:marketBump}));
    put(ledgerPdas[index][0],sdk.getMarketLedgerV3Encoder().encode({schemaVersion:3,venue,market:key,marketIndex:index,settlement:0n,insurance:index===0?10n:0n,
      fees:0n,insuranceFeeRemainder:index===0?3:0,version:1n,bump:ledgerPdas[index][1]}));
  }
  put(portfolio,sdk.getPortfolioV3Encoder().encode({schemaVersion:3,venue,owner,index:0,children:3,bump:portfolioBump}));
  for(const [index,[key,marginBump]] of margins.entries())put(key,sdk.getMarginAccountV3Encoder().encode({...empty(sdk.getMarginAccountV3Decoder()),schemaVersion:3,venue,
    owner,portfolio,id:index,subaccountIndex:index,mode:index,isolatedMarketIndex:index===0?255:1,cash:50_000n,nonce:4n,stateVersion:9n,delegateEpoch:1n,bump:marginBump}));
  const mintBytes=Buffer.alloc(82);mintBytes[44]=6;mintBytes[45]=1;put(mint,mintBytes,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const token=Buffer.alloc(165);token.set(getAddressEncoder().encode(mint));token.set(getAddressEncoder().encode(venue),32);token.writeBigUInt64LE(100_010n,64);token[108]=1;
  put(vault,token,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const clock=Buffer.alloc(40);clock.writeBigUInt64LE(100n);clock.writeBigInt64LE(500n,32);put(sdk.ACCOUNT_CLOCK,clock,'Sysvar1111111111111111111111111111111111111');
  const batches:Address[][]=[],rpc={call:async(method:string,params:unknown[]=[])=>{
    expect(method).toBe('getMultipleAccounts');const keys=params[0] as Address[];batches.push(keys);return {context:{slot:100},value:keys.map(key=>accounts.get(key)??null)};
  }};
  const config:sdk.AccountUserConfig={version:3,chain:'solana:localnet',profile:'account-safety-qualification',rpcUrl:'http://127.0.0.1:1',wsUrl:'ws://127.0.0.1:2',
    genesis:mint,anchor:'1'.repeat(88),anchorHash:'00'.repeat(32),venue,mint,domain};
  return {config,accounts,put,rpc,batches,margins:margins.map(([key])=>key),owner,portfolio,custody};
}
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
