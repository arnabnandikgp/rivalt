import {LIQUIDITY_ARTIFACTS,LIQUIDITY_ARTIFACT_SET} from './liquidity-artifacts.js';

/** API/budget policy 4 is separate from the program's profile. Candidate binding
 * is opt-in and exact; it does not promote the selected default runtime. */
export type AccountDeployment='selected'|'account-scale-candidate';
export const ACCOUNT_SCALE_ARTIFACT_SET='p55b2-maintained-bc9f029';
const candidate:Record<string,{bytes:number;sha256:string}>={
  clearing:{bytes:2374856,sha256:'62523299a7f1629dc40e56cd99c6b858a74a247bc5eecca46debab0ec0ab65a9'},
  'maker-a':{bytes:166848,sha256:'8caa4409f196b75a23418fcc4adee5ae9ef7fdbf3dc18c2d3f8d7665a09f94cc'},
  'maker-b':{bytes:166848,sha256:'7fb790b32a94b66f5bc893c3e212a31604fae7c0d1d82ab693bda4f0dc5b8a41'},
};
export function accountDeployment(selection:AccountDeployment) {
  if(selection==='selected')return {artifactSet:LIQUIDITY_ARTIFACT_SET,schema:8,programProfile:4,artifacts:LIQUIDITY_ARTIFACTS};
  if(selection==='account-scale-candidate')return {artifactSet:ACCOUNT_SCALE_ARTIFACT_SET,schema:10,programProfile:6,
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>({...artifact,...candidate[artifact.name]}))};
  throw new Error('Unsupported account deployment');
}
