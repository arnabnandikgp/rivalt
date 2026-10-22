import { expect,it } from 'vitest';
import { quoteWindow,publicRequestId } from './quote-window.js';
it('closes the configured dispatch window before a scheduled sample, including overdue samples',()=>{
  expect(quoteWindow(103n,100n,5n,1n)).toBe(true);
  for(const now of [104n,105n,110n])expect(quoteWindow(now,100n,5n,1n)).toBe(false);
  expect(quoteWindow(105n,100n,2n,0n)).toBe(true);
  expect(()=>quoteWindow(100n,100n,6n,1n)).toThrow();
  expect(()=>quoteWindow(100n,100n,5n,2n)).toThrow();
});
it('keeps public identities out of every worker namespace',()=>{
  for(const prefix of ['funding','keeper','maker','maker-sync','order','risk'])expect(()=>publicRequestId(prefix+':1')).toThrow();
  for(const value of [undefined,null,5,'','bad space','x'.repeat(161)])expect(()=>publicRequestId(value)).toThrow();
  for(const value of ['load:2','wallet:abc','fault:lost-ack','order-form:1'])expect(publicRequestId(value)).toBe(value);
});
