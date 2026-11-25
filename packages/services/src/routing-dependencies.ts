import {AccountRole,type AccountMeta} from '@solana/kit';
import type {MarketCheckpoint} from '@rivalt/sdk';

/** Wire privilege checks for the bounded relay. Clearing authenticates live
 * ownership, code, capital, dependency PDAs and signed epochs at execution. */
export function validateRoutingDependencies(accounts:Record<string,AccountMeta|undefined>,extra:readonly AccountMeta[],
  additionalBooks:number,standing:boolean,checkpoints:readonly MarketCheckpoint[]){
  const keys=checkpoints.find(entry=>entry.account===accounts.market?.address)?.makerDirectory;
  if(!keys)throw new Error('Missing market registration configuration');
  const names=standing?['zeroRegistration','oneRegistration','twoRegistration']:['firstRegistration'];
  const ids=names.map(name=>keys.indexOf(accounts[name]!.address));
  const boundary=6*additionalBooks;
  if(!Number.isInteger(additionalBooks)||additionalBooks<0||additionalBooks>5||extra.length<boundary)
    throw new Error('Invalid signed maker bundle count');
  for(let offset=0;offset<boundary;offset+=6){
    const bundle=extra.slice(offset,offset+6);
    if(bundle.some((account,index)=>account.role!==(index<2?AccountRole.WRITABLE:AccountRole.READONLY)))
      throw new Error('Invalid maker dependency privileges');
    ids.push(keys.indexOf(bundle[1].address));
  }
  if(ids.some((id,index)=>id<0||index>0&&id<=ids[index-1]))throw new Error('Invalid maker registration sequence');
  const lanes=keys.slice(0,3).filter((_,lane)=>!ids.includes(lane)&&ids.some(id=>id%3===lane));
  const supplied=extra.slice(boundary);
  if(lanes.length!==supplied.length||lanes.some((key,index)=>supplied[index].address!==key||
      supplied[index].role!==AccountRole.WRITABLE))throw new Error('Invalid physical maker accounting lanes');
}
