import assert from 'node:assert/strict';
import {verifyTestBuild} from './backing-artifacts.js';
import {accountDeployment,WIDE_DIRECTORY_ARTIFACT_SET,WIDE_ROUTING_ARTIFACT_SET,MULTI_ROUTING_ARTIFACT_SET} from '@rivalt/sdk';

/** Explicit local binary identity shared by the launcher and finalized journal. */
export function routerBuild(selection:'funded-routing'|'bounded-entry'|'closed-quantity'|'bounded-router-candidate' =
  process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-funded-benchmark' ? 'funded-routing' :
  process.env.RIVALT_SETTLEMENT_PROBE?.startsWith('execution-router-bounded-entry')?'bounded-entry':
  ['execution-router-closed-quantity','execution-router-mixed-storage'].includes(process.env.RIVALT_SETTLEMENT_PROBE ?? '') ? 'closed-quantity' : 'bounded-router-candidate',
  directory = process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!) {
  const revision = process.env.RIVALT_ROUTER_REVISION!;
  const extended=process.env.RIVALT_SETTLEMENT_PROBE==='execution-router-multi-width';
  if (extended || process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-multi-fills') {
    assert.equal(revision,extended?'f0b8a599c24bde303d7ce9a8eb74bd1ffd86a85a':'f05d93191089e3440465424cf5d53071e1e7db65');
    const artifacts = {
      'clearing':extended?{bytes:3695504,sha256:'8b04d8ee378b22a868fef46da28323a8eac4704894eee7476e45ae441c1989bf'}:{bytes:3666448,sha256:'ceb335974c7a1f492028606e05b96c38fd3d9866205392cdeed2951fa379db69'},
      'maker-a':{bytes:167520,sha256:'2140ec94a8994a62d0c54044b10d14f48eae19dca0c9a8299b78f7b82b1ca97f'},
      'maker-b':{bytes:167520,sha256:'372794d71127c68e548d5df4edf0af70c11d15a3ed10dcf2bc993339e67752fe'},
    };
    verifyTestBuild(directory,revision,artifacts,'wide-atomic-routes');
    return {revision,artifacts,artifactSet:MULTI_ROUTING_ARTIFACT_SET};
  }
  const wideFills=process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-wide-fills';
  if (wideFills || process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-wide-directory') {
    assert.equal(revision,wideFills?'5e32c124f078902535c6e40a02419f797550e89a':'9a537a70a86e8ef8ebbfc4ec37bf84e7d5f37084');
    const artifacts = {
      clearing:wideFills?{bytes:3639640,sha256:'f386eddff755a76efc93d97b75c29de756b555a2eb78762649f03b91e223cb12'}:{bytes:3631168,sha256:'e370a3b1cb18896d05737777ec19deabab3c11532d69d11b3d5f23bd3b4ec283'},
      'maker-a':{bytes:167520,sha256:'2140ec94a8994a62d0c54044b10d14f48eae19dca0c9a8299b78f7b82b1ca97f'},
      'maker-b':{bytes:167520,sha256:'372794d71127c68e548d5df4edf0af70c11d15a3ed10dcf2bc993339e67752fe'},
    };
    verifyTestBuild(directory,revision,artifacts,'wide-maker-discovery');
    return {revision,artifacts,artifactSet:wideFills?WIDE_ROUTING_ARTIFACT_SET:WIDE_DIRECTORY_ARTIFACT_SET};
  }
  const deployment = accountDeployment(selection);
  assert.equal(revision, deployment.programRevision);
  const artifacts = Object.fromEntries(deployment.artifacts
    .filter(artifact => artifact.name !== 'oracle-fixture')
    .map(({name, bytes, sha256}) => [name, {bytes, sha256}]));
  verifyTestBuild(directory, revision, artifacts, selection==='bounded-entry'||selection==='funded-routing'?'bounded-entry-settlement':selection==='closed-quantity'?'closed-quantity-settlement':'execution-router-qualification');
  return {artifactSet: deployment.artifactSet, artifacts, revision};
}
