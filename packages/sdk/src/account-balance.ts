import {ordinaryGainAtoms,type PerLotProfit} from './profit-attribution.js';
import type {MarginAccount,Market as MarketAccount,VenueSafety} from './generated/index.js';
import {effectiveFunding,oracleMode} from './oracle-policy.js';
import {marginBalanceView,marginOrderRemaining,type MarginPreview} from './margin-balance.js';

type Root=MarginPreview<Omit<MarginAccount,'bump'|'discriminator'>>;
type Market=MarginPreview<Omit<MarketAccount,'bump'|'discriminator'>>;
type Safety=MarginPreview<Pick<VenueSafety,'venue'|'mode'|'paused'>>;
export {marginOrderRemaining as accountOrderRemaining};
export function effectiveAccountFunding(safety:Safety,market:Market,now:bigint,slot:bigint) {
  return effectiveFunding({...market,mode:safety.mode===1?2:0},market,now,slot);
}
export function accountSourceMode(safety:Safety,market:Market,now:bigint,slot:bigint) {
  return oracleMode({...market,mode:safety.mode===2?3:2},market,now,slot);
}
/** Both held funding endpoints per market, including adverse mixed corners. */
export function accountFundingBounds(safety:Safety,market:Market,now:bigint,slot:bigint):[bigint,bigint] {
  const current=effectiveAccountFunding(safety,market,now,slot),observation=market.oracle;
  let end=current;
  if(safety.mode===1&&BigInt(observation.heldEpoch)===BigInt(market.configEpoch)&&
    BigInt(observation.heldUntil)>BigInt(observation.sampledAt)&&slot<BigInt(observation.heldSlot)&&
    now>=BigInt(observation.sampledAt)&&now-BigInt(observation.sampledAt)<=30n) {
    end=BigInt(observation.fundingBase)+BigInt(observation.premiumScaled)*
      (BigInt(observation.heldUntil)-BigInt(observation.sampledAt))/3600n;
  }
  return current<end?[current,end]:[end,current];
}

/** Current whole-account valuation. Headroom is indicative, not a payout promise:
 * the atomic instruction recomputes sources, funding, reservations and solvency. */
export function accountBalanceView(root:Root,safety:Safety,markets:Market[],now:bigint,slot:bigint,closedEntries?:readonly PerLotProfit[]) {
  if(root.schemaVersion!==10||root.lifecycle!==2||BigInt(root.activationGeneration)===0n||root.venue!==safety.venue||markets.some((market,index)=>
    market.schemaVersion!==10||market.venue!==root.venue||market.index!==index))throw new Error('Invalid account preview dependencies');
  const sources=markets.map(market=>accountSourceMode(safety,market,now,slot));
  const funding=markets.map(market=>effectiveAccountFunding(safety,market,now,slot));
  const view=marginBalanceView(root,markets,funding,sources,now,slot,safety.mode===2);
  const bounds=markets.map(market=>accountFundingBounds(safety,market,now,slot));
  const corners=bounds[0].flatMap(btc=>bounds[1].map(eth=>
    marginBalanceView(root,markets,[btc,eth],sources,now,slot,safety.mode===2).riskEquityScaled));
  const heldRiskEquityScaled=corners.some(value=>value===null)?null:
    corners.map(value=>BigInt(value!)).reduce((left,right)=>left<right?left:right);
  const sourcesAllowExit=markets.every((market,index)=>
    (BigInt(root.positions[index].lots)===0n&&!root.book.orders.some((stored,orderIndex)=>stored.marketIndex===index&&BigInt(view.orders[orderIndex].remaining)>0n))||
    ['Normal','Degraded'].includes(sources[index]));
  const terminal=[0,3,4].includes(safety.mode);
  const flat=root.positions.every(position=>BigInt(position.lots)===0n&&BigInt(position.virtualScaled)===0n)&&
    BigInt(root.reserved)===0n&&root.book.orders.every(stored=>![1,2].includes(stored.order.state)&&BigInt(stored.order.reserve)===0n);
  const status=safety.paused?'Paused':safety.mode===2?'FrozenResolution':terminal&&!flat?'TerminalAccountNotSettled':
    !sourcesAllowExit?'RequiredSourceUnavailable':'RequiresAtomicAccountChecksAndSimulation';
  let indicativeCashHeadroom:string|null=null;
  if(status==='RequiresAtomicAccountChecksAndSimulation'&&view.localCashHeadroom!==null&&heldRiskEquityScaled!==null) {
    const heldCash=heldRiskEquityScaled>0n?heldRiskEquityScaled/1_000_000_000n:0n;
    const currentCash=BigInt(view.localCashHeadroom);indicativeCashHeadroom=(currentCash<heldCash?currentCash:heldCash).toString();
  }
  if(closedEntries && closedEntries.length!==root.positions.length)throw new Error('Incomplete position entry history.');
  const positions=view.positions.map((position,index)=>({...position,
    ordinaryPayableAtoms:closedEntries && position.unpaidClaimScaled!==null ?
      ordinaryGainAtoms(BigInt(position.unpaidClaimScaled),BigInt(position.lots),BigInt(markets[index].referencePrice),closedEntries[index]).toString():null}));
  return {...view,positions,heldFundingBoundsScaled:bounds.map(values=>values.map(value=>value.toString())),
    heldRiskEquityScaled:heldRiskEquityScaled?.toString()??null,indicativeCashHeadroom,
    withdrawableCash:null,withdrawalStatus:status,paused:safety.paused};
}

/** Explains when a realized gain on a partly or fully closed position can be paid.
 * The shared pool is observed liquidity, never a reservation for this account. */
export function closedGainStatus(position:{lots:string;unpaidClaimScaled:string|null;ordinaryPayableAtoms?:string|null}, settlement:bigint,
  safety:{mode:number;paused:boolean}) {
  if (position.unpaidClaimScaled === null || (position.lots !== '0' && position.ordinaryPayableAtoms == null)) return null;
  const claim = BigInt(position.unpaidClaimScaled);
  if (claim <= 0n) return null;
  if (safety.paused || safety.mode !== 1) return 'Ordinary settlement suspended';
  const wholeAtoms = position.ordinaryPayableAtoms == null ? claim / 1_000_000_000n : BigInt(position.ordinaryPayableAtoms);
  if (wholeAtoms === 0n) return position.lots === '0' ? 'Below one payable atom' : 'No whole atoms eligible for payment';
  if (settlement === 0n) return 'Awaiting loss collection';
  if (settlement < wholeAtoms) return 'Market pool covers part of this claim';
  return 'Awaiting verified payment';
}
