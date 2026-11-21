import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import type {Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import type {JointReference} from './populated-joint-payment.js';
export async function checkPopulatedFlows(read:(key:Address)=>Promise<Buffer|null>,venue:Address,members:Address[],expected:JointReference) {
  const [prepared]=await sdk.deriveSettlementWorkspace(venue,'prepared');
  const header=sdk.getPreparedSettlementDecoder().decode((await read(prepared))!);
  assert.equal(header.count,BigInt(members.length));
  const flowPages=await Promise.all(Array.from({length:Math.ceil(members.length/36)},async(_,index)=>{
    const [key]=await sdk.deriveSettlementLimbPage(venue,64,BigInt(index));
    const page=sdk.getSettlementLimbPageDecoder().decode((await read(key))!);
    assert(page.venue===venue && page.epoch===header.epoch && page.register===64 && page.pageIndex===BigInt(index));
    return page;
  }));
  for(let index=0;index<Math.ceil(members.length/8);index++) {
    const [key]=await sdk.deriveFrozenMarginPage(venue,BigInt(index));
    const page=sdk.getOriginalBudgetPageDecoder().decode((await read(key))!);
    assert.equal(page.venue,venue);
    assert.equal(page.epoch,header.epoch);
    assert.equal(page.pageIndex,BigInt(index));
    assert.equal(page.rowCount,Math.min(8,members.length-index*8),'Incomplete frozen membership page');
    assert.deepEqual(page.rows.slice(0,page.rowCount).map(row=>row.recoveryPayout.claimDelta.map(String)),expected.deltas.slice(index*8,index*8+page.rowCount));
    for(const [slot,row] of page.rows.slice(0,page.rowCount).entries()) {
      const ordinal=index*8+slot,flow=flowPages[Math.floor(ordinal/36)],offset=(ordinal%36)*7;
      assert(offset+7<=flow.wordCount);
      const [id,cashBefore,btc,eth,cashAfter,,flags]=flow.payload.words.slice(offset,offset+7);
      assert.equal(id,row.id);assert.equal(row.member,members[ordinal]);assert.equal(cashBefore,row.cash);
      assert.equal(cashAfter,BigInt(expected.plan.cash[ordinal]));assert.equal(flags>>56n,1n);
      const movements=[btc,eth].map((amount,market)=>{
        const claim=row.claims[market]+row.recoveryPayout.claimDelta[market]*1_000_000_000n;
        if(claim===0n)assert.equal(amount,0n);
        return String(claim<0n?-amount:amount);
      });
      assert.deepEqual(movements,expected.plan.movements[ordinal]);
    }
  }
}

export async function populatedKeeperExit(h:CanonicalHarness,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,members:Address[],expected:JointReference) {
  const directory=process.env.RIVALT_RUN_DIR!;
  for(const mode of ['interrupt','resume']) {
    const child=spawn(process.execPath,['--import','tsx','tests/rpc-contract/populated-keeper-driver.ts',mode,setup.venue],{stdio:'inherit'});
    const [code,signal]=await new Promise<[number|null,NodeJS.Signals|null]>((resolve,reject)=>{
      child.once('error',reject);child.once('exit',(code,signal)=>resolve([code,signal]));
    });
    if(mode==='interrupt')assert.equal(signal,'SIGKILL');else assert.equal(code,0);
  }
  const {guard,root}=executionTestHelpers(h,setup);
  const positions=await Promise.all(members.map(root));
  assert.deepEqual(positions.map(account=>String(account.cash)),expected.plan.cash);
  assert(positions.every(account=>account.positions.every(position=>position.lots===0n&&position.virtualScaled===0n)));
  const source=sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  assert.deepEqual(source.insuranceSpent.map(String),expected.spent);
  await checkPopulatedFlows(key=>h.read(key),setup.venue,members,expected);
  const ordinal=positions.findIndex(account=>account.owner===setup.traderOwner.address && account.cash>0n);
  assert(ordinal>=0);
  const margin=members[ordinal],amount=positions[ordinal].cash;
  const token=async(key:Address)=>getTokenDecoder().decode((await h.read(key))!).amount;
  const before=await token(setup.traderToken.address),vault=await token(setup.vault);
  await h.send('withdraw full keeper-verified wallet payout',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
    btc:setup.markets[0],eth:setup.markets[1],owner:setup.traderOwner,margin,userToken:setup.traderToken.address,quoteMint:setup.mint.address,
    amount,guard:await guard(margin)})],[setup.traderOwner]);
  assert.equal(await token(setup.traderToken.address),before+amount);assert.equal(await token(setup.vault),vault-amount);
  assert.equal((await root(margin)).cash,0n);
  const originals=readFileSync(directory+'/populated-worker.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line));
  const interrupted=JSON.parse(readFileSync(directory+'/interrupted-intent.json','utf8'));
  assert.equal(originals.filter(row=>row.signature===interrupted.signature && row.wire===interrupted.wire).length,1);
  assert.equal(new Set(originals.map(row=>row.signature)).size,originals.length);
  const fees=originals.reduce((sum,row)=>sum+BigInt(row.fee),0n);
  assert.equal(JSON.parse(readFileSync(directory+'/populated-worker-budget.json','utf8')).spent,String(fees));
  return {applied:positions.length,spent:expected.spent,withdrawn:amount,ordinal,vaultAfter:await token(setup.vault),originals:originals.length,fees,
    restartedSignature:interrupted.signature};
}
