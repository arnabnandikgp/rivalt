import {address,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';
import {MAKER_A_PROGRAM_ADDRESS} from './generatedMakerA/index.js';
import {MAKER_B_PROGRAM_ADDRESS} from './generatedMakerB/index.js';
import {ArtifactVerifier} from './artifacts.js';
import type {UserRpc} from './wallet-client.js';

// P40B candidate: clean SBF source 6123dc8; qualification is recorded in STATUS.
// Public configuration
// selects this profile, never replacement hashes or a default/devnet executable.
export const LIQUIDITY_ARTIFACT_SET='p40b-scoped-history-candidate-v3';
export const LIQUIDITY_ARTIFACTS=Object.freeze([
  {name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:2452824,sha256:'99059dda4a4cd09c2729a33d8ec59ec7246d077d03e752f916857cbb713b277a'},
  {name:'maker-a',program:MAKER_A_PROGRAM_ADDRESS,bytes:261056,sha256:'4ab6c75534971f89c7568043cad30b1ee1430d877a309d4bfed771763d492137'},
  {name:'maker-b',program:MAKER_B_PROGRAM_ADDRESS,bytes:261056,sha256:'c6896918f0ab76a72d11da638c923d86382ba9d0becf71a46874aa82bce2daaa'},
  {name:'oracle-fixture',program:address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj'),bytes:168720,sha256:'85a4369ebf563f77d01c77b3a363750839b8799622fc99db2fff78bfebce46c7'},
].map(artifact=>Object.freeze(artifact)));
export class LiquidityArtifactVerifier {
  private readonly verifier:ArtifactVerifier;
  constructor(rpc:Pick<UserRpc,'call'>) {this.verifier=new ArtifactVerifier(rpc,LIQUIDITY_ARTIFACTS);}
  verify(authority:Address) {return this.verifier.verify(authority);}
}
