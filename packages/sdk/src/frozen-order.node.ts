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
