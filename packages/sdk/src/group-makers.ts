import {address,getAddressDecoder,getAddressEncoder,getProgramDerivedAddress,type Address} from '@solana/kit';
import * as protocol from './generated/index.js';
import * as makerA from './generatedMakerA/index.js';
import * as makerB from './generatedMakerB/index.js';
import {findGroupMakerPda} from './group-addresses.js';
import type {GroupSnapshot} from './group-snapshot.js';
import {fromBase64,hex,requireValue,type UserRpc} from './wallet-client.js';

const LOADER=address('BPFLoaderUpgradeab1e11111111111111111111111');
/** Attach actual owner/config/code bindings without mixing group sequences.
 * A config epoch may be ahead of its registration until an owner sync lands. */
export async function readGroupMakers(rpc:Pick<UserRpc,'call'>,snapshot:GroupSnapshot){
  const identities=await Promise.all(snapshot.markets.flatMap((market,marketIndex)=>[0,1].map(async makerId=>{
    const [registration,bump]=await findGroupMakerPda(market,makerId);
    return {market,marketIndex,makerId,registration,bump};
  })));
  const accounts=new Map<Address,any>(),groupBytes=hex(protocol.getClearingGroupV2Encoder().encode(snapshot.state));
  const read=async(keys:Address[])=>{
    const batch=[snapshot.group,...new Set(keys)];
    requireValue(batch.length<=100,'Maker snapshot request exceeds RPC bound.');
    const response=await rpc.call('getMultipleAccounts',[batch,{encoding:'base64',commitment:snapshot.commitment}]);
    requireValue(response.value.length===batch.length,'Invalid maker RPC account count.');
    const group=response.value[0];
    requireValue(group?.owner===protocol.CLEARING_PROGRAM_ADDRESS&&group.data?.[1]==='base64'&&hex(fromBase64(group.data[0]))===groupBytes,'Group changed during maker snapshot; refresh.');
    batch.forEach((key,index)=>accounts.set(key,response.value[index]));
  };
  const raw=(key:Address,owner:Address)=>{
    const account=accounts.get(key);requireValue(account?.owner===owner&&account.data?.[1]==='base64','Missing or foreign maker dependency.');
    return fromBase64(account.data[0]);
  };
  await read(identities.map(identity=>identity.registration));
  const discovered=identities.flatMap(identity=>{
    if(!accounts.get(identity.registration))return [];
    const bytes=raw(identity.registration,protocol.CLEARING_PROGRAM_ADDRESS);
    requireValue(hex(bytes.slice(0,8))===hex(protocol.MAKER_REGISTRATION_V2_DISCRIMINATOR),'Wrong maker registration schema.');
    return [{...identity,registrationState:protocol.getMakerRegistrationV2Decoder().decode(bytes)}];
  });
  await read(discovered.flatMap(({registration,registrationState})=>[registration,registrationState.config,registrationState.pricingProgram,registrationState.programData]));
  return Promise.all(discovered.map(async identity=>{
    const registration=protocol.getMakerRegistrationV2Decoder().decode(raw(identity.registration,protocol.CLEARING_PROGRAM_ADDRESS));
    const capital=snapshot.roots[registration.capital],expectedProgram=identity.makerId===0?makerA.MAKER_A_PROGRAM_ADDRESS:makerB.MAKER_B_PROGRAM_ADDRESS;
    requireValue(registration.schemaVersion===2&&registration.group===snapshot.group&&registration.market===identity.market&&registration.marketIndex===identity.marketIndex&&
      registration.makerId===identity.makerId&&registration.bump===identity.bump&&registration.pricingProgram===expectedProgram&&
      capital?.owner===registration.owner&&capital.role===1&&capital.mode===1&&capital.isolatedMarketIndex===identity.marketIndex,'Invalid isolated maker binding.');
    const [config,configBump]=await getProgramDerivedAddress({programAddress:expectedProgram,seeds:[new TextEncoder().encode('maker-v2'),getAddressEncoder().encode(registration.capital)]});
    const [programData]=await getProgramDerivedAddress({programAddress:LOADER,seeds:[getAddressEncoder().encode(expectedProgram)]});
    requireValue(registration.config===config&&registration.programData===programData,'Maker config/code PDA mismatch.');
    const executable=raw(expectedProgram,LOADER);
    requireValue(accounts.get(expectedProgram).executable===true&&executable.length===36&&new DataView(executable.buffer,executable.byteOffset).getUint32(0,true)===2&&
      getAddressDecoder().decode(executable.slice(4))===programData,'Maker executable binding mismatch.');
    const code=raw(programData,LOADER);
    requireValue(code.length>=45&&new DataView(code.buffer,code.byteOffset).getUint32(0,true)===3,'Invalid maker ProgramData.');
    const hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',code))),approved=hash===hex(registration.approvedHash);
    const configBytes=raw(config,expectedProgram);
    requireValue(hex(configBytes.slice(0,8))===hex(makerA.MAKER_GROUP_CONFIG_DISCRIMINATOR),'Wrong maker config schema.');
    const decoded=makerA.getMakerGroupConfigDecoder().decode(configBytes),state=decoded.state;
    requireValue(decoded.group===snapshot.group&&state.version===2&&state.makerId===identity.makerId&&state.owner===registration.owner&&state.market===identity.market&&
      state.capital===registration.capital&&hex(state.domain)===hex(snapshot.state.domain)&&state.bump===configBump,'Maker pricing identity mismatch.');
    return {...identity,registrationState:registration,state,capital,approved,programDataHash:hash,
      synchronized:state.quoteEpoch===registration.quoteEpoch&&state.startSlot===registration.startSlot&&state.expirySlot===registration.expirySlot};
  }));
}
export type GroupMaker=Awaited<ReturnType<typeof readGroupMakers>>[number];
