/** Existing launchers default to their original profile; canonical operation
 * requires the explicit pinned local profile name. Unknown names fail closed. */
export function accountExecutionProfile(value=process.env.RIVALT_ACCOUNT_PROFILE):3|4 {
  if(value===undefined||value==='account-safety-qualification')return 3;
  if(value==='liquidity-execution-qualification')return 4;
  throw new Error('Unsupported account service profile');
}
