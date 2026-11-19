import type {PreparedSettlement} from '@rivalt/sdk';
import {singleLotWinnerOrder,twoDebtorRecovery} from '@rivalt/sdk/frozen-order';
import type {FrozenMember} from './foreign-creditor-proposal.js';

export async function sharedInventoryProposal(header:PreparedSettlement,members:FrozenMember[],
    capacity:(member:FrozenMember)=>Promise<bigint>, partial=false) {
  if(BigInt(members.length)!==header.count || header.gross[0]!==4n || header.gross[1]!==0n ||
      header.pools.some(pool=>pool!==0n)) return null;
  const scale=1_000_000_000n;
  const debtors:FrozenMember[]=[],winners:FrozenMember[]=[];
  for(const member of members) {
    const {claims:[btc,eth],lots:[lots,ethLots]}=member.row;
    if(eth!==0n || ethLots!==0n)return null;
    if(lots===0n && (btc===0n || partial && btc>0n))continue;
    if((lots!==1n && lots!==-1n) || btc%scale!==0n || (!partial && btc===0n))return null;
    (btc<0n?debtors:winners).push(member);
  }
  if(debtors.length!==2 || winners.length!==2 || debtors[0].row.id>=debtors[1].row.id) return null;
  const side=debtors[0].row.lots[0];
  if(debtors[1].row.lots[0]!==side || winners.some(member=>member.row.lots[0]!==-side))return null;
  const losses=debtors.map(({row})=>-row.claims[0]/scale-row.cash);
  const total=losses[0]+losses[1],residual=total-header.insurance[0];
  if(residual<=0n || losses.some(loss=>partial?loss<0n:loss<=0n))return null;
  const budgets=losses.map(loss=>loss*residual/total);
  const eligible=await Promise.all(winners.map(capacity));
  const debtorAmounts=debtors.map(({row},index)=>({id:row.id,amount:budgets[index]}));
  const winningAmounts=winners.map(({row},index)=>({id:row.id,amount:eligible[index]}));
  const plan=partial?twoDebtorRecovery(header.venue,header.epoch,debtorAmounts,winningAmounts):
    {order:singleLotWinnerOrder(header.venue,header.epoch,debtorAmounts,winningAmounts),charges:budgets};
  if(!plan?.order)return null;
  const {order,charges}=plan;
  const roles=[...debtors,...order.map(i=>winners[i])];
  const pages=[...new Set([...roles].sort((a,b)=>a.ordinal<b.ordinal?-1:1).map(member=>member.page))];
  return {ordinals:roles.map(member=>member.ordinal),charges,firstWinner:roles[2].row.member,secondWinner:roles[3].row.member,
    firstPage:pages[0],secondPage:pages[1],thirdPage:pages[2],fourthPage:pages[3]};
}
