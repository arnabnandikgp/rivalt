import {describe, expect, it} from 'vitest';
import {address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {foreignCreditorProposal, type FrozenMember} from './foreign-creditor-proposal.js';

describe('foreign creditor recovery proposal',()=>{
  it('binds four non-adjacent roles to sorted pages and rejects additional obligations',async()=>{
    const venue=address('11111111111111111111111111111111');
    const header=sdk.getPreparedSettlementDecoder().decode(new Uint8Array(sdk.getPreparedSettlementDecoder().fixedSize));
    header.count=32n;
    header.insurance=[6n,3n];
    const decoder=sdk.getFrozenMarginPageDecoder();
    const pages=await Promise.all([0n,1n,2n,3n].map(async index=>(await sdk.deriveFrozenMarginPage(venue,index))[0]));
    const members:FrozenMember[]=Array.from({length:32},(_,index)=>({
      row:decoder.decode(new Uint8Array(decoder.fixedSize)).rows[0],
      ordinal:BigInt(index),page:pages[Math.floor(index/8)],
    }));
    const scale=1_000_000_000n;
    for(const [ordinal,cash,btc,eth,btcLots,ethLots] of [
      [25,19987,-20002,0,1,0], [8,1000000,5004,0,0,0],
      [23,19976,14998,-35004,-1,2], [7,1000000,0,35004,0,-2],
    ]) {
      Object.assign(members[ordinal].row,{cash:BigInt(cash),claims:[BigInt(btc)*scale,BigInt(eth)*scale],
        lots:[BigInt(btcLots),BigInt(ethLots)]});
    }
    const proposal=foreignCreditorProposal(header,members);
    expect(proposal?.ordinals).toEqual([25n,8n,23n,7n]);
    expect(proposal?.charges).toEqual([9n,33n]);
    expect([proposal?.firstPage,proposal?.secondPage,proposal?.thirdPage,proposal?.fourthPage]).toEqual(pages);
    members[31].row.claims[1]=1n;
    expect(foreignCreditorProposal(header,members)).toBeNull();
  });
});
