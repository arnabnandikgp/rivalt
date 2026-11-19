import {PROFIT_ATTRIBUTION_ARTIFACT_SET,SPONSORED_PROFIT_ARTIFACT_SET} from './profit-attribution.js';
import {LIQUIDITY_ARTIFACTS,LIQUIDITY_ARTIFACT_SET} from './liquidity-artifacts.js';

/** API/budget policy 4 is separate from program profile 6. Both explicit names
 * bind the same qualified bytes; old journals keep their original artifact set. */
export type AccountDeployment='selected'|'account-scale-candidate'|'profit-attribution-candidate'|'sponsored-profit-candidate'|'verified-pair-candidate'|'btc-residual-candidate'|'btc-allocation-candidate'|'linked-pair-candidate';
export const SETTLEMENT_HELPER_REVISION='ed466030eccd485b8552b378815bf3f4e28fb658';
export const VERIFIED_PAIR_HELPER_REVISION='447efef3d434496c483715c06cbc8e5341da10c1';
export const VERIFIED_PAIR_ARTIFACT_SET='verified-pair-447efef';
export const BTC_ALLOCATION_ARTIFACT_SET='btc-allocation-9e2cc00';
export const BTC_RESIDUAL_ARTIFACT_SET='btc-residual-8024a37';
export const ACCOUNT_SCALE_ARTIFACT_SET=LIQUIDITY_ARTIFACT_SET;
export function accountDeployment(selection:AccountDeployment) {
  if(selection==='linked-pair-candidate')return {
    artifactSet:'linked-pair-0e027fc',schema:10,programProfile:6,helperRevision:'0e027fcd5d5a658292218d40106c65b22c81da5c',
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
