import {PROFIT_ATTRIBUTION_ARTIFACT_SET,SPONSORED_PROFIT_ARTIFACT_SET} from './profit-attribution.js';
import {LIQUIDITY_ARTIFACTS,LIQUIDITY_ARTIFACT_SET} from './liquidity-artifacts.js';

/** API/budget policy 4 is separate from program profile 6. Both explicit names
 * bind the same qualified bytes; old journals keep their original artifact set. */
export type AccountDeployment='selected'|'account-scale-candidate'|'profit-attribution-candidate'|'sponsored-profit-candidate'|'verified-pair-candidate';
export const SETTLEMENT_HELPER_REVISION='ed466030eccd485b8552b378815bf3f4e28fb658';
export const VERIFIED_PAIR_ARTIFACT_SET='verified-pair-d218d95';
export const ACCOUNT_SCALE_ARTIFACT_SET=LIQUIDITY_ARTIFACT_SET;
export function accountDeployment(selection:AccountDeployment) {
  if(selection==='verified-pair-candidate')return {
    artifactSet:VERIFIED_PAIR_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:SETTLEMENT_HELPER_REVISION,
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2548088,sha256:'cd497a6d49abcbfd551a05de5bc356615a6918f0832320eeb658fb3bc15b5c9e'}:artifact)
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
