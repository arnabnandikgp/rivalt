import {getMakerRegistrationDecoder,getMarketLedgerDecoder,MAKER_REGISTRATION_DISCRIMINATOR,MARKET_LEDGER_DISCRIMINATOR} from './generated/index.js';
import {requireValue} from './wallet-client.js';

const lifetime=(view:DataView,offset:number)=>view.getBigUint64(offset,true)+(view.getBigUint64(offset+8,true)<<64n);

/** Fresh aggregate-fee deployment only. The prefix fee balance includes escrow. */
export function decodeFeeLedger(bytes:Uint8Array) {
  const decoder=getMarketLedgerDecoder(), offset=decoder.fixedSize;
  requireValue(bytes.length===offset+24&&MARKET_LEDGER_DISCRIMINATOR.every((byte,index)=>byte===bytes[index]),'Invalid fee ledger layout.');
  const state=decoder.decode(bytes),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const pendingFees=view.getBigUint64(offset+16,true),classifiedFees=lifetime(view,offset);
  requireValue(pendingFees<=state.fees&&state.insuranceFeeRemainder<4,'Invalid fee escrow.');
  return {state,classifiedFees,pendingFees,spendableFees:state.fees-pendingFees};
}
export function decodeMakerFeeLane(bytes:Uint8Array,layout:boolean|'checked-funding'=false) {
  const decoder=getMakerRegistrationDecoder(), offset=decoder.fixedSize;
  requireValue(bytes.length===offset+(layout==='checked-funding'?64:layout?32:16)&&MAKER_REGISTRATION_DISCRIMINATOR.every((byte,index)=>byte===bytes[index]),'Invalid maker fee lane.');
  return {state:decoder.decode(bytes),collected:lifetime(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),offset)};
}

/** Apply in finalized block, transaction and invocation order within one market. */
export function attributeFinalizedFee(priorCumulative:bigint,fee:bigint) {
  requireValue(priorCumulative>=0n&&fee>=0n,'Invalid fee receipt.');
  const cumulative=priorCumulative+fee, insurance=cumulative/4n-priorCumulative/4n;
  return {cumulative,insurance,retained:fee-insurance,carry:Number(cumulative%4n)};
}
