// Classify a finalized rejection on the local Surfpool chain, where the block
// clock supplies transaction time. Any missing write history is inconclusive.
import {getBase58Encoder,type Address} from '@solana/kit';
import {VersionedTransaction} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';

type Maker = {program:Address; config:Address; price:Address};
type Rpc = Pick<sdk.AccountUserClient['rpc'],'call'>;

export async function expiredMakerPublication(rpc:Rpc,maker:Maker,before:string,landedSlot:number,landedTime:number|null) {
  if(typeof landedTime!=='number'||!Number.isSafeInteger(landedTime))return null;
  if(maker.program!==sdk.makerA.MAKER_A_PROGRAM_ADDRESS && maker.program!==sdk.makerB.MAKER_B_PROGRAM_ADDRESS)return null;
  const history=await rpc.call('getSignaturesForAddress',[maker.price,{commitment:'finalized',before,limit:32}]);
  for(const entry of history){
    if(entry.err)continue;
    const tx=await rpc.call('getTransaction',[entry.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    if(!tx?.meta || tx.meta.err || tx.slot!==entry.slot || tx.slot>=landedSlot)return null;
    const {message}=VersionedTransaction.deserialize(Buffer.from(tx.transaction[0],'base64'));
    const keys=message.staticAccountKeys.map(key=>key.address);
    const priceIndex=keys.indexOf(maker.price);
    if(priceIndex<0)return null;
    if(!message.isAccountWritable(priceIndex))continue;
    // Only the last successful writer counts. Require a matching maker
    // reprice and its authenticated self-CPI event in the same instruction.
    const writers=message.compiledInstructions.flatMap((ix,index)=>ix.accountKeyIndexes.includes(priceIndex)?[index]:[]);
    if(writers.length!==1)return null;
    const index=writers[0],instruction=message.compiledInstructions[index];
    if(keys[instruction.programIdIndex]!==maker.program || keys[instruction.accountKeyIndexes[1]]!==maker.config
      || instruction.accountKeyIndexes[2]!==priceIndex || sdk.hex(instruction.data.slice(0,8))!==sdk.hex(sdk.makerA.REPRICE_DISCRIMINATOR))return null;
    const group=tx.meta.innerInstructions?.find((item:{index:number})=>item.index===index);
    for(const event of group?.instructions??[]){
      if(keys[event.programIdIndex]!==maker.program || event.stackHeight!==2)continue;
      const bytes=getBase58Encoder().encode(event.data);
      if(sdk.hex(bytes.slice(0,8))!=='e445a52e51cb9a1d' ||
        sdk.hex(bytes.slice(8,16))!==sdk.hex(sdk.makerA.MAKER_PRICE_UPDATED_EVENT_DISCRIMINATOR))continue;
      const publication=sdk.makerA.getMakerPriceUpdatedEventDecoder().decode(bytes.slice(8));
      if(!Number.isSafeInteger(tx.blockTime) || publication.config!==maker.config ||
        publication.slot!==BigInt(tx.slot) || publication.time!==BigInt(tx.blockTime))return null;
      const expires=publication.time+6n;
      if(BigInt(landedTime)<expires)return null;
      return {price:maker.price,signature:entry.signature,publishedAt:String(publication.time),expiresAt:String(expires),landedTime};
    }
    return null;
  }
  return null;
}
