import {address,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';
import {MAKER_A_PROGRAM_ADDRESS} from './generatedMakerA/index.js';
import {MAKER_B_PROGRAM_ADDRESS} from './generatedMakerB/index.js';
import {ArtifactVerifier} from './artifacts.js';
import type {UserRpc} from './wallet-client.js';

// P41 candidate: clean SBF source b0c5675; integrated qualification pending.
// Public configuration never supplies replacement hashes or default/devnet code.
export const LIQUIDITY_ARTIFACT_SET='p41-relevant-markets-candidate-v1';
export const LIQUIDITY_ARTIFACTS=Object.freeze([
  {name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:2472208,sha256:'03c475ba72dcc77244ed32b2fc3c79c9ffe58ac0ae0ca90cb06e96d313d11e03'},
  {name:'maker-a',program:MAKER_A_PROGRAM_ADDRESS,bytes:261056,sha256:'47a772348f8a4a3ba1513ff164780fc3fdba79f25c81b97e7e98e0843bde0c75'},
  {name:'maker-b',program:MAKER_B_PROGRAM_ADDRESS,bytes:261056,sha256:'154024b47ce9079245fd66216880626c0e38b36e07f75fba3798e05f44786937'},
  {name:'oracle-fixture',program:address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj'),bytes:168720,sha256:'85a4369ebf563f77d01c77b3a363750839b8799622fc99db2fff78bfebce46c7'},
].map(artifact=>Object.freeze(artifact)));
export class LiquidityArtifactVerifier {
  private readonly verifier:ArtifactVerifier;
  constructor(rpc:Pick<UserRpc,'call'>) {this.verifier=new ArtifactVerifier(rpc,LIQUIDITY_ARTIFACTS);}
  verify(authority:Address) {return this.verifier.verify(authority);}
}
