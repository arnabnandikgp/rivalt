import { expect,it } from 'vitest';
import { Continuity } from './continuity.js';
it('requires monotonic continuous activity as well as wall elapsed time',()=>{
  const good=new Continuity(1000,0);good.observe(2000,1000);good.observe(3000,2000);expect(good.result().wallSeconds).toBe(2);
  for(const [wall,mono] of [[86401000,1000],[86401000,86400000],[0,1000],[1100,4000]])expect(()=>new Continuity(1000,0).observe(wall,mono)).toThrow('Continuity');
});
