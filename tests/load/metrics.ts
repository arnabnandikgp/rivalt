export type Attempt = {
  side?:number;lots?:string;id: string; phase: string; offeredAt: number; actor: number; fault: boolean;
  status: string; eligible?: boolean; signature?: string; code?: string;
  quoteMs?: number; validationMs?: number; signingMs?: number; submitMs?: number; signedAtEpochMs?: number; firstBroadcastMs?: number;
  processedMs?: number; confirmedMs?: number; finalizedMs?: number;
  bytes?: number; accounts?: number; units?: number; fee?: string;
};
export function distribution(values: number[]) {
  if (!values.length) return { count: 0, p50: null, p95: null, p99: null, max: null };
  if (values.some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid latency population');
  const sorted = [...values].sort((a,b)=>a-b);
  const q = (p:number) => sorted[Math.ceil(p*sorted.length)-1];
  return {count:sorted.length,p50:q(.5),p95:q(.95),p99:q(.99),max:sorted.at(-1)!};
}
export function summarize(rows: Attempt[]) {
  const submitted=rows.filter(r=>r.signature), normal=submitted.filter(r=>r.eligible&&!r.fault);
  const counts:Record<string,number>={},causes:Record<string,number>={},mix:Record<string,any>={};for(const row of rows){counts[row.status]=(counts[row.status]??0)+1;if(row.code)causes[row.code]=(causes[row.code]??0)+1;const key=`${row.side??'unknown'}:${row.lots??'unknown'}`,m=mix[key]??={offered:0,submitted:0,successful:0};m.offered++;if(row.signature)m.submitted++;if(row.status==='finalized')m.successful++;}
  const normalOffered=rows.filter(r=>!r.fault).length;
  return {offered:rows.length,submitted:submitted.length,normalOffered,normalAvailability:normalOffered?normal.length/normalOffered:null,normalEligible:normal.length,
    normalSuccessful:normal.filter(r=>r.status==='finalized').length,
    normalSuccess:normal.length?normal.filter(r=>r.status==='finalized').length/normal.length:null,
    statusCounts:counts,causeCounts:causes,sideSizeMix:mix,quote:distribution(rows.flatMap(r=>r.quoteMs===undefined?[]:[r.quoteMs])),
    signing:distribution(rows.flatMap(r=>r.signingMs===undefined?[]:[r.signingMs])),
    validation:distribution(rows.flatMap(r=>r.validationMs===undefined?[]:[r.validationMs])),
    submit:distribution(rows.flatMap(r=>r.submitMs===undefined?[]:[r.submitMs])),
    firstBroadcast:distribution(rows.flatMap(r=>r.firstBroadcastMs===undefined?[]:[r.firstBroadcastMs])),
    processed:distribution(rows.flatMap(r=>r.processedMs===undefined?[]:[r.processedMs])),
    confirmed:distribution(rows.flatMap(r=>r.confirmedMs===undefined?[]:[r.confirmedMs])),
    finalized:distribution(rows.flatMap(r=>r.finalizedMs===undefined?[]:[r.finalizedMs])),
    maxBytes:rows.reduce((n,r)=>Math.max(n,r.bytes??0),0),maxAccounts:rows.reduce((n,r)=>Math.max(n,r.accounts??0),0),
    maxUnits:rows.reduce((n,r)=>Math.max(n,r.units??0),0),fees:rows.reduce((n,r)=>n+BigInt(r.fee??0),0n).toString()};
}
