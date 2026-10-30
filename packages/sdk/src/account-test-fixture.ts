import {liquidityAccountFixture} from '../test-support/liquidity-accounts.js';
import {expect} from 'vitest';
import {address,getAddressEncoder,getProgramDerivedAddress,type Address,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from './index.js';

/** Bounded codec/consumer vectors. Actual signed financial acceptance is separate. */
export async function accountFixture() {
  const domain='34'.repeat(32),[venue,bump]=await sdk.deriveAccountVenue(Buffer.from(domain,'hex'));
  const [[custody,custodyBump],[safety,safetyBump],[vault,vaultBump],...marketPdas]=await Promise.all([
    sdk.deriveVenueComponent(venue,'custody'),sdk.deriveVenueComponent(venue,'safety'),sdk.deriveVenueComponent(venue,'vault'),
    sdk.deriveAccountMarket(venue,0),sdk.deriveAccountMarket(venue,1)]);
  const ledgerPdas=await Promise.all(marketPdas.map(([market])=>sdk.deriveMarketLedger(market)));
  const [owner]=await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('p27-unit-owner')]});
  const [portfolio,portfolioBump]=await sdk.deriveAccountPortfolio(venue,owner,0);
  const margins=await Promise.all([0,1].map(index=>sdk.deriveMarginAccount(portfolio,index)));
  const mint=address('11111111111111111111111111111111'),accounts=new Map<string,any>();
  const put=(key:string,data:ReadonlyUint8Array|Uint8Array,owner:string=sdk.CLEARING_PROGRAM_ADDRESS)=>accounts.set(key,{owner,data:[Buffer.from(data).toString('base64'),'base64']});
  const empty=<Value>(decoder:{fixedSize:number;decode(bytes:Uint8Array):Value})=>decoder.decode(new Uint8Array(decoder.fixedSize));
  put(venue,sdk.getVenueEncoder().encode({...empty(sdk.getVenueDecoder()),schemaVersion:5,revision:1n,profileVersion:4,domain:Buffer.from(domain,'hex'),
    quoteMint:mint,vault,markets:marketPdas.map(([key])=>key),marketCount:2,insuranceFeeShareBps:2500,termsEpoch:1n,configEpoch:1n,bump,vaultBump}));
  put(custody,sdk.getCustodyEncoder().encode({schemaVersion:5,revision:1n,venue,totalCash:100_000n,allocatedVault:100_010n,liabilityVersions:[1n,1n],bump:custodyBump}));
  put(safety,sdk.getVenueSafetyEncoder().encode({schemaVersion:5,revision:1n,venue,mode:1,paused:false,epoch:2n,resolutionEpoch:0n,recoverySince:0n,recoveryLast:0n,bump:safetyBump}));
  for(const [index,[key,marketBump]] of marketPdas.entries()) {
    put(key,sdk.getMarketEncoder().encode({...empty(sdk.getMarketDecoder()),schemaVersion:5,revision:1n,venue,index,lotsPerUnit:index===0?1_000_000n:100_000n,
      crossEligible:true,termsEpoch:1n,configEpoch:1n,bump:marketBump}));
    put(ledgerPdas[index][0],sdk.getMarketLedgerEncoder().encode({schemaVersion:5,revision:1n,venue,market:key,marketIndex:index,settlement:0n,insurance:index===0?10n:0n,
      fees:0n,insuranceFeeRemainder:index===0?3:0,version:1n,bump:ledgerPdas[index][1]}));
  }
  put(portfolio,sdk.getPortfolioEncoder().encode({schemaVersion:5,revision:1n,venue,owner,index:0,children:3,bump:portfolioBump}));
  for(const [index,[key,marginBump]] of margins.entries())put(key,sdk.getMarginAccountEncoder().encode({...empty(sdk.getMarginAccountDecoder()),schemaVersion:5,revision:1n,venue,
    owner,portfolio,id:index,subaccountIndex:index,mode:index,isolatedMarketIndex:index===0?255:1,cash:50_000n,nonce:4n,stateVersion:9n,delegateEpoch:1n,bump:marginBump}));
  const mintBytes=Buffer.alloc(82);mintBytes[44]=6;mintBytes[45]=1;put(mint,mintBytes,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const token=Buffer.alloc(165);token.set(getAddressEncoder().encode(mint));token.set(getAddressEncoder().encode(venue),32);token.writeBigUInt64LE(100_010n,64);token[108]=1;
  put(vault,token,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const clock=Buffer.alloc(40);clock.writeBigUInt64LE(100n);clock.writeBigInt64LE(500n,32);put(sdk.ACCOUNT_CLOCK,clock,'Sysvar1111111111111111111111111111111111111');
  const batches:Address[][]=[],rpc={call:async(method:string,params:unknown[]=[])=>{
    expect(method).toBe('getMultipleAccounts');const keys=params[0] as Address[];batches.push(keys);return {context:{slot:100},value:keys.map(key=>accounts.get(key)??null)};
  }};
  const config:sdk.AccountUserConfig={version:4,accountSchema:5 as const,chain:'solana:localnet',profile:'liquidity-execution-qualification',rpcUrl:'http://127.0.0.1:1',wsUrl:'ws://127.0.0.1:2',
    genesis:mint,anchor:'1'.repeat(88),anchorHash:'00'.repeat(32),venue,mint,domain};
  return {config,accounts,put,rpc,batches,margins:margins.map(([key])=>key),owner,portfolio,custody,safety,empty,marketPdas};
}

/** Bounded encoded RPC fixtures, never runtime acceptance or trusted artifacts. */
export async function accountTradeFixture() {
  const fixture=await accountFixture(),{put,empty,config,accounts}=fixture;
  for(const [index,[market,bump]] of fixture.marketPdas.entries()) {
    const state={...empty(sdk.getMarketDecoder()),schemaVersion:5,revision:1n,venue:config.venue,index,bump,crossEligible:true,
      termsEpoch:1n,configEpoch:1n,lotsPerUnit:index===0?1_000_000n:100_000n,referencePrice:10_000n,lower:9900n,upper:10100n,validFrom:1n,validUntil:1000n};
    Object.assign(state.oracle,{status:2,sampledAt:500n,sourceDeadline:520n,lastQualified:500n,heldEpoch:1n,heldUntil:506n,heldSlot:1000n});
    put(market,sdk.getMarketEncoder().encode(state));
  }
  const makers=await liquidityAccountFixture({venue:config.venue,market:fixture.marketPdas[0][0],
    domain:Buffer.from(config.domain,'hex'),slot:100n,now:500n});
  for(const [key,account]of makers.accounts)accounts.set(key,account);
  return {...fixture,makers:makers.states};
}
