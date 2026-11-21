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
  const [prepared]=await sdk.deriveSettlementWorkspace(setup.venue,'prepared');
  const header=sdk.getPreparedSettlementDecoder().decode((await h.read(prepared))!);
  assert.equal(header.count,BigInt(members.length));
  for(let index=0;index<Math.ceil(members.length/8);index++) {
    const [key]=await sdk.deriveFrozenMarginPage(setup.venue,BigInt(index));
    const page=sdk.getOriginalBudgetPageDecoder().decode((await h.read(key))!);
    assert.deepEqual(page.rows.slice(0,page.rowCount).map(row=>row.recoveryPayout.claimDelta.map(String)),expected.deltas.slice(index*8,index*8+page.rowCount));
  }
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
