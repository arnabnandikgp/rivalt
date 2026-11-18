import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LIQUIDITY_ARTIFACTS} from '../packages/sdk/src/liquidity-artifacts.js';

/** A matching build manifest proves consistency, not qualification. Always bind
 * local runtime files to the same fixed allowlist as the deployed-code verifier. */
export function verifyLiquidityArtifactDirectory(directory:string){
  const manifest=JSON.parse(readFileSync(resolve(directory,'build-manifest.json'),'utf8'));
  assert.equal(manifest.trackedDirty,false,'Artifact build must have a clean tracked tree');
  assert.equal(manifest.profile,'liquidity-execution-qualification','Wrong artifact profile');
  assert.equal(manifest.framework,'anchor-2.0.0-rc.2','Wrong artifact framework');
  assert.equal(manifest.accountSchema,10,'Wrong clearing account schema');
  assert.equal(manifest.profileVersion,6,'Wrong clearing program profile');
  assert.equal(manifest.makerAccountSchema,5,'Wrong maker account schema');
  for(const artifact of LIQUIDITY_ARTIFACTS){
    const filename=`${artifact.name.replaceAll('-','_')}.so`;
    const bytes=readFileSync(resolve(directory,filename));
    assert.equal(bytes.length,artifact.bytes,`Unqualified ${filename} length`);
    const hash=createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash,artifact.sha256,`Unqualified ${filename} hash`);
    assert.equal(manifest.binaries?.[filename],hash,`Manifest mismatch for ${filename}`);
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.equal(process.argv.length,3,'Usage: verify-liquidity-artifacts.ts <directory>');
  verifyLiquidityArtifactDirectory(process.argv[2]);
  console.log('Qualified clearing, maker and oracle artifact hashes verified.');
}
