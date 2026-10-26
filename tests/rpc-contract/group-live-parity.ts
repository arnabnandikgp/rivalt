import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import * as sdk from '@rivalt/sdk';

const idl=JSON.parse(readFileSync('packages/sdk/idl/clearing.json','utf8'));
const schemas: {name:string;discriminator:number[]}[]=idl.events.filter((event:{name:string})=>event.name.endsWith('V2'));
const canonical=(value:unknown):unknown=>{
  if(typeof value==='bigint')return value.toString();
  if(value instanceof Uint8Array)return [...value];
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object'){
    if('__option' in value){
      if(value.__option==='None')return null;
      assert(value.__option==='Some' && 'value' in value);return canonical(value.value);
    }
    return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='discriminator').map(([key,item])=>[key,canonical(item)]));
  }
  return value;
};
export function decodeGroupEvent(bytes:Buffer) {
  const schema=schemas.find(entry=>bytes.subarray(0,8).equals(Buffer.from(entry.discriminator)));
  if(!schema)return null;
  const parser=(sdk as unknown as Record<string,(data:Buffer)=>unknown>)[`parse${schema.name}Event`];
  assert(parser,`missing event parser ${schema.name}`);
  return {name:schema.name,data:parser(bytes)};
}
export function groupLiveParity(directory:string,accounts:{name:string;bytes:string}[],events:string[]) {
  const input={accounts:accounts.map(entry=>({...entry,program:'clearing'})),events:events.map(bytes=>({program:'clearing',bytes}))};
  const path=`${directory}/legacy-input.json`;writeFileSync(path,JSON.stringify(input));
  const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/group-trading.cjs',path],{encoding:'utf8',maxBuffer:32*1024*1024}));
  for(const [index,entry] of accounts.entries()) {
    const name=entry.name[0].toUpperCase()+entry.name.slice(1);
    const decoder=(sdk as unknown as Record<string,()=>{decode(data:Buffer):unknown}>)[`get${name}Decoder`]();
    assert.deepEqual(legacy.accounts[index],canonical(decoder.decode(Buffer.from(entry.bytes,'base64'))),entry.name);
  }
  const names=new Set<string>();
  for(const [index,bytes] of events.entries()) {
    const event=decodeGroupEvent(Buffer.from(bytes,'base64'));assert(event);names.add(event.name);
    assert.deepEqual(legacy.events[index]?.data,canonical(event.data),`${event.name} #${index}`);
  }
  return {accounts:accounts.length,events:events.length,eventTypes:[...names]};
}
