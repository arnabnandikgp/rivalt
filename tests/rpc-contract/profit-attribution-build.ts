import {accountDeployment} from '@rivalt/sdk';
import {BACKING_ARTIFACTS,verifyTestBuild} from './backing-artifacts.js';

export function verifyProfitBuild(directory:string,sponsored=false,paired=false,residual=false,allocation=false,linked:boolean|'flat'|'allocation'|'foreign'=false) {
  const revision=linked?accountDeployment(linked==='foreign'?'foreign-creditor-candidate':linked==='allocation'?'linked-allocation-candidate':linked==='flat'?'linked-flat-candidate':'linked-pair-candidate').helperRevision:allocation?accountDeployment('btc-allocation-candidate').helperRevision:residual?'8024a3776e8d57807ace6f782fef972f89c5f196':paired?'447efef3d434496c483715c06cbc8e5341da10c1':sponsored?'1763dc750dbb27c852fafd5fbda4fad486fd69cb':'33361d969978543716697373826a3f3675e1edc4';
  const deployment=accountDeployment(linked==='foreign'?'foreign-creditor-candidate':linked==='allocation'?'linked-allocation-candidate':linked==='flat'?'linked-flat-candidate':linked?'linked-pair-candidate':allocation?'btc-allocation-candidate':residual?'btc-residual-candidate':paired?'verified-pair-candidate':sponsored?'sponsored-profit-candidate':'profit-attribution-candidate');
  const pinned=deployment.artifacts.find(artifact=>artifact.name==='clearing')!;
  const artifacts={...BACKING_ARTIFACTS,clearing:{bytes:pinned.bytes,sha256:pinned.sha256}};
  verifyTestBuild(directory,revision,artifacts,linked==='foreign'?'foreign-creditor-qualification':linked==='allocation'?'linked-allocation-qualification':linked?'linked-pair-qualification':allocation?'btc-allocation-qualification':residual?'btc-residual-qualification':paired?'single-pair-default-qualification':'profit-attribution-qualification');
  return {artifactSet:deployment.artifactSet,artifacts,revision};
}
