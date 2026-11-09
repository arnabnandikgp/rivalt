import {address,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';
import {MAKER_A_PROGRAM_ADDRESS} from './generatedMakerA/index.js';
import {MAKER_B_PROGRAM_ADDRESS} from './generatedMakerB/index.js';
import {ArtifactVerifier} from './artifacts.js';
import type {UserRpc} from './wallet-client.js';

// P49 larger-quantity candidate: clean SBF source 49c343e. Qualification status
// lives in STATUS; this new binding never rewrites existing C0 journals.
// Public configuration never supplies replacement hashes or default/devnet code.
export const LIQUIDITY_ARTIFACT_SET='p49-expanded-quantities-candidate-v1';
export const LIQUIDITY_ARTIFACTS=Object.freeze([
  {name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:1537888,sha256:'ec731074e2ee4d963d5e12a00f94fbf1473f9154c40dc8bc7a9585797665fab3'},
  {name:'maker-a',program:MAKER_A_PROGRAM_ADDRESS,bytes:166712,sha256:'8fa58fedda985df1eecc4704e3c8890df83d29aa67366869b486a6f6a34478d4'},
  {name:'maker-b',program:MAKER_B_PROGRAM_ADDRESS,bytes:166712,sha256:'c3c141a9e2e52031a1b6e058a80dc6fcb93ab1746666955d4a0b7fb920fb69d2'},
  {name:'oracle-fixture',program:address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj'),bytes:60288,sha256:'dfe6b448cbe91726d0e3c5db7497e1405d562e671dbe2472a1ffb930ea2a3ca1'},
].map(artifact=>Object.freeze(artifact)));
export class LiquidityArtifactVerifier {
  private readonly verifier:ArtifactVerifier;
  constructor(rpc:Pick<UserRpc,'call'>) {this.verifier=new ArtifactVerifier(rpc,LIQUIDITY_ARTIFACTS);}
  verify(authority:Address) {return this.verifier.verify(authority);}
}
