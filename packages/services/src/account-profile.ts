/** Services require the explicit current local deployment profile. */
export function accountExecutionProfile(value=process.env.RIVALT_ACCOUNT_PROFILE):4 {
  if(value==='liquidity-execution-qualification')return 4;
  throw new Error('Explicit liquidity-execution-qualification service profile required');
}
