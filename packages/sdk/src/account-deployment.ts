import {PROFIT_ATTRIBUTION_ARTIFACT_SET} from './profit-attribution.js';
import {LIQUIDITY_ARTIFACTS,LIQUIDITY_ARTIFACT_SET} from './liquidity-artifacts.js';

/** API/budget policy 4 is separate from program profile 6. Both explicit names
 * bind the same qualified bytes; old journals keep their original artifact set. */
export type AccountDeployment='selected'|'account-scale-candidate'|'profit-attribution-candidate';
export const SETTLEMENT_HELPER_REVISION='ed466030eccd485b8552b378815bf3f4e28fb658';
export const ACCOUNT_SCALE_ARTIFACT_SET=LIQUIDITY_ARTIFACT_SET;
export function accountDeployment(selection:AccountDeployment) {
  if(selection==='profit-attribution-candidate')return {
    artifactSet:PROFIT_ATTRIBUTION_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:SETTLEMENT_HELPER_REVISION,
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2497736,sha256:'f4b313c3899e1aab074baf92a015c2e37f3c7a450e6610105e0669d539a98ca3'}:artifact)
  };
  if(selection!=='selected'&&selection!=='account-scale-candidate')throw new Error('Unsupported account deployment');
  return {artifactSet:LIQUIDITY_ARTIFACT_SET,schema:10,programProfile:6,artifacts:LIQUIDITY_ARTIFACTS,helperRevision:SETTLEMENT_HELPER_REVISION};
}
