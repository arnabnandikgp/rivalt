import {afterEach,expect,it,vi} from 'vitest';
import {Rpc} from './rpc.js';

afterEach(()=>vi.unstubAllGlobals());
it('decodes a response at the exact configured byte budget',async()=>{
  const bytes=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:1,result:'valid'}));
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes)));
  expect(await new Rpc('http://localhost',bytes.length).call('getSlot')).toBe('valid');
});
it('cancels an over-budget streamed response without consuming its remaining chunks',async()=>{
  let reads=0,cancelled=false;
  const body=new ReadableStream({pull(controller){reads++;controller.enqueue(Buffer.alloc(8));},cancel(){cancelled=true;}},{highWaterMark:0});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(body)));
  await expect(new Rpc('http://localhost',16).call('getBlock')).rejects.toThrow('byte budget');
  expect(reads).toBe(3);expect(cancelled).toBe(true);
});
it('retains RPC envelope identity and error checks',async()=>{
  for(const body of [{id:2,result:0},{id:1,error:{code:-1}},{id:1}]){
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json(body)));
    await expect(new Rpc('http://localhost').call('getSlot')).rejects.toThrow('RPC getSlot failed');
  }
});
