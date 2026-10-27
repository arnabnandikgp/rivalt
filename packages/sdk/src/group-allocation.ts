import type {Address} from '@solana/kit';
import {allocateMarginRoute,type MarginRouteIntent,type MarginStoredFill} from './margin-allocation.js';
import {effectiveGroupFunding,groupSourceMode} from './group-balance.js';
import type {GroupSnapshot} from './group-snapshot.js';
import type {GroupMaker} from './group-makers.js';
import {requireValue} from './wallet-client.js';
export type GroupStoredFill=MarginStoredFill;
export type GroupAllocationInput=MarginRouteIntent&{snapshot:GroupSnapshot;trader:Address;makers:GroupMaker[]};

export function allocateGroupRoute(input:GroupAllocationInput){
  const {snapshot,marketIndex}=input,root=snapshot.roots[input.trader];
  requireValue(root&&root.schemaVersion===2&&root.group===snapshot.group&&[1,2].includes(snapshot.state.mode)&&!snapshot.state.paused&&
    (root.mode===0?snapshot.state.mode===2:root.isolatedMarketIndex===marketIndex),'Group trading account unavailable.');
  const makers=input.makers.filter(maker=>maker.marketIndex===marketIndex&&maker.registrationState.market===snapshot.markets[marketIndex]&&maker.registrationState.group===snapshot.group)
    .map(maker=>{
      const capital=snapshot.roots[maker.registrationState.capital];
      requireValue(capital?.schemaVersion===2&&capital.group===snapshot.group&&maker.state.version===2,'Invalid isolated group maker.');
      return {...maker,capital};
    });
  requireValue(snapshot.marketStates.length===2&&snapshot.marketStates.every((market,index)=>market.schemaVersion===2&&market.group===snapshot.group&&market.index===index),'Invalid group market dependencies.');
  return allocateMarginRoute({...input,root,makers,markets:snapshot.marketStates,marketKeys:snapshot.markets,domain:snapshot.state.domain,
    slot:snapshot.slot,now:snapshot.now,funding:snapshot.marketStates.map(market=>effectiveGroupFunding(snapshot.state,market,snapshot.now,snapshot.slot)),
    sources:snapshot.marketStates.map(market=>groupSourceMode(snapshot.state,market,snapshot.now,snapshot.slot))});
}
