import {describe, expect, it} from 'vitest';
import {address, getBase58Decoder, type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {decodeGroup, type GroupEvent} from './group-events.js';
import {emptyGroup, projectGroup, reconcileGroupLedger, type GroupState} from './group-projection.js';
import {json, PROGRAM} from './events.js';

const zero = address('11111111111111111111111111111111'), group = PROGRAM, domain = '00'.repeat(32);
const clean = (value: unknown) => {const {discriminator,bump,vaultBump,...fields} = JSON.parse(json(value)); return fields;};
const blank = (decoder: {fixedSize:number; decode(bytes:Uint8Array):unknown}) => clean(decoder.decode(new Uint8Array(decoder.fixedSize)));
function state(): GroupState {
  const value = emptyGroup();
  value.group = {...blank(sdk.getClearingGroupV2Decoder()), schemaVersion:2, profileVersion:2, domain,
    mode:2, markets:['btc','eth'], marketCount:2, totalCash:'200', allocatedVault:'200'} as any;
  for (const [index,key] of ['btc','eth'].entries()) value.markets[key] = {...blank(sdk.getGroupMarketV2Decoder()), schemaVersion:2, group, index} as any;
  value.members = ['first','second'];
  for (const [id,key] of value.members.entries()) value.roots[key] = {...blank(sdk.getMarginAccountV2Decoder()), schemaVersion:2, group,
    id, mode:0, isolatedMarketIndex:255, subaccountIndex:0, cash:'100', delegateEpoch:'1'} as any;
  return value;
}
const event = (type: GroupEvent['type'], data: any): GroupEvent => ({type, data:{group,sequence:'1',slot:'10',...data},
  signature:'signed', outer:0, inner:0, ordinal:0, slot:10, blockTime:10, bytes:'test-vector'});
const init = sdk.getGroupCustodyChangedV2EventEncoder().encode({schemaVersion:2,profileVersion:2,domain:new Uint8Array(32),group,
  sequence:1n,slot:10n,kind:0,actor:zero,subject:group,index:0,amount:0n,members:[],authority:zero,quoteMint:zero,vault:zero,
  markets:[zero,zero],marketCount:0,mode:0,paused:false,termsEpoch:1n,configEpoch:1n,totalCash:0n,settlement:0n,insurance:0n,fees:0n,allocatedVault:0n,actualVault:0n});
const transaction = (payload: ReadonlyUint8Array = init) => ({slot:10,blockTime:10,
  transaction:{signatures:['signed'],message:{accountKeys:[PROGRAM,zero]}},meta:{err:null,innerInstructions:[{index:0,
    instructions:[{programIdIndex:0,accounts:[1],data:getBase58Decoder().decode(Buffer.concat([Buffer.from('e445a52e51cb9a1d','hex'),Buffer.from(payload)]))}]}]}});

describe('authenticated schema-2 event stream', () => {
  it('binds the producer, authority, group and exact event schema', () => {
    const tx = transaction();
    expect(decodeGroup('signed',tx,zero,group)).toHaveLength(1);
    expect(decodeGroup('signed',tx,zero,zero)).toEqual([]);
    expect(() => decodeGroup('signed',tx,group,group)).toThrow(/authority/);
    expect(() => decodeGroup('other',tx,zero,group)).toThrow(/identity/);
    expect(() => decodeGroup('signed',{...tx,slot:11},zero,group)).toThrow(/slot/);
    expect(decodeGroup('signed',{...tx,meta:{...tx.meta,err:{InstructionError:[1,'Custom']}}},zero,group)).toEqual([]);
  });
  it('rejects unknown versions, truncation and trailing bytes', () => {
    const unknown = Buffer.from(init); unknown[0] ^= 1;
    expect(() => decodeGroup('signed',transaction(unknown),zero,group)).toThrow(/schema/);
    const old = Buffer.from(init); old.writeUInt16LE(1,8);
    expect(() => decodeGroup('signed',transaction(old),zero,group)).toThrow(/version/);
    expect(() => decodeGroup('signed',transaction(init.slice(0,-1)),zero,group)).toThrow();
    expect(() => decodeGroup('signed',transaction(Buffer.concat([Buffer.from(init),Buffer.from([0])])),zero,group)).toThrow(/Trailing/);
  });
});

describe('whole-group projection invariants', () => {
  it('counts shared root cash once and retains opposite sub-atom claims', () => {
    const current = state();
    current.roots.first.positions[0].virtualScaled = '300000001';
    current.roots.first.positions[1].virtualScaled = '-200000002';
    current.roots.second.positions[0].virtualScaled = '-300000001';
    current.roots.second.positions[1].virtualScaled = '200000002';
    expect(() => reconcileGroupLedger(current)).not.toThrow();
    current.group!.totalCash = current.group!.allocatedVault = '400';
    expect(() => reconcileGroupLedger(current)).toThrow(/root cash/);
  });
  it('detects a single lost fractional claim', () => {
    const current = state(); current.roots.first.positions[1].virtualScaled = '1';
    expect(() => reconcileGroupLedger(current)).toThrow(/claims/);
  });
  it('rejects foreign isolated exposure and leaked cached reserves', () => {
    const current = state(); current.roots.first.mode = 1; current.roots.first.isolatedMarketIndex = 0;
    current.roots.first.positions[1].generation = '1';
    expect(() => reconcileGroupLedger(current)).toThrow(/foreign isolated/);
    current.roots.first.positions[1].generation = '0'; current.roots.first.reserved = '1';
    expect(() => reconcileGroupLedger(current)).toThrow(/order sum/);
  });
  it('uses one global sequence for interleaved market observations', () => {
    const current = state();
    projectGroup(current,event('group-oracle',{market:'btc',state:{...current.markets.btc,observationSequence:'1'}}),group,domain);
    projectGroup(current,event('group-oracle',{sequence:'2',market:'eth',state:{...current.markets.eth,observationSequence:'1'}}),group,domain);
    expect(current.sequence).toBe('2');
    expect(current.markets.btc.observationSequence).toBe('1'); expect(current.markets.eth.observationSequence).toBe('1');
    expect(() => projectGroup(current,event('group-oracle',{sequence:'4',market:'btc',state:current.markets.btc}),group,domain)).toThrow(/sequence/);
  });
  it('cannot mutate an immutable owner or an earlier canonical event', () => {
    const current = state();
    const change = event('margin-authority',{margin:'first',state:{...current.roots.first,delegateEpoch:'2'}}), original = json(change);
    projectGroup(current,change,group,domain);
    current.roots.first.book.lastOrderId = '99';
    expect(json(change)).toBe(original);
    expect(() => projectGroup(current,event('margin-authority',{sequence:'2',margin:'first',state:{...current.roots.first,owner:PROGRAM}}),group,domain)).toThrow(/immutable root owner/);
  });
});
