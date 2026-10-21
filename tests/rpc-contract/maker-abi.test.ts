import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { getProgramDerivedAddress, getAddressEncoder, address, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { makerAddresses } from './maker-cases.js';
import { payerKey } from './custody-cases.js';
const integer = (n: bigint) => ({ $integer: n.toString() });
const pubkey = (v: string) => ({ $address: v });
const bytes = (v: Uint8Array) => ({ $bytes: Array.from(v) });
describe('P03 maker ABI and exact quote contracts', () => {
  it('matches all eleven new instruction families against isolated legacy Anchor', async () => {
    const payer = await payerKey(), a = await makerAddresses(0), b = await makerAddresses(1);
    const systemProgram = address('11111111111111111111111111111111'), domain = Uint8Array.from({length:32},(_,i)=>i+1);
    const [binding] = await getProgramDerivedAddress({ programAddress:a.program,seeds:[Buffer.from('maker-capital'),getAddressEncoder().encode(a.capital)] });
    const ro = { market:a.market,capital:a.capital,registration:a.registration,pricingProgram:a.pricingProgram,programData:a.programData,config:a.config };
    const event = { eventAuthority:a.eventAuthority,program:a.program };
    const admin = { owner:a.owner.address,authority:payer.address,...ro,...event };
    const args = { side:1,lots:10n,referencePrice:60_000n,quoteEpoch:1n,authorityEpoch:1n,termsEpoch:1n,configEpoch:3n };
    const taggedArgs = Object.fromEntries(Object.entries(args).map(([k,v])=>[k,typeof v==='bigint'?integer(v):v]));
    const modern: Instruction[] = [await sdk.getRegisterMakerInstructionAsync({...a,authority:payer,makerId:0,inventoryLimit:100_000n}),
      await sdk.getApproveMakerInstructionAsync({...a,authority:payer}), await sdk.getSyncMakerEpochInstructionAsync(a),
      await sdk.getQuarantineMakerInstructionAsync({...a,authority:payer}),await sdk.getPreviewMakerInstructionAsync({...a,...args})];
    const instructions:any[] = [
      {program:'clearing',name:'registerMaker',args:[0,integer(100_000n)],accounts:{...admin,binding,systemProgram}},
      {program:'clearing',name:'approveMaker',args:[],accounts:admin},
      {program:'clearing',name:'syncMakerEpoch',args:[],accounts:{...ro,...event}},
      {program:'clearing',name:'quarantineMaker',args:[],accounts:{authority:payer.address,market:a.market,registration:a.registration,...event}},
      {program:'clearing',name:'previewMaker',args:[taggedArgs],accounts:ro},
    ];
    for (const [id,x] of [a,b].entries()) {
      const api=id===0?sdk.makerA:sdk.makerB, program=id===0?'maker_a':'maker_b';
      const request={version:1,domain,market:x.market,capital:x.capital,quoteEpoch:1n,authorityEpoch:1n,termsEpoch:1n,marketConfigEpoch:3n,
        side:0,lots:10n,inventory:-9_007_199_254_740_993n,cash:18_446_744_073_709_551_615n,inventoryLimit:100_000n,consumed:300n,referencePrice:60_000n,slot:100n};
      const tagged={...Object.fromEntries(Object.entries(request).map(([k,v])=>[k,typeof v==='bigint'?integer(v):v])),domain:bytes(domain),market:pubkey(x.market),capital:pubkey(x.capital)};
      modern.push(await api.getInitializeConfigInstructionAsync({...x,domain,duration:3600n}),api.getPublishEpochInstruction({owner:x.owner,config:x.config,duration:64n}),api.getQuoteInstruction({config:x.config,...request}));
      instructions.push({program,name:'initializeConfig',args:[pubkey(x.market),bytes(domain),integer(3600n)],accounts:{owner:x.owner.address,capital:x.capital,config:x.config,systemProgram}},
        {program,name:'publishEpoch',args:[integer(64n)],accounts:{owner:x.owner.address,config:x.config}},
        {program,name:'quote',args:[tagged],accounts:{config:x.config}});
    }
    writeFileSync('.local/p03-abi.json',JSON.stringify({instructions}));
    const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/makers.cjs','.local/p03-abi.json'],{encoding:'utf8'}));
    modern.forEach((ix,i)=>{assert.equal(Buffer.from(ix.data!).toString('hex'),legacy.instructions[i].data);assert.deepEqual(ix.accounts!.map(x=>({address:x.address,signer:(x.role&2)!==0,writable:(x.role&1)!==0})),legacy.instructions[i].accounts);});
    assert(modern[4].accounts!.every(x=>x.role===0),'preview must request no writable or signer account');
    assert(modern[7].accounts!.every(x=>x.role===0),'maker CPI must request one read-only config');
  });
  it('matches independent per-lot prices over deterministic inventory/prefix cases', async () => {
    const a=await makerAddresses(0),domain=new Uint8Array(32).fill(1);
    let seed=0x504f335f52495641n;
    for(let i=0;i<4000;i++) {
      seed=(seed*6364136223846793005n+1n)&((1n<<64n)-1n);
      const id=Number(seed%2n),side=Number((seed>>7n)%2n),inventory=(seed>>9n)%2049n-1024n;
      const consumed=(seed>>23n)%400n,lots=1n+(seed>>31n)%100n;
      const state={version:1,makerId:id,owner:a.owner.address,market:a.market,capital:a.capital,domain,quoteEpoch:1n,startSlot:100n,expirySlot:500n,bump:255};
      const req={version:1,domain,market:a.market,capital:a.capital,quoteEpoch:1n,authorityEpoch:1n,termsEpoch:1n,marketConfigEpoch:1n,side,lots,inventory,cash:1_000_000_000n,inventoryLimit:100_000n,consumed,referencePrice:60_000n,slot:100n};
      let expected=0n;
      for(let j=consumed;j<consumed+lots;j++) {const offset=id===0?10n+j:30n+(j>256n?j-256n:0n);const center=60_000n-(id===0?inventory/64n*4n:inventory/256n);expected+=side===0?center+offset:center-offset;}
      assert.equal(sdk.quoteMaker(state,req).grossQuote,expected);
    }
  });
});
