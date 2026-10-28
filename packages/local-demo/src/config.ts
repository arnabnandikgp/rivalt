import {resolve} from 'node:path';
export const DEMO_ROOT=resolve('.local/interactive-demo');
export const RUNTIME=resolve(DEMO_ROOT,'runtime');
export const CONTROL='http://127.0.0.1:18094';
export const UI='http://127.0.0.1:18083';
export const PORTS=[18931,18932,15443,18092,18093,18094,18083];
export const IMAGE='docker.io/library/postgres@sha256:89f747171c4b0af0eacf5984550060be79786dbe286eb60cfa691d79d1e8b23f';
export const CONTAINER='rivalt-interactive-demo';
export const json=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
export function publicRequest(origin:string|undefined,host:string|undefined){
  return origin===UI&&host==='127.0.0.1:18094';
}
