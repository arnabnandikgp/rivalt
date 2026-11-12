import {LIQUIDITY_ARTIFACTS,LIQUIDITY_ARTIFACT_SET} from './liquidity-artifacts.js';

/** API/budget policy 4 is separate from program profile 6. Both explicit names
 * bind the same qualified bytes; old journals keep their original artifact set. */
export type AccountDeployment='selected'|'account-scale-candidate';
export const ACCOUNT_SCALE_ARTIFACT_SET=LIQUIDITY_ARTIFACT_SET;
export function accountDeployment(selection:AccountDeployment) {
  if(selection!=='selected'&&selection!=='account-scale-candidate')throw new Error('Unsupported account deployment');
  return {artifactSet:LIQUIDITY_ARTIFACT_SET,schema:10,programProfile:6,artifacts:LIQUIDITY_ARTIFACTS};
}
