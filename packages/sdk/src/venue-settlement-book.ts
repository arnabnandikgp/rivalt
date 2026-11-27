// Capture the current venue's default inputs in the market-indexed native solver's wire format.
import type {Address} from '@solana/kit';
import {readCompleteFinancialSnapshot,type AccountIdentity} from './account-snapshot.js';
import {requireValue,type UserRpc} from './wallet-client.js';

const scale=1_000_000_000n;

export async function readVenueSettlementBook(rpc:Pick<UserRpc,'call'>,identity:AccountIdentity,roster:Address[]) {
  const view=await readCompleteFinancialSnapshot(rpc,identity,roster);
  requireValue(view.safetyState.mode===1 && view.feeEscrow && view.marginLayout==='ledger-lanes',
    'Settlement input reader needs the active ledger-lane venue.');
  const markets=view.marketStates.map((market,index)=>{
    const ledger=view.ledgerStates[index];
    requireValue(market.referencePrice>0n,'Missing settlement reference.');
    // Fees on execution lanes include the insurance share until market classification.
    const pending=view.feeEscrow![index].pendingFees;
    const insuranceDue=(pending+BigInt(ledger.insuranceFeeRemainder))/4n;
    return {id:market.index,pool:ledger.settlement.toString(),insurance:(ledger.insurance+insuranceDue).toString(),
      fees:(ledger.fees-insuranceDue).toString()};
  });
  let accountedCash=0n;
  const totals=markets.map(()=>({lots:0n,claim:0n}));
  const roots=Object.values(view.roots).sort((first,second)=>first.id<second.id?-1:1);
  const rows=roots.map(root=>{
    accountedCash+=root.cash;
    const claims=root.positions.map((position,index)=>{
      const market=view.marketStates[index];
      const scaled=position.virtualScaled+position.lots*(market.referencePrice*scale-
        (market.fundingIndexScaled-position.fundingCheckpointScaled));
      totals[index].claim+=scaled;
      totals[index].lots+=position.lots;
      return scaled.toString();
    });
    return {id:root.id.toString(),cash:root.cash.toString(),claims};
  });
  for(const [index,market] of markets.entries()) {
    requireValue(totals[index].lots===0n && totals[index].claim===BigInt(market.pool)*scale,
      'Market inventory or settlement pool does not reconcile.');
    accountedCash+=BigInt(market.pool)+BigInt(market.insurance)+BigInt(market.fees);
  }
  requireValue(accountedCash===view.custodyState.allocatedVault,'Member cash and market funds do not reconcile to allocated custody.');
  return {contextSlot:view.contextSlot,membershipEpoch:view.membership.membershipEpoch,unallocated:view.actualVault-accountedCash,
    book:{market_roster:markets.map(m=>m.id),markets,roster:rows.map(row=>row.id),rows,vault:accountedCash.toString()}};
}
