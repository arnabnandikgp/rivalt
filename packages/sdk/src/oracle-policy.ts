/** Mirrors G08 clock policy for labeled previews. Clearing remains authoritative.
 * Works with decoded bigint accounts and canonical decimal-string projections.
 */
export function effectiveFunding(m:any,r:any,now:bigint,slot:bigint):bigint {
  const base=BigInt(m?.fundingIndexScaled??0),o=r?.oracle;
  if(m?.mode!==2 || !o)return base;
  const start=BigInt(o.sampledAt),end=BigInt(o.heldUntil);
  if(BigInt(o.heldEpoch)!==BigInt(m.configEpoch)||end<=start||slot>=BigInt(o.heldSlot)||now<start||now-start>30n)return base;
  return BigInt(o.fundingBase)+BigInt(o.premiumScaled)*((now<end?now:end)-start)/3600n;
}
export function oracleMode(m:any,r:any,now:bigint,slot:bigint):'Normal'|'Degraded'|'NoCredibleBounds'|'Frozen'{
  if(m?.mode===3)return 'Frozen';
  if(!r || slot<BigInt(r.validFrom)||slot>=BigInt(r.validUntil))return 'NoCredibleBounds';
  if(m?.mode!==2)return 'Normal';
  const o=r.oracle;
  if(!o||o.status===0||now<BigInt(o.sampledAt)||now>=BigInt(o.sourceDeadline))return 'NoCredibleBounds';
  return o.status===2&&BigInt(o.heldEpoch)===BigInt(m.configEpoch)&&now-BigInt(o.lastQualified)<12n?'Normal':'Degraded';
}
export const accruedBalance=<T extends {lots:bigint;virtualScaled:bigint;fundingCheckpointScaled:bigint}>(p:T,f:bigint):T=>({...p,virtualScaled:p.virtualScaled-p.lots*(f-p.fundingCheckpointScaled),fundingCheckpointScaled:f});
