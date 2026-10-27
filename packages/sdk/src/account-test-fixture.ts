import {expect} from 'vitest';
import {address,getAddressEncoder,getProgramDerivedAddress,type Address,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from './index.js';

/** Bounded codec/consumer vectors. Actual signed financial acceptance is separate. */
export async function accountFixture() {
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
  return {config,accounts,put,rpc,batches,margins:margins.map(([key])=>key),owner,portfolio,custody,safety,empty,marketPdas};
}

/** Bounded encoded RPC fixtures, never runtime acceptance or trusted artifacts. */
export async function accountTradeFixture() {
  const fixture=await accountFixture(),{put,empty,config,accounts}=fixture;
  for(const [index,[market,bump]] of fixture.marketPdas.entries()) {
    const state={...empty(sdk.getMarketV3Decoder()),schemaVersion:3,venue:config.venue,index,bump,crossEligible:true,
      termsEpoch:1n,configEpoch:1n,lotsPerUnit:index===0?1_000_000n:100_000n,referencePrice:10_000n,lower:9900n,upper:10100n,validFrom:1n,validUntil:1000n};
    Object.assign(state.oracle,{status:2,sampledAt:500n,sourceDeadline:520n,lastQualified:500n,heldEpoch:1n,heldUntil:506n,heldSlot:1000n});
    put(market,sdk.getMarketV3Encoder().encode(state));
  }
  const loader=address('BPFLoaderUpgradeab1e11111111111111111111111'),market=fixture.marketPdas[0][0];
  const makers=[];
  for(const makerId of [0,1]) {
    const pricingProgram=makerId===0?sdk.makerA.MAKER_A_PROGRAM_ADDRESS:sdk.makerB.MAKER_B_PROGRAM_ADDRESS;
    const [owner]=await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from(`p27-maker-${makerId}`)]});
    const [portfolio,portfolioBump]=await sdk.deriveAccountPortfolio(config.venue,owner,0);
    const [capital,capitalBump]=await sdk.findMarginV3Pda(portfolio,1);
    const [registration,bump]=await sdk.findAccountMakerV3Pda(market,makerId);
    const [makerConfig,configBump]=await getProgramDerivedAddress({programAddress:pricingProgram,seeds:[Buffer.from('maker-v3'),getAddressEncoder().encode(capital)]});
    const [programData]=await getProgramDerivedAddress({programAddress:loader,seeds:[getAddressEncoder().encode(pricingProgram)]});
    const executable=Buffer.alloc(36);executable.writeUInt32LE(2);executable.set(getAddressEncoder().encode(programData),4);
    put(pricingProgram,executable,loader);accounts.get(pricingProgram).executable=true;
    const code=Buffer.alloc(64);code.writeUInt32LE(3);put(programData,code,loader);
    const approvedHash=new Uint8Array(await crypto.subtle.digest('SHA-256',code));
    put(portfolio,sdk.getPortfolioV3Encoder().encode({schemaVersion:3,venue:config.venue,owner,index:0,children:2,bump:portfolioBump}));
    put(capital,sdk.getMarginAccountV3Encoder().encode({...empty(sdk.getMarginAccountV3Decoder()),schemaVersion:3,venue:config.venue,
      owner,portfolio,id:makerId+2,subaccountIndex:1,mode:1,role:1,isolatedMarketIndex:0,cash:500_000_000n,bump:capitalBump}));
    put(makerConfig,sdk.makerA.getMakerAccountConfigEncoder().encode({venue:config.venue,state:{version:3,makerId,owner,market,capital,
      domain:Buffer.from(config.domain,'hex'),quoteEpoch:1n,startSlot:1n,expirySlot:1000n,bump:configBump}}),pricingProgram);
    const state={...empty(sdk.getMakerRegistrationV3Decoder()),schemaVersion:3,venue:config.venue,market,marketIndex:0,makerId,owner,capital,
      config:makerConfig,pricingProgram,programData,approvedHash,authorityEpoch:1n,quoteEpoch:1n,startSlot:1n,expirySlot:1000n,inventoryLimit:100_000n,bump};
    put(registration,sdk.getMakerRegistrationV3Encoder().encode(state));
    makers.push({registration,capital,config:makerConfig,pricingProgram,programData,state});
  }
  return {...fixture,makers};
}
