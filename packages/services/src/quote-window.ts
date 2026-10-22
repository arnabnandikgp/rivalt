/** Conservative local dispatch admission. These bounds never extend an on-chain quote. */
export function quoteWindow(now:bigint,sampledAt:bigint,interval:bigint,margin:bigint){
  if(interval<2n||interval>5n||margin<0n||margin>1n)throw new Error('Invalid quote dispatch window');
  return margin===0n||now+margin<sampledAt+interval;
}
export function publicRequestId(value:unknown):string{
  if(typeof value!=='string'||!/^[a-zA-Z0-9:._-]{1,160}$/.test(value)||/^(funding|keeper|maker|maker-sync|order|risk):/.test(value))throw new Error('Invalid public request identity');
  return value;
}
