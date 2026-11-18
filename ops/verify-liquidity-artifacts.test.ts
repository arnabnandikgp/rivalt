import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';

// Tiny test-only approved binaries let CI exercise real file/hash checks without
// downloading retained SBF evidence. Production exposes no caller-selected pins.
vi.mock('../packages/sdk/src/liquidity-artifacts.js',()=>({LIQUIDITY_ARTIFACTS:[
  {name:'clearing',bytes:3,sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'},
  {name:'maker-a',bytes:3,sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'},
  {name:'maker-b',bytes:3,sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'},
  {name:'oracle-fixture',bytes:3,sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'},
]}));
import {verifyLiquidityArtifactDirectory} from './verify-liquidity-artifacts.js';

const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'rivalt-artifact-gate-'));directories.push(directory);
  const binaries:Record<string,string>={};
  for(const name of ['clearing','maker_a','maker_b','oracle_fixture']){
    writeFileSync(join(directory,`${name}.so`),'abc');
    binaries[`${name}.so`]='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  }
  const manifest={trackedDirty:false,profile:'liquidity-execution-qualification',framework:'anchor-2.0.0-rc.2',
    accountSchema:10,profileVersion:6,makerAccountSchema:5,binaries};
  const save=()=>writeFileSync(join(directory,'build-manifest.json'),JSON.stringify(manifest));
  save();return {directory,manifest,save};
}
it('accepts exactly admitted files and matching build metadata in an alternate directory',()=>{
  const {directory}=fixture();expect(()=>verifyLiquidityArtifactDirectory(directory)).not.toThrow();
});
it.each(['clearing','maker_a','maker_b','oracle_fixture'])('rejects changed %s even with a matching rewritten manifest',name=>{
  const {directory,manifest,save}=fixture();
  writeFileSync(join(directory,`${name}.so`),'abd');
  manifest.binaries[`${name}.so`]=createHash('sha256').update('abd').digest('hex');save();
  expect(()=>verifyLiquidityArtifactDirectory(directory)).toThrow(`Unqualified ${name}.so hash`);
});
it('rejects missing, truncated and extended binaries',()=>{
  const {directory}=fixture(),path=join(directory,'maker_b.so');
  for(const bytes of ['ab','abcd']){
    writeFileSync(path,bytes);expect(()=>verifyLiquidityArtifactDirectory(directory)).toThrow(/length/);
  }
  rmSync(path);expect(()=>verifyLiquidityArtifactDirectory(directory)).toThrow(/ENOENT/);
});
it('rejects inconsistent manifests even for admitted bytes',()=>{
  const {directory,manifest,save}=fixture();manifest.binaries['clearing.so']='0'.repeat(64);save();
  expect(()=>verifyLiquidityArtifactDirectory(directory)).toThrow(/Manifest mismatch/);
});
it.each([
  ['trackedDirty',true],['profile','devnet-test-profile'],['framework','anchor-1.2.1'],
  ['accountSchema',8],['profileVersion',4],['makerAccountSchema',4],
])('rejects incompatible build metadata: %s',(key,value)=>{
  const {directory}=fixture(),path=join(directory,'build-manifest.json');
  const manifest=JSON.parse(readFileSync(path,'utf8'));manifest[key as string]=value;
  writeFileSync(path,JSON.stringify(manifest));expect(()=>verifyLiquidityArtifactDirectory(directory)).toThrow();
});
