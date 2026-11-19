import type {PreparedSettlement} from './generated/index.js';
import {requireValue} from './wallet-client.js';
const marker=new TextEncoder().encode('RVPAIR01');
export function frozenPairReceipt(prepared:PreparedSettlement) {
  const bytes=Uint8Array.from(prepared.state.membership);
  if(!marker.every((byte,index)=>bytes[index]===byte))return null;
  const view=new DataView(bytes.buffer);
  const [epoch,debtorId,winnerId,charge,price,unpaidGainCap]=Array.from({length:6},(_,index)=>view.getBigUint64(8+8*index,true));
  requireValue(epoch===prepared.epoch&&debtorId!==winnerId&&charge<=unpaidGainCap&&(price===0n)===(charge===0n)
    &&bytes.subarray(56).every(byte=>byte===0),'Invalid verified pair receipt.');
  return {epoch,debtorId,winnerId,charge,price,unpaidGainCap};
}
