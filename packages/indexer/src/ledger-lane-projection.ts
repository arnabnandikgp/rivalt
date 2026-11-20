import {applyBackingChanges, type BackingChange} from '@rivalt/sdk';
import {accountCheck, present, type AccountRoot, type AccountState} from './account-projection.js';

type Ledger=AccountState['ledgers'][string];
function contribution(root:AccountRoot,ledger:Ledger):BackingChange{
  const selected=ledger.marketIndex,scale=1_000_000_000n;
  const positions=root.positions.map((position,index)=>{
    const quantity=BigInt(position.lots),fixed=BigInt(position.virtualScaled)+quantity*BigInt(position.fundingCheckpointScaled);
    const range=ledger.backing.region;
    const minimum=fixed+quantity*(scale*BigInt(range.prices[index][quantity>=0n?0:1])-BigInt(range.funding[index][quantity>=0n?1:0]));
    return {quantity,fixed,minimum};
  });
  const {quantity,fixed,minimum}=positions[selected];
  const debt=positions.reduce((sum,p)=>p.minimum<0n?sum-p.minimum:sum,0n);
  return {bad:BigInt(minimum<0n&&BigInt(root.cash)*scale<debt),quantity,positive:fixed>0n?fixed:0n,negative:fixed<0n?-fixed:0n,
    required:positions.map((p,i)=>BigInt(p.quantity!==0n&&(i===selected||minimum<0n)))};
}

/** Replay only confirmed financial root replacements. The raw ledger is independently reconciled by scoped revision. */
export function ledgerAfterFill(state:AccountState,ledger:Ledger,roots:readonly AccountRoot[],fee:string){
  let liabilityIncrements=1n;
  const changes:BackingChange[]=[];
  for(const next of roots){
    const old=present(state.roots[state.identities[next.id]],'previous filled margin account');
    const active=(root:AccountRoot,index:number)=>[root.positions[index].lots,root.positions[index].virtualScaled].some(value=>BigInt(value)!==0n);
    const index=ledger.marketIndex;
    accountCheck(!active(old,1-index)&&!active(next,1-index),'sibling ledger required for route');
    if(!active(old,index)&&!active(next,index))continue;
    liabilityIncrements++;
    if(ledger.backing.epoch==='0'||state.safety?.mode!==1||state.safety.epoch!==ledger.backing.safetyEpoch||old.backingEpochs[index]!==ledger.backing.epoch)continue;
    const previous=contribution(old,ledger),current=contribution(next,ledger);
    changes.push({bad:current.bad-previous.bad,quantity:current.quantity-previous.quantity,positive:current.positive-previous.positive,
      negative:current.negative-previous.negative,required:current.required.map((v,i)=>v-previous.required[i])});
  }
  const summary=ledger.backing.epoch==='0'?ledger.backing.summary:Buffer.from(applyBackingChanges(Buffer.from(ledger.backing.summary,'hex'),changes)).toString('hex');
  return {...ledger,fees:String(BigInt(ledger.fees)+BigInt(fee)),version:String(BigInt(ledger.version)+1n),
    liabilityVersion:String(BigInt(ledger.liabilityVersion)+liabilityIncrements),backing:{...ledger.backing,summary}};
}
