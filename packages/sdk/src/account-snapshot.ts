import {address,type Address,type Decoder,type ReadonlyUint8Array} from '@solana/kit';
import {getMintDecoder,getTokenDecoder,TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import * as protocol from './generated/index.js';
import {deriveAccountVenue,deriveAccountPortfolio,findVenueComponentV3Pda,findMarketV3Pda,findLedgerV3Pda,findMarginV3Pda,findAccountMakerV3Pda} from './account-addresses.js';
import {authenticateAccountMakers,type AccountMakerIdentity} from './account-makers.js';
import {authenticateLiquidityMarket,discoverLiquidityAccounts} from './liquidity-adapter.js';
import {fromBase64,hex,requireValue,rpcInteger,type UserRpc} from './wallet-client.js';

export type AccountIdentity={venue:Address;mint:Address;domain:string};
export const ACCOUNT_CLOCK=address('SysvarC1ock11111111111111111111111111111111');

/** An ordinary action reads only its selected root(s), portfolio identity and the
 * fixed two-market dependencies. Discovery reads immutable root identities; the
 * final financial snapshot is ONE RPC batch, with no whole-registry scan or global
 * discovery-sequence retry. A caller still simulates the actual atomic instruction. */
export async function readAccountSnapshot(rpc:Pick<UserRpc,'call'>,identity:AccountIdentity,margins:Address[],
  commitment:'confirmed'|'finalized'='finalized') {
  requireValue(margins.length>=1&&margins.length<=2&&new Set(margins).size===margins.length,'Select one or two distinct margin accounts.');
  return readSnapshot(rpc,identity,margins,commitment);
}
/** Profile-4 funded balances/exits have no maker dependency or discovery scan. */
export async function readLiquiditySnapshot(rpc:Pick<UserRpc,'call'>,identity:AccountIdentity,margins:Address[],
  commitment:'confirmed'|'finalized'='finalized') {
  requireValue(margins.length>=1&&margins.length<=2&&new Set(margins).size===margins.length,'Select one or two distinct margin accounts.');
  return readSnapshot(rpc,identity,margins,commitment,undefined,undefined,4);
}
/** Trading adds only the selected market's two maker registrations/capitals and
 * immutable pricing dependencies, all in the same final financial batch. */
export async function readAccountTradeSnapshot(rpc:Pick<UserRpc,'call'>,identity:AccountIdentity,trader:Address,marketIndex:0|1,
  commitment:'confirmed'|'finalized'='confirmed') {
  requireValue(marketIndex===0||marketIndex===1,'Unsupported maker market.');
  return readSnapshot(rpc,identity,[trader],commitment,marketIndex);
}
/** Profile 4 preview: all three sealed candidates, code, custody and complete
 * selected accounts share one final RPC context. No transaction builder or
 * financial activation is supplied by this P31 interface. */
export async function readLiquidityTradeSnapshot(rpc:Pick<UserRpc,'call'>,identity:AccountIdentity,trader:Address,marketIndex:0|1,
  commitment:'confirmed'|'finalized'='confirmed') {
  requireValue(marketIndex===0||marketIndex===1,'Unsupported liquidity market.');
  return readSnapshot(rpc,identity,[trader],commitment,undefined,marketIndex,4);
}
async function readSnapshot(rpc:Pick<UserRpc,'call'>,identity:AccountIdentity,selectedMargins:Address[],
  commitment:'confirmed'|'finalized',makerMarketIndex?:0|1,liquidityMarketIndex?:0|1,profile:3|4=3) {
  requireValue(['confirmed','finalized'].includes(commitment),'Unsupported account commitment.');
  requireValue(/^[0-9a-f]{64}$/.test(identity.domain),'Invalid venue domain.');
  const venue=identity.venue,component=(name:Parameters<typeof findVenueComponentV3Pda>[1])=>findVenueComponentV3Pda(venue,name);
  const [[canonicalVenue,venueBump],[custody,custodyBump],[safety,safetyBump],[vault,vaultBump],...marketPdas]=await Promise.all([
    deriveAccountVenue(Uint8Array.from(identity.domain.match(/../g)!,value=>parseInt(value,16))),component('custody'),component('safety'),component('vault'),
    findMarketV3Pda(venue,0),findMarketV3Pda(venue,1)]);
  requireValue(canonicalVenue===venue,'Venue PDA mismatch.');
  const markets=marketPdas.map(([key])=>key),ledgerPdas=await Promise.all(markets.map(key=>findLedgerV3Pda(key)));
  const ledgers=ledgerPdas.map(([key])=>key);
  const raw=(account:any,owner:string=protocol.CLEARING_PROGRAM_ADDRESS)=>{
    requireValue(account?.owner===owner&&account.data?.[1]==='base64','Missing or foreign account dependency.');return fromBase64(account.data[0]);
  };
  const decode=<Value>(account:any,discriminator:ReadonlyUint8Array,decoder:Decoder<Value>&{fixedSize?:number}):Value=>{
    const bytes=raw(account);requireValue(hex(bytes.slice(0,8))===hex(discriminator),'Wrong account discriminator.');
    if(decoder.fixedSize!==undefined)requireValue(bytes.length===decoder.fixedSize,'Wrong account size.');
    return decoder.decode(bytes);
  };
  const identities:AccountMakerIdentity[]=[],makerKeys:Address[]=[];
  let makerDiscoverySlot=0n;
  const liquidityDiscovery=liquidityMarketIndex===undefined?undefined:
    await discoverLiquidityAccounts(rpc,venue,markets[liquidityMarketIndex],commitment);
  if(liquidityDiscovery) { makerDiscoverySlot=liquidityDiscovery.contextSlot;makerKeys.push(...liquidityDiscovery.keys); }
  if(makerMarketIndex!==undefined) {
    const registrationPdas=await Promise.all([0,1].map(makerId=>findAccountMakerV3Pda(markets[makerMarketIndex],makerId)));
    const result=await rpc.call('getMultipleAccounts',[registrationPdas.map(([key])=>key),{encoding:'base64',commitment}]);
    requireValue(result.value?.length===2,'Incomplete maker discovery.');makerDiscoverySlot=rpcInteger(result.context.slot);
    for(const [makerId,[registration,bump]] of registrationPdas.entries()) {
      if(result.value[makerId]===null)continue;
      const discovered=decode(result.value[makerId],protocol.MAKER_REGISTRATION_V3_DISCRIMINATOR,protocol.getMakerRegistrationV3Decoder());
      requireValue(discovered.schemaVersion===3&&discovered.venue===venue&&discovered.market===markets[makerMarketIndex]&&
        discovered.makerId===makerId&&discovered.bump===bump,'Foreign maker discovery.');
      identities.push({registration,bump,marketIndex:makerMarketIndex,makerId,discovered});
      makerKeys.push(registration,discovered.config,discovered.pricingProgram,discovered.programData);
    }
  }
  const margins=[...new Set([...selectedMargins,...identities.map(identity=>identity.discovered.capital),...liquidityDiscovery?.capitals??[]])];
  const discovery=await rpc.call('getMultipleAccounts',[margins,{encoding:'base64',commitment,minContextSlot:Number(makerDiscoverySlot)}]);
  requireValue(discovery.value?.length===margins.length,'Incomplete account discovery.');
  const discovered=discovery.value.map((account:any)=>decode(account,protocol.MARGIN_ACCOUNT_V3_DISCRIMINATOR,protocol.getMarginAccountV3Decoder())) as protocol.MarginAccountV3[];
  const portfolioKeys=[...new Set(discovered.map(root=>root.portfolio))];
  const keys=[venue,custody,safety,vault,identity.mint,ACCOUNT_CLOCK,...markets,...ledgers,...margins,...portfolioKeys,...new Set(makerKeys)];
  requireValue(new Set(keys).size===keys.length,'Aliased account dependencies.');
  // RPC dependency discovery includes all unselected makers and full code. This
  // read bound is separate from the signed transaction's loaded-account budget.
  requireValue(keys.length<=(liquidityDiscovery?48:32),'Account snapshot exceeds bounded dependency set.');
  const discoverySlot=rpcInteger(discovery.context.slot);
  requireValue(discoverySlot>=makerDiscoverySlot,'Account RPC predates maker discovery.');
  const response=await rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment,minContextSlot:Number(discoverySlot)}]);
  const contextSlot=rpcInteger(response.context.slot);requireValue(contextSlot>=discoverySlot,'Account RPC predates discovery.');
  requireValue(response.value?.length===keys.length,'Incomplete account snapshot.');
  const accounts=new Map<Address,any>(keys.map((key,index)=>[key,response.value[index]]));
  const venueState=decode(accounts.get(venue),protocol.VENUE_V3_DISCRIMINATOR,protocol.getVenueV3Decoder());
  requireValue(venueState.schemaVersion===3&&venueState.profileVersion===profile&&venueState.marketCount===2&&venueState.bump===venueBump&&venueState.vaultBump===vaultBump&&
    hex(venueState.domain)===identity.domain&&venueState.quoteMint===identity.mint&&venueState.vault===vault&&venueState.insuranceFeeShareBps===2500&&
    venueState.markets.every((key,index)=>key===markets[index]),'Venue identity/profile mismatch.');
  const custodyState=decode(accounts.get(custody),protocol.CUSTODY_V3_DISCRIMINATOR,protocol.getCustodyV3Decoder());
  const safetyState=decode(accounts.get(safety),protocol.SAFETY_V3_DISCRIMINATOR,protocol.getSafetyV3Decoder());
  requireValue(custodyState.schemaVersion===3&&custodyState.venue===venue&&custodyState.bump===custodyBump&&
    safetyState.schemaVersion===3&&safetyState.venue===venue&&safetyState.bump===safetyBump&&[0,1,2,3,4].includes(safetyState.mode),'Account custody/safety identity.');
  const marketStates=markets.map((key,index)=>{
    const value=decode(accounts.get(key),protocol.MARKET_V3_DISCRIMINATOR,protocol.getMarketV3Decoder());
    requireValue(value.schemaVersion===3&&value.venue===venue&&value.index===index&&value.bump===marketPdas[index][1]&&
      value.lotsPerUnit===(index===0?1_000_000n:100_000n),'Market identity/units mismatch.');return value;
  });
  const ledgerStates=ledgers.map((key,index)=>{
    const value=decode(accounts.get(key),protocol.MARKET_LEDGER_V3_DISCRIMINATOR,protocol.getMarketLedgerV3Decoder());
    requireValue(value.schemaVersion===3&&value.venue===venue&&value.market===markets[index]&&value.marketIndex===index&&value.bump===ledgerPdas[index][1]&&
      value.insuranceFeeRemainder<4,'Market ledger identity/carry mismatch.');return value;
  });
  requireValue(custodyState.allocatedVault===custodyState.totalCash+ledgerStates.reduce((sum,value)=>sum+value.settlement+value.insurance+value.fees,0n),'Venue cash conservation.');
  const portfolios:Record<string,protocol.PortfolioV3>={},roots:Record<string,protocol.MarginAccountV3>={};
  for(const key of portfolioKeys) {
    const value=decode(accounts.get(key),protocol.PORTFOLIO_V3_DISCRIMINATOR,protocol.getPortfolioV3Decoder());
    const [canonical,bump]=await deriveAccountPortfolio(venue,value.owner,value.index);
    requireValue(value.schemaVersion===3&&value.venue===venue&&key===canonical&&value.bump===bump,'Portfolio identity mismatch.');portfolios[key]=value;
  }
  for(const [index,key] of margins.entries()) {
    const value=decode(accounts.get(key),protocol.MARGIN_ACCOUNT_V3_DISCRIMINATOR,protocol.getMarginAccountV3Decoder());
    const [canonical,bump]=await findMarginV3Pda(value.portfolio,value.subaccountIndex),portfolio=portfolios[value.portfolio];
    requireValue(value.schemaVersion===3&&value.venue===venue&&value.id<64&&value.portfolio===discovered[index].portfolio&&key===canonical&&value.bump===bump&&
      portfolio?.owner===value.owner&&(portfolio.children&(1<<value.subaccountIndex))!==0&&[0,1,2].includes(value.role)&&
      (value.mode===0?value.subaccountIndex===0&&value.isolatedMarketIndex===255&&value.role!==1:
        value.mode===1&&value.subaccountIndex>=1&&[0,1].includes(value.isolatedMarketIndex)),'Margin identity/mode mismatch.');
    if(value.mode===1) {
      const unused=value.positions[1-value.isolatedMarketIndex];
      requireValue(unused.lots===0n&&unused.virtualScaled===0n&&unused.fundingCheckpointScaled===0n&&unused.generation===0n,'Foreign isolated position.');
    }
    roots[key]=value;
  }
  const mintBytes=raw(accounts.get(identity.mint),TOKEN_PROGRAM_ADDRESS),mint=getMintDecoder().decode(mintBytes);
  requireValue(mintBytes.length===82&&mint.isInitialized&&mint.decimals===6,'Unsupported collateral mint.');
  const tokenBytes=raw(accounts.get(vault),TOKEN_PROGRAM_ADDRESS),token=getTokenDecoder().decode(tokenBytes);
  requireValue(tokenBytes.length===165&&tokenBytes[108]===1&&token.owner===venue&&token.mint===identity.mint&&token.amount>=custodyState.allocatedVault,'Venue vault mismatch/deficit.');
  const clock=raw(accounts.get(ACCOUNT_CLOCK),'Sysvar1111111111111111111111111111111111111');requireValue(clock.length===40,'Invalid Clock.');
  const clockView=new DataView(clock.buffer,clock.byteOffset,clock.byteLength);
  const slot=clockView.getBigUint64(0,true),now=clockView.getBigInt64(32,true);
  // Surfpool can return a Clock ahead of its reported commitment context (R019).
  // Preserve both observations: use actual Clock for expiry, and require RPC
  // contexts to be monotone above. Never substitute an older context for Clock.
  requireValue(now>=0n,'Invalid snapshot clock.');
  const makers=await authenticateAccountMakers({venue,markets,venueState,roots},identities,accounts);
  const liquidity=liquidityMarketIndex===undefined?undefined:await authenticateLiquidityMarket({venue,
    market:markets[liquidityMarketIndex],marketIndex:liquidityMarketIndex,domain:venueState.domain,slot,now,contextSlot},accounts);
  return {commitment,venue,custody,safety,vault,markets,btc:markets[0],eth:markets[1],ledgers,btcLedger:ledgers[0],ethLedger:ledgers[1],makers,
    venueState,custodyState,safetyState,marketStates,ledgerStates,roots,portfolios,actualVault:token.amount,liquidity,
    slot,now,contextSlot};
}
export type AccountSnapshot=Awaited<ReturnType<typeof readAccountSnapshot>>;
export function accountGuard(snapshot:AccountSnapshot,margin:Address):protocol.AccountGuardV3 {
  const root=snapshot.roots[margin];requireValue(root,'Margin absent from snapshot.');
  return {safetyEpoch:snapshot.safetyState.epoch,venueTermsEpoch:snapshot.venueState.termsEpoch,nonce:root.nonce,stateVersion:root.stateVersion};
}
