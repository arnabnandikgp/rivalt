import {resolve} from 'node:path';
import {accountDeployment,usesMultiMaker,usesExecutionRouter} from '../../sdk/src/account-deployment.js';
export const DEMO_ROOT=resolve(process.env.RIVALT_DEMO_ROOT??'.local/interactive-demo');
export const RUNTIME=resolve(DEMO_ROOT,'runtime');
const requested=process.env.RIVALT_DEMO_DEPLOYMENT??'bounded-entry';
if(requested!=='selected'&&requested!=='unified-recovery-candidate'&&!usesExecutionRouter(requested))throw new Error('Unknown local demo deployment');
export const DEMO_DEPLOYMENT:'selected'|'unified-recovery-candidate'|'execution-router-candidate'|'bounded-router-candidate'|'closed-quantity'|'bounded-entry'|'funded-routing'|'multi-maker'|'funded-multi-maker'|'price-limited-multi-maker'=requested;
export function requireFreshDemoDeployment(selection:string=DEMO_DEPLOYMENT) {
  if(selection!=='bounded-entry'&&selection!=='funded-routing'&&!usesMultiMaker(selection))throw new Error('Fresh demo venues require fixed-width closed-quantity settlement. Historical artifacts are available for replay.');
}
export const ARTIFACT_DIRECTORY=DEMO_DEPLOYMENT==='selected'?
  resolve(process.env.RIVALT_ARTIFACT_DIR??'.local/anchor-rc2/current'):
  resolve(process.env.RIVALT_DEMO_PROGRAMS??`.local/demo-programs/${accountDeployment(DEMO_DEPLOYMENT).artifactSet}`);
export const demoArtifact=(program:string)=>resolve(ARTIFACT_DIRECTORY,program+'.so');
export const CONTROL='http://127.0.0.1:18094';
export const UI='http://127.0.0.1:18083';
export const PORTS=[18931,18932,15443,18092,18093,18094,18083];
export const IMAGE='docker.io/library/postgres@sha256:89f747171c4b0af0eacf5984550060be79786dbe286eb60cfa691d79d1e8b23f';
export const CONTAINER='rivalt-interactive-demo';
export const json=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
export function publicRequest(origin:string|undefined,host:string|undefined){
  return origin===UI&&host==='127.0.0.1:18094';
}
