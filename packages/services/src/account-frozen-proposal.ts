import assert from 'node:assert/strict';
import {type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {Rpc} from '../../indexer/src/rpc.js';
import {decodeAccountWorker,readAccountResolution} from './account-worker-state.js';
import {proposeAccountRates,type AccountRateInputs} from './account-rate-proposal.js';

/** Bounded page reads with a final exact-header fence. Frozen rows are immutable
 * until Apply, which is excluded here. A mixed revision/epoch never supplies a
 * rate proposal. The program independently checks every uploaded limb/row. */
export async function readAccountRateProposal(rpc:Pick<Rpc,'call'>,venue:Address,epoch:bigint,expectedProfile:5=5) {
  assert(expectedProfile===5,'Unsupported frozen proposal profile.');
  const before=await readAccountResolution(rpc,venue),header=before.preparedState;
  assert(before.header.epoch===epoch&&before.header.stage===2&&header.epoch===epoch&&header.stage===3&&header.count>0n
    &&header.count===before.header.count&&header.membershipEpoch===before.header.membershipEpoch,'No complete frozen cohort awaiting proposal.');
  const venueRaw=await rpc.call('getAccountInfo',[venue,{encoding:'base64',commitment:'confirmed',minContextSlot:Number(before.contextSlot)}]);
  const venueState=decodeAccountWorker(venueRaw.value,sdk.VENUE_DISCRIMINATOR,sdk.getVenueDecoder());
  const [canonical,bump]=await sdk.deriveAccountVenue(Uint8Array.from(venueState.domain));
  assert(canonical===venue&&venueState.bump===bump&&venueState.schemaVersion===9&&venueState.profileVersion===expectedProfile
    &&venueState.marketCount===2&&venueState.insuranceFeeShareBps===2500,'Foreign proposal venue/profile.');
  const pageCount=(header.count+7n)/8n,rows:sdk.FrozenMargin[]=[],pages:Address[]=[];
  for(let start=0n;start<pageCount;start+=8n) {
    const keys=await Promise.all(Array.from({length:Number(pageCount-start<8n?pageCount-start:8n)},(_,offset)=>sdk.deriveFrozenMarginPage(venue,start+BigInt(offset))));
    const response=await rpc.call('getMultipleAccounts',[keys.map(([key])=>key),{encoding:'base64',commitment:'confirmed',minContextSlot:Number(before.contextSlot)}]);
    assert(response.value?.length===keys.length,'Incomplete frozen page batch.');
    for(const [offset,[key,pageBump]] of keys.entries()) {
      const index=start+BigInt(offset),page=decodeAccountWorker(response.value[offset],sdk.FROZEN_MARGIN_PAGE_DISCRIMINATOR,sdk.getFrozenMarginPageDecoder());
      const length=Number(header.count-index*8n<8n?header.count-index*8n:8n);
      assert(page.schemaVersion===9&&page.venue===venue&&page.bump===pageBump&&page.epoch===epoch&&page.pageIndex===index
        &&page.rowCount===length&&page.revision>0n,'Incomplete or foreign frozen page.');
      for(const row of page.rows.slice(0,length)) {
        assert(row.activationGeneration>0n&&row.originalRevision>0n
          &&row.member!=='11111111111111111111111111111111'&&(!rows.length||rows.at(-1)!.id<row.id),'Wrong frozen member/order/application state.');
        const debts=row.claims.reduce((total,value)=>total+(value<0n?-value:0n),0n)/1_000_000_000n;
        assert(row.collected===(row.cash<debts?row.cash:debts),'Frozen collection mismatch.');rows.push(row);
      }
      pages.push(key);
    }
  }
  assert(new Set(rows.map(row=>row.member)).size===rows.length,'Duplicate frozen roots.');
  const insurance=Buffer.from(before.ratesState.state.insurance);
  assert(before.ratesState.epoch===epoch&&insurance.length===64&&insurance[0]===1&&insurance[2]<=3
    &&insurance.readBigUInt64LE(8)===header.insurance[0]&&insurance.readBigUInt64LE(16)===header.insurance[1],'Foreign insurance checkpoint.');
  const budgets:[bigint,bigint]=[insurance.readBigUInt64LE(24),insurance.readBigUInt64LE(32)];
  assert(budgets.every((value,index)=>value<=header.insurance[index]),'Invalid insurance budget.');
  const input:AccountRateInputs={rows:rows.map(row=>({cash:row.cash,claims:[row.claims[0],row.claims[1]]})),
    pools:[header.pools[0],header.pools[1]],budgets};
  assert(input.rows.reduce((sum,row)=>sum+row.cash,0n)===before.header.cashBefore,'Frozen cash aggregate mismatch.');
  const proposal=proposeAccountRates(input),denominator=Buffer.from(header.state.denominator);
  assert(denominator[0]===1&&denominator[1]===3,'Incomplete common denominator.');
  const register=denominator[2],used=denominator.readBigUInt64LE(24);assert(used>0n&&used<=proposal.capacity);
  const limbs:bigint[]=[];
  for(let index=0n;index<(used+255n)/256n;index++) {
    const [key,pageBump]=await sdk.deriveSettlementLimbPage(venue,register,index);
    const response=await rpc.call('getAccountInfo',[key,{encoding:'base64',commitment:'confirmed',minContextSlot:Number(before.contextSlot)}]);
    const page=decodeAccountWorker(response.value,sdk.SETTLEMENT_LIMB_PAGE_DISCRIMINATOR,sdk.getSettlementLimbPageDecoder());
    assert(page.schemaVersion===9&&page.venue===venue&&page.bump===pageBump&&page.epoch===epoch&&page.register===register&&page.pageIndex===index,'Foreign common denominator page.');
    limbs.push(...page.payload.words.slice(0,Number(used-index*256n<256n?used-index*256n:256n)));
  }
  assert(limbs.reduceRight((total,word)=>(total<<64n)+word,0n)===proposal.common,'Frozen common denominator mismatch.');
  const after=await readAccountResolution(rpc,venue);
  assert(before.raw.every((bytes:Buffer,index:number)=>bytes.equals(after.raw[index])),'Frozen proposal stage/revision changed; reread.');
  return {resolution:before.resolution,header:before.header,prepared:header,registry:before.registryState,pages,rows,proposal,
    contextSlot:after.contextSlot,input};
}
