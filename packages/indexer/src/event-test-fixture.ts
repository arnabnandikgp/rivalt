// Compiled-message fixtures test decoding only; no successful financial execution
// is implied. Actual signed RPC/WS acceptance uses the deployment harness.
import {getAddressDecoder,getBase58Decoder,type Address,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
export const fixtureKey=(byte:number)=>getAddressDecoder().decode(new Uint8Array(32).fill(byte));
export const fixtureVenue=fixtureKey(17),fixtureAuthority=fixtureKey(18);
export function eventTransaction(payload:ReadonlyUint8Array,venue=fixtureVenue,authority=fixtureAuthority,program:Address=sdk.CLEARING_PROGRAM_ADDRESS,signature='signed') {
  const instruction=sdk.DEPOSIT_ACCOUNT_DISCRIMINATOR;
  const footer=sdk.getAccountTransitionEventEncoder().encode({schemaVersion:7,venue,domain:new Uint8Array(32),slot:10n,
    instruction,payloadCount:1,reads:[],writes:[{account:venue,kind:0,before:0n,after:1n}]});
  const data=(bytes:ReadonlyUint8Array)=>getBase58Decoder().decode(bytes);
  const event=(bytes:ReadonlyUint8Array)=>({programIdIndex:2,accounts:[3],data:data(Buffer.concat([Buffer.from('e445a52e51cb9a1d','hex'),Buffer.from(bytes)])),stackHeight:2});
  return {slot:10,blockTime:10,transaction:{signatures:[signature],message:{
    header:{numRequiredSignatures:1,numReadonlySignedAccounts:0,numReadonlyUnsignedAccounts:2},
    accountKeys:[fixtureKey(19),venue,program,authority],instructions:[{programIdIndex:2,accounts:[1,3,2],data:data(instruction)}]}},
    meta:{err:null as unknown,innerInstructions:[{index:0,instructions:[event(payload),event(footer)]}],logMessages:['untrusted log']}};
}
