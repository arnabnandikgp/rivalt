/** Explicit local candidate allowlist. Never imported by normal runtime admission. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const BACKING_ARTIFACT_SET='p56-continuation-1c08778';
export const BACKING_BUILD='1c08778fde3359b003f744654220946bc56e6f83';
export const BACKING_ARTIFACTS:Record<string,{bytes:number;sha256:string}>={
  clearing:{bytes:2378392,sha256:'60c3bb23a550723dd0958fc6b34dcde72ed742f3dde4075bf1b6eab5a01e3790'},
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
