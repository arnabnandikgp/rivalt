// Candidate frozen pages append either a BTC charge or a BTC/ETH pair to each row.
// Only a completed allocation certificate activates the recorded amounts.
import {
  fixDecoderSize,getAddressDecoder,getArrayDecoder,getBytesDecoder,getStructDecoder,
  type FixedSizeDecoder,getTupleDecoder,getU16Decoder,getU64Decoder,getU8Decoder,transformDecoder,
} from '@solana/kit';
import {getFrozenMarginDecoder,type PreparedSettlement} from './generated/index.js';
import {requireValue} from './wallet-client.js';

export function getBtcAllocationPageDecoder() {
  const row=transformDecoder(getTupleDecoder([getFrozenMarginDecoder(),getU64Decoder()]),
    ([original,btcCharge])=>({...original,btcCharge}));
  return allocationPage(row);
}

export function getLinkedAllocationPageDecoder() {
  const row=transformDecoder(getTupleDecoder([getFrozenMarginDecoder(),getU64Decoder(),getU64Decoder()]),
    ([original,btc,eth])=>({...original,linkedCharges:[btc,eth] as [bigint,bigint]}));
  return allocationPage(row);
}

// Eleven fixed revisioned accounts precede the dynamic pages in VerifyInventoryBook.
export const INVENTORY_BOOK_ACTIVE_PAGE_LIMIT=32-11;
export const INVENTORY_BOOK_EVENT_PAGE_LIMIT=Math.floor((8192-108-10*41-49)/49);
export const INVENTORY_BOOK_HEAP_BYTES=128*1024;

export function getInventoryBookPageDecoder() {
  return allocationPage(transformDecoder(getTupleDecoder([getFrozenMarginDecoder(),getU64Decoder(),getU64Decoder()]),
    ([original,bookCapacity,bookCharge])=>({...original,bookCapacity,bookCharge})));
}

export function inventoryBookReceipt(header:PreparedSettlement) {
  const bytes=Uint8Array.from(header.state.membership);
  if(new TextDecoder().decode(bytes.subarray(0,8))!=='RVBOOK01')return null;
  const view=new DataView(bytes.buffer), epoch=view.getBigUint64(8,true);
  const total=view.getBigUint64(16,true),count=view.getBigUint64(24,true);
  requireValue(epoch===header.epoch && [2,3].includes(header.stage) && header.gross[1]===0n &&
    count*2n<=header.gross[0] && total>=count && (count>0n||total===0n) && bytes.subarray(64).every(value=>value===0),'Invalid inventory book receipt.');
  return {epoch,total,count,digest:Array.from(bytes.subarray(32,64),value=>value.toString(16).padStart(2,'0')).join('')};
}

function allocationPage<T>(row:FixedSizeDecoder<T>) {
  return getStructDecoder([
    ['discriminator',fixDecoderSize(getBytesDecoder(),8)],['schemaVersion',getU16Decoder()],
    ['revision',getU64Decoder()],['venue',getAddressDecoder()],['epoch',getU64Decoder()],
    ['pageIndex',getU64Decoder()],['rowCount',getU8Decoder()],['rows',getArrayDecoder(row,{size:8})],['bump',getU8Decoder()],
  ]);
}

export function btcAllocationReceipt(header:PreparedSettlement) {
  const bytes=Uint8Array.from(header.state.membership);
  if(new TextDecoder().decode(bytes.subarray(0,8))!=='RVBTC001')return null;
  const view=new DataView(bytes.buffer);
  const word=(index:number)=>view.getBigUint64(8+8*index,true);
  const [epoch,attempt,debtorId,shortfall,cursor,recovered,capacity,unit,weight,extraLots,id]=Array.from({length:11},(_,i)=>word(i));
  const committed=header.stage===2||header.stage===3;
  requireValue(epoch===header.epoch&&attempt>0n&&cursor<=header.count&&capacity<=shortfall&&recovered<=shortfall&&
    (committed?cursor===header.count&&capacity===recovered:header.stage===5&&cursor<header.count)&&
    (unit>0n?weight>=unit:weight===0n&&extraLots===0n&&id===0n)&&bytes.subarray(128).every(v=>v===0),'Invalid BTC allocation receipt.');
  return {epoch,attempt,debtorId,shortfall,cursor,recovered,capacity,committed};
}

export function linkedAllocationReceipt(header:PreparedSettlement) {
  const bytes=Uint8Array.from(header.state.membership);
  if(new TextDecoder().decode(bytes.subarray(0,8))!=='RVJALLOC')return null;
  const view=new DataView(bytes.buffer);
  const word=(index:number)=>view.getBigUint64(8+index*8,true);
  const epoch=word(0),attempt=word(1),debtorId=word(2),shares=[word(3),word(4)];
  const targets=[word(5),word(6)],cursor=word(7),recovered=[word(8),word(9)];
  const committed=header.stage===2||header.stage===3;
  requireValue(epoch===header.epoch&&attempt>0n&&bytes.subarray(152).every(value=>value===0)
    &&(committed?cursor===header.count:header.stage===7&&cursor<header.count)
    &&targets.every((target,market)=>target>0n&&recovered[market]<=target&&(!committed||target===recovered[market]))
    &&[10,14].every(start=>word(start)>0n&&word(start)<=word(start+1)),'Invalid linked allocation receipt.');
  return {epoch,attempt,debtorId,shares,targets,cursor,recovered,committed};
}
