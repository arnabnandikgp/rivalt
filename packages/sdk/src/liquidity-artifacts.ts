import {address,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';
import {MAKER_A_PROGRAM_ADDRESS} from './generatedMakerA/index.js';
import {MAKER_B_PROGRAM_ADDRESS} from './generatedMakerB/index.js';
import {ArtifactVerifier} from './artifacts.js';
import type {UserRpc} from './wallet-client.js';

// P37 candidate: clean SBF source 828fe543; qualification is recorded in STATUS.
// Public configuration
// selects this profile, never replacement hashes or a default/devnet executable.
export const LIQUIDITY_ARTIFACT_SET='p37-current-runtime-candidate-v1';
export const LIQUIDITY_ARTIFACTS=Object.freeze([
  {name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:2_290_224,sha256:'c12d9cb442b0900d58e093ba806611e41231bbca33d10c26cbd61e31b931de94'},
  {name:'maker-a',program:MAKER_A_PROGRAM_ADDRESS,bytes:260_560,sha256:'98c05f4a83f77a17185c00d6f55708bfbb7cb1126c67c6793c7e8b02fd04412a'},
  {name:'maker-b',program:MAKER_B_PROGRAM_ADDRESS,bytes:260_560,sha256:'5163f9445a26211c8348df671e5743549c73bbfd99869d68b37af54b5093c08d'},
  {name:'oracle-fixture',program:address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj'),bytes:151_608,sha256:'d8996b99368c7edf94a812d0c58bac4bf43471d4dbbb943ec610d839769b57c4'},
].map(artifact=>Object.freeze(artifact)));
export class LiquidityArtifactVerifier {
  private readonly verifier:ArtifactVerifier;
  constructor(rpc:Pick<UserRpc,'call'>) {this.verifier=new ArtifactVerifier(rpc,LIQUIDITY_ARTIFACTS);}
  verify(authority:Address) {return this.verifier.verify(authority);}
}
