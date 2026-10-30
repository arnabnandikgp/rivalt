import {expect,it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {accountFixture} from '../../packages/sdk/src/account-test-fixture.js';

it('binds the current local deployment to generated program identities',()=>{
  expect(sdk.testDeployment()).toEqual({chain:'solana:localnet',genesis:null,
    clearing:sdk.CLEARING_PROGRAM_ADDRESS,makerA:sdk.makerA.MAKER_A_PROGRAM_ADDRESS,makerB:sdk.makerB.MAKER_B_PROGRAM_ADDRESS});
});
it('rejects historical clusters, arbitrary chains and public credentials',async()=>{
  const {config}=await accountFixture();
  for(const chain of ['solana:devnet','solana:mainnet','arbitrary']){
    expect(()=>sdk.testDeployment(chain)).toThrow('Unsupported');
    expect(()=>sdk.accountUserConfig({...config,chain} as sdk.AccountUserConfig)).toThrow('qualified');
  }
  for(const rpcUrl of ['http://127.0.0.1?api-key=secret','http://user:pass@127.0.0.1','http://127.0.0.1#secret'])
    expect(()=>sdk.accountUserConfig({...config,rpcUrl})).toThrow();
  for(const rpcUrl of ['https://rpc.example','http://rpc.example','file:///tmp/rpc'])
    expect(()=>sdk.testRpcUrl(rpcUrl,'solana:localnet')).toThrow();
  expect(()=>sdk.testRpcUrl('http://127.0.0.1:8899','solana:localnet')).not.toThrow();
  expect(()=>sdk.testRpcUrl('ws://localhost:8900','solana:localnet',true)).not.toThrow();
  expect(()=>sdk.testRpcUrl('http://localhost:8900','solana:localnet',true)).toThrow();
});
