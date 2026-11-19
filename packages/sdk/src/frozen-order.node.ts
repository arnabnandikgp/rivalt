// D121 ordering for the service and the finalized journal. The browser SDK
// has no dependency on the Node hashing API.
import {createHash} from 'node:crypto';
import {getAddressEncoder,type Address} from '@solana/kit';

export function frozenMemberRank(venue:Address,epoch:bigint,id:bigint) {
  const fields=Buffer.alloc(16);
  fields.writeBigUInt64LE(epoch,0);
  fields.writeBigUInt64LE(id,8);
  return createHash('sha256').update('Rivalt/frozen-member-order/v1\0')
    .update(Buffer.from(getAddressEncoder().encode(venue))).update(fields).digest();
}

type Participant = {id:bigint;amount:bigint};
export function singleLotWinnerOrder(venue:Address,epoch:bigint,debtors:Participant[],winners:Participant[]) {
  if(debtors.length!==2 || winners.length!==2 || [...debtors,...winners].some(member=>member.amount<=0n)
      || new Set([...debtors,...winners].map(member=>member.id)).size!==4) return null;
  const preferred=(left:Participant,right:Participant)=>{
    const order=Buffer.compare(frozenMemberRank(venue,epoch,left.id),frozenMemberRank(venue,epoch,right.id));
    return order<0 || (order===0 && left.id<right.id);
  };
  // The larger budget goes to the larger capacity. Equal budgets leave the
  // winner charges fixed, so the first debtor in the episode gets the first winner.
  const [first,second]=debtors, [left,right]=winners;
  let leftFirst:boolean;
  if(first.amount===second.amount) leftFirst=preferred(first,second)===preferred(left,right);
  else leftFirst=(first.amount>second.amount)===(left.amount===right.amount?preferred(left,right):left.amount>right.amount);
  const order=leftFirst?[0,1]:[1,0];
  return order.every((winner,index)=>debtors[index].amount<=winners[winner].amount)?order:null;
}

/** Two disjoint one-lot matchings, including losses that cannot be recovered in full. */
export function twoDebtorRecovery(venue:Address,epoch:bigint,debtors:Participant[],winners:Participant[]) {
  if(debtors.length!==2 || winners.length!==2 || debtors[0].id>=debtors[1].id || winners[0].id>=winners[1].id ||
      new Set([...debtors,...winners].map(member=>member.id)).size!==4 ||
      [...debtors,...winners].some(member=>member.amount<0n)) return null;
  function order(members:Participant[]) {
    const priority=members.map(member=>frozenMemberRank(venue,epoch,member.id));
    return Buffer.compare(priority[0],priority[1])<=0?[0,1]:[1,0];
  }
  const winnerOrder=order(winners),debtorOrder=order(debtors);
  function match(indices:number[]) {
    const charges=indices.map((winner,debtor)=>{
      const budget=debtors[debtor].amount,capacity=winners[winner].amount;
      return budget<capacity?budget:capacity;
    });
    const byWinner=indices[0]===0?charges:[charges[1],charges[0]];
    const deviation=byWinner[0]*winners[1].amount-byWinner[1]*winners[0].amount;
    const score=[charges[0]+charges[1],deviation>0n?-deviation:deviation,-BigInt(charges.filter(q=>q>0n).length),
      ...winnerOrder.map(winner=>byWinner[winner]),...winnerOrder.flatMap(winner=>
        debtorOrder.map(debtor=>indices[debtor]===winner?charges[debtor]:0n))];
    return {indices,charges,score};
  }
  const first=match([0,1]),second=match([1,0]);
  const difference=first.score.findIndex((value,index)=>value!==second.score[index]);
  const best=difference>=0 && second.score[difference]>first.score[difference]?second:first;
  return {order:best.indices,charges:best.charges};
}
