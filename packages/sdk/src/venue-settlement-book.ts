// Capture the current venue's default inputs in the market-indexed native solver's wire format.
import {getAddressEncoder,type Address} from '@solana/kit';
import {readCompleteFinancialSnapshot,type AccountIdentity} from './account-snapshot.js';
import {memberIndexBytes} from './account-addresses.js';
import {hex,requireValue,type UserRpc} from './wallet-client.js';

const scale=1_000_000_000n;

export async function readVenueSettlementBook(rpc:Pick<UserRpc,'call'>,identity:AccountIdentity,roster:Address[],
  phase:'active-preview'|'frozen') {
  const view=await readCompleteFinancialSnapshot(rpc,identity,roster);
  requireValue(view.feeEscrow && view.marginLayout==='ledger-lanes','Settlement input reader needs the ledger-lane venue.');
  const frozen=phase==='frozen'?view.resolutionState:undefined;
  if(phase==='frozen') {
    requireValue(frozen && view.safetyState.mode===2 && view.safetyState.paused && frozen.stage===2 && frozen.cursor===0n &&
      frozen.epoch===view.safetyState.resolutionEpoch && frozen.safetyEpoch===view.safetyState.epoch &&
      frozen.termsEpoch===view.venueState.termsEpoch && frozen.count===view.membership.financialCount &&
      frozen.membershipEpoch===view.membership.membershipEpoch && frozen.liveIndex===view.membership.liveIndex &&
      view.storageState?.lockedEpoch===frozen.epoch && view.storageState.readyCapacity>=frozen.count &&
      frozen.allocatedBefore===view.custodyState.allocatedVault,'Expected a newly valued, complete frozen venue.');
    const encode=getAddressEncoder();
    const input=Uint8Array.from([...new TextEncoder().encode('rivalt-financial-membership-v1'),...encode.encode(view.venue),
      ...encode.encode(view.membership.liveIndex),...memberIndexBytes(frozen.membershipEpoch),...memberIndexBytes(frozen.count)]);
    requireValue(hex(new Uint8Array(await crypto.subtle.digest('SHA-256',input)))===hex(frozen.registryHash),'Frozen membership hash mismatch.');
  } else requireValue(phase==='active-preview' && view.safetyState.mode===1,'Expected an active venue preview.');
  const markets=view.marketStates.map((market,index)=>{
    const ledger=view.ledgerStates[index];
    requireValue((frozen?.prices[index]??market.referencePrice)>0n,'Missing settlement reference.');
    // Fees on execution lanes include the insurance share until market classification.
    const pending=view.feeEscrow![index].pendingFees;
    const insuranceDue=(pending+BigInt(ledger.insuranceFeeRemainder))/4n;
    if(frozen) requireValue(pending===0n && market.configEpoch===frozen.configEpochs[index] &&
      market.fundingIndexScaled===frozen.funding[index] && market.grossLots===frozen.remainingGross[index] &&
      ledger.settlement===frozen.poolsBefore[index] && ledger.insurance===frozen.insuranceBefore[index] &&
      ledger.fees===frozen.feesBefore[index],'Frozen ledger or market mismatch.');
    return {id:market.index,pool:ledger.settlement.toString(),insurance:(ledger.insurance+insuranceDue).toString(),
      fees:(ledger.fees-insuranceDue).toString()};
  });
  let accountedCash=0n;
  const totals=markets.map(()=>({lots:0n,gross:0n,claim:0n}));
  const roots=Object.values(view.roots).sort((first,second)=>first.id<second.id?-1:1);
  const rows=roots.map(root=>{
    accountedCash+=root.cash;
    const claims=root.positions.map((position,index)=>{
      const market=view.marketStates[index];
      const price=frozen?.prices[index]??market.referencePrice;
      const scaled=position.virtualScaled+position.lots*(price*scale-
        (market.fundingIndexScaled-position.fundingCheckpointScaled));
      totals[index].claim+=scaled;
      totals[index].lots+=position.lots;
      totals[index].gross+=position.lots<0n?-position.lots:position.lots;
      return scaled.toString();
    });
    return {id:root.id.toString(),cash:root.cash.toString(),claims};
  });
  if(frozen) requireValue(accountedCash===frozen.cashBefore,'Frozen member cash mismatch.');
  for(const [index,market] of markets.entries()) {
    requireValue(totals[index].lots===0n && totals[index].gross===view.marketStates[index].grossLots && totals[index].claim===BigInt(market.pool)*scale,
      'Market inventory or settlement pool does not reconcile.');
    accountedCash+=BigInt(market.pool)+BigInt(market.insurance)+BigInt(market.fees);
  }
  requireValue(accountedCash===view.custodyState.allocatedVault,'Member cash and market funds do not reconcile to allocated custody.');
  return {phase,episode:frozen?.epoch,contextSlot:view.contextSlot,membershipEpoch:view.membership.membershipEpoch,unallocated:view.actualVault-accountedCash,
    book:{market_roster:markets.map(m=>m.id),markets,roster:rows.map(row=>row.id),rows,vault:accountedCash.toString()}};
}
