import {expect,it} from 'vitest';
import {getPreparedSettlementDecoder} from './generated/index.js';
import {boundRecoveryReceipt,pagedRecoveryHeader} from './recovery-receipt.js';

it('reads signed payments separately from claim adjustments and rejects a mixed freeze',()=>{
  const decoder=getPreparedSettlementDecoder();
  const header={...decoder.decode(new Uint8Array(decoder.fixedSize)),epoch:5n,count:8n,stage:2};
  const bytes=Buffer.alloc(544);
  header.state.membership=bytes;
  expect(boundRecoveryReceipt(header)).toBeNull();
  bytes.write('RVJOINT1');
  bytes.writeBigUInt64LE(5n,8);
  bytes.fill(1,16,48);
  bytes.writeBigUInt64LE(9n,48);
  for(let index=0;index<8;index++)bytes.writeBigUInt64LE(BigInt(index+10),80+48*index);
  bytes.writeBigInt64LE(-9n,88);
  bytes.writeBigInt64LE(15n,104);
  bytes.writeBigInt64LE(-6n,112);
  bytes.writeBigUInt64LE(19n,120);
  bytes.writeBigUInt64LE(7n,464);
  bytes.writeBigUInt64LE(1n,488);
  const receipt=boundRecoveryReceipt(header)!;
  expect(receipt.memberIds).toEqual([10n,11n,12n,13n,14n,15n,16n,17n]);
  expect([receipt.claimDeltas[0],receipt.movements[0],receipt.finalCash[0]]).toEqual([[-9n,0n],[15n,-6n],19n]);
  expect([receipt.schedule,receipt.schedulesChecked]).toEqual([7n,1n<<64n]);
  expect(()=>boundRecoveryReceipt({...header,epoch:4n})).toThrow();
  bytes[543]=1;
  expect(()=>boundRecoveryReceipt(header)).toThrow();
  bytes[543]=0;
  bytes.writeBigUInt64LE(10n,128);
  expect(()=>boundRecoveryReceipt(header)).toThrow();
});

it('binds a paged header to the exact population and a fully covered rank',()=>{
  const decoder=getPreparedSettlementDecoder();
  const bytes=Buffer.alloc(544);
  const header={...decoder.decode(new Uint8Array(decoder.fixedSize)),epoch:7n,count:9n,stage:2};
  header.state.membership=bytes;
  bytes.write('RVPAGED1');bytes.writeBigUInt64LE(7n,8);bytes.fill(2,16,48);
  bytes.writeBigUInt64LE(9n,80);bytes.writeBigUInt64LE(1364n,88);bytes.writeBigUInt64LE(2548n,104);
  expect(pagedRecoveryHeader(header)).toMatchObject({memberCount:9n,schedule:1364n,schedulesChecked:2548n});
  expect(boundRecoveryReceipt(header)).toBeNull();
  expect(()=>pagedRecoveryHeader({...header,count:8n})).toThrow();
  expect(()=>pagedRecoveryHeader({...header,stage:4})).toThrow();
  bytes.writeBigUInt64LE(2548n,88);
  expect(()=>pagedRecoveryHeader(header)).toThrow();
  bytes.writeBigUInt64LE(1364n,88);bytes[120]=1;
  expect(()=>pagedRecoveryHeader(header)).toThrow();
});
