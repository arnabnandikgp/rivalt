import assert from 'node:assert/strict';
import {verifyTestBuild} from './backing-artifacts.js';
import {EXECUTION_ROUTER_ARTIFACT_SET} from '@rivalt/sdk';

/** Explicit local binary identity shared by the launcher and finalized journal. */
export function routerBuild() {
  const directory = process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!;
  const revision = process.env.RIVALT_ROUTER_REVISION!;
  assert.equal(revision, '35fef03e3f58e9cba69b4c38408e39194bddc051');
  const artifacts = {
    clearing: {bytes: 3637536, sha256: 'fa85567e41cde0b9ecb0eb02ae78c4213f1898cd46dbeccc3ab6e4a6c7c35bc4'},
    'maker-a': {bytes: 167520, sha256: '38a45a632db54c64a39c2793043ec14bb0b172721761a2950c61d59328ec6ccb'},
    'maker-b': {bytes: 167520, sha256: '924c94a5a7e1eff35ad0dc28a4ebc3b01b7b5b17d18d8fda531e91daeaf37139'},
  };
  verifyTestBuild(directory, revision, artifacts, 'execution-router-qualification');
  return {artifactSet: EXECUTION_ROUTER_ARTIFACT_SET, artifacts};
}
