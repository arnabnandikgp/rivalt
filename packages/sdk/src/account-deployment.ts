import {PROFIT_ATTRIBUTION_ARTIFACT_SET,SPONSORED_PROFIT_ARTIFACT_SET} from './profit-attribution.js';
import {LIQUIDITY_ARTIFACTS,LIQUIDITY_ARTIFACT_SET} from './liquidity-artifacts.js';

/** API/budget policy 4 is separate from program profile 6. Both explicit names
 * bind the same qualified bytes; old journals keep their original artifact set. */
export type AccountDeployment='selected'|'account-scale-candidate'|'profit-attribution-candidate'|'sponsored-profit-candidate'|'verified-pair-candidate'|'btc-residual-candidate'|'btc-allocation-candidate'|'linked-pair-candidate'|'linked-flat-candidate'|'linked-allocation-candidate'|'foreign-creditor-candidate'|'shared-inventory-candidate'|'partial-inventory-candidate'|'book-inventory-candidate'|'book-capacity-candidate'|'multi-lot-book-candidate';
export const SETTLEMENT_HELPER_REVISION='ed466030eccd485b8552b378815bf3f4e28fb658';
export const VERIFIED_PAIR_HELPER_REVISION='447efef3d434496c483715c06cbc8e5341da10c1';
export const VERIFIED_PAIR_ARTIFACT_SET='verified-pair-447efef';
export const SHARED_INVENTORY_ARTIFACT_SET='shared-inventory-59184c5';
export const BOOK_INVENTORY_ARTIFACT_SET='inventory-book-d5cc624';
export const BOOK_CAPACITY_ARTIFACT_SET='book-capacity-eb011a5';
export const MULTI_LOT_ARTIFACT_SET='multi-lot-baef259';
export const isBookInventoryArtifact=(set?:string)=>set===BOOK_INVENTORY_ARTIFACT_SET||set===BOOK_CAPACITY_ARTIFACT_SET||set===MULTI_LOT_ARTIFACT_SET;
export const isBookInventoryDeployment=(selection:AccountDeployment)=>selection==='book-inventory-candidate'||selection==='book-capacity-candidate'||selection==='multi-lot-book-candidate';
export const PARTIAL_INVENTORY_ARTIFACT_SET='partial-inventory-2256c51';
export const isSharedInventoryArtifact=(value?:string)=>value===SHARED_INVENTORY_ARTIFACT_SET || value===PARTIAL_INVENTORY_ARTIFACT_SET;
export const FOREIGN_CREDITOR_ARTIFACT_SET='foreign-creditor-d177cc5';
export const LINKED_ALLOCATION_ARTIFACT_SET='linked-allocation-d0ae474';
export const LINKED_FLAT_ARTIFACT_SET='linked-flat-30434d5';
export const LINKED_PAIR_ARTIFACT_SET='linked-pair-0e027fc';
export const BTC_ALLOCATION_ARTIFACT_SET='btc-allocation-9e2cc00';
export const BTC_RESIDUAL_ARTIFACT_SET='btc-residual-8024a37';
export const ACCOUNT_SCALE_ARTIFACT_SET=LIQUIDITY_ARTIFACT_SET;
export function accountDeployment(selection:AccountDeployment) {
  if(selection==='multi-lot-book-candidate')return {
    artifactSet:MULTI_LOT_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'baef259fbf6c0a385890c9ca614b8f8994c958fc',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2855600,sha256:'0e5c4e520dd966abf5979c65f96644b5f7bc57e3a822efbf207dbea7b72a0cb4'}:artifact)
  };
  if(selection==='book-capacity-candidate')return {
    artifactSet:BOOK_CAPACITY_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'eb011a5b3846cc002217cefbf1be59d22c934228',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2778000,sha256:'a07c006ab60c2d7e187f2712ff6565d41122f9bf4825654c511b6ea2dd0c8618'}:artifact)
  };
  if(selection==='book-inventory-candidate')return {
    artifactSet:BOOK_INVENTORY_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'d5cc6243b191cecedc1ed4845fafa8dc92e1691a',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2731776,sha256:'fa5e8877510f28c202c7d4db799a81a91ce7eeb031ffea59b543d41a04bbfac2'}:artifact)
  };
  if(selection==='partial-inventory-candidate')return {
    artifactSet:PARTIAL_INVENTORY_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'2256c519e09c3f3c35816e3a0f578614de7f0654',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2638216,sha256:'da2796230e4591aa53855b4fc0c6543ad424c017bd09cd2ec8c8f96535627e8e'}:artifact)
  };
  if(selection==='shared-inventory-candidate')return {
    artifactSet:SHARED_INVENTORY_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'59184c58e1cfa0a3aabafaf11274a10a0c58154e',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2683376,sha256:'caf78f79e2e0bf1b6fc30f3ce5aef2cc0f453af2ef13e422a774055a4a833eef'}:artifact)
  };
  if(selection==='foreign-creditor-candidate')return {
    artifactSet:FOREIGN_CREDITOR_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'d177cc5ed68bb527470486165d2702d03e03959e',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2603744,sha256:'3d7b0b64d71aad7943b265ac66011fd8231f8d195846a2c49d0fcbe0825ee76b'}:artifact)
  };
  if(selection==='linked-allocation-candidate')return {
    artifactSet:LINKED_ALLOCATION_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'d0ae474df3ba758466b5ca9b9e9e1f2cd6840935',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2609136,sha256:'4e41342a10405a75e1539a8a249c97cbf6c955f4434f484996f9c2f0bf06bcd4'}:artifact)
  };
  if(selection==='linked-flat-candidate')return {
    artifactSet:LINKED_FLAT_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'30434d5e0cc77c296912ecd82d1036b8c674d9a9',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2586864,sha256:'e55f48477a39977d10e33a85e87bab5d5ee00161307469ae1c88dae500d2cac9'}:artifact)
  };
  if(selection==='linked-pair-candidate')return {
    artifactSet:LINKED_PAIR_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'0e027fcd5d5a658292218d40106c65b22c81da5c',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2585320,sha256:'7f627bc93748c7b4e6c36aa65a461900690387c77ab0e6169e4745dd0bad9086'}:artifact)
  };
  if(selection==='btc-allocation-candidate')return {
    artifactSet:BTC_ALLOCATION_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'9e2cc0071b8b3aaf84e21e26727f2f8ff7f01ed4',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2581008,sha256:'cfca283a6c024d0839c4f9167bcef78ab15ca2d7346b814db4bda496503f02b9'}:artifact)
  };
  if(selection==='btc-residual-candidate')return {
    artifactSet:BTC_RESIDUAL_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'8024a3776e8d57807ace6f782fef972f89c5f196',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2550560,sha256:'cd2e95d27c5e6ec9b1a55138220ec29f2475c9a7c9b3d14373c35a5361e1982e'}:artifact)
  };
  if(selection==='verified-pair-candidate')return {
    artifactSet:VERIFIED_PAIR_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:VERIFIED_PAIR_HELPER_REVISION,
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2549160,sha256:'ad877806d413e8708d8c33189dc4d2084392fb41995763f016506c7ae04b8f6a'}:artifact)
  };
  if(selection==='sponsored-profit-candidate')return {
    artifactSet:SPONSORED_PROFIT_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:SETTLEMENT_HELPER_REVISION,
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2516448,sha256:'e1fa7b655b3e619aac575f1a8e559791cfc09e5c28492a5e334678b105b7f547'}:artifact)
  };
  if(selection==='profit-attribution-candidate')return {
    artifactSet:PROFIT_ATTRIBUTION_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:SETTLEMENT_HELPER_REVISION,
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2497736,sha256:'f4b313c3899e1aab074baf92a015c2e37f3c7a450e6610105e0669d539a98ca3'}:artifact)
  };
  if(selection!=='selected'&&selection!=='account-scale-candidate')throw new Error('Unsupported account deployment');
  return {artifactSet:LIQUIDITY_ARTIFACT_SET,schema:10,programProfile:6,artifacts:LIQUIDITY_ARTIFACTS,helperRevision:SETTLEMENT_HELPER_REVISION};
}
