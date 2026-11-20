// Check every quantity directly against the surviving entry, paid gain and frozen mark.
import assert from 'node:assert/strict';
import type {Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {scanMetas} from './membership-scan-helper.js';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';

const scale=1_000_000_000n;
const minimum=(left:bigint,right:bigint)=>left<right?left:right;
type Setup=Awaited<ReturnType<typeof liquidityExecutionSetup>>;
export async function verifyPartitionedInputs(h:CanonicalHarness,setup:Setup,members:Address[],budgets:bigint[][],completionStage:4|20=4,withBudgets=false) {
  const before=sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const epoch=before.epoch;
  const [prepared]=await sdk.deriveSettlementWorkspace(setup.venue,'prepared');
  const common={...setup.safetyCommon,prepared,epoch};
  const header=async()=>sdk.getPreparedSettlementDecoder().decode((await h.read(prepared))!);
  await h.send('initialize complete frozen membership',[sdk.getInitializePreparedSettlementInstruction({...common,sourceRevision:before.revision})]);
  const pages=await Promise.all(Array.from({length:Math.ceil(members.length/8)},(_,index)=>sdk.deriveFrozenMarginPage(setup.venue,BigInt(index))));
  for(const [index,[page]] of pages.entries()) {
    await h.send('initialize partitioned frozen page',[sdk.getInitializeFrozenMarginPageInstruction({...common,page,pageIndex:BigInt(index)})]);
  }
  let next=0;
  for(let current=await header();current.stage===1;current=await header()) {
    const request=sdk.membershipRequest(current.state.membership,current.count);
    const metas=await scanMetas(h,setup.venue,request);
    if(request.kind==='member') {
      assert.equal(request.ordinal,BigInt(next));assert.equal(metas[1].address,members[next]);
      const args={...common,revision:current.revision,members:metas[0].address,margin:metas[1].address};
      const page=pages[Math.floor(next/8)][0];
      if(next===8) {
        const previous=pages[0][0];
        const snapshot=await Promise.all([previous,page,prepared].map(h.read));
        await h.send('reject prior page at boundary',[sdk.getValuePreparedMemberInstruction({...args,page:previous})],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await Promise.all([previous,page,prepared].map(h.read)),snapshot);
      }
      await h.send('freeze member charge terms',[sdk.getValuePreparedMemberInstruction({...args,page})]);
      next++;
    } else {
      assert(request.kind==='node'||request.kind==='page');
      await h.send('advance complete frozen membership',[sdk.getAdvancePreparedMembershipInstruction({...common,revision:current.revision,index:metas[0].address})]);
    }
  }
  assert.equal(next,members.length);assert.equal((await header()).stage,completionStage);
  const decoder=withBudgets?sdk.getOriginalBudgetPageDecoder():sdk.getPartitionedRecoveryPageDecoder();
  const rows=[];
  let comparisons=0;
  for(const [index,[page,bump]] of pages.entries()) {
    const bytes=(await h.read(page))!;assert.equal(bytes.length,decoder.fixedSize);
    const value=decoder.decode(bytes);
    assert.deepEqual([value.venue,value.epoch,value.pageIndex,value.bump,value.rowCount],
      [setup.venue,epoch,BigInt(index),bump,Math.min(members.length-index*8,8)]);
    for(const [offset,row] of value.rows.slice(0,value.rowCount).entries()) {
      const key=members[index*8+offset];assert.equal(row.member,key);
      const {root,positions}=sdk.decodeProfitAttribution((await h.read(key))!,true);
      assert.deepEqual([row.id,row.cash,row.originalRevision,row.activationGeneration],
        [root.id,root.cash,root.revision,root.activationGeneration]);
      for(const [market,position] of positions.entries()) {
        const current=root.positions[market],lots=current.lots,mark=before.prices[market];
        const quantity=lots<0n?-lots:lots;
        assert.equal(row.lots[market],lots);
        const claim=lots*(mark*scale-before.funding[market]+current.fundingCheckpointScaled)+current.virtualScaled;
        assert.equal(row.claims[market],claim);
        const [numerator,denominator]=row.recoveryLotRates[market];
        assert(denominator>0n);
        const unit=position.denominator*scale;
        const profit=(lots<0n?-1n:1n)*(mark*unit-position.entryScaled);
        const room=lots<0n?1_000_000n-mark:mark-1n;
        const perLot=claim>0n && quantity>0n && profit>position.paidScaled
          ?minimum(minimum(profit/unit,room)*unit,profit-position.paidScaled):0n;
        if(perLot===0n)assert.deepEqual([numerator,denominator],[0n,1n]);
        for(let count=1n;count<=quantity;count++) {
          assert.equal(count*numerator/denominator,count*perLot/unit);
          comparisons++;
        }
      }
      rows.push(row);
    }
  }
  // The Python Fraction settlement supplies each debtor's written-off atoms.
  // Reconstruct every radix independently of the native edge iterator.
  let schedules=1n;
  const edgesByMarket=[0,0];
  for(const market of [0,1])for(const [index,debtor] of rows.entries())for(const winner of rows) {
    if(debtor.lots[market]*winner.lots[market]>=0n||winner.claims[market]<=0n)continue;
    const magnitude=(value:bigint)=>value<0n?-value:value;
    const available=minimum(magnitude(debtor.lots[market]),magnitude(winner.lots[market]));
    const [num,den]=winner.recoveryLotRates[market];
    const maximum=minimum(budgets[index][market],minimum(winner.claims[market]/scale,available*num/den));
    if(maximum>0n){edgesByMarket[market]++;schedules*=maximum+1n;}
  }
  assert.deepEqual(sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!),before);
  return {pages:pages.length,pageBytes:decoder.fixedSize,comparisons,edgesByMarket,schedules:schedules.toString()};
}
