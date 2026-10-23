import { expect,it } from 'vitest';
import { Continuity } from './continuity.js';
it('requires monotonic continuous activity as well as wall elapsed time',()=>{
  const good=new Continuity(1000,0);good.observe(2000,1000);good.observe(3000,2000);expect(good.result().wallSeconds).toBe(2);
  for(const [wall,mono] of [[86401000,1000],[86401000,86400000],[0,1000],[1100,4000]])expect(()=>new Continuity(1000,0).observe(wall,mono)).toThrow('Continuity');
});

it('allows measured gradual clock slew while retaining both elapsed clocks',()=>{
  const clock=new Continuity(1000,0);
  for(let n=1;n<=86400;n++)clock.observe(1000+Math.floor(n*999.95),n*1000);
  const r=clock.result();expect(r.monotonicSeconds).toBe(86400);expect(r.wallSeconds).toBeLessThan(86400);expect(r.maxClockDriftMs).toBe(4320);
  expect(()=>clock.observe(1000+86400*999.95+4000,86401000)).toThrow('Continuity');
});
