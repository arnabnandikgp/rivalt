/** Native descriptor transport only. No native result authorizes money: the
 * landed program derives and authenticates every page and revision again. */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {readAccountResolution} from './account-worker-state.js';

export type SettlementPageRequest={register:number;index:bigint;writable:boolean};
export type SettlementPageOperation='denominator'|'rate'|'plan'|'plan-row'|'application';
type Continuation=Awaited<ReturnType<typeof readAccountResolution>>;
export class SettlementPages {
  private readonly binary:string;
  constructor(directory=resolve('.local/settlement-helper')) {
    const manifest=JSON.parse(readFileSync(resolve(directory,'manifest.json'),'utf8'));
    assert(manifest.version===1&&manifest.accountSchema===10&&manifest.programProfile===6
      &&manifest.binary==='rivalt-settlement-pages'&&/^[0-9a-f]{40}$/.test(manifest.revision)
      &&/^[0-9a-f]{64}$/.test(manifest.sha256),'Unsupported settlement helper manifest');
    this.binary=resolve(directory,manifest.binary);
    const bytes=readFileSync(this.binary);
    assert(bytes.length===manifest.bytes&&createHash('sha256').update(bytes).digest('hex')===manifest.sha256,'Settlement helper binary mismatch');
  }
  async requests(state:Continuation,operation:SettlementPageOperation,ordinal?:bigint):Promise<SettlementPageRequest[]> {
    assert((operation==='plan-row')===(ordinal!==undefined),'Wrong row descriptor request');
    const input=JSON.stringify({version:1,operation,prepared:state.raw[3].toString('hex'),
      rates:state.raw[4].toString('hex'),plan:state.raw[5].toString('hex'),ordinal:ordinal?.toString()??null});
    assert(Buffer.byteLength(input)<=32*1024,'Oversized descriptor input');
    const output=await new Promise<string>((accept,reject)=>{
      const child=execFile(this.binary,[],{encoding:'utf8',timeout:5000,maxBuffer:16*1024},(error,stdout)=>error?reject(error):accept(stdout));
      child.stdin!.on('error',reject);child.stdin!.end(input);
    });
    return decodeSettlementPages(output);
  }
}
export function decodeSettlementPages(output:string):SettlementPageRequest[] {
  const response=JSON.parse(output);
  assert(response.version===1&&response.schema===10&&Array.isArray(response.pages)&&response.pages.length<=3,'Invalid descriptor response');
  const pages=response.pages.map((page:any)=>{
    assert(Number.isSafeInteger(page.register)&&page.register>=0&&page.register<=70&&typeof page.writable==='boolean'
      &&typeof page.index==='string'&&/^(0|[1-9][0-9]*)$/.test(page.index),'Invalid descriptor page');
    const index=BigInt(page.index);assert(index<2n**64n,'Page index overflow');
    return {register:page.register,index,writable:page.writable};
  });
  for(let index=1;index<pages.length;index++)assert(pages[index-1].register<pages[index].register
    ||pages[index-1].register===pages[index].register&&pages[index-1].index<pages[index].index,'Duplicate or unordered descriptor pages');
  return pages;
}
