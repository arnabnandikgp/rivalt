import assert from 'node:assert/strict';
import type {Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';

export type WinnerReference = {
  cutoffs: string[][];
  minimumLots: string;
  initialDigest: string;
  prefixes: {digest: string; recovered: string[]; winnerLots: string}[];
};

export async function verifyWinnerAllocations(
  h:CanonicalHarness, setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>, prepared:Address,
  epoch:bigint, pages:Address[], expected:WinnerReference[],
) {
  const binding={prepared,resolution:setup.resolution};
  const read=(address:Address)=>h.read(address);
  const frozenKeys=[prepared,setup.resolution,...pages];
  const before=await Promise.all(frozenKeys.map(read));
  const readProof=async(address:Address)=>sdk.getWinnerAllocationProofDecoder().decode((await h.read(address))!);
  const completed=[];
  // A wrong but validly encoded threshold can run beside both real proposals.
  // It must fail its final comparison without holding up another keeper.
  for(const [nonce,market,wrong] of [[11n,0,true],[12n,0,false],[13n,1,false]] as const) {
    const ref=expected[market];
    const cutoffs=ref.cutoffs.map(([unit,capacity,memberId])=>({unit:BigInt(unit),capacity:BigInt(capacity),memberId:BigInt(memberId)}));
    if(wrong)cutoffs[0].unit-=1n;
    const [proof]=await sdk.findProofPda({payer:setup.payer,nonce});
    await h.send('open independent winner threshold proposal',[sdk.getOpenWinnerProofInstruction({...binding,proof,payer:setup.payer,nonce,market,epoch,cutoffs})]);
    let state=await readProof(proof);
    assert.equal(state.stage,0);
    assert.equal(Buffer.from(state.targetDigest).toString('hex'),ref.initialDigest);
    const instruction=(page:Address,revision=state.revision,opponents?:Address)=>
      sdk.getAdvanceWinnerProofInstruction({...binding,proof,page,revision,opponents});
    if(wrong) {
      const saved=await read(proof);
      // ClearingError::Source is the feature-specific recovery source code.
      await h.send('reject wrong frozen page for winner proof',[instruction(pages[1])],[],7100);
      assert.deepEqual(await read(proof),saved);
    }
    for(const [index,page] of pages.entries()) {
      await h.send('collect opposing lots for winner allocation',[instruction(page)]);
      const previous=state;
      state=await readProof(proof);
      assert.equal(state.revision,previous.revision+1n);
      const last=index===pages.length-1;
      assert.equal(state.stage,last?1:0);
      assert.equal(state.cursor,last?0n:BigInt((index+1)*8));
      if(!wrong && index===0) {
        const saved=await read(proof);
        await h.send('reject repeated inventory revision',[instruction(page,previous.revision)],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await read(proof),saved);
      }
    }
    for(const [index,page] of pages.entries()) {
      assert.equal(state.scanningOpponents,false);
      const last=index===pages.length-1;
      if(wrong && last) {
        const saved=await read(proof);
        await h.send('reject complete but inferior winner allocation',[instruction(page)],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await read(proof),saved);
        break;
      }
      await h.send(last?'certify ordered winner allocations':'check winner weights and charges',[instruction(page)]);
      state=await readProof(proof);
      assert.equal(state.stage,last?2:1);
      if(!wrong) {
        assert.equal(Buffer.from(state.targetDigest).toString('hex'),ref.prefixes[index].digest);
        assert.deepEqual(state.recovered.map(String),ref.prefixes[index].recovered);
        assert.equal(state.winnerLots.toString(),ref.prefixes[index].winnerLots);
      }
    }
    if(!wrong) {
      assert.deepEqual(state.cutoffs,cutoffs);
      assert.equal(state.minimumLots.toString(),ref.minimumLots);
      const bytes=await read(proof);
      await h.send('reject replay of certified winner allocation',[instruction(pages.at(-1)!)],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await read(proof),bytes);
      completed.push({market,proof,minimumLots:ref.minimumLots,winnerLots:state.winnerLots.toString(),
        debtorLots:state.debtorLots.toString(),winnerFloorProved:state.winnerFloorProved,digest:ref.prefixes.at(-1)!.digest});
    }
  }
  assert.deepEqual(await Promise.all(frozenKeys.map(read)),before);
  return completed;
}
