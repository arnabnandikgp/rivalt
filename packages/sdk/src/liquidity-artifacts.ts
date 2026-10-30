import {address,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';
import {MAKER_A_PROGRAM_ADDRESS} from './generatedMakerA/index.js';
import {MAKER_B_PROGRAM_ADDRESS} from './generatedMakerB/index.js';
import {ArtifactVerifier} from './artifacts.js';
import type {UserRpc} from './wallet-client.js';

// P36 candidate: clean SBF source cff1cf9; qualification is recorded in STATUS.
// Public configuration
// selects this profile, never replacement hashes or a default/devnet executable.
export const LIQUIDITY_ARTIFACT_SET='p36-canonical-names-candidate-v1';
export const LIQUIDITY_ARTIFACTS=Object.freeze([
  {name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:4_511_952,sha256:'2706d1a8e103355b89fa63844da570e059df351437d05d4fd0c44b2ec36652eb'},
  {name:'maker-a',program:MAKER_A_PROGRAM_ADDRESS,bytes:382_864,sha256:'eaf5f821ac5a0d8b99c360ad6137fe601b583b870a88499ecb3d5f86091be431'},
  {name:'maker-b',program:MAKER_B_PROGRAM_ADDRESS,bytes:382_864,sha256:'00622d571c64aa1d799ce3f04278c3db91acfdff1ba928d1bd2e04409a27caff'},
  {name:'oracle-fixture',program:address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj'),bytes:151_608,sha256:'d8996b99368c7edf94a812d0c58bac4bf43471d4dbbb943ec610d839769b57c4'},
].map(artifact=>Object.freeze(artifact)));
export class LiquidityArtifactVerifier {
  private readonly verifier:ArtifactVerifier;
  constructor(rpc:Pick<UserRpc,'call'>) {this.verifier=new ArtifactVerifier(rpc,LIQUIDITY_ARTIFACTS);}
  verify(authority:Address) {return this.verifier.verify(authority);}
}
