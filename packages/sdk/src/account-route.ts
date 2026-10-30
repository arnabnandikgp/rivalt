import {createNoopSigner,getProgramDerivedAddress,type Address} from '@solana/kit';
import * as protocol from './generated/index.js';
import {allocateMarginRoute,type MarginRouteIntent} from './margin-allocation.js';
import {effectiveAccountFunding,accountSourceMode} from './account-balance.js';
import {accountGuard,type AccountSnapshot} from './account-snapshot.js';
import {groupRouteComputeBudget} from './route-budget.js';
import {requireValue} from './wallet-client.js';

export type AccountAllocationInput=MarginRouteIntent&{snapshot:AccountSnapshot;trader:Address};
export function allocateAccountRoute(input:AccountAllocationInput) {
  const {snapshot,marketIndex}=input,root=snapshot.roots[input.trader];
  requireValue(root?.schemaVersion===3&&root.venue===snapshot.venue&&snapshot.safetyState.mode===1&&!snapshot.safetyState.paused&&
    (root.mode===0||root.isolatedMarketIndex===marketIndex),'Account trading unavailable.');
  requireValue(snapshot.marketStates.length===2&&snapshot.marketStates.every((market,index)=>market.schemaVersion===3&&market.venue===snapshot.venue&&market.index===index),
    'Invalid account market dependencies.');
  requireValue(root.mode!==0||snapshot.marketStates[marketIndex].crossEligible,'Market is not cross eligible.');
  const makers=snapshot.makers.filter(maker=>maker.marketIndex===marketIndex).map(maker=>{
    const registration=maker.registrationState,capital=snapshot.roots[registration.capital];
    requireValue(registration.schemaVersion===3&&registration.venue===snapshot.venue&&registration.market===snapshot.markets[marketIndex]&&
      maker.state.version===3&&capital?.schemaVersion===3&&capital.venue===snapshot.venue,'Foreign account maker candidate.');return {...maker,capital};
  });
  return allocateMarginRoute({...input,root,makers,markets:snapshot.marketStates,marketKeys:snapshot.markets,domain:snapshot.venueState.domain,
    slot:snapshot.slot,now:snapshot.now,funding:snapshot.marketStates.map(market=>effectiveAccountFunding(snapshot.safetyState,market,snapshot.now,snapshot.slot)),
    sources:snapshot.marketStates.map(market=>accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot))});
}

/** Exact A/B selection, with account/market/maker authority and consumed prefixes.
 * No historical observation or global event sequence enters the signed intent. */
export async function buildAccountRoute(input:AccountAllocationInput,actor:Address) {
  const {snapshot,marketIndex,trader}=input,root=snapshot.roots[trader];
  requireValue(snapshot.commitment==='confirmed','Account execution requires a labelled confirmed snapshot.');
  requireValue(root&&(input.stored||root.owner===actor||(root.delegate===actor&&snapshot.slot<root.delegateExpirySlot)),'Live account trade authority required.');
  const allocation=allocateAccountRoute(input);if(!allocation)return null;
  const selected=allocation.legs.map(leg=>snapshot.makers.find(maker=>maker.marketIndex===marketIndex&&maker.makerId===leg.makerId)!);
  const market=snapshot.marketStates[marketIndex];
  const expirySlot=[snapshot.slot+150n,market.validUntil,...selected.map(maker=>maker.state.expirySlot)].reduce((left,right)=>left<right?left:right);
  requireValue(expirySlot>snapshot.slot,'Account route expired.');
  const [eventAuthority]=await getProgramDerivedAddress({programAddress:protocol.CLEARING_PROGRAM_ADDRESS,seeds:[new TextEncoder().encode('__event_authority')]});
  const [first,second]=selected,firstState=first.registrationState,secondState=second?.registrationState;
  const common={venue:snapshot.venue,custody:snapshot.custody,safety:snapshot.safety,market:snapshot.markets[marketIndex],otherMarket:snapshot.markets[1-marketIndex],
    ledger:snapshot.ledgers[marketIndex],otherLedger:snapshot.ledgers[1-marketIndex],vault:snapshot.vault,actor:createNoopSigner(actor),trader,
    eventAuthority,program:protocol.CLEARING_PROGRAM_ADDRESS,guard:accountGuard(snapshot,trader),startSlot:snapshot.slot,expirySlot,lots:input.lots,
    firstCapital:firstState.capital,firstRegistration:first.registration,firstProgram:firstState.pricingProgram,firstProgramData:firstState.programData,firstConfig:firstState.config,
    secondCapital:secondState?.capital,secondRegistration:second?.registration,secondProgram:secondState?.pricingProgram,secondProgramData:secondState?.programData,secondConfig:secondState?.config};
  const legs=allocation.legs.map((leg,index)=>({lots:leg.lots,quoteEpoch:selected[index].registrationState.quoteEpoch,
    authorityEpoch:selected[index].registrationState.authorityEpoch,expectedConsumed:input.side===0?selected[index].registrationState.buyConsumed:selected[index].registrationState.sellConsumed}));
  const position=root.positions[marketIndex],reduceOnly=input.reduceOnly??
    ((input.side===1&&position.lots>=input.lots)||(input.side===0&&-position.lots>=input.lots));
  const instruction=input.stored?await protocol.getExecuteAccountOrderInstructionAsync({...common,...input.stored,legs}):
    await protocol.getExecuteAccountRouteInstructionAsync({...common,domain:snapshot.venueState.domain,termsEpoch:market.termsEpoch,configEpoch:market.configEpoch,
      side:input.side,allInLimit:allocation.allIn,maxFee:allocation.fee,reduceOnly,generation:position.generation,legs});
  return {snapshotCommitment:snapshot.commitment,snapshotSlot:snapshot.slot,trader,marketIndex,guard:common.guard,expirySlot,allocation,
    instructions:[groupRouteComputeBudget(),instruction]};
}
export type AccountRouteQuote=NonNullable<Awaited<ReturnType<typeof buildAccountRoute>>>;
