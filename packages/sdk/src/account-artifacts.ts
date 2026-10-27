import {address,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';
import {MAKER_A_PROGRAM_ADDRESS} from './generatedMakerA/index.js';
import {MAKER_B_PROGRAM_ADDRESS} from './generatedMakerB/index.js';
import {GroupArtifactVerifier} from './group-artifacts.js';
import type {UserRpc} from './wallet-client.js';

// Qualified executable pin 915d8e8; a public configuration cannot replace hashes.
export const ACCOUNT_ARTIFACT_SET='p26-qualified-local-v1';
export const ACCOUNT_ARTIFACTS=Object.freeze([
  {name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:4_023_296,sha256:'213041a4a9ec5a2b4800d53ddd778aa73189c469a1f9643dc00907fa4188cda7'},
  {name:'maker-a',program:MAKER_A_PROGRAM_ADDRESS,bytes:287_456,sha256:'8278bdd99d8a9d660b2e6aad352fc4e76167f9a049bfdd6e8b04a37e264c5ba6'},
  {name:'maker-b',program:MAKER_B_PROGRAM_ADDRESS,bytes:287_456,sha256:'23ae46289c0247eb1d4bc2f9c02602e80b80f12e43619f52494a855aa6a00c45'},
  {name:'oracle-fixture',program:address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj'),bytes:151_608,sha256:'d8996b99368c7edf94a812d0c58bac4bf43471d4dbbb943ec610d839769b57c4'},
].map(artifact=>Object.freeze(artifact)));
/** Reuse the loader/finality verifier, preserving separate V2/V3 artifact sets. */
export class AccountArtifactVerifier {
  private readonly verifier:GroupArtifactVerifier;
  constructor(rpc:Pick<UserRpc,'call'>) {this.verifier=new GroupArtifactVerifier(rpc,ACCOUNT_ARTIFACTS);}
  verify(authority:Address) {return this.verifier.verify(authority);}
}
