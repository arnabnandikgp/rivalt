import {accountDeployment} from '@rivalt/sdk';
import {BACKING_ARTIFACTS,verifyTestBuild} from './backing-artifacts.js';

export function verifyProfitBuild(directory:string,sponsored=false,paired=false) {
  const revision=paired?'447efef3d434496c483715c06cbc8e5341da10c1':sponsored?'1763dc750dbb27c852fafd5fbda4fad486fd69cb':'33361d969978543716697373826a3f3675e1edc4';
  const deployment=accountDeployment(paired?'verified-pair-candidate':sponsored?'sponsored-profit-candidate':'profit-attribution-candidate');
  const pinned=deployment.artifacts.find(artifact=>artifact.name==='clearing')!;
  const artifacts={...BACKING_ARTIFACTS,clearing:{bytes:pinned.bytes,sha256:pinned.sha256}};
  verifyTestBuild(directory,revision,artifacts,paired?'single-pair-default-qualification':'profit-attribution-qualification');
  return {artifactSet:deployment.artifactSet,artifacts,revision};
}
