// Resource-only fixtures: current compiled full contexts with extremal scratch.
// No Apply, payout, token movement or accepted financial history is claimed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { address, getProgramDerivedAddress, getTransactionDecoder, lamports, type Address } from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { payerKey } from './harness.js';

const capturePath = process.argv[2], output = process.argv[3];
assert(capturePath && output, 'Usage: safety-width-svm.ts <actual financial-capture.json> <new ignored output>');
mkdirSync(output, { recursive: false });
const raw = readFileSync(capturePath), capture = JSON.parse(raw.toString());
const build = JSON.parse(readFileSync(`${process.env.RIVALT_ARTIFACT_DIR??'.local/anchor-rc2/candidate'}/build-manifest.json`, 'utf8'));
assert.equal(build.trackedDirty, false);
const sbf = readFileSync(`${process.env.RIVALT_ARTIFACT_DIR??'.local/anchor-rc2/candidate'}/clearing.so`);
assert.equal(createHash('sha256').update(sbf).digest('hex'), build.binaries['clearing.so']);
const parent = new LiteSVM().withSigverify(true).withBlockhashCheck(true), payer = await payerKey();
parent.addProgramFromFile(sdk.CLEARING_PROGRAM_ADDRESS, `${process.env.RIVALT_ARTIFACT_DIR??'.local/anchor-rc2/candidate'}/clearing.so`);
parent.airdrop(payer.address, lamports(100_000_000_000n));
const fixed: Address[] = [capture.venue, capture.custody, capture.safety, capture.registry, capture.vault, ...capture.markets, ...capture.ledgers];
const keys: Address[] = [...fixed, capture.resolution, capture.work, ...capture.pages, ...capture.roots];
for (const key of keys) {
  const data = Buffer.from(capture.frozenAccounts[key], 'base64');
  parent.setAccount({ address: key, data, executable: false,
    lamports: lamports(parent.minimumBalanceForRentExemption(BigInt(data.length))), space: BigInt(data.length),
    programAddress: key === capture.vault ? TOKEN_PROGRAM_ADDRESS : sdk.CLEARING_PROGRAM_ADDRESS });
}
const original = parent.toBytes();
const [eventAuthority] = await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('__event_authority')]});
const base = { venue: address(capture.venue), custody: address(capture.custody), safety: address(capture.safety), registry: address(capture.registry),
  btc: address(capture.markets[0]), eth: address(capture.markets[1]), btcLedger: address(capture.ledgers[0]), ethLedger: address(capture.ledgers[1]),
  vault: address(capture.vault), resolution: address(capture.resolution), work: address(capture.work), page: address(capture.pages[0]),
  eventAuthority, program: sdk.CLEARING_PROGRAM_ADDRESS };
