// Fresh P32 complete-cohort resolution using the unchanged financial engine.
// The independent Fraction reference proposes rates; the deployed program must
// verify every row, round, apply and reconcile before any funded exit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { AccountRole, type Address, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type { CanonicalHarness } from './canonical-maker-cases.js';
import type { liquidityExecutionSetup } from './liquidity-execution-setup.js';

export async function resolveLiquidityCohort(h: CanonicalHarness,
  setup: Awaited<ReturnType<typeof liquidityExecutionSetup>>, roots: Address[],
  reject: (label: string, instruction: Instruction, error?: number) => Promise<void>) {
  const accounts = setup.safetyCommon;
  const header = async () => sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const initial = await header();
  assert.equal(initial.stage, 2); assert.equal(initial.count, roots.length);
  const rows = await Promise.all(roots.map(async key => {
    const root = sdk.getMarginAccountDecoder().decode((await h.read(key))!);
    return { cash: root.cash, claims: root.positions.map((position, index) =>
      position.lots * initial.prices[index] * 1_000_000_000n + position.virtualScaled
        - position.lots * (initial.funding[index] - position.fundingCheckpointScaled)), key };
  }));
  const advance = (stage: number, start: number, length: number, members: Address[] = []) => {
    const instruction = sdk.getAdvanceAccountResolutionInstruction({ ...accounts,
      page: setup.pages[Math.floor(start / 2)], epoch: initial.epoch, stage, start, length });
    return { ...instruction, accounts: [...instruction.accounts!, ...members.map(address => ({
      address, role: stage === 9 ? AccountRole.WRITABLE : AccountRole.READONLY }))] };
  };
  const send = (label: string, instruction: Instruction) => h.send(`P32 safety ${label}`, [instruction]);
  await reject('complete valuation cannot omit first member', advance(2, 1, 1, [roots[1]]));
  await reject('complete valuation cannot reorder members', advance(2, 0, 2, [roots[1], roots[0]]));
  for (let start = 0; start < roots.length; start += 2) {
    await send('canonical complete valuation', advance(2, start, Math.min(2, roots.length - start), roots.slice(start, start + 2)));
  }
  assert.equal((await header()).stage, 3);
  for (let start = 0; start < roots.length; start += 2) {
    await send('exact denominator pass', advance(3, start, Math.min(2, roots.length - start)));
  }
  const finalize = () => sdk.getFinalizeAccountResolutionRatesInstruction({ ...accounts, epoch: initial.epoch });
  const proofs = [];
  let expectedInsurance: bigint[] = [];
  for (let evaluation = 0; (await header()).stage === 4; evaluation++) {
    assert(evaluation < 3);
    const current = await header(); assert.equal(current.evaluation, evaluation);
    const proof = JSON.parse(execFileSync('python3', ['tests/financial/clearing-rate-proposal.py'], {
      input: JSON.stringify({ rows, pools: initial.poolsBefore, budgets: current.budgets },
        (_, value) => typeof value === 'bigint' ? value.toString() : value), encoding: 'utf8',
    })) as { common: string; factor: string; rates: string[]; spent: string[]; fractional: boolean[] };
    proofs.push(proof);
    assert.equal(current.common.limbs.reduceRight((total, limb) => (total << 64n) + limb, 0n), BigInt(proof.common));
    const proposal = Buffer.alloc(1560);
    const encode = (value: bigint, offset: number, length: number) => {
      for (let index = 0; index < length; index++) { proposal[offset + index] = Number(value & 255n); value >>= 8n; }
      assert.equal(value, 0n);
    };
    proof.rates.forEach((rate, index) => encode(BigInt(rate), index * 768, 768));
    encode(BigInt(proof.factor), 1536, 24);
    const proposalHash = createHash('sha256').update(proposal).digest();
    for (let offset = 0; offset < proposal.length; offset += 512) {
      await send('upload untrusted exact rate proposal', sdk.getProposeAccountResolutionInstruction({ ...accounts,
        epoch: initial.epoch, evaluation, proposalHash, offset, bytes: proposal.subarray(offset, Math.min(offset + 512, proposal.length)) }));
    }
    assert.equal((await header()).stage, 5);
    await reject('rates cannot finalize before complete verification', finalize());
    await reject('rate verification remains bounded to one row', advance(5, 0, 2));
    for (let start = 0; start < roots.length; start++) await send('verify every frozen exact flow', advance(5, start, 1));
    await send('verify complete equations and insurance floors', finalize());
    if (proof.fractional.some(Boolean)) {
      assert.equal((await header()).stage, 4);
      assert.deepEqual((await header()).budgets, current.budgets.map((budget, index) => proof.fractional[index] ? BigInt(proof.spent[index]) : budget));
    } else {
      expectedInsurance = proof.spent.map(BigInt); assert.equal((await header()).stage, 6);
    }
  }
  const verified = await header(); assert.equal(verified.stage, 6);
  assert.deepEqual(verified.insuranceSpent, expectedInsurance);
  for (let start = 0; start < roots.length; start++) await send('plan all atom floors', advance(6, start, 1));
  assert.equal((await header()).stage, 7);
  const frozenRows: sdk.ResolutionRow[] = [];
  for (let index = 0; index < Math.ceil(roots.length / 2); index++) {
    const page = sdk.getResolutionPageDecoder().decode((await h.read(setup.pages[index]))!);
    frozenRows.push(...page.rows.slice(0, page.rowCount));
  }
  const wide = (limbs: readonly bigint[]) => limbs.reduceRight((total, limb) => (total << 64n) + limb, 0n);
  const denominator = wide(verified.flowDenominator.limbs);
  const orders = [0, 1].map(market => roots.map((_, index) => index).sort((left, right) => {
    const remainder = (index: number) => frozenRows[index].claimsScaled[market] > 0n
      ? wide(frozenRows[index].exactFlowNumerators[market].limbs) - frozenRows[index].roundedFlows[market] * denominator : 0n;
    const first = remainder(left), second = remainder(right);
    return first === second ? left - right : first > second ? -1 : 1;
  })) as [number[], number[]];
  await reject('remainder order cannot omit or duplicate members', sdk.getOrderAccountResolutionInstruction({ ...accounts,
    epoch: initial.epoch, orders: [Array(roots.length).fill(0), orders[1]] }));
  await send('propose complete remainder order', sdk.getOrderAccountResolutionInstruction({ ...accounts, epoch: initial.epoch, orders }));
  for (let start = 0; start < roots.length * 2; start++) {
    const member = orders[Math.floor(start / roots.length)][start % roots.length];
    await send('verify exact remainder order and stable ties', sdk.getCheckAccountResolutionOrderInstruction({ ...accounts,
      page: setup.pages[Math.floor(member / 2)], epoch: initial.epoch, start }));
  }
  for (let steps = 0; (await header()).stage === 8; steps++) {
    assert(steps < 2000, 'bounded deterministic circulation');
    await send('deterministic conserving atom circulation', sdk.getRoundAccountResolutionInstruction({ ...accounts,
      epoch: initial.epoch, start: (await header()).cursor }));
  }
  const rounded = await header(); assert.equal(rounded.stage, 9);
  const graph = sdk.getResolutionWorkDecoder().decode((await h.read(setup.work))!);
  const plannedCash = frozenRows.map((row, index) => row.cashAfter + BigInt(graph.residualCapacity[2 * (2 * roots.length + index) + 1]));
  for (let market = 0; market < 2; market++) {
    const movements = frozenRows.reduce((total, row, index) => total
      + (row.claimsScaled[market] < 0n ? -1n : row.claimsScaled[market] > 0n ? 1n : 0n)
        * (row.roundedFlows[market] + BigInt(graph.residualCapacity[2 * (market * roots.length + index) + 1])), 0n);
    assert.equal(movements, initial.poolsBefore[market] + verified.insuranceSpent[market]);
  }
  await reject('reconciliation cannot precede row application', advance(10, 0, 1, [roots[0]]));
  await send('apply first atom ownership row', advance(9, 0, 1, [roots[0]]));
  await reject('applied row cannot replay', advance(9, 0, 1, [roots[0]]));
  for (let start = 1; start < roots.length;) {
    const length = start % 2 === 1 ? 1 : Math.min(2, roots.length - start);
    await send('apply every remaining canonical row', advance(9, start, length, roots.slice(start, start + length)));
    start += length;
  }
  assert.equal((await header()).stage, 10);
  for (const [index, key] of roots.entries()) {
    const root = sdk.getMarginAccountDecoder().decode((await h.read(key))!);
    assert.equal(root.cash, plannedCash[index]);
    assert(root.positions.every(position => position.lots === 0n && position.virtualScaled === 0n));
    assert(root.book.orders.every(entry => entry.order.state === 0));
    assert.equal(root.reserved, 0n); assert.equal(root.delegateExpirySlot, 0n);
  }
  for (let start = 0; start < roots.length; start += 2) {
    await send('complete applied-account reconciliation', advance(10, start, Math.min(2, roots.length - start), roots.slice(start, start + 2)));
  }
  assert.equal((await header()).stage, 11);
  assert.equal(sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!).mode, 3);
  return { initial, verified, rounded, plannedCash, proofs, graph, frozenInputs: rows };
}
