import {address,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';
import {MAKER_A_PROGRAM_ADDRESS} from './generatedMakerA/index.js';
import {MAKER_B_PROGRAM_ADDRESS} from './generatedMakerB/index.js';
import {ArtifactVerifier} from './artifacts.js';
import type {UserRpc} from './wallet-client.js';

// P53B qualified policy 2: SBF afeb7ea; publisher 10cadb7, boundary/replay/safety 82d2c6a.
// Preserve the candidate binding used by actual originals; never rewrite C0 journals.
// Public configuration never supplies replacement hashes or default/devnet code.
export const LIQUIDITY_ARTIFACT_SET='p53b-numeric-price-policy-candidate-v2';
export const LIQUIDITY_ARTIFACTS=Object.freeze([
  {name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:1538848,sha256:'fbd5524190f301a4e82146839fef1a7a3917f9a86e1a871be2e3c9dc509cd1dd'},
  {name:'maker-a',program:MAKER_A_PROGRAM_ADDRESS,bytes:166712,sha256:'8fa58fedda985df1eecc4704e3c8890df83d29aa67366869b486a6f6a34478d4'},
  {name:'maker-b',program:MAKER_B_PROGRAM_ADDRESS,bytes:166712,sha256:'c3c141a9e2e52031a1b6e058a80dc6fcb93ab1746666955d4a0b7fb920fb69d2'},
  {name:'oracle-fixture',program:address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj'),bytes:60288,sha256:'dfe6b448cbe91726d0e3c5db7497e1405d562e671dbe2472a1ffb930ea2a3ca1'},
].map(artifact=>Object.freeze(artifact)));
export class LiquidityArtifactVerifier {
  private readonly verifier:ArtifactVerifier;
  constructor(rpc:Pick<UserRpc,'call'>) {this.verifier=new ArtifactVerifier(rpc,LIQUIDITY_ARTIFACTS);}
  verify(authority:Address) {return this.verifier.verify(authority);}
}
