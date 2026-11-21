import {resolve} from 'node:path';
export const DEMO_ROOT=resolve(process.env.RIVALT_DEMO_ROOT??'.local/interactive-demo');
export const RUNTIME=resolve(DEMO_ROOT,'runtime');
const requested=process.env.RIVALT_DEMO_DEPLOYMENT??'selected';
if(requested!=='selected'&&requested!=='unified-recovery-candidate')throw new Error('Unknown local demo deployment');
export const DEMO_DEPLOYMENT:'selected'|'unified-recovery-candidate'=requested;
const baseline=resolve(process.env.RIVALT_ARTIFACT_DIR??'.local/anchor-rc2/current');
export const ARTIFACT_DIRECTORY=DEMO_DEPLOYMENT==='selected'?baseline:resolve(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR??
  '.local/profit-attribution/build-3d90b3ef3dd9895870e14b0e3ad9340d8a87e591');
export const demoArtifact=(program:string)=>resolve(program==='oracle_fixture'?baseline:ARTIFACT_DIRECTORY,program+'.so');
export const CONTROL='http://127.0.0.1:18094';
export const UI='http://127.0.0.1:18083';
export const PORTS=[18931,18932,15443,18092,18093,18094,18083];
export const IMAGE='docker.io/library/postgres@sha256:89f747171c4b0af0eacf5984550060be79786dbe286eb60cfa691d79d1e8b23f';
export const CONTAINER='rivalt-interactive-demo';
export const json=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
export function publicRequest(origin:string|undefined,host:string|undefined){
  return origin===UI&&host==='127.0.0.1:18094';
}
