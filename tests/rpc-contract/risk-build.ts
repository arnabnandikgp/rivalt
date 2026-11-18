// Only the matched risk qualification imports these local deployment hashes.
import { readFileSync } from 'node:fs';
import { BACKING_ARTIFACT_SET, BACKING_ARTIFACTS, BACKING_BUILD, verifyTestBuild } from './backing-artifacts.js';

const candidateRevision = '6775e130c2e9862c8eca5c71b57fe3f268d90adf';
const candidate = {
  clearing: { bytes: 2374256, sha256: 'c5297e58e06f74ac92e55e9115056b5e04a9f047b93cff64a1d0018bb2b2f668' },
  'maker-a': { bytes: 166848, sha256: 'f5c618052c3df9cbf3474937d1e269c0eb23d6acec1720f78e2b3002878cdf7c' },
  'maker-b': { bytes: 166848, sha256: '018177e49b5527d14b7904db411d0eb6ad5a4fc674e97197e181d891247aa268' },
};
export function verifyRiskBuild(directory: string) {
  const { revision } = JSON.parse(readFileSync(`${directory}/build-manifest.json`, 'utf8'));
  if (revision === BACKING_BUILD) {
    verifyTestBuild(directory, BACKING_BUILD, BACKING_ARTIFACTS);
    return { artifactSet: BACKING_ARTIFACT_SET, artifacts: BACKING_ARTIFACTS };
  }
  verifyTestBuild(directory, candidateRevision, candidate);
  return { artifactSet: 'risk-engine-6775e13', artifacts: candidate };
}
