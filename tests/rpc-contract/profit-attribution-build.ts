import {accountDeployment} from '@rivalt/sdk';
import {BACKING_ARTIFACTS,verifyTestBuild} from './backing-artifacts.js';

export function verifyProfitBuild(directory:string,sponsored=false) {
  const revision=sponsored?'1763dc750dbb27c852fafd5fbda4fad486fd69cb':'33361d969978543716697373826a3f3675e1edc4';
  const deployment=accountDeployment(sponsored?'sponsored-profit-candidate':'profit-attribution-candidate');
  const pinned=deployment.artifacts.find(artifact=>artifact.name==='clearing')!;
  const artifacts={...BACKING_ARTIFACTS,clearing:{bytes:pinned.bytes,sha256:pinned.sha256}};
  verifyTestBuild(directory,revision,artifacts,'profit-attribution-qualification');
  return {artifactSet:deployment.artifactSet,artifacts,revision};
}
