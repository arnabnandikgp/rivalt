import {expect,it} from 'vitest';
import {workloadMetrics,type WorkloadOffer} from './group-workload-metrics.js';
it('keeps refusals, misses and failures in offered denominators and isolates drain outcomes',()=>{
  const base={population:'scheduled',phase:'normal',margin:'cross',marketIndex:0,scheduledMs:0,startedMs:10} as const;
  const offers:WorkloadOffer[]=[
    {...base,id:0,status:'finalized',quoteMs:20,preparedMs:30,submittedMs:40,finalizedMs:100},
    {...base,id:1,status:'quote-refused',reason:'source'},
    {...base,id:2,status:'not-attempted',reason:'account-original-pending'},
    {...base,id:3,status:'failed',quoteMs:20,preparedMs:30,submittedMs:40,finalizedMs:110},
    {...base,id:4,population:'drain',status:'finalized',submittedMs:40,finalizedMs:200},
  ];
  const result=workloadMetrics(offers);
  expect(result.scheduled.offeredAvailability).toEqual({numerator:1,denominator:4});
  expect(result.scheduled.submittedSuccess).toEqual({numerator:1,denominator:2});
  expect(result.scheduled.quoted).toBe(2);
  expect(result.scheduled.offerToFinalizedMs).toEqual({count:1,p50:90,p95:90,p99:90,max:90});
  expect(result.scheduled.reasons).toEqual({finalized:1,source:1,'account-original-pending':1,failed:1});
  expect(result.drain.offeredAvailability).toEqual({numerator:1,denominator:1});
});
it('empty populations expose no invented latency or success rate',()=>{
  const result=workloadMetrics([]).scheduled;
  expect(result.offeredAvailability).toEqual({numerator:0,denominator:0});
  expect(result.submitToFinalizedMs).toEqual({count:0,p50:null,p95:null,p99:null,max:null});
});
