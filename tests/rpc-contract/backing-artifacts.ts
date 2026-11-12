/** Explicit local candidate allowlist. Never imported by normal runtime admission. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const BACKING_ARTIFACT_SET='p56-population-0cc21b8';
export const BACKING_BUILD='0cc21b820005cc9708d7baeb63193f55576c4f62';
export const BACKING_ARTIFACTS:Record<string,{bytes:number;sha256:string}>={
  clearing:{bytes:2374816,sha256:'16f94c7fb2808e9ac4d547a3671a13386be4296c2a43cb5ef8950e67de3d0651'},
  'maker-a':{bytes:166848,sha256:'8caa4409f196b75a23418fcc4adee5ae9ef7fdbf3dc18c2d3f8d7665a09f94cc'},
  'maker-b':{bytes:166848,sha256:'7fb790b32a94b66f5bc893c3e212a31604fae7c0d1d82ab693bda4f0dc5b8a41'},
};
export function verifyBackingBuild(directory:string) {
  const manifest=JSON.parse(readFileSync(`${directory}/build-manifest.json`,'utf8'));
  assert.equal(manifest.revision,BACKING_BUILD);assert.equal(manifest.trackedDirty,false);
  assert.equal(manifest.accountSchema,10);assert.equal(manifest.profileVersion,6);
  assert.equal(manifest.framework,'anchor-2.0.0-rc.2');
  for(const [name,expected] of Object.entries(BACKING_ARTIFACTS)) {
    const file=`${name.replace('-','_')}.so`,bytes=readFileSync(`${directory}/${file}`);
    assert.equal(bytes.length,expected.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256);
    assert.equal(manifest.binaries[file],expected.sha256);
  }
  return manifest;
}
