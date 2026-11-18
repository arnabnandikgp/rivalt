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

function arithmeticAccesses(bytes: Buffer): Access[] {
  assert.equal(bytes[0],1);assert.equal(bytes[2]&2,0);
  const width=bytes.readBigUInt64LE(8),left=bytes.readUInt32LE(16),right=bytes.readUInt32LE(20),out=bytes.readUInt32LE(24);
  const position=bytes.readBigUInt64LE(32),column=BigInt(bytes[3]);
  if(bytes[2]&1)return [{register:out,word:position,writable:true}];
  if(bytes[1]===3)return [{register:left,word:width-position-1n,writable:false},{register:out,word:width-position-1n,writable:true}];
  if(bytes[1]===2){const accesses:Access[]=[{register:left,word:position,writable:false}];
    if(position+column<width)accesses.push({register:out,word:position+column,writable:true});return accesses;}
  assert([0,1].includes(bytes[1]));return [{register:left,word:position,writable:false},{register:right,word:position,writable:false},{register:out,word:position,writable:true}];
}
function normalizedAccesses(bytes: Buffer): Access[] {
  assert.equal(bytes[0],1);const inner=bytes.subarray(64,192);
  if(bytes[1]===1)return [{register:inner.readUInt32LE(24),word:bytes.readBigUInt64LE(32)-1n,writable:false}];
  assert.equal(bytes[1],0);
  const inputs=[{register:inner.readUInt32LE(16),used:bytes.readBigUInt64LE(16)},
    {register:inner.readUInt32LE(20),used:bytes.readBigUInt64LE(24)}];
  return arithmeticAccesses(inner).filter(access=>access.writable||!inputs.some(input=>input.register===access.register&&access.word>=input.used));
}
function comparisonAccesses(bytes: Buffer): Access[] {
  assert.equal(bytes[0],1);assert.equal(bytes[1],0);const word=bytes.readBigUInt64LE(24)-1n;
  return [16,20].map(offset=>({register:bytes.readUInt32LE(offset),word,writable:false}));
}
function atomAccesses(bytes: Buffer): Access[] {
  assert.equal(bytes[0],1);
  if(bytes[4])return normalizedAccesses(bytes.subarray(136,328));
  if(bytes[5])return comparisonAccesses(bytes.subarray(328,368));
  if(bytes[1]!==1)return [];
  const width=bytes.readBigUInt64LE(40),position=bytes[2];assert(position<5);
  const offset=position<2?32:16;
  const word=[width-1n,width-2n,width,width-1n,width-2n][position];
  return word>=0n&&word<bytes.readBigUInt64LE(offset+8)?[{register:bytes.readUInt32LE(offset),word,writable:false}]:[];
}
export function ratePages(encoded: Uint8Array | readonly number[]): LimbRequest[] {
  const bytes=Buffer.from(encoded);assert.equal(bytes.length,960);assert.equal(bytes[0],1);
  const pending=bytes.subarray(544,928);
  const accesses=bytes[7]===1?normalizedAccesses(pending.subarray(0,192)):
    bytes[7]===2?comparisonAccesses(pending.subarray(0,40)):bytes[7]===3?atomAccesses(pending):undefined;
  assert(accesses,'rate cursor must be pending');
  const pages:LimbRequest[]=[];
  for(const access of accesses){assert(access.word>=0n);const index=access.word/256n;
    const prior=pages.find(page=>page.register===access.register&&page.index===index);
    if(prior)prior.writable ||= access.writable;else pages.push({register:access.register,index,writable:access.writable});}
  return pages.sort((left,right)=>left.register-right.register||(left.index<right.index?-1:left.index===right.index?0:1));
}
