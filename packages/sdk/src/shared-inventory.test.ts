import {expect,it} from 'vitest';
import {PARTIAL_INVENTORY_ARTIFACT_SET,SHARED_INVENTORY_ARTIFACT_SET} from './account-deployment.js';
import {sharedInventoryReceipt} from './frozen-pair.js';

function receipt(marker:string,charge:bigint,fillPrice:bigint) {
  const bytes=new Uint8Array(128);
  bytes.set(new TextEncoder().encode(marker));
  const fields=[1n,6n,7n,1n,2n,charge,12n,1n,20_006n,fillPrice,40_012n];
  const view=new DataView(bytes.buffer);
  fields.forEach((word,index)=>view.setBigUint64(8+8*index,word,true));
  return {epoch:1n,stage:2,state:{membership:bytes}};
}

it('binds empty forced fills to the pinned partial-inventory receipt and zero price',()=>{
  const empty=receipt('RVLOTS02',0n,0n);
  expect(sharedInventoryReceipt(empty,PARTIAL_INVENTORY_ARTIFACT_SET)?.prices).toEqual([0n,40_012n]);
  expect(()=>sharedInventoryReceipt(empty,SHARED_INVENTORY_ARTIFACT_SET)).toThrow();
  expect(()=>sharedInventoryReceipt(receipt('RVLOTS02',0n,40_000n))).toThrow();
  expect(()=>sharedInventoryReceipt(receipt('RVLOTS02',1n,0n))).toThrow();
  expect(()=>sharedInventoryReceipt(receipt('RVLOTS01',0n,0n))).toThrow();
  expect(sharedInventoryReceipt(receipt('RVLOTS01',1n,40_001n),SHARED_INVENTORY_ARTIFACT_SET)?.charges).toEqual([1n,12n]);
});
