import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {artifactNames, candidateArtifacts, C0_SOURCE, sha256} from './profile-contracts.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, {recursive: true}); });
function fixture(change: Record<string, unknown>) {
  const directory = mkdtempSync(join(tmpdir(), 'rivalt-profile-contract-'));
  directories.push(directory);
  const bytes = Buffer.from('not a qualified program');
  for (const name of artifactNames) writeFileSync(join(directory, `${name}.so`), bytes);
  writeFileSync(join(directory, 'build-manifest.json'), JSON.stringify({revision: C0_SOURCE,
    trackedDirty: false, profile: 'liquidity-execution-qualification', framework: 'anchor-2.0.0-rc.2',
    accountSchema: 8, makerAccountSchema: 5,
    binaries: Object.fromEntries(artifactNames.map(name => [`${name}.so`, sha256(bytes)])), ...change}));
  return directory;
}
describe('candidate measurement provenance', () => {
  it.each([{revision: '0'.repeat(40)}, {trackedDirty: true}, {instrumented: true},
    {accountSchema: 7}, {profile: 'default'}])('rejects incompatible manifest %j', change => {
    expect(() => candidateArtifacts(fixture(change))).toThrow();
  });
  it('rejects a self-consistent local manifest whose binaries are not admitted', () => {
    expect(() => candidateArtifacts(fixture({}))).toThrow(/client admission allowlist/);
  });
});
