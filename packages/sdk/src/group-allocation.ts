import type {Address} from '@solana/kit';
import {allocateRoute,type RouteBalance,type RouteCandidate} from './allocate-route.js';
import {effectiveGroupFunding,groupBalanceView,groupOrderRemaining,groupSourceMode} from './group-balance.js';
import type {GroupSnapshot} from './group-snapshot.js';
import type {GroupMaker} from './group-makers.js';
import type {MarginAccountV2} from './generated/index.js';
import {orderTriggered} from './order-policy.js';
import {requireValue} from './wallet-client.js';

const SCALE=1_000_000_000n,MAX_CASH=1_000_000_000_000_000n,MAX_LOTS=100_000_000n,MAX_SCALED=10n**26n,MAX_U64=(1n<<64n)-1n;
const abs=(value:bigint)=>value<0n?-value:value;
export type GroupStoredFill={id:bigint;version:bigint;filled:bigint};
export type GroupAllocationInput={snapshot:GroupSnapshot;trader:Address;marketIndex:0|1;side:0|1;lots:bigint;makers:GroupMaker[];
  maxFee:bigint;allInLimit:bigint;reduceOnly?:boolean;stored?:GroupStoredFill};

/** Whole-root indicative admission over unchanged bounded A/B allocation.
 * Every candidate owns cash once and includes both funding prefixes/reservations.
 * This cannot authorize a trade; clearing repeats all current checks. */
