import {address,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';
import {MAKER_A_PROGRAM_ADDRESS} from './generatedMakerA/index.js';
import {MAKER_B_PROGRAM_ADDRESS} from './generatedMakerB/index.js';
import {ArtifactVerifier} from './artifacts.js';
import type {UserRpc} from './wallet-client.js';

// P46 serialized C0: clean SBF source 10b4d98; candidate runtime acceptance pending.
// Public configuration never supplies replacement hashes or default/devnet code.
export const LIQUIDITY_ARTIFACT_SET='p46-anchor-rc2-c0-candidate-v1';
export const LIQUIDITY_ARTIFACTS=Object.freeze([
  {name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:1537504,sha256:'8ae60521ee25f82477f4786f3d9b22a3c72f36edd3af7e4bc17b7a64717a940c'},
  {name:'maker-a',program:MAKER_A_PROGRAM_ADDRESS,bytes:166712,sha256:'03f5c2657945a9ee7f3fdbdd327a480855692e88b27394e17a7275e7d69abc3e'},
  {name:'maker-b',program:MAKER_B_PROGRAM_ADDRESS,bytes:166712,sha256:'59fa13d77416f392e1404fafd2bc88ba8791ee0d6dffbe88061c48050bfe87c6'},
  {name:'oracle-fixture',program:address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj'),bytes:60288,sha256:'dfe6b448cbe91726d0e3c5db7497e1405d562e671dbe2472a1ffb930ea2a3ca1'},
].map(artifact=>Object.freeze(artifact)));
export class LiquidityArtifactVerifier {
  private readonly verifier:ArtifactVerifier;
  constructor(rpc:Pick<UserRpc,'call'>) {this.verifier=new ArtifactVerifier(rpc,LIQUIDITY_ARTIFACTS);}
  verify(authority:Address) {return this.verifier.verify(authority);}
}
