import {expect,it} from 'vitest';
import {DemoFaucet} from './faucet.js';

it('releases preparation failures and the global busy lock without calling submit',async()=>{
  const faucet=new DemoFaucet();let submissions=0;
  await expect(faucet.fund('wallet',async()=>{throw new Error('Rent lookup failed');})).rejects.toThrow('Rent lookup failed');
  expect(await faucet.fund('wallet',async()=>async()=>++submissions)).toBe(1);
  await expect(faucet.fund('wallet',async()=>async()=>++submissions)).rejects.toMatchObject({status:409});
  expect(submissions).toBe(1);
});

it('reserves admission before asynchronous preparation and preserves the session cap',async()=>{
  const faucet=new DemoFaucet();let ready!:(submit:()=>Promise<void>)=>void;
  const pending=faucet.fund<void>('first',()=>new Promise<()=>Promise<void>>(resolve=>{ready=resolve;}));
  await expect(faucet.fund('first',async()=>async()=>{})).rejects.toMatchObject({status:409});
  await expect(faucet.fund('other',async()=>async()=>{})).rejects.toThrow('Faucet is busy');
  ready(async()=>{});await pending;
  for(let index=1;index<16;index++)await faucet.fund(`wallet-${index}`,async()=>async()=>{});
  await expect(faucet.fund('seventeenth',async()=>async()=>{})).rejects.toMatchObject({status:400});
});