const limbs = (number: bigint, length = 96) => {
  const result = Array.from({ length }, () => { const low = number & ((1n << 64n) - 1n); number >>= 64n; return low; });
  assert.equal(number, 0n); return result;
};
const wide = (number: bigint) => ({ limbs: limbs(number) });
const value = (limbs: readonly bigint[]) => limbs.reduceRight((total, limb) => (total << 64n) + limb, 0n);
const serialize = (input: unknown) => JSON.stringify(input, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const checks: unknown[] = [];
for (const bits of [2796, 5632]) for (const mixed of [false, true]) {
  const svm = LiteSVM.fromBytes(original).withSigverify(true).withBlockhashCheck(true);
  const account = (key: Address) => { const result = svm.getAccount(key); assert(result.exists); return result; };
  const read = (key: Address) => Buffer.from(account(key).data);
  const header = sdk.getResolutionDecoder().decode(read(base.resolution));
  const work = sdk.getResolutionWorkDecoder().decode(read(base.work));
  const page = sdk.getResolutionPageDecoder().decode(read(base.page));
  const maximum = 100_300_000_000_000_000_000_000_000n, debt = 2n * maximum - 1n, cash = 1_000_000_000_000_000n;
  const common = (((1n << BigInt(bits)) - 1n) / debt) * debt, factor = (1n << 186n) - 1n;
  assert.equal(common.toString(2).length, bits);
  const rateDenominator = common * factor, denominator = 1_000_000_000n * rateDenominator;
  const claims: [bigint, bigint] = [-maximum, mixed ? maximum : -maximum + 1n];
  const clocks = svm.getClock(); clocks.unixTimestamp = header.frozenAt + 1n; clocks.slot = 100_000n; svm.setClock(clocks);
  svm.setAccount({ ...account(base.resolution), data: sdk.getResolutionEncoder().encode({ ...header, stage: 5, cursor: 0,
    common: wide(common), rateFactor: limbs(factor, 3), rateNumerators: [wide(rateDenominator), wide(rateDenominator)], flowDenominator: wide(denominator) }) });
  svm.setAccount({ ...account(base.work), data: sdk.getResolutionWorkEncoder().encode({ ...work, opcode: 5, row: 0,
    registers: work.registers.map((_, index) => wide(index === 3 ? rateDenominator : 0n)) }) });
  svm.setAccount({ ...account(base.page), data: sdk.getResolutionPageEncoder().encode({ ...page, epoch: header.epoch, rowCount: 2,
    rows: page.rows.map((row, index) => index === 0 ? { ...row, member: address(capture.roots[0]), cashBefore: cash,
      claimsScaled: claims, collected: cash, applied: false } : row) }) });
  const immutable = [...fixed, ...capture.roots].map(key => ({ key, data: read(key) }));
  for (const stage of [5, 6]) {
    if (stage === 6) {
      const current = sdk.getResolutionDecoder().decode(read(base.resolution));
      svm.setAccount({ ...account(base.resolution), data: sdk.getResolutionEncoder().encode({ ...current, stage, cursor: 0 }) });
    }
    svm.expireBlockhash();
    const { transaction } = await sdk.signCanonicalInstructions({ async getLatestBlockhash() {
      return { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n };
    } }, payer, [sdk.getAdvanceAccountResolutionInstruction({ ...base, epoch: header.epoch, stage, start: 0, length: 1 })],
    { computeUnitLimit: 1_200_000, loadedAccountsDataSizeLimit: 8 * 1024 * 1024 });
    const outcome = svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize()));
    const meta = outcome instanceof FailedTransactionMetadata ? outcome.meta() : outcome;
    const label = `${bits}-bit ${mixed ? 'mixed claims' : 'double debt'} ${stage === 5 ? 'Verify' : 'FlowPlan'}`;
    writeFileSync(`${output}/case-${checks.length}.json`, serialize({ label, wire: Buffer.from(transaction.serialize()).toString('base64'), logs: meta.logs() }));
    assert(!(outcome instanceof FailedTransactionMetadata), `${label}: ${meta.logs().join('\n')}`);
    assert(meta.computeUnitsConsumed() <= 960_000n, `${label}: 20% headroom`);
    const result = sdk.getResolutionPageDecoder().decode(read(base.page)).rows[0];
    const expected = mixed ? [maximum * rateDenominator, maximum * rateDenominator]
      : claims.map(claim => cash * denominator * (-claim) / debt);
    assert.deepEqual(result.exactFlowNumerators.map(flow => value(flow.limbs)), expected, 'Independent bigint exact flows');
    if (stage === 6) {
      assert.deepEqual(result.roundedFlows, expected.map(flow => flow / denominator));
      assert.equal(result.cashAfter, (cash * denominator - expected[0] + (mixed ? expected[1] : -expected[1])) / denominator);
    }
    for (const before of immutable) {
      const after = read(before.key);
      // Scoped envelopes may advance identity revisions, never cash/claims/token bodies.
      if (before.key === capture.vault) assert.deepEqual(after, before.data);
      else { assert.deepEqual(after.subarray(0, 10), before.data.subarray(0, 10)); assert.deepEqual(after.subarray(18), before.data.subarray(18)); }
    }
    checks.push({ label, commonBits: bits, factorBits: 186, stage, computeUnits: String(meta.computeUnitsConsumed()), wireBytes: transaction.serialize().length });
  }
}
assert.deepEqual(parent.toBytes(), original, 'Scratch forks never mutate retained parent snapshot');
writeFileSync(`${output}/summary.json`, serialize({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  build, captureSha256: createHash('sha256').update(raw).digest('hex'), members: capture.roots.length,
  scope: 'LiteSVM 1.6.1 resource-only full-context scratch fixtures, not reachable financial history; no Apply or payout', checks }));
console.log(serialize(checks));
