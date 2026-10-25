import {createNoopSigner,getProgramDerivedAddress,type Address} from '@solana/kit';
import * as protocol from './generated/index.js';
import {allocateGroupRoute,type GroupAllocationInput} from './group-allocation.js';
import {groupRouteComputeBudget} from './route-budget.js';
import {requireValue} from './wallet-client.js';

/** Rebuild the exact bounded instruction from authenticated snapshot inputs.
 * An HTTP quote's supplied accounts/message are never accepted as authority. */
export async function buildGroupRoute(input:GroupAllocationInput,actor:Address){
  const {snapshot,marketIndex,trader}=input,root=snapshot.roots[trader];
  requireValue(snapshot.commitment==='confirmed','Group execution requires a labelled confirmed snapshot.');
  requireValue(root&&(input.stored||root.owner===actor||(root.delegate===actor&&snapshot.slot<root.delegateExpirySlot)),
    'Live group trade authority required.');
  const allocation=allocateGroupRoute(input);if(!allocation)return null;
  const selected=allocation.legs.map(leg=>input.makers.find(maker=>maker.marketIndex===marketIndex&&maker.makerId===leg.makerId)!);
  const market=snapshot.marketStates[marketIndex];
  const expirySlot=[snapshot.slot+150n,market.validUntil,...selected.map(maker=>maker.state.expirySlot)].reduce((left,right)=>left<right?left:right);
  requireValue(expirySlot>snapshot.slot,'Group route expired.');
  const [eventAuthority]=await getProgramDerivedAddress({programAddress:protocol.CLEARING_PROGRAM_ADDRESS,seeds:[new TextEncoder().encode('__event_authority')]});
  const [first,second]=selected,firstState=first.registrationState,secondState=second?.registrationState;
  const common={group:snapshot.group,market:snapshot.markets[marketIndex],otherMarket:snapshot.markets[1-marketIndex],vault:snapshot.vault,
    actor:createNoopSigner(actor),trader,eventAuthority,program:protocol.CLEARING_PROGRAM_ADDRESS,
    firstCapital:firstState.capital,firstRegistration:first.registration,firstProgram:firstState.pricingProgram,firstProgramData:firstState.programData,firstConfig:firstState.config,
    secondCapital:secondState?.capital,secondRegistration:second?.registration,secondProgram:secondState?.pricingProgram,secondProgramData:secondState?.programData,secondConfig:secondState?.config,
    sequence:snapshot.state.sequence,observations:snapshot.marketStates.map(state=>state.observationSequence)};
  const legs=allocation.legs.map((leg,index)=>({lots:leg.lots,quoteEpoch:selected[index].registrationState.quoteEpoch,authorityEpoch:selected[index].registrationState.authorityEpoch}));
  const position=root.positions[marketIndex],reduceOnly=input.reduceOnly??
    ((input.side===1&&position.lots>=input.lots)||(input.side===0&&-position.lots>=input.lots));
  const instruction=input.stored?await protocol.getExecuteMarginOrderV2InstructionAsync({...common,args:{...input.stored,observationSequence:market.observationSequence,
    startSlot:snapshot.slot,expirySlot,lots:input.lots,legs}}):await protocol.getExecuteMarginRouteV2InstructionAsync({...common,intent:{domain:snapshot.state.domain,
      termsEpoch:market.termsEpoch,configEpoch:market.configEpoch,observationSequence:market.observationSequence,nonce:root.nonce,startSlot:snapshot.slot,expirySlot,
      side:input.side,lots:input.lots,allInLimit:allocation.allIn,maxFee:allocation.fee,reduceOnly,generation:position.generation,legs}});
  return {snapshotCommitment:snapshot.commitment,snapshotSlot:snapshot.slot,sequence:snapshot.state.sequence,observations:common.observations,
    trader,marketIndex,nonce:root.nonce,expirySlot,allocation,instructions:[groupRouteComputeBudget(),instruction]};
}
export type GroupRouteQuote=NonNullable<Awaited<ReturnType<typeof buildGroupRoute>>>;
