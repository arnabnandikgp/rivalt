export type Attempt = {
  id: string; phase: string; offeredAt: number; actor: number; fault: boolean;
  status: string; eligible?: boolean; signature?: string; code?: string;
  quoteMs?: number; signingMs?: number; submitMs?: number; signedAtEpochMs?: number; firstBroadcastMs?: number;
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
  const counts:Record<string,number>={};for(const row of rows)counts[row.status]=(counts[row.status]??0)+1;
  return {offered:rows.length,submitted:submitted.length,normalEligible:normal.length,
    normalSuccessful:normal.filter(r=>r.status==='finalized').length,
    normalSuccess:normal.length?normal.filter(r=>r.status==='finalized').length/normal.length:null,
    statusCounts:counts,quote:distribution(rows.flatMap(r=>r.quoteMs===undefined?[]:[r.quoteMs])),
    signing:distribution(rows.flatMap(r=>r.signingMs===undefined?[]:[r.signingMs])),
    submit:distribution(rows.flatMap(r=>r.submitMs===undefined?[]:[r.submitMs])),
    firstBroadcast:distribution(rows.flatMap(r=>r.firstBroadcastMs===undefined?[]:[r.firstBroadcastMs])),
    processed:distribution(rows.flatMap(r=>r.processedMs===undefined?[]:[r.processedMs])),
    confirmed:distribution(rows.flatMap(r=>r.confirmedMs===undefined?[]:[r.confirmedMs])),
    finalized:distribution(rows.flatMap(r=>r.finalizedMs===undefined?[]:[r.finalizedMs])),
    maxBytes:Math.max(0,...rows.map(r=>r.bytes??0)),maxAccounts:Math.max(0,...rows.map(r=>r.accounts??0)),
    maxUnits:Math.max(0,...rows.map(r=>r.units??0)),fees:rows.reduce((n,r)=>n+BigInt(r.fee??0),0n).toString()};
}
