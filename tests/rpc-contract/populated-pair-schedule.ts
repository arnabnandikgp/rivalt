import assert from 'node:assert/strict';
import {AccountRole,type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';

export type PairReference = {
  orderRoot:string;
  pages:{role:0|1;index:string;entries:string[][];next:string}[];
  openings:{prefix:string;rows:{weight:string;charge:string;role:0|1|null;slot:string}[]}[];
  hashes:string[];
  minimumLots:string;
  amounts:string;
  quantities:Record<string,string>;
};
const hex=(bytes:ArrayLike<number>)=>Buffer.from(bytes).toString('hex');
const digest=(encoded:string)=>Buffer.from(encoded,'hex');

export async function verifyPopulatedPairs(
  h:CanonicalHarness,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,prepared:Address,
  frozenPages:Address[],allocations:{proof:Address;market:number}[],references:PairReference[],
) {
  const source={prepared,resolution:setup.resolution};
  const financial=[prepared,setup.resolution,...frozenPages,...allocations.map(allocation=>allocation.proof)];
  const before=await Promise.all(financial.map(address=>h.read(address)));
  const results=[];
  for(const {proof:allocation,market} of allocations) {
    const ref=references[market];
    const nonce=22n+BigInt(market);
    const [certificate]=await sdk.findOpenPairScheduleCertificatePda({payer:setup.payer,nonce});
    const read=async()=>sdk.getPairScheduleProofDecoder().decode((await h.read(certificate))!);
    await h.send('open market pair schedule',[sdk.getOpenPairScheduleInstruction({
      ...source,certificate,allocation,payer:setup.payer,nonce,orderRoot:digest(ref.orderRoot)})]);
    let state=await read();
    assert.equal(state.totalAtoms.toString(),ref.amounts);
    assert.equal(state.minimumLots.toString(),ref.minimumLots);
    assert.equal(hex(state.pairHash),ref.hashes[0]);
    const keys:[Address[],Address[]]=[[],[]];
    for(const page of ref.pages) {
      const index=BigInt(page.index),role=page.role;
      const [orderPage]=await sdk.derivePairOrderPage(certificate,role,index);
      const entries=page.entries.map(tuple=>{
        const [ordinal,memberId,lots,numerator,denominator,atoms]=tuple.map(BigInt);
        return {ordinal,memberId,lots,rate:[numerator,denominator],atoms};
      });
      const args={...source,payer:setup.payer,certificate,orderPage,role,index,entries,next:digest(page.next)};
      if(keys[0].length===0) {
        const original=await h.read(certificate);
        const wrong=entries.map((entry,i)=>i===0?{...entry,atoms:entry.atoms+1n}:entry);
        await h.send('reject altered ordered page preimage',[sdk.getAppendPairOrderInstruction({...args,entries:wrong})],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await h.read(certificate),original);
        assert.equal(await h.read(orderPage),null);
      }
      await h.send('append committed episode order',[sdk.getAppendPairOrderInstruction(args)]);
      const actual=sdk.getPairOrderPageDecoder().decode((await h.read(orderPage))!);
      assert.deepEqual(actual.rows.slice(0,actual.rowCount).map(row=>row.original),entries);
      assert.equal(actual.index,index);
      assert.equal(actual.role,role);
      keys[role].push(orderPage);
    }
    state=await read();
    assert.equal(state.stage,2);
    assert.deepEqual(state.amounts,[state.totalAtoms,state.totalAtoms]);
    const lastPage=ref.openings.length-1;
    for(let index=lastPage;index>=0;index--) {
      const {prefix,rows}=ref.openings[index];
      const accounts:Address[]=[];
      const openings=rows.map(row=>{
        const bookSlot=BigInt(row.slot);
        let lookup=0;
        if(row.role!==null) {
          const address=keys[row.role][Number(bookSlot/8n)];
          assert(address);
          if(!accounts.includes(address))accounts.push(address);
          lookup=accounts.indexOf(address);
        }
        return {weight:BigInt(row.weight),charge:BigInt(row.charge),bookSlot,lookup};
      });
      const build=(provided=prefix,values=openings)=>{
        const ix=sdk.getCheckPairMembersInstruction({...source,certificate,frozenPage:frozenPages[index],prefix:digest(provided),openings:values});
        return {...ix,accounts:[...ix.accounts,...accounts.map(address=>({address,role:AccountRole.READONLY}))]};
      };
      if(index===lastPage) {
        const prior=await h.read(certificate);
        await h.send('reject false winner hash opening',[build('00'.repeat(32))],[],sdk.CLEARING_ERROR__RESOLUTION);
        const wrong=openings.map((opening,i)=>rows[i].role===null?opening:{...opening,bookSlot:opening.bookSlot^1n});
        await h.send('reject substituted ordered holder',[build(prefix,wrong)],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await h.read(certificate),prior);
      }
      await h.send('bind original frozen members into ordered pages',[build()]);
      state=await read();
      assert.equal(hex(state.targetHash),prefix);
      assert.equal(state.membersLeft,BigInt(index*8));
    }
    let continuations=0;
    while(state.stage===3) {
      const winners=keys[0][Number(state.winnerCursor/8n)],debtors=keys[1][Number(state.debtorPage)];
      assert(winners && debtors);
      const args={...source,certificate,winners,debtors,revision:state.revision};
      if(!continuations) {
        const workspace=[certificate,winners,debtors];
        const prior=await Promise.all(workspace.map(key=>h.read(key)));
        await h.send('reject swapped pair roles',[sdk.getMatchPairPageInstruction({...args,winners:debtors,debtors:winners})],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await Promise.all(workspace.map(key=>h.read(key))),prior);
      }
      await h.send('match next ordered debtor page',[sdk.getMatchPairPageInstruction(args)]);
      state=await read();
      assert.equal(state.revision,args.revision+1n);
      assert.equal(hex(state.pairHash),ref.hashes[Number(state.pairs)]);
      if(!continuations) {
        const prior=await h.read(certificate);
        await h.send('reject repeated ordered pair continuation',[sdk.getMatchPairPageInstruction(args)],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await h.read(certificate),prior);
      }
      continuations++;
    }
    assert.equal(state.stage,4);
    assert.equal(state.pairs,BigInt(ref.hashes.length-1));
    assert.equal(state.pairedAtoms,state.totalAtoms);
    assert.equal(state.lotsLeft,0n);
    assert.deepEqual(state.floor,[0n,0n]);
    for(const key of keys.flat()) {
      const page=sdk.getPairOrderPageDecoder().decode((await h.read(key))!);
      for(const row of page.rows.slice(0,page.rowCount)) {
        assert.equal(row.atomsLeft,0n);
        assert.equal(row.lotsLeft.toString(),ref.quantities[row.original.ordinal.toString()]);
      }
    }
    const bytes=await h.read(certificate);
    await h.send('reject completed pair schedule replay',[sdk.getMatchPairPageInstruction({
      ...source,certificate,winners:keys[0][0],debtors:keys[1][0],revision:state.revision})],[],sdk.CLEARING_ERROR__RESOLUTION);
    assert.deepEqual(await h.read(certificate),bytes);
    results.push({certificate,market,pages:keys.flat().length,continuations,pairs:state.pairs.toString(),
      atoms:state.pairedAtoms.toString(),lots:state.minimumLots.toString(),digest:hex(state.pairHash)});
  }
  assert.deepEqual(await Promise.all(financial.map(key=>h.read(key))),before);
  return results;
}
