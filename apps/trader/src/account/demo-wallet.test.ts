import {expect,it} from 'vitest';
import type {AccountUserConfig} from '@rivalt/sdk';
import {requireLocalDemo} from './demo-wallet.js';
const config={version:3,chain:'solana:localnet',profile:'account-safety-qualification',rpcUrl:'http://127.0.0.1:18931',wsUrl:'ws://127.0.0.1:18932'} as AccountUserConfig;
it('permits only the explicit loopback account demo',()=>{
  expect(()=>requireLocalDemo(config,'http://127.0.0.1:18083')).not.toThrow();
  expect(()=>requireLocalDemo({...config,version:4,profile:'liquidity-execution-qualification'},'http://127.0.0.1:18083')).not.toThrow();
  expect(()=>requireLocalDemo({...config,version:4} as unknown as AccountUserConfig,'http://127.0.0.1:18083')).toThrow();
  for(const origin of ['https://rivalt.example','http://localhost:18083','http://127.0.0.1:9999'])expect(()=>requireLocalDemo(config,origin)).toThrow();
  for(const override of [{chain:'solana:devnet'},{profile:'devnet'},{rpcUrl:'https://api.devnet.solana.com'},{wsUrl:'wss://example.com'}])
    expect(()=>requireLocalDemo({...config,...override} as AccountUserConfig,'http://127.0.0.1:18083')).toThrow();
});
