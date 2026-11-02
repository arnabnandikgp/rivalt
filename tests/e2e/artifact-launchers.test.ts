import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {LIQUIDITY_ARTIFACTS} from '../../packages/sdk/src/liquidity-artifacts.js';

it.each(['current-runtime-smoke','liquidity-continuation-smoke','smoke'])(
  '%s refuses a self-consistent unqualified artifact set before starting a runtime',script=>{
    const directory=mkdtempSync(join(tmpdir(),'rivalt-launcher-gate-'));
    try{
      const binaries:Record<string,string>={};
      for(const artifact of LIQUIDITY_ARTIFACTS){
        const filename=`${artifact.name.replaceAll('-','_')}.so`,bytes=Buffer.alloc(artifact.bytes);
        writeFileSync(join(directory,filename),bytes);
        binaries[filename]=createHash('sha256').update(bytes).digest('hex');
      }
      writeFileSync(join(directory,'build-manifest.json'),JSON.stringify({trackedDirty:false,
        profile:'liquidity-execution-qualification',framework:'anchor-2.0.0-rc.2',accountSchema:8,makerAccountSchema:5,binaries}));
      const runDirectory=join(directory,'must-not-start');
      const outcome=spawnSync('bash',[`ops/${script}.sh`],{encoding:'utf8',timeout:15_000,env:{...process.env,
        RIVALT_ARTIFACT_DIR:directory,RIVALT_RUN_DIR:runDirectory,RIVALT_LIQUIDITY_PROBE:'makers',
        RIVALT_CONTINUATION_PROFILE:'treatment'}});
      expect(outcome.error).toBeUndefined();expect(outcome.status).not.toBe(0);
      expect(outcome.stderr).toContain('Unqualified clearing.so hash');
      expect(existsSync(runDirectory)).toBe(false);
    }finally{rmSync(directory,{recursive:true,force:true});}
  },20_000);
