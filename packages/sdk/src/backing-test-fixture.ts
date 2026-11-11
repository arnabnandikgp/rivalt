/** Literal wire inputs for client tests only. No financial effect or reference
 * expectation is inferred by calling the implementation being tested. */
export function backingCheckpoint(count=2n,pool=0n,requiredMask=0,bad=0n) {
  const bytes=Buffer.alloc(104);bytes.write('RVBACK01');
  bytes.writeBigUInt64LE(count,8);bytes.writeBigUInt64LE(bad,16);
  // Client fixtures use small values; independent native coverage includes all
  // 192-bit limbs and full-domain quantities.
  bytes.writeBigUInt64LE(pool*1_000_000_000n,40);
  bytes.writeBigUInt64LE(requiredMask&1?count:0n,88);
  bytes.writeBigUInt64LE(requiredMask&2?count:0n,96);
  return bytes;
}
