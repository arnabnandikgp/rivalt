import {PROFIT_ATTRIBUTION_ARTIFACT_SET} from '@rivalt/sdk';
import {BACKING_ARTIFACTS,verifyTestBuild} from './backing-artifacts.js';

export function verifyProfitBuild(directory:string) {
  const revision='33361d969978543716697373826a3f3675e1edc4';
  const artifacts={...BACKING_ARTIFACTS,clearing:{bytes:2497736,sha256:'f4b313c3899e1aab074baf92a015c2e37f3c7a450e6610105e0669d539a98ca3'}};
  verifyTestBuild(directory,revision,artifacts,'profit-attribution-qualification');
  return {artifactSet:PROFIT_ATTRIBUTION_ARTIFACT_SET,artifacts,revision};
}
