// Only the dedicated liquidation qualification accepts this local candidate.
import {verifyTestBuild} from './backing-artifacts.js';

const revision = '4e07c1fc44a3766bbfe2eb779de7e2ec01989df9';
const artifacts = {
  clearing: {bytes:2384384, sha256:'3d0f701ab0d2d0b992ed8cfc6479f6b380cefed12507ab09f7a8eb1b1675ed77'},
  'maker-a': {bytes:166848, sha256:'f5c618052c3df9cbf3474937d1e269c0eb23d6acec1720f78e2b3002878cdf7c'},
  'maker-b': {bytes:166848, sha256:'018177e49b5527d14b7904db411d0eb6ad5a4fc674e97197e181d891247aa268'},
};

export function verifyLiquidationBuild(directory:string) {
  verifyTestBuild(directory,revision,artifacts);
  return {artifactSet:'maker-liquidation-4e07c1f',artifacts};
}
