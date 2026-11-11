// Test-operator transport for checkpoint format 1. The program independently
// derives this plan; wrong client bytes/privileges cannot authorize progress.
import assert from 'node:assert/strict';
export type LimbRequest={register:number;index:bigint;writable:boolean};
type Access={register:number;word:bigint;writable:boolean};
export function denominatorPages(encoded: Uint8Array | readonly number[]): LimbRequest[] {
  const bytes=Buffer.from(encoded);assert.equal(bytes.length,320);assert.equal(bytes[0],1);
  let accesses:Access[];
  if(bytes[1]===0)accesses=[{register:0,word:0n,writable:true}];
  else {
    assert.equal(bytes[1],2);const lcm=bytes.subarray(48,272);assert.equal(lcm[0],1);
    const stage=lcm[1],input=lcm.readUInt32LE(8),scratch=lcm.readUInt32LE(12),output=lcm.readUInt32LE(16);
    const used=lcm.readBigUInt64LE(24),scanned=lcm.readBigUInt64LE(56);
    if(stage===2)accesses=[{register:scratch,word:scanned,writable:true}];
    else if(stage===4)accesses=[{register:output,word:scanned-1n,writable:false}];
    else {
      assert([0,1,3].includes(stage));const work=lcm.subarray(80,208);assert.equal(work[0],1);
      const width=work.readBigUInt64LE(8),left=work.readUInt32LE(16),right=work.readUInt32LE(20),out=work.readUInt32LE(24);
      const position=work.readBigUInt64LE(32),column=BigInt(work[3]);assert.equal(work[2]&2,0);
      if(work[2]&1)accesses=[{register:out,word:position,writable:true}];
      else if(work[1]===3)accesses=[{register:left,word:width-position-1n,writable:false},{register:out,word:width-position-1n,writable:true}];
      else if(work[1]===2){accesses=[{register:left,word:position,writable:false}];if(position+column<width)accesses.push({register:out,word:position+column,writable:true});}
      else {assert([0,1].includes(work[1]));accesses=[{register:left,word:position,writable:false},{register:right,word:position,writable:false},{register:out,word:position,writable:true}];}
      if(stage===0&&scanned===0n)accesses.unshift({register:input,word:used-1n,writable:false});
    }
  }
  const pages:LimbRequest[]=[];
  for(const item of accesses){assert(item.word>=0n);const index=item.word/256n,prior=pages.find(page=>page.register===item.register&&page.index===index);
    if(prior)prior.writable ||= item.writable;else pages.push({register:item.register,index,writable:item.writable});}
  return pages.sort((left,right)=>left.register-right.register||(left.index<right.index?-1:left.index===right.index?0:1));
}
