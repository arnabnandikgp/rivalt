import {describe,it,expect} from 'vitest';
import {liquidityOperatorConfig} from './liquidity-config.js';
import {address} from '@solana/kit';
const key=address('11111111111111111111111111111111');
const config=()=>({schemaVersion:4 as const,operatorClass:'internal-reference' as const,runId:'operator',databaseEnv:'RIVALT_DATABASE_URL',
  signerPath:'/private/operator.json',role:'maker' as const,marketIndex:0 as const,instance:2 as const,signer:key,
  deployment:{version:4 as const,accountSchema:5 as const,chain:'solana:localnet' as const,profile:'liquidity-execution-qualification' as const,
    rpcUrl:'http://127.0.0.1:18941',wsUrl:'ws://127.0.0.1:18942',genesis:key,anchor:'1'.repeat(88),anchorHash:'a'.repeat(64),venue:key,mint:key,domain:'b'.repeat(64)}});
describe('canonical operator configuration',()=>{
  it('binds three-instance internal workers to explicit qualified local deployment',()=>expect(liquidityOperatorConfig(config()).instance).toBe(2));
  it('rejects foreign profiles, credential-bearing public URLs and ambiguous role identities',()=>{
    for(const mutate of [(value:any)=>value.deployment.version=3,(value:any)=>value.deployment.rpcUrl+='?api-key=secret',
      (value:any)=>value.instance=3,(value:any)=>value.role='funding',(value:any)=>value.operatorClass='independent',
      (value:any)=>value.databaseEnv='DATABASE_URL']){const value=config();mutate(value);expect(()=>liquidityOperatorConfig(value)).toThrow();}
  });
});
