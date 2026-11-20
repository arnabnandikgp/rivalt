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

/** Replay the single-lot assignment from frozen budgets and surviving winning gains. */
export function inventoryBookPlan(venue:Address,epoch:bigint,debtors:Participant[],winners:Participant[],side:bigint,mark:bigint) {
  if(side!==1n && side!==-1n)throw new Error('Unknown debtor direction');
  const ranked=(members:Participant[])=>members.filter(member=>member.amount>0n).map(member=>({
    ...member,priority:frozenMemberRank(venue,epoch,member.id),
  }));
  type Member=ReturnType<typeof ranked>[number];
  const byAmount=(a:bigint,b:bigint)=>a>b?-1:a<b?1:0;
  const byPriority=(a:Member,b:Member)=>Buffer.compare(a.priority,b.priority)||byAmount(b.id,a.id);
  const compare=(a:Member,b:Member)=>byAmount(a.amount,b.amount)||byPriority(a,b);
  if(new Set([...debtors,...winners].map(member=>member.id)).size!==debtors.length+winners.length ||
      [...debtors,...winners].some(member=>member.amount<0n))throw new Error('Invalid inventory book members');
  const available=ranked(debtors).sort(compare), eligible=ranked(winners).sort(compare);
  const targets=eligible.slice(0,available.length).map((winner,i)=>({
    winner,charge:winner.amount<available[i].amount?winner.amount:available[i].amount,
  })).sort((left,right)=>byPriority(left.winner,right.winner));
  available.sort(byPriority);
  const pairs:bigint[][]=[];
  for(const [index,{winner,charge}] of targets.entries()) {
    // Check the suffix directly. Each remaining target must have a distinct
    // budget at least as large when both sequences are sorted descending.
    const suffix=targets.slice(index+1).map(target=>target.charge).sort(byAmount);
    const candidate=available.findIndex((debtor,position)=> {
      if(debtor.amount<charge)return false;
      const remaining=available.filter((_,i)=>i!==position).map(member=>member.amount).sort(byAmount);
      return suffix.every((amount,i)=>remaining[i]>=amount);
    });
    if(candidate<0)throw new Error('Incomplete frozen inventory assignment');
    const debtor=available.splice(candidate,1)[0];
    pairs.push([debtor.id,winner.id,charge,mark+side*charge]);
  }
  const total=pairs.reduce((sum,pair)=>sum+pair[2],0n);
  const words=(values:bigint[])=>{
    const bytes=Buffer.alloc(8*values.length);
    values.forEach((value,i)=>bytes.writeBigUInt64LE(value,i*8));
    return bytes;
  };
  const capacities=[...winners].sort((a,b)=>byAmount(b.id,a.id)).map(member=>[member.id,member.amount]);
  let digest=createHash('sha256').update('Rivalt/inventory-book/v1').update(getAddressEncoder().encode(venue) as Uint8Array)
    .update(words([epoch,total])).digest();
  for(const row of [...capacities,...pairs])digest=createHash('sha256').update(digest).update(words(row)).digest();
  return {pairs,capacities,total,digest:digest.toString('hex')};
}
