/** Full projected-state comparison with explicit fresh-deployment/time witnesses.
 * A slot/digest witness is a disclosed mismatch, never exact input equivalence. */
import assert from 'node:assert/strict';
const timeFields=new Set(['fundingTime','sampledAt','sourceDeadline','validSince','lastQualified','heldUntil',
  'lastObservedTime','observedTime','validUntilTime']);
const slotFields=new Set(['slot','validFrom','validUntil','heldSlot','lastObservedSlot','observedSlot',
  'validUntilSlot','updatedSlot','expirySlot','startSlot','delegateExpirySlot','updaterExpirySlot']);
export type InputWitness={path:string;kind:'slot'|'digest';before:string;after:string};
export function financialEquivalence(before:unknown,after:unknown,roles:ReadonlyMap<string,string>,unixOffset:bigint) {
  const witnesses:InputWitness[]=[];let comparedLeaves=0;
  function compare(left:any,right:any,path:string[],field='') {
    const label=path.join('.');
    if(Array.isArray(left)) {
      assert(Array.isArray(right)&&left.length===right.length,`${label}: array shape`);
      left.forEach((value,index)=>compare(value,right[index],[...path,String(index)],field));return;
    }
    if(left!==null&&typeof left==='object') {
      assert(right!==null&&typeof right==='object'&&!Array.isArray(right),`${label}: object shape`);
      const keys=Object.keys(left).map(key=>roles.get(key)??key);
      assert.equal(new Set(keys).size,keys.length,`${label}: alias collision`);
      assert.deepEqual(keys.sort(),Object.keys(right).sort(),`${label}: fields`);
      for(const [key,value] of Object.entries(left)) {
        const mapped=roles.get(key)??key;compare(value,right[mapped],[...path,mapped],key);
      }
      return;
    }
    comparedLeaves++;
    if(field==='schemaVersion'){assert.equal(left,7,label);assert.equal(right,8,label);return;}
    if(timeFields.has(field)&&left!=='0') {
      assert.equal(BigInt(right)-BigInt(left),unixOffset,`${label}: relative time changed`);return;
    }
    if(slotFields.has(field)&&left!==right) {
      assert(typeof left==='string'&&typeof right==='string'&&/^\d+$/.test(left)&&/^\d+$/.test(right),`${label}: slot encoding`);
      assert.equal(left==='0',right==='0',`${label}: absent/present slot changed`);
      witnesses.push({path:label,kind:'slot',before:left,after:right});return;
    }
    if(['approvedHash','inputDigest'].includes(field)&&left!==right) {
      const allowed=field==='approvedHash'?/^liquidity\.makers\.[^.]+\.approvedHash$/:/^liquidity\.reports\.[^.]+\.report\.inputDigest$/;
      assert(allowed.test(label),`${label}: undocumented digest`);
      assert(/^[a-f0-9]{64}$/.test(left)&&/^[a-f0-9]{64}$/.test(right),`${label}: digest encoding`);
      witnesses.push({path:label,kind:'digest',before:left,after:right});return;
    }
    assert.deepEqual(typeof left==='string'?(roles.get(left)??left):left,right,`${label}: financial/state mismatch`);
  }
  compare(before,after,[]);
  return {comparedLeaves,fullInputMatch:witnesses.length===0,witnesses};
}