export function allocateGroupRoute(input:GroupAllocationInput){
  const {snapshot,marketIndex,side,lots}=input,root=snapshot.roots[input.trader],market=snapshot.marketStates[marketIndex];
  requireValue([0,1].includes(marketIndex)&&[0,1].includes(side)&&lots>0n&&lots<=4608n&&input.maxFee>=0n&&input.allInLimit>=0n,'Invalid group route bounds.');
  requireValue(root&&root.group===snapshot.group&&[1,2].includes(snapshot.state.mode)&&!snapshot.state.paused&&
    (root.mode===0?snapshot.state.mode===2:root.isolatedMarketIndex===marketIndex),'Group trading account unavailable.');
  const stored=input.stored?root.book.orders.find(entry=>entry.order.id===input.stored!.id&&entry.order.version===input.stored!.version&&entry.order.filled===input.stored!.filled):undefined;
  if(input.stored)requireValue(stored&&stored.marketIndex===marketIndex&&stored.order.side===side&&groupOrderRemaining(root,stored,market,snapshot.slot)>=lots&&
    orderTriggered(stored.order,market.referencePrice,snapshot.slot),'Stored group order unavailable.');
  const selected=root.positions[marketIndex],reduceOnly=stored?.order.reduceOnly??input.reduceOnly??
    ((side===1&&selected.lots>=lots)||(side===0&&-selected.lots>=lots));
  if(reduceOnly)requireValue(selected.lots!==0n&&lots<=abs(selected.lots)&&((side===0)===(selected.lots<0n)),'Invalid reduce-only group intent.');
  for(let index=0;index<2;index++){
    const relevant=index===marketIndex||root.positions[index].lots!==0n||root.book.orders.some(entry=>entry.marketIndex===index&&groupOrderRemaining(root,entry,snapshot.marketStates[index],snapshot.slot)>0n);
    if(relevant){const mode=groupSourceMode(snapshot.state,snapshot.marketStates[index],snapshot.now,snapshot.slot);
      requireValue(mode==='Normal'||(reduceOnly&&mode==='Degraded'),'Required group market source unavailable.');}
  }
  const eligible=input.makers.filter(maker=>maker.marketIndex===marketIndex&&maker.registrationState.market===snapshot.markets[marketIndex]&&maker.registrationState.group===snapshot.group&&
    maker.approved&&maker.synchronized&&!maker.registrationState.quarantined&&maker.registrationState.owner!==root.owner);
  requireValue(new Set(eligible.map(maker=>maker.makerId)).size===eligible.length&&eligible.length<=2,'Duplicate group maker candidate.');
  if(!eligible.length)return null;
  const funding=snapshot.marketStates.map(state=>effectiveGroupFunding(snapshot.state,state,snapshot.now,snapshot.slot));
  const accrued=(account:MarginAccountV2)=>{
    const candidate=structuredClone(account);
    candidate.positions.forEach((position,index)=>{if(candidate.mode===0||candidate.isolatedMarketIndex===index){
      position.virtualScaled-=position.lots*(funding[index]-position.fundingCheckpointScaled);position.fundingCheckpointScaled=funding[index];
    }});return candidate;
  };
  const capitals=eligible.map(maker=>{const capital=snapshot.roots[maker.registrationState.capital];
    requireValue(capital&&capital.owner===maker.registrationState.owner&&capital.group===snapshot.group,'Foreign group maker capital.');return capital;});
  const originals=new Map<number,MarginAccountV2>([root,...capitals].map(account=>[account.id,accrued(account)]));
  requireValue(originals.size===eligible.length+1,'Aliased group capital.');
  const balance=(account:MarginAccountV2):RouteBalance=>({id:account.id,cash:account.cash,lots:account.positions[marketIndex].lots,
    virtualScaled:account.positions[marketIndex].virtualScaled,reserved:BigInt(groupBalanceView(account,snapshot.state,snapshot.marketStates,snapshot.now,snapshot.slot).reserved)});
  const trader=balance(originals.get(root.id)!);
  const candidates:RouteCandidate[]=eligible.map(maker=>{
    const capital=originals.get(snapshot.roots[maker.registrationState.capital].id)!,registration=maker.registrationState;
    requireValue(capital.mode===1&&capital.role===1&&capital.isolatedMarketIndex===marketIndex&&maker.state.version===2,'Invalid isolated group maker.');
    // V2 authenticates its envelope before reusing the exact V1 strategy, just
    // like maker_interface::group_quote. No transport/authority is downgraded.
    return {state:{...maker.state,version:1},balance:balance(capital),request:{version:1,domain:snapshot.state.domain,market:snapshot.markets[marketIndex],
      capital:registration.capital,quoteEpoch:registration.quoteEpoch,authorityEpoch:registration.authorityEpoch,termsEpoch:market.termsEpoch,marketConfigEpoch:market.configEpoch,
      side,lots,inventory:capital.positions[marketIndex].lots,cash:capital.cash,inventoryLimit:registration.inventoryLimit,
      consumed:side===0?registration.buyConsumed:registration.sellConsumed,referencePrice:market.referencePrice,slot:snapshot.slot}};
  });
  const nextRoot=(before:RouteBalance,after:RouteBalance,gross:bigint,fee:bigint)=>{
    const candidate=structuredClone(originals.get(before.id)!),position=candidate.positions[marketIndex];
    const delta=abs(after.lots-before.lots);
    if(position.lots!==after.lots&&(position.lots===0n||after.lots===0n||(position.lots>0n)!==(after.lots>0n)))position.generation++;
    candidate.cash=after.cash;position.lots=after.lots;position.virtualScaled=after.virtualScaled;
    if(stored&&before.id===root.id){
      const order=candidate.book.orders.find(entry=>entry.order.id===stored.order.id)!.order;
      order.filled+=delta;order.notional+=gross;order.feeCharged+=fee;
      requireValue(order.filled<=order.lots&&order.feeCharged<=order.feeBudget,'Invalid stored group fill prefix.');
      order.state=order.filled===order.lots?3:2;
      if(order.groupId!==0n){
        const protection=candidate.book.protections.find(entry=>entry.marketIndex===marketIndex&&entry.protection.id===order.groupId)?.protection;
        requireValue(protection&&protection.remaining>=delta,'Invalid protective group allowance.');protection.remaining-=delta;
      }
    }
    return candidate;
  };
  const admissible=(before:RouteBalance,after:RouteBalance,gross:bigint,fee:bigint)=>{
    try{
      const candidate=nextRoot(before,after,gross,fee);
      if(candidate.cash<0n||candidate.cash>MAX_CASH||candidate.positions.some(position=>abs(position.lots)>MAX_LOTS||abs(position.virtualScaled)>MAX_SCALED||
        abs(position.fundingCheckpointScaled)>10n**15n||position.generation>MAX_U64||(position.lots!==0n&&position.generation===MAX_U64)))return false;
      const view=groupBalanceView(candidate,snapshot.state,snapshot.marketStates,snapshot.now,snapshot.slot);
      if(view.riskEquityScaled===null||view.initialMargin===null||BigInt(view.reserved)>MAX_CASH)return false;
      if(BigInt(view.riskEquityScaled)>=(BigInt(view.initialMargin)+BigInt(view.reserved))*SCALE)return true;
      if(before.id!==root.id||!reduceOnly||after.lots!==0n&&(after.lots>0n)!==(before.lots>0n)||abs(after.lots)>=abs(before.lots))return false;
      const previous=groupBalanceView(originals.get(before.id)!,snapshot.state,snapshot.marketStates,snapshot.now,snapshot.slot);
      return previous.maintenanceDeficitScaled!==null&&view.maintenanceDeficitScaled!==null&&BigInt(view.maintenanceDeficitScaled)<BigInt(previous.maintenanceDeficitScaled);
    }catch{return false;}
  };
  return allocateRoute({snapshotSlot:snapshot.slot,side,lots,lower:market.lower,upper:market.upper,trader,candidates,grossLots:market.grossLots,
    maxFee:stored?stored.order.feeBudget-stored.order.feeCharged:input.maxFee,
    allInLimit:stored?stored.order.limit*lots:input.allInLimit,notionalPrefix:stored?.order.notional,
    postReserve:(before,after,gross,fee)=>BigInt(groupBalanceView(nextRoot(before,after,gross,fee),snapshot.state,snapshot.marketStates,snapshot.now,snapshot.slot).reserved),admissible});
}
