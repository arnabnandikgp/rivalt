import assert from 'node:assert/strict';
import {verifyTestBuild} from './backing-artifacts.js';
import {accountDeployment} from '@rivalt/sdk';

/** Explicit local binary identity shared by the launcher and finalized journal. */
export function routerBuild() {
  const directory = process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!;
  const revision = process.env.RIVALT_ROUTER_REVISION!;
  const deployment = accountDeployment('execution-router-candidate');
  assert.equal(revision, deployment.programRevision);
  const artifacts = Object.fromEntries(deployment.artifacts
    .filter(artifact => artifact.name !== 'oracle-fixture')
    .map(({name, bytes, sha256}) => [name, {bytes, sha256}]));
  verifyTestBuild(directory, revision, artifacts, 'execution-router-qualification');
  return {artifactSet: deployment.artifactSet, artifacts};
}
