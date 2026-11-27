import {decodeVenueMembershipRegistry} from './account-membership.js';
import {deriveMemberIndex} from './account-addresses.js';
import {isListedMakerCapital} from './market-listing.js';
import {readCoherentAccounts} from './coherent-accounts.js';
import {decodeCapacityAnchor,makerRegistrationPdas,marketFromExecutionLanes} from './market-capacity.js';
import {ledgerFromExecutionLanes} from './ledger-lanes.js';
import {decodeFeeLedger} from './market-fees.js';
import {hasCapacityLayout,hasFundingLayout,hasFeeLayout,decodeMarginForLayout,decodeProfitAttribution,type PerLotProfit,type MarginLayout} from './profit-attribution.js';
import {address,type Address,type Decoder,type ReadonlyUint8Array} from '@solana/kit';
import {getMintDecoder,getTokenDecoder,TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import * as protocol from './generated/index.js';
import {deriveAccountVenue,deriveAccountPortfolio,deriveVenueComponent,deriveAccountMarket,deriveMarketLedger,deriveMarginAccount} from './account-addresses.js';
import {authenticateLiquidityMarket,discoverLiquidityAccounts} from './liquidity-adapter.js';
import {fromBase64,hex,requireValue,rpcInteger,type UserRpc} from './wallet-client.js';

export type AccountIdentity={venue:Address;mint:Address;domain:string;closedQuantity?:boolean;boundedEntry?:boolean;marginLayout?:MarginLayout};
export const ACCOUNT_CLOCK=address('SysvarC1ock11111111111111111111111111111111');

/** Funded balances/exits read only selected roots and their complete market dependencies. */
export async function readAccountSnapshot(rpc:Pick<UserRpc,'call'>,identity:AccountIdentity,margins:Address[],
  commitment:'confirmed'|'finalized'='finalized') {
  requireValue(margins.length>=1&&margins.length<=2&&new Set(margins).size===margins.length,'Select one or two distinct margin accounts.');
  return readSnapshot(rpc,identity,margins,commitment);
}
/** Worker discovery batches share the checked market and custody inputs at one bank.
 * At most 40 roots, 40 portfolios and 16 shared keys fit in one RPC response. */
export const SETTLEMENT_READ_BATCH = 40;
export function readSettlementSnapshot(rpc:Pick<UserRpc,'call'>,identity:AccountIdentity,margins:Address[]) {
  requireValue(margins.length>0 && margins.length<=SETTLEMENT_READ_BATCH && new Set(margins).size===margins.length,
    'Invalid settlement read batch.');
  return readSnapshot(rpc,identity,margins,'confirmed',undefined,100);
}
/** Trading discovers every sealed registration, then authenticates the complete
 * financial and pricing dependency set in one final RPC context. */
export async function readAccountTradeSnapshot(rpc:Pick<UserRpc,'call'>,identity:AccountIdentity,trader:Address,marketIndex:0|1,
  commitment:'confirmed'|'finalized'='confirmed') {
  requireValue(marketIndex===0||marketIndex===1,'Unsupported liquidity market.');
  return readSnapshot(rpc,identity,[trader],commitment,marketIndex);
}
/** Registry and every nominated financial root are authenticated at the same bank.
 * Completeness follows from unique active member IDs and the registry count. */
export async function readCompleteFinancialSnapshot(rpc:Pick<UserRpc,'call'>,identity:AccountIdentity,margins:Address[]) {
  requireValue(margins.length>0 && margins.length<=SETTLEMENT_READ_BATCH && new Set(margins).size===margins.length,
    'Invalid complete settlement roster.');
  const [registry,bump]=await deriveVenueComponent(identity.venue,'registry');
  const [liveIndex]=await deriveMemberIndex(identity.venue,14,0n);
  const snapshot=await readSnapshot(rpc,identity,margins,'finalized',undefined,100,{registry,bump,liveIndex});
  const state=snapshot.membership;
  const roots=Object.values(snapshot.roots);
  requireValue(state && BigInt(roots.length)===state.financialCount && new Set(roots.map(root=>root.id)).size===roots.length &&
    roots.every(root=>root.id<state.nextId),'Incomplete financial membership at settlement bank.');
  return {...snapshot,membership:state};
}
async function readSnapshot(rpc:Pick<UserRpc,'call'>,identity:AccountIdentity,selectedMargins:Address[],
  commitment:'confirmed'|'finalized',liquidityMarketIndex?:0|1,maxKeys=32,complete?:{registry:Address;bump:number;liveIndex:Address}) {
  requireValue(['confirmed','finalized'].includes(commitment),'Unsupported account commitment.');
  requireValue(/^[0-9a-f]{64}$/.test(identity.domain),'Invalid venue domain.');
  const venue=identity.venue,component=(name:Parameters<typeof deriveVenueComponent>[1])=>deriveVenueComponent(venue,name);
  const [[canonicalVenue,venueBump],[custody,custodyBump],[safety,safetyBump],[vault,vaultBump],...marketPdas]=await Promise.all([
    deriveAccountVenue(Uint8Array.from(identity.domain.match(/../g)!,value=>parseInt(value,16))),component('custody'),component('safety'),component('vault'),
    deriveAccountMarket(venue,0),deriveAccountMarket(venue,1)]);
  requireValue(canonicalVenue===venue,'Venue PDA mismatch.');
  const markets=marketPdas.map(([key])=>key),ledgerPdas=await Promise.all(markets.map(key=>deriveMarketLedger(key)));
  const ledgers=ledgerPdas.map(([key])=>key);
  const raw=(account:any,owner:string=protocol.CLEARING_PROGRAM_ADDRESS)=>{
    requireValue(account?.owner===owner&&!account.executable&&account.data?.[1]==='base64','Missing or foreign account dependency.');return fromBase64(account.data[0]);
  };
  const decode=<Value>(account:any,discriminator:ReadonlyUint8Array,decoder:Decoder<Value>&{fixedSize?:number}):Value=>{
    const bytes=raw(account);requireValue(hex(bytes.slice(0,8))===hex(discriminator),'Wrong account discriminator.');
    if(decoder.fixedSize!==undefined)requireValue(bytes.length===decoder.fixedSize,'Wrong account size.');
    return decoder.decode(bytes);
  };
  const makerKeys:Address[]=[];
  let makerDiscoverySlot=0n;
  const liquidityDiscovery=liquidityMarketIndex===undefined?undefined:
    await discoverLiquidityAccounts(rpc,venue,markets[liquidityMarketIndex],commitment,identity.marginLayout);
  if(liquidityDiscovery) { makerDiscoverySlot=liquidityDiscovery.contextSlot;makerKeys.push(...liquidityDiscovery.keys); }
  const ledgerLanes=identity.marginLayout==='ledger-lanes';
  const checkpointPdas=identity.marginLayout==='market-lanes'||ledgerLanes?await Promise.all(markets.map(makerRegistrationPdas)):[];
  for(const registrations of checkpointPdas)for(const [key] of registrations)makerKeys.push(key);
  const margins=[...new Set([...selectedMargins,...liquidityDiscovery?.capitals??[]])];
  const discovery=await rpc.call('getMultipleAccounts',[margins,{encoding:'base64',commitment,minContextSlot:Number(makerDiscoverySlot)}]);
  requireValue(discovery.value?.length===margins.length,'Incomplete account discovery.');
  const discovered=discovery.value.map((account:any)=>decodeMarginForLayout(raw(account),identity.marginLayout)) as protocol.MarginAccount[];
  const portfolioKeys=[...new Set(discovered.map(root=>root.portfolio))];
  const keys=[venue,custody,safety,vault,identity.mint,ACCOUNT_CLOCK,...markets,...ledgers,...margins,...portfolioKeys,...new Set(makerKeys),...(complete?[complete.registry]:[])];
  requireValue(new Set(keys).size===keys.length,'Aliased account dependencies.');
  // RPC dependency discovery includes all unselected makers and full code. This
  // read bound is separate from the signed transaction's loaded-account budget.
  requireValue(keys.length<=(liquidityDiscovery?30+6*liquidityDiscovery.capitals.length:maxKeys),'Account snapshot exceeds bounded dependency set.');
  const discoverySlot=rpcInteger(discovery.context.slot);
  requireValue(discoverySlot>=makerDiscoverySlot,'Account RPC predates maker discovery.');
  const response=await readCoherentAccounts(rpc,keys,commitment,discoverySlot);
  const contextSlot=rpcInteger(response.context.slot);requireValue(contextSlot>=discoverySlot,'Account RPC predates discovery.');
  requireValue(response.value?.length===keys.length,'Incomplete account snapshot.');
  const accounts=new Map<Address,any>(keys.map((key,index)=>[key,response.value[index]]));
  const membership=complete?decodeVenueMembershipRegistry(accounts.get(complete.registry),venue,complete.bump,complete.liveIndex):undefined;
  const venueState=decode(accounts.get(venue),protocol.VENUE_DISCRIMINATOR,protocol.getVenueDecoder());
  requireValue(venueState.schemaVersion===10&&venueState.profileVersion===6&&venueState.marketCount===2&&venueState.bump===venueBump&&venueState.vaultBump===vaultBump&&
    hex(venueState.domain)===identity.domain&&venueState.quoteMint===identity.mint&&venueState.vault===vault&&venueState.insuranceFeeShareBps===2500&&
    venueState.markets.every((key,index)=>key===markets[index]),'Venue identity/profile mismatch.');
  const custodyState=decode(accounts.get(custody),protocol.CUSTODY_DISCRIMINATOR,protocol.getCustodyDecoder());
  const safetyState=decode(accounts.get(safety),protocol.VENUE_SAFETY_DISCRIMINATOR,protocol.getVenueSafetyDecoder());
  requireValue(custodyState.schemaVersion===10&&custodyState.venue===venue&&custodyState.bump===custodyBump&&
    safetyState.schemaVersion===10&&safetyState.venue===venue&&safetyState.bump===safetyBump&&[0,1,2,3,4].includes(safetyState.mode),'Account custody/safety identity.');
  const clock=raw(accounts.get(ACCOUNT_CLOCK),'Sysvar1111111111111111111111111111111111111');requireValue(clock.length===40,'Invalid Clock.');
  const clockView=new DataView(clock.buffer,clock.byteOffset,clock.byteLength);
  const slot=clockView.getBigUint64(0,true),now=clockView.getBigInt64(32,true);
  // Surfpool can return a Clock ahead of its reported commitment context (R019).
  // Preserve both observations: use actual Clock for expiry, and require RPC
  // contexts to be monotone above. Never substitute an older context for Clock.
  requireValue(now>=0n,'Invalid snapshot clock.');
  const marketStates=markets.map((key,index)=>{
    const value=checkpointPdas[index]?marketFromExecutionLanes(key,raw(accounts.get(key)),
      checkpointPdas[index].map(([address,bump])=>({bytes:raw(accounts.get(address)),bump})),slot,safetyState.mode===1,ledgerLanes):
      hasCapacityLayout(identity.marginLayout)?decodeCapacityAnchor(raw(accounts.get(key)),hasFundingLayout(identity.marginLayout)).market:decode(accounts.get(key),protocol.MARKET_DISCRIMINATOR,protocol.getMarketDecoder());
    requireValue(value.schemaVersion===10&&value.venue===venue&&value.index===index&&value.bump===marketPdas[index][1]&&
      value.lotsPerUnit===(index===0?1_000_000n:100_000n),'Market identity/units mismatch.');return value;
  });
  const feeEscrow=hasFeeLayout(identity.marginLayout)?ledgers.map((key,index)=>{
    const escrow=decodeFeeLedger(raw(accounts.get(key)));
    return ledgerLanes?ledgerFromExecutionLanes(escrow,checkpointPdas[index].map(([address,bump])=>({bytes:raw(accounts.get(address)),bump}))):escrow;
  }):undefined;
  const ledgerStates=ledgers.map((key,index)=>{
    const value=feeEscrow?.[index].state??decode(accounts.get(key),protocol.MARKET_LEDGER_DISCRIMINATOR,protocol.getMarketLedgerDecoder());
    requireValue(value.schemaVersion===10&&value.venue===venue&&value.market===markets[index]&&value.marketIndex===index&&value.bump===ledgerPdas[index][1]&&
      value.insuranceFeeRemainder<4,'Market ledger identity/carry mismatch.');return value;
  });
  requireValue(custodyState.allocatedVault>=ledgerStates.reduce((sum,value)=>sum+value.settlement+value.insurance+value.fees,0n),'Invalid allocated pool backing.');
  // This is a requested-root snapshot, not a complete-cohort cash audit.
  const portfolios:Record<string,protocol.Portfolio>={},roots:Record<string,protocol.MarginAccount>={};
  for(const key of portfolioKeys) {
    const value=decode(accounts.get(key),protocol.PORTFOLIO_DISCRIMINATOR,protocol.getPortfolioDecoder());
    const [canonical,bump]=await deriveAccountPortfolio(venue,value.owner,value.index);
    requireValue(value.schemaVersion===10&&value.venue===venue&&key===canonical&&value.bump===bump,'Portfolio identity mismatch.');portfolios[key]=value;
  }
  const closedEntries:Record<string,PerLotProfit[]>={};
  for(const [index,key] of margins.entries()) {
    const bytes=raw(accounts.get(key));
    const attribution=ledgerLanes?decodeProfitAttribution(bytes,true):undefined;
    if(identity.closedQuantity!==undefined)
      requireValue(Boolean(attribution?.closedQuantity)===identity.closedQuantity,'Payout rule differs from deployment.');
    if(identity.boundedEntry!==undefined)
      requireValue(Boolean(attribution?.entryBounds)===identity.boundedEntry,'Entry format differs from deployment.');
    if(attribution?.closedQuantity) closedEntries[key]=attribution.ordinaryPositions;
    const value=attribution?.root??decodeMarginForLayout(bytes,identity.marginLayout);
    const [canonical,bump]=await deriveMarginAccount(value.portfolio,value.subaccountIndex),portfolio=portfolios[value.portfolio];
    requireValue(value.schemaVersion===10&&value.venue===venue&&value.lifecycle===2&&value.activationGeneration>0n&&value.portfolio===discovered[index].portfolio&&key===canonical&&value.bump===bump&&
      portfolio?.owner===value.owner&&portfolio.activeChildren>0&&[0,1,2].includes(value.role)&&
      (value.mode===0?value.subaccountIndex===0&&value.isolatedMarketIndex===255&&value.role!==1:
        value.mode===1&&value.subaccountIndex>=1&&([0,1].includes(value.isolatedMarketIndex)||isListedMakerCapital(value))),'Margin identity/mode mismatch.');
    if(value.mode===1) value.positions.forEach((position,index)=>{
      if(index!==value.isolatedMarketIndex)
        requireValue(position.lots===0n&&position.virtualScaled===0n&&position.fundingCheckpointScaled===0n&&position.generation===0n,'Foreign isolated position.');
    });
    roots[key]=value;
  }
  const mintBytes=raw(accounts.get(identity.mint),TOKEN_PROGRAM_ADDRESS),mint=getMintDecoder().decode(mintBytes);
  requireValue(mintBytes.length===82&&mint.isInitialized&&mint.decimals===6,'Unsupported collateral mint.');
  const tokenBytes=raw(accounts.get(vault),TOKEN_PROGRAM_ADDRESS),token=getTokenDecoder().decode(tokenBytes);
  requireValue(tokenBytes.length===165&&tokenBytes[108]===1&&token.owner===venue&&token.mint===identity.mint&&token.amount>=custodyState.allocatedVault,'Venue vault mismatch/deficit.');
  const liquidity=liquidityMarketIndex===undefined?undefined:await authenticateLiquidityMarket({venue,marginLayout:identity.marginLayout,
    market:markets[liquidityMarketIndex],marketIndex:liquidityMarketIndex,domain:venueState.domain,slot,now,contextSlot},accounts);
  return {marginLayout:identity.marginLayout,commitment,venue,custody,safety,vault,markets,btc:markets[0],eth:markets[1],ledgers,btcLedger:ledgers[0],ethLedger:ledgers[1],
    venueState,custodyState,safetyState,marketStates,ledgerStates,feeEscrow,membership,roots,closedEntries,portfolios,actualVault:token.amount,liquidity,
    slot,now,contextSlot};
}
export type AccountSnapshot=Awaited<ReturnType<typeof readAccountSnapshot>>;
export function accountGuard(snapshot:AccountSnapshot,margin:Address):protocol.AccountGuard {
  const root=snapshot.roots[margin];requireValue(root,'Margin absent from snapshot.');
  return {safetyEpoch:snapshot.safetyState.epoch,venueTermsEpoch:snapshot.venueState.termsEpoch,nonce:root.nonce,stateVersion:root.stateVersion};
}
