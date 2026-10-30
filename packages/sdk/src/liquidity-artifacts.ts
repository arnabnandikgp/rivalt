import {address,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';
import {MAKER_A_PROGRAM_ADDRESS} from './generatedMakerA/index.js';
import {MAKER_B_PROGRAM_ADDRESS} from './generatedMakerB/index.js';
import {ArtifactVerifier} from './artifacts.js';
import type {UserRpc} from './wallet-client.js';

// P42 candidate: clean SBF source 6aeb7d0; integrated qualification pending.
// Public configuration never supplies replacement hashes or default/devnet code.
export const LIQUIDITY_ARTIFACT_SET='p42-custody-isolation-candidate-v1';
export const LIQUIDITY_ARTIFACTS=Object.freeze([
  {name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:2482344,sha256:'d9c83864f5d3b0c5e7dcfa0100486335b1c96c583b62f9c68054318cf3169bcb'},
  {name:'maker-a',program:MAKER_A_PROGRAM_ADDRESS,bytes:261056,sha256:'4a600b298340928f962f6d28e13d6aef209233bff8b5d403713f35d5f898d9a6'},
  {name:'maker-b',program:MAKER_B_PROGRAM_ADDRESS,bytes:261056,sha256:'10340ac7f5a9c4bfe5dbf0adee62232daf6829962413d5e9dab726f387a8e9b2'},
  {name:'oracle-fixture',program:address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj'),bytes:168720,sha256:'85a4369ebf563f77d01c77b3a363750839b8799622fc99db2fff78bfebce46c7'},
].map(artifact=>Object.freeze(artifact)));
export class LiquidityArtifactVerifier {
  private readonly verifier:ArtifactVerifier;
  constructor(rpc:Pick<UserRpc,'call'>) {this.verifier=new ArtifactVerifier(rpc,LIQUIDITY_ARTIFACTS);}
  verify(authority:Address) {return this.verifier.verify(authority);}
}
