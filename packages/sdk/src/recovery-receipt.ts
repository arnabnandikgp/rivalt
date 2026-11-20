import {getAddressDecoder} from '@solana/kit';
import type {PreparedSettlement} from './generated/index.js';
import {requireValue} from './wallet-client.js';

/** Clearing stores this receipt in the completed membership traversal's scratch.
 * Its signed market movements are distinct from the forced-close claim changes. */
export function boundRecoveryReceipt(header: PreparedSettlement) {
  const bytes = Uint8Array.from(header.state.membership);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== 'RVJOINT1') return null;
  requireValue(bytes.length === 544 && header.count === 8n && [2, 3].includes(header.stage),
    'Invalid recovery receipt header.');
  const view = new DataView(bytes.buffer);
  const unsigned = (offset: number) => view.getBigUint64(offset, true);
  const signed = (offset: number) => view.getBigInt64(offset, true);
  const wide = (offset: number) => unsigned(offset) + (unsigned(offset + 8) << 64n);
  const memberIds: bigint[] = [], claimDeltas: bigint[][] = [], movements: bigint[][] = [], finalCash: bigint[] = [];
  const search = getAddressDecoder().decode(bytes.subarray(16, 48));
  const chargeAtoms = [unsigned(48), unsigned(56)], insuranceSpent = [unsigned(64), unsigned(72)];
  for (let ordinal = 0; ordinal < 8; ordinal++) {
    const start = 80 + 48 * ordinal, id = unsigned(start);
    requireValue(!ordinal || id > memberIds[ordinal - 1], 'Unordered recovery member.');
    memberIds.push(id);
    claimDeltas.push([signed(start + 8), signed(start + 16)]);
    movements.push([signed(start + 24), signed(start + 32)]);
    finalCash.push(unsigned(start + 40));
  }
  const schedule = wide(464), schedulesChecked = wide(480);
  requireValue(unsigned(8) === header.epoch && search !== '11111111111111111111111111111111'
    && schedule < schedulesChecked && bytes.subarray(496).every(value => value === 0),
    'Invalid frozen recovery commitment.');
  return {search, schedule, schedulesChecked, chargeAtoms, insuranceSpent, memberIds, claimDeltas, movements, finalCash};
}

/** The epoch-bound market totals stay in the header. Each member's authorized
 * cash and forced-close delta live on that member's canonical frozen page. */
export function pagedRecoveryHeader(header:PreparedSettlement) {
  const bytes=Uint8Array.from(header.state.membership);
  if(new TextDecoder().decode(bytes.subarray(0,8))!=='RVPAGED1')return null;
  requireValue(bytes.length===544 && [2,3].includes(header.stage),'Invalid paged recovery stage');
  const view=new DataView(bytes.buffer);
  const word=(offset:number)=>view.getBigUint64(offset,true);
  const wide=(offset:number)=>word(offset)+(word(offset+8)<<64n);
  const search=getAddressDecoder().decode(bytes.subarray(16,48));
  const memberCount=word(80),schedule=wide(88),schedulesChecked=wide(104);
  requireValue(word(8)===header.epoch && memberCount>0n && memberCount===header.count
    && search!=='11111111111111111111111111111111' && schedule<schedulesChecked
    && bytes.subarray(120).every(value=>value===0),'Invalid paged recovery commitment');
  return {search,schedule,schedulesChecked,chargeAtoms:[word(48),word(56)],insuranceSpent:[word(64),word(72)],memberCount};
}
