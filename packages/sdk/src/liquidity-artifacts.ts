import {address,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';
import {MAKER_A_PROGRAM_ADDRESS} from './generatedMakerA/index.js';
import {MAKER_B_PROGRAM_ADDRESS} from './generatedMakerB/index.js';
import {GroupArtifactVerifier} from './group-artifacts.js';
import type {UserRpc} from './wallet-client.js';

// P32 A37/G25 qualification: clean SBF source 6437f7d. Public configuration
// selects this profile, never replacement hashes or a default/devnet executable.
export const LIQUIDITY_ARTIFACT_SET='p32-qualified-local-v1';
export const LIQUIDITY_ARTIFACTS=Object.freeze([
  {name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:4_512_040,sha256:'8eab115f2b45cf27601fadc7c8601675e5a16d964c908761c9bd51192582e904'},
  {name:'maker-a',program:MAKER_A_PROGRAM_ADDRESS,bytes:382_856,sha256:'51d9b4878c71ace458aea44e11c2c024596b73e187926adac81d90ec3eaae8d0'},
  {name:'maker-b',program:MAKER_B_PROGRAM_ADDRESS,bytes:382_856,sha256:'d797a82eee749a6abf8ddf8bd8d496e90c266dace613a5578bdd4526aa564086'},
  {name:'oracle-fixture',program:address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj'),bytes:151_608,sha256:'d8996b99368c7edf94a812d0c58bac4bf43471d4dbbb943ec610d839769b57c4'},
].map(artifact=>Object.freeze(artifact)));
export class LiquidityArtifactVerifier {
  private readonly verifier:GroupArtifactVerifier;
  constructor(rpc:Pick<UserRpc,'call'>) {this.verifier=new GroupArtifactVerifier(rpc,LIQUIDITY_ARTIFACTS);}
  verify(authority:Address) {return this.verifier.verify(authority);}
}
