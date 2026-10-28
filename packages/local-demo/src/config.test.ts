import {expect,it} from 'vitest';
import {publicRequest,UI} from './config.js';
it('does not expose the faucet to cross-origin pages or ambiguous hosts',()=>{
  expect(publicRequest(UI,'127.0.0.1:18094')).toBe(true);
  for(const origin of [undefined,'null','https://example.com','http://127.0.0.1:18084'])expect(publicRequest(origin,'127.0.0.1:18094')).toBe(false);
  for(const host of [undefined,'localhost:18094','example.com:18094'])expect(publicRequest(UI,host)).toBe(false);
});
