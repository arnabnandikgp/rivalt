// Only the dedicated liquidation qualification accepts this local candidate.
import {verifyTestBuild} from './backing-artifacts.js';

const revision = 'ab3f6c6e225f9099768cc85f42d55f101679ac89';
const artifacts = {
  clearing: {bytes:2384352, sha256:'2c73fd34890d9d576b486e5f23221918a725b92897aeeef65a0384dd4f84e719'},
  'maker-a': {bytes:166848, sha256:'f5c618052c3df9cbf3474937d1e269c0eb23d6acec1720f78e2b3002878cdf7c'},
  'maker-b': {bytes:166848, sha256:'018177e49b5527d14b7904db411d0eb6ad5a4fc674e97197e181d891247aa268'},
};

export function verifyLiquidationBuild(directory:string) {
  verifyTestBuild(directory,revision,artifacts);
  return {artifactSet:'maker-liquidation-ab3f6c6',artifacts};
}
