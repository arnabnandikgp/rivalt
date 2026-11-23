import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {verifyTestBuild} from './backing-artifacts.js';

/** Explicit local binary identity shared by the launcher and finalized journal. */
export function routerBuild() {
  const directory = process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!;
  const revision = process.env.RIVALT_ROUTER_REVISION!;
  assert.match(revision, /^[a-f0-9]{40}$/);
  const artifacts = Object.fromEntries(['clearing','maker-a','maker-b'].map(name => {
    const bytes = readFileSync(`${directory}/${name.replace('-', '_')}.so`);
    return [name, {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}];
  }));
  verifyTestBuild(directory, revision, artifacts, 'execution-router-qualification');
  return {artifactSet: `execution-router-${revision}`, artifacts};
}
