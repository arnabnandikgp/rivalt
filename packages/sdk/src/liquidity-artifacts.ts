import {address,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';
import {MAKER_A_PROGRAM_ADDRESS} from './generatedMakerA/index.js';
import {MAKER_B_PROGRAM_ADDRESS} from './generatedMakerB/index.js';
import {ArtifactVerifier} from './artifacts.js';
import type {UserRpc} from './wallet-client.js';

// P43: clean SBF source fb5d0c5; scoped acceptance passed, full P44 qualification pending.
// Public configuration never supplies replacement hashes or default/devnet code.
export const LIQUIDITY_ARTIFACT_SET='p43-cu-optimization-candidate-v1';
export const LIQUIDITY_ARTIFACTS=Object.freeze([
  {name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:2484144,sha256:'a9a8f59e5e5fa93c4657ed25313f99199827d1e1ecf56e2f8b8ebb2caa6305f4'},
  {name:'maker-a',program:MAKER_A_PROGRAM_ADDRESS,bytes:261056,sha256:'4a600b298340928f962f6d28e13d6aef209233bff8b5d403713f35d5f898d9a6'},
  {name:'maker-b',program:MAKER_B_PROGRAM_ADDRESS,bytes:261056,sha256:'10340ac7f5a9c4bfe5dbf0adee62232daf6829962413d5e9dab726f387a8e9b2'},
  {name:'oracle-fixture',program:address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj'),bytes:168720,sha256:'85a4369ebf563f77d01c77b3a363750839b8799622fc99db2fff78bfebce46c7'},
].map(artifact=>Object.freeze(artifact)));
export class LiquidityArtifactVerifier {
  private readonly verifier:ArtifactVerifier;
  constructor(rpc:Pick<UserRpc,'call'>) {this.verifier=new ArtifactVerifier(rpc,LIQUIDITY_ARTIFACTS);}
  verify(authority:Address) {return this.verifier.verify(authority);}
}
