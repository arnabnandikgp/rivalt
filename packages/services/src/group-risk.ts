import {AccountRole,type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';

/** Default rereads these six authenticated sources on chain, independently of
 * the cached oracle mode. Administrative pause never changes that authority. */
export function groupRiskSources(snapshot:sdk.GroupSnapshot){
  const [btc,eth]=snapshot.marketStates.map(market=>market.oracle.sources);
  if(btc[1]!==eth[1]||btc[3]!==eth[3])throw new Error('Group collateral source identity mismatch');
  return {primaryBtc:btc[0],primaryCollateral:btc[1],guardBtc:btc[2],guardCollateral:btc[3],primaryEth:eth[0],guardEth:eth[2]};
}

/** Open exposure may be bankrupt at a newer source price even while sampling is
 * paused. A simulation authenticates current prices and net equity; adverse risk
 * equity or a keeper heuristic never authorizes default. Flat net-positive roots
 * need no probe because neither price nor pending funding can change their claim. */
export function groupDefaultProbeMembers(snapshot:sdk.GroupSnapshot):Address[]{
  return snapshot.members.filter(margin=>{
    const root=snapshot.roots[margin];
    return root.positions.some(position=>position.lots!==0n)||
      root.cash*1_000_000_000n+root.positions.reduce((sum,position)=>sum+position.virtualScaled,0n)<0n;
  });
}

export function groupResolutionPage(snapshot:sdk.GroupSnapshot & {eventAuthority:Address;program:Address}){
  const header=snapshot.resolutionState?.header;
  if(snapshot.state.mode!==3||!snapshot.state.paused||!header||header.stage<2||header.stage>11||
    header.count!==snapshot.members.length||header.cursor>=header.count)throw new Error('Invalid complete-group resolution cursor');
  const members=snapshot.members.slice(header.cursor,header.cursor+4);
  const instruction=sdk.getAdvanceGroupResolutionV2Instruction({...snapshot,epoch:header.epoch,stage:header.stage,start:header.cursor});
  return {...instruction,accounts:[...instruction.accounts,...members.map(address=>({address,
    role:[3,10].includes(header.stage)?AccountRole.WRITABLE:AccountRole.READONLY}))]};
}

export function groupReceiver(snapshot:sdk.GroupSnapshot,owner:Address,margin:Address|undefined){
  if(!margin)return null;
  const root=snapshot.roots[margin];
  if(!root||root.owner!==owner||root.role===1||root.cash===0n)throw new Error('Explicit funded non-maker receiver required');
  return root;
}
