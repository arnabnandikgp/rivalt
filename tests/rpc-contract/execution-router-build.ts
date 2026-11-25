import assert from 'node:assert/strict';
import {verifyTestBuild} from './backing-artifacts.js';
import {accountDeployment,WIDE_DIRECTORY_ARTIFACT_SET} from '@rivalt/sdk';

/** Explicit local binary identity shared by the launcher and finalized journal. */
export function routerBuild(selection:'funded-routing'|'bounded-entry'|'closed-quantity'|'bounded-router-candidate' =
  process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-funded-benchmark' ? 'funded-routing' :
  process.env.RIVALT_SETTLEMENT_PROBE?.startsWith('execution-router-bounded-entry')?'bounded-entry':
  ['execution-router-closed-quantity','execution-router-mixed-storage'].includes(process.env.RIVALT_SETTLEMENT_PROBE ?? '') ? 'closed-quantity' : 'bounded-router-candidate',
  directory = process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!) {
  const revision = process.env.RIVALT_ROUTER_REVISION!;
  if (process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-wide-directory') {
    assert.equal(revision,'9a537a70a86e8ef8ebbfc4ec37bf84e7d5f37084');
    const artifacts = {
      clearing:{bytes:3631168,sha256:'e370a3b1cb18896d05737777ec19deabab3c11532d69d11b3d5f23bd3b4ec283'},
      'maker-a':{bytes:167520,sha256:'2140ec94a8994a62d0c54044b10d14f48eae19dca0c9a8299b78f7b82b1ca97f'},
      'maker-b':{bytes:167520,sha256:'372794d71127c68e548d5df4edf0af70c11d15a3ed10dcf2bc993339e67752fe'},
    };
    verifyTestBuild(directory,revision,artifacts,'wide-maker-discovery');
    return {revision,artifacts,artifactSet:WIDE_DIRECTORY_ARTIFACT_SET};
  }
  const deployment = accountDeployment(selection);
  assert.equal(revision, deployment.programRevision);
  const artifacts = Object.fromEntries(deployment.artifacts
    .filter(artifact => artifact.name !== 'oracle-fixture')
    .map(({name, bytes, sha256}) => [name, {bytes, sha256}]));
  verifyTestBuild(directory, revision, artifacts, selection==='bounded-entry'||selection==='funded-routing'?'bounded-entry-settlement':selection==='closed-quantity'?'closed-quantity-settlement':'execution-router-qualification');
  return {artifactSet: deployment.artifactSet, artifacts, revision};
}
