/** Counts use every declared offer. Refusals are not removed from availability. */
export type WorkloadOffer = {
  id: number; population: 'scheduled'|'drain'; phase: string; marketIndex: number; margin: string;
  scheduledMs: number; startedMs: number; finishedMs?: number; status: string; reason?: string;
  quoteMs?: number; preparedMs?: number; submittedMs?: number; finalizedMs?: number;
  signature?: string; wire?: string; bytes?: number; units?: number; fee?: string;
  allocation?: unknown; diagnostic?: unknown; lots?: string; side?: number; error?: string;
};
const countBy = (values: WorkloadOffer[], key: (value: WorkloadOffer)=>string) => {
  const result: Record<string,number> = {};
  for (const value of values) {const name=key(value);result[name]=(result[name]??0)+1;}
  return result;
};
const quantiles = (values: number[]) => {
  const sorted=[...values].sort((left,right)=>left-right);
  const at=(fraction:number)=>sorted.length?sorted[Math.ceil(sorted.length*fraction)-1]:null;
  return {count:sorted.length,p50:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)??null};
};
export function workloadMetrics(offers: WorkloadOffer[]) {
  const scheduled=offers.filter(offer=>offer.population==='scheduled');
  const population=(values:WorkloadOffer[])=>{
    const submitted=values.filter(offer=>offer.submittedMs!==undefined),finalized=values.filter(offer=>offer.status==='finalized');
    return {offered:values.length,quoted:values.filter(offer=>offer.quoteMs!==undefined).length,
      prepared:values.filter(offer=>offer.preparedMs!==undefined).length,submitted:submitted.length,finalized:finalized.length,
      offeredAvailability:{numerator:finalized.length,denominator:values.length},
      submittedSuccess:{numerator:finalized.length,denominator:submitted.length},
      outcomes:countBy(values,offer=>offer.status),reasons:countBy(values,offer=>offer.reason??offer.status),
      offerToFinalizedMs:quantiles(finalized.map(offer=>offer.finalizedMs!-offer.startedMs)),
      submitToFinalizedMs:quantiles(finalized.map(offer=>offer.finalizedMs!-offer.submittedMs!)),
      schedulingDelayMs:quantiles(values.map(offer=>offer.startedMs-offer.scheduledMs))};
  };
  return {scheduled:population(scheduled),byPhase:Object.fromEntries([...new Set(scheduled.map(offer=>offer.phase))]
    .map(phase=>[phase,population(scheduled.filter(offer=>offer.phase===phase))])),
    byAccount:Object.fromEntries([...new Set(scheduled.map(offer=>offer.margin))].map(margin=>[margin,population(scheduled.filter(offer=>offer.margin===margin))])),
    drain:population(offers.filter(offer=>offer.population==='drain'))};
}
