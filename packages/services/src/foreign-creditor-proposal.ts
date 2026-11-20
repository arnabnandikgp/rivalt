import type {Address} from '@solana/kit';
import type {FrozenMargin, PreparedSettlement} from '@rivalt/sdk';

export type FrozenMember = {row:FrozenMargin; ordinal:bigint; page:Address};

/** A keeper may suggest this shape. Clearing authenticates both roots, all
 * four rows, complete valuation totals and both execution schedules itself. */
export function foreignCreditorProposal(header:PreparedSettlement, members:FrozenMember[]) {
  if (header.pools.some(value=>value!==0n) || BigInt(members.length)!==header.count) return null;
  const roles: (FrozenMember | undefined)[] = Array(4);
  const scale=1_000_000_000n;
  for(const member of members) {
    const {claims:[btc,eth],lots:[btcLots,ethLots]}=member.row;
    if(btc%scale || eth%scale) return null;
    if(btc===0n && eth===0n && btcLots===0n && ethLots===0n) continue;
    let role:number;
    if(btc<0n && eth===0n && btcLots!==0n && ethLots===0n) role=0;
    else if(btc>0n && eth===0n && btcLots===0n && ethLots===0n) role=1;
    else if(btc>0n && eth<0n && btcLots!==0n && ethLots!==0n) role=2;
    else if(btc===0n && eth>0n && btcLots===0n && ethLots!==0n) role=3;
    else return null;
    if(roles[role]) return null;
    roles[role]=member;
  }
  const [debtor,flat,cross,eth]=roles;
  if(!debtor || !flat || !cross || !eth) return null;
  const debt=-debtor.row.claims[0]/scale, gain=cross.row.claims[0]/scale, ethDebt=-cross.row.claims[1]/scale;
  const backing=debtor.row.cash+header.insurance[0], ethBacking=cross.row.cash+header.insurance[1];
  const btcCharge=debt-backing, originalEthCeiling=ethBacking+(gain*backing+debt-1n)/debt;
  const ethCharge=ethDebt-originalEthCeiling, projectedEth=ethBacking+gain-btcCharge;
  if(debt!==flat.row.claims[0]/scale+gain || ethDebt!==eth.row.claims[1]/scale ||
      debtor.row.lots[0]!==-cross.row.lots[0] || cross.row.lots[1]!==-eth.row.lots[1] ||
      backing<=0n || btcCharge<=0n || gain<=btcCharge || ethCharge<=0n ||
      projectedEth>originalEthCeiling || projectedEth+ethCharge<originalEthCeiling) return null;
  const ordered=[debtor,flat,cross,eth];
  const pages=[...new Set([...ordered].sort((left,right)=>left.ordinal<right.ordinal?-1:1).map(member=>member.page))];
  return {ordinals:ordered.map(member=>member.ordinal),charges:[btcCharge,ethCharge],
    firstPage:pages[0],secondPage:pages[1],thirdPage:pages[2],fourthPage:pages[3],
    crossWinner:cross.row.member,ethWinner:eth.row.member};
}
