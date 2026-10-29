import {address,getAddressEncoder,getProgramDerivedAddress} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {integer,type Rpc} from '../../indexer/src/rpc.js';

export type LiquidityPriceAuthority={kind:'liquidityPriceSequence';venue:string;account:string;
  registration:string;pricingProgram:string;value:string};

/** Called after finalized blockhash expiry in an artifact-verified runtime.
 * Reprice success strictly increments this maker-owned sequence. An unchanged
 * value proves nonapplication only; a hidden failed landing may still pay fees. */
export async function liquidityPriceSequence(rpc:Pick<Rpc,'call'>,authority:LiquidityPriceAuthority,minimumSlot:number) {
  const program=address(authority.pricingProgram);
  if(program!==sdk.makerA.MAKER_A_PROGRAM_ADDRESS&&program!==sdk.makerB.MAKER_B_PROGRAM_ADDRESS)
    throw new Error('Unsupported liquidity authority program');
  const response=await rpc.call('getMultipleAccounts',[[authority.registration,authority.account],
    {encoding:'base64',commitment:'finalized',minContextSlot:minimumSlot}]);
  const slot=integer(response.context.slot);
  if(slot<minimumSlot||response.value?.length!==2)throw new Error('Incomplete liquidity authority snapshot');
  const decode=<Value>(index:number,owner:string,discriminator:ArrayLike<number>,decoder:{fixedSize:number;decode(bytes:Uint8Array):Value})=>{
    const account=response.value[index];
    if(account?.owner!==owner||account.executable!==false||account.data?.[1]!=='base64')throw new Error('Foreign liquidity authority owner');
    const bytes=Buffer.from(account.data[0],'base64');
    if(bytes.length!==decoder.fixedSize||!bytes.subarray(0,8).equals(Buffer.from(discriminator)))throw new Error('Wrong liquidity authority schema');
    return decoder.decode(bytes);
  };
  const registration=decode(0,sdk.CLEARING_PROGRAM_ADDRESS,sdk.MAKER_REGISTRATION_V4_DISCRIMINATOR,sdk.getMakerRegistrationV4Decoder());
  const key=getAddressEncoder();
  if(registration.schemaVersion!==4||registration.venue!==authority.venue||registration.pricingProgram!==program
    ||registration.instance>2)throw new Error('Foreign liquidity authority registration');
  const [registered,bump]=await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,
    seeds:[Buffer.from('maker-v4'),key.encode(registration.market),Uint8Array.of(registration.instance)]});
  const [config]=await getProgramDerivedAddress({programAddress:program,seeds:[Buffer.from('curve-v4'),key.encode(registration.capital)]});
  const [price,priceBump]=await getProgramDerivedAddress({programAddress:program,seeds:[Buffer.from('price-v4'),key.encode(config)]});
  if(registered!==authority.registration||registration.bump!==bump||registration.config!==config
    ||registration.price!==price||price!==authority.account)throw new Error('Noncanonical liquidity authority');
  const state=decode(1,program,sdk.makerA.MAKER_PRICE_V4_DISCRIMINATOR,sdk.makerA.getMakerPriceV4Decoder()).state;
  if(state.schemaVersion!==4||state.config!==config||state.bump!==priceBump)throw new Error('Foreign liquidity price identity');
  return {value:state.sequence,slot};
}
