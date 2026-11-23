import {usesExecutionRouter} from '@rivalt/sdk';
/** Services require the explicit current local deployment profile. */
export function accountExecutionProfile(value=process.env.RIVALT_ACCOUNT_PROFILE):4 {
  if(value==='liquidity-execution-qualification')return 4;
  throw new Error('Explicit liquidity-execution-qualification service profile required');
}

/** Separate explicit candidate selection; selected runtime remains the default. */
export function accountDeploymentSelection(value=process.env.RIVALT_ACCOUNT_DEPLOYMENT,consumer?:string):import('./account-deployment.js').AccountDeployment {
  if(value===undefined||value==='selected')return 'selected';
  if(value==='account-scale-candidate')return value;
  if(usesExecutionRouter(value)&&consumer==='wallet-api')return value;
  if(value==='integrated-recovery-candidate'&&['risk','settlement','executor'].includes(consumer??''))return value;
  if((value==='unified-recovery-candidate'||usesExecutionRouter(value))&&['risk','settlement','executor','maker','funding','orders'].includes(consumer??''))return value;
  throw new Error('Unsupported account deployment selection');
}
