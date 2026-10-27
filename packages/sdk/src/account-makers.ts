import {address,getAddressDecoder,getAddressEncoder,getProgramDerivedAddress,type Address} from '@solana/kit';
import * as protocol from './generated/index.js';
import * as makerA from './generatedMakerA/index.js';
import * as makerB from './generatedMakerB/index.js';
import {findAccountMakerV3Pda,findMarginV3Pda} from './account-addresses.js';
import {fromBase64,hex,requireValue} from './wallet-client.js';

export type AccountMakerIdentity={registration:Address;bump:number;marketIndex:number;makerId:number;
  discovered:protocol.MakerRegistrationV3};
type Snapshot={venue:Address;markets:Address[];venueState:protocol.VenueV3;roots:Record<string,protocol.MarginAccountV3>};
const LOADER=address('BPFLoaderUpgradeab1e11111111111111111111111');

/** Authenticate only records from the same final financial RPC batch as the
 * trader. Discovery supplies immutable keys, never financial/quote authority. */
export async function authenticateAccountMakers(snapshot:Snapshot,identities:AccountMakerIdentity[],accounts:Map<Address,any>) {
  const raw=(key:Address,owner:Address)=>{
    const account=accounts.get(key);requireValue(account?.owner===owner&&account.data?.[1]==='base64','Missing or foreign account maker dependency.');
    return fromBase64(account.data[0]);
  };
  return Promise.all(identities.map(async identity=>{
    const {registration:registrationKey,marketIndex,makerId}=identity,market=snapshot.markets[marketIndex];
    const bytes=raw(registrationKey,protocol.CLEARING_PROGRAM_ADDRESS);
    requireValue(bytes.length===protocol.getMakerRegistrationV3Size()&&hex(bytes.slice(0,8))===hex(protocol.MAKER_REGISTRATION_V3_DISCRIMINATOR),'Wrong account maker registration.');
    const registration=protocol.getMakerRegistrationV3Decoder().decode(bytes),capital=snapshot.roots[registration.capital];
    const expectedProgram=makerId===0?makerA.MAKER_A_PROGRAM_ADDRESS:makerB.MAKER_B_PROGRAM_ADDRESS;
    const [canonical,bump]=await findAccountMakerV3Pda(market,makerId);
    requireValue(registrationKey===canonical&&registration.bump===bump&&registration.schemaVersion===3&&registration.venue===snapshot.venue&&
      registration.market===market&&registration.marketIndex===marketIndex&&registration.makerId===makerId&&registration.pricingProgram===expectedProgram&&
      registration.capital===identity.discovered.capital&&registration.config===identity.discovered.config&&registration.programData===identity.discovered.programData&&
      capital?.owner===registration.owner&&capital.role===1&&capital.mode===1&&capital.isolatedMarketIndex===marketIndex,'Invalid isolated account maker binding.');
    const [capitalKey]=await findMarginV3Pda(capital.portfolio,capital.subaccountIndex);
    requireValue(capitalKey===registration.capital,'Noncanonical account maker capital.');
    const [config,configBump]=await getProgramDerivedAddress({programAddress:expectedProgram,seeds:[new TextEncoder().encode('maker-v3'),getAddressEncoder().encode(registration.capital)]});
    const [programData]=await getProgramDerivedAddress({programAddress:LOADER,seeds:[getAddressEncoder().encode(expectedProgram)]});
    requireValue(registration.config===config&&registration.programData===programData,'Account maker config/code PDA mismatch.');
    const executable=raw(expectedProgram,LOADER);
    requireValue(accounts.get(expectedProgram).executable===true&&executable.length===36&&new DataView(executable.buffer,executable.byteOffset).getUint32(0,true)===2&&
      getAddressDecoder().decode(executable.slice(4))===programData,'Account maker executable binding mismatch.');
    const code=raw(programData,LOADER);
    requireValue(code.length>=45&&code.length<=1_048_576&&new DataView(code.buffer,code.byteOffset).getUint32(0,true)===3,'Invalid account maker ProgramData.');
    const hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',code))),approved=hash===hex(registration.approvedHash);
    const configBytes=raw(config,expectedProgram);
    requireValue(configBytes.length===makerA.getMakerAccountConfigSize()&&hex(configBytes.slice(0,8))===hex(makerA.MAKER_ACCOUNT_CONFIG_DISCRIMINATOR),'Wrong account maker config schema.');
    const decoded=makerA.getMakerAccountConfigDecoder().decode(configBytes),state=decoded.state;
    requireValue(decoded.venue===snapshot.venue&&state.version===3&&state.makerId===makerId&&state.owner===registration.owner&&state.market===market&&
      state.capital===registration.capital&&hex(state.domain)===hex(snapshot.venueState.domain)&&state.bump===configBump&&state.quoteEpoch>0n&&
      state.expirySlot-state.startSlot>=64n&&state.expirySlot-state.startSlot<=3600n,'Account maker pricing identity/epoch mismatch.');
    return {registration:registrationKey,market,marketIndex,makerId,registrationState:registration,state,capital,approved,programDataHash:hash,
      synchronized:state.quoteEpoch===registration.quoteEpoch&&state.startSlot===registration.startSlot&&state.expirySlot===registration.expirySlot};
  }));
}
export type AccountMaker=Awaited<ReturnType<typeof authenticateAccountMakers>>[number];
