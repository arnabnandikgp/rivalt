import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {address,getAddressEncoder,getProgramDerivedAddress,type Address,type Instruction} from '@solana/kit';
import {Keypair} from '@solana/web3.js';
import {CLEARING_PROGRAM_ADDRESS} from '@rivalt/sdk';
export const LOADER=address('BPFLoaderUpgradeab1e11111111111111111111111');
export const program=CLEARING_PROGRAM_ADDRESS;
export const fixtureKey=(role:string)=>Keypair.fromSeed(createHash('sha256').update(`rivalt/p02/local-only/${role}`).digest());
export const payerKey=()=>Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('.local/keys/payer.json','utf8'))));
export async function addresses(){
  const [eventAuthority]=await getProgramDerivedAddress({programAddress:program,seeds:[Buffer.from('__event_authority')]});
  const [programData]=await getProgramDerivedAddress({programAddress:LOADER,seeds:[getAddressEncoder().encode(program)]});
  return {eventAuthority,program,programData};
}
export type Harness = {
  send(label: string, instructions: Instruction[], signers?: Keypair[], expectedError?: number): Promise<void>;
  read(key: Address): Promise<Buffer | null>;
  rent(bytes: number): Promise<bigint>;
};
