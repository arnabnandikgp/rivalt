// Exact candidate page layout. Each original FrozenMargin has one appended
// whole-atom BTC charge. These provisional fields become economic only after
// the header certifies the entire scan.
import {
  fixDecoderSize,getAddressDecoder,getArrayDecoder,getBytesDecoder,getStructDecoder,
  getTupleDecoder,getU16Decoder,getU64Decoder,getU8Decoder,transformDecoder,
} from '@solana/kit';
import {getFrozenMarginDecoder,type PreparedSettlement} from './generated/index.js';
import {requireValue} from './wallet-client.js';

export function getBtcAllocationPageDecoder() {
  const row=transformDecoder(getTupleDecoder([getFrozenMarginDecoder(),getU64Decoder()]),
    ([original,btcCharge])=>({...original,btcCharge}));
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
