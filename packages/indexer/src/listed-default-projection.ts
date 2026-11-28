import * as sdk from '@rivalt/sdk';
import type {AccountEvent} from './account-events.js';
import {accountCheck,accountFields,present,type AccountState} from './account-projection.js';

const scale=1_000_000_000n;
const next=(value:string)=>String(BigInt(value)+1n);

/** Rebuild a settled root from its prior journaled state and its final cash.
 * The episode retains the original prices, funding and market-specific resources. */
export function projectListedDefault(state:AccountState,event:AccountEvent,artifactSet?:string) {
  const data=event.data, venue=present(state.venue,'listed venue'), safety=present(state.safety,'listed safety');
  accountCheck(artifactSet===sdk.LISTED_DEFAULT_ARTIFACT_SET && venue.profileVersion===7,'listed default artifact');
  const ids=state.members.map(key=>state.roots[key].id)
    .sort((left,right)=>BigInt(left)<BigInt(right)?-1:BigInt(left)>BigInt(right)?1:0);
  if(event.type==='ListedDefaultFrozen') {
    const snap=data.snapshot;
    accountCheck(safety.mode===1 && !safety.paused && !state.listedDefaults?.[data.episode] &&
      snap.epoch===next(safety.resolutionEpoch) && snap.safetyEpoch===next(safety.epoch) && snap.termsEpoch===next(venue.termsEpoch)
      && snap.memberCount===String(ids.length) && snap.membershipEpoch===state.membershipVersion &&
      snap.allocatedVault===state.custody?.allocatedVault && state.members.includes(snap.target),'listed freeze basis');
    const directories=Object.values(state.listedVenues??{});
    accountCheck(directories.length===1,'listed default directory');
    const admitted=[0,1,...directories[0].markets.slice(0,directories[0].count)];
    accountCheck(admitted.length===snap.width && snap.markets.length===8,'listed freeze width');
    for(const [i,id] of admitted.entries()) {
      const m=snap.markets[i], base=id<2;
      const ledger=base?Object.values(state.ledgers).find(l=>l.marketIndex===id):undefined;
      const book=base?undefined:Object.values(state.listedBooks??{}).find(b=>state.listings?.[b.listing]?.marketId===id);
      const balances=present(ledger??book,'frozen ledger');
      const gross=base?state.markets[venue.markets[id]].grossLots:book!.grossLots;
      accountCheck(m.market===id && BigInt(m.reference)>0n && m.grossLots===gross && m.settlement===balances.settlement
        && m.insurance===balances.insurance && m.fees===balances.fees &&
        m.insuranceCarry===(ledger?.insuranceFeeRemainder??book!.insuranceCarry),'frozen market resources');
    }
    const target=state.roots[snap.target];
    const stored=state.listedPositions?.[snap.target];
    const extra=stored?sdk.decodeListedRecords(Buffer.from(stored,'hex'),sdk.listedMarginCapacity(target),true).records:[];
    const occupied=[...target.positions.map((p,market)=>({...p,market})),...extra];
    let equity=BigInt(target.cash)*scale,debt=0n,flat=true;
    for(const p of occupied) {
      const slot=admitted.indexOf(p.market);
      accountCheck(slot>=0,'frozen market for debtor');
      const m=snap.markets[slot],lots=BigInt(p.lots);
      const claim=BigInt(p.virtualScaled)+lots*(BigInt(m.reference)*scale-BigInt(m.funding)+BigInt(p.fundingCheckpointScaled));
      equity+=claim;if(claim<0n)debt-=claim;if(lots!==0n)flat=false;
    }
    accountCheck(equity<0n || (flat && debt>BigInt(target.cash)*scale),'permissionless default eligibility');
    (state.listedDefaults??={})[data.episode]={venue:data.venue,schemaVersion:1,revision:'0',completed:false,snapshot:snap};
    Object.assign(safety,{epoch:snap.safetyEpoch,resolutionEpoch:snap.epoch,mode:2,paused:true,recoverySince:'0',recoveryLast:'0'});
    venue.termsEpoch=snap.termsEpoch;
    return;
  }
  const episode=present(state.listedDefaults?.[data.episode],'frozen listed episode'), snap=episode.snapshot;
  accountCheck(safety.mode===2 && safety.paused && !episode.completed && snap.epoch===data.epoch
    && data.termsEpoch===next(venue.termsEpoch) && data.safetyEpoch===next(safety.epoch) && data.checkedPlans>0
    && data.memberIds.length===ids.length && ids.every((id,i)=>id===data.memberIds[i])
    && data.finalCash.length===ids.length && data.spent.length===snap.width && data.charged.length===snap.width,
    'complete listed settlement');
  const empty=accountFields<sdk.MarginAccount>(sdk.getMarginAccountDecoder().decode(new Uint8Array(sdk.getMarginAccountSize())));
  let total=0n;
  for(const [i,id] of ids.entries()) {
    const key=state.identities[id],root=state.roots[key], cash=BigInt(data.finalCash[i]);
    accountCheck(cash>=0n,'final cash');
    total+=cash;
    root.cash=String(cash);root.nonce=next(root.nonce);root.stateVersion=next(root.stateVersion);root.delegateEpoch=next(root.delegateEpoch);
    root.delegate=empty.delegate;root.delegateExpirySlot='0';root.backingEpochs=['0','0'];root.reserved='0';
    root.book={...structuredClone(empty.book),lastOrderId:root.book.lastOrderId,lastGroupId:root.book.lastGroupId};
    root.positions=root.positions.map((p,m)=>root.mode===1 && root.isolatedMarketIndex!==m?p:{
      lots:'0',virtualScaled:'0',fundingCheckpointScaled:snap.markets[m].funding,generation:next(p.generation)});
    const packed=state.listedPositions?.[key];
    if(packed) {
      const header=Buffer.from(packed,'hex').subarray(0,18);
      header.writeUInt16LE(0,16);
      state.listedPositions![key]=header.toString('hex');
    }
  }
  for(const [i,m] of snap.markets.slice(0,snap.width).entries()) {
    const spent=BigInt(data.spent[i]);
    accountCheck(spent>=0n && spent<=BigInt(m.insurance),'market-local insurance');
    const insurance=String(BigInt(m.insurance)-spent);
    total+=BigInt(insurance)+BigInt(m.fees);
    if(i<2) {
      const market=state.markets[venue.markets[i]], ledger=present(Object.values(state.ledgers).find(l=>l.marketIndex===i),'inline ledger');
      market.grossLots='0';market.termsEpoch=next(market.termsEpoch);
      Object.assign(ledger,{insurance,settlement:'0',version:next(ledger.version),liabilityVersion:next(ledger.liabilityVersion)});
    } else {
      const book=present(Object.values(state.listedBooks??{}).find(b=>state.listings?.[b.listing]?.marketId===m.market),'listed book');
      Object.assign(book,{insurance,settlement:'0',grossLots:'0'});
    }
  }
  accountCheck(total===BigInt(snap.allocatedVault),'terminal custody conservation');
  episode.completed=true;venue.termsEpoch=data.termsEpoch;
  Object.assign(safety,{mode:3,paused:false,epoch:data.safetyEpoch});
}
