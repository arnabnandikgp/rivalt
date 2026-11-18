import {accountDeployment,PROFIT_ATTRIBUTION_ARTIFACT_SET} from '@rivalt/sdk';
import {BACKING_ARTIFACTS,verifyTestBuild} from './backing-artifacts.js';

export function verifyProfitBuild(directory:string) {
  const revision='33361d969978543716697373826a3f3675e1edc4';
  const pinned=accountDeployment('profit-attribution-candidate').artifacts.find(artifact=>artifact.name==='clearing')!;
  const artifacts={...BACKING_ARTIFACTS,clearing:{bytes:pinned.bytes,sha256:pinned.sha256}};
  verifyTestBuild(directory,revision,artifacts,'profit-attribution-qualification');
  return {artifactSet:PROFIT_ATTRIBUTION_ARTIFACT_SET,artifacts,revision};
}
