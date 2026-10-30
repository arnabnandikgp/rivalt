import {expect,it} from 'vitest';
import {boundedDispatch,dispatchAccess,reserveDispatch} from './dispatch.js';
import {dispatchKey,dispatchWire} from '../test-support/dispatch-fixture.js';
import type {PoolClient} from 'pg';

for(const version of [0,1] as const)it(`retains v${version} fee-payer, readonly and writable message dependencies`,()=>{
  expect(dispatchAccess(dispatchWire(1,2,3,version))).toEqual([
    {address:dispatchKey(1).toBase58(),writable:true},
    {address:dispatchKey(2).toBase58(),writable:true},
    {address:dispatchKey(3).toBase58(),writable:false},
    {address:dispatchKey(9).toBase58(),writable:false},
  ].sort((left,right)=>left.address.localeCompare(right.address)));
});

it('promotes aliased readonly/writable inputs and retains the payer as a write',()=>{
  expect(dispatchAccess(dispatchWire(1,1,1)).filter(item=>item.address===dispatchKey(1).toBase58()))
    .toEqual([{address:dispatchKey(1).toBase58(),writable:true}]);
});

it('allows a blocked RPC lane to coexist with independent progress within the bound',async()=>{
  let release!:()=>void,active=0,maximum=0;
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  const completed:string[]=[];
  await boundedDispatch(['slow','first','second','third'],async id=>{
    maximum=Math.max(maximum,++active);
    if(id==='slow')await barrier;
    if(id==='third')release();
    completed.push(id);active--;
  });
  expect(completed).toEqual(['first','second','third','slow']);expect(maximum).toBe(2);
});

it('finishes independent work before reporting an individual SQL/transport failure',async()=>{
  const visited:string[]=[];
  await expect(boundedDispatch(['bad','good','last'],async id=>{
    visited.push(id);if(id==='bad')throw new Error('broken connection');
  })).rejects.toThrow('Some durable originals could not progress');
  expect(visited).toEqual(['bad','good','last']);
});

it('does not persist an admission when a lock or durable conflicting original blocks it',async()=>{
  for(const fault of ['lock','conflict']) {
    const statements:string[]=[];
    const client={query:async(sql:string)=>{
      statements.push(sql);return {rows:sql.includes(' AS acquired')?[{acquired:fault!=='lock'}]:[{conflict:true}]};
    }} as unknown as PoolClient;
    expect(await reserveDispatch(client,'run','request',dispatchWire())).toBe(false);
    expect(statements.some(sql=>sql.startsWith('INSERT'))).toBe(false);
  }
});
