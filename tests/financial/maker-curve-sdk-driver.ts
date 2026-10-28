// Same bounded wire vectors as the native driver, independently decoded here.
import { createInterface } from 'node:readline';
import { quoteCanonicalV4, type CanonicalRegionV4, type CanonicalShapeV4 } from '../../packages/sdk/src/canonical-quote.js';

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    const fields = line.split(' ');
    if (fields.length !== 6) throw new Error('fields');
    const bytes = Buffer.from(fields[0], 'hex');
    if (bytes.length !== 429) throw new Error('shape');
    const readRegions = (offset: number, count: number): CanonicalRegionV4[] => {
      if (count > 8) throw new Error('count');
      const regions: CanonicalRegionV4[] = [];
      for (let index = 0; index < 8; index++) {
        const position = offset + index * 24;
        const region = { endLots: bytes.readBigUInt64LE(position), offset: bytes.readBigUInt64LE(position + 8), slope: bytes.readBigUInt64LE(position + 16) };
        if (index < count) regions.push(region);
        else if (region.endLots !== 0n || region.offset !== 0n || region.slope !== 0n) throw new Error('unused');
      }
      return regions;
    };
    const shape: CanonicalShapeV4 = {
      mode: bytes[0], ttlSlots: bytes.readUInt16LE(1), target: bytes.readBigInt64LE(3),
      skewStep: bytes.readBigUInt64LE(11), skewTick: bytes.readBigUInt64LE(19),
      longCap: bytes.readBigUInt64LE(27), shortCap: bytes.readBigUInt64LE(35),
      bids: readRegions(45, bytes[43]), asks: readRegions(237, bytes[44]),
    };
    const answer = quoteCanonicalV4(shape, BigInt(fields[1]), Number(fields[2]), BigInt(fields[3]), BigInt(fields[4]), BigInt(fields[5]));
    process.stdout.write(`OK ${answer.gross} ${answer.remaining}\n`);
  } catch {
    process.stdout.write('ERR rejected\n');
  }
}
