import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {accountDeployment,type AccountDeployment} from '../../sdk/src/account-deployment.js';

export function verifyDemoPrograms(directory:string,selection:AccountDeployment) {
  const deployment=accountDeployment(selection);
  const binaries:Record<string,string>={};
  for(const artifact of deployment.artifacts){
    const filename=artifact.name.replaceAll('-','_')+'.so';
    const bytes=readFileSync(join(directory,filename));
    const digest=createHash('sha256').update(bytes).digest('hex');
    assert.equal(bytes.length,artifact.bytes,`Unqualified ${filename} length`);
    assert.equal(digest,artifact.sha256,`Unqualified ${filename} hash`);
    binaries[filename]=digest;
  }
  return {revision:deployment.helperRevision,artifactSet:deployment.artifactSet,binaries};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.equal(process.argv.length,3);
  console.log(JSON.stringify(verifyDemoPrograms(process.argv[2],'unified-recovery-candidate'),null,2));
}
