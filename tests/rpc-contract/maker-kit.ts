import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { getBase58Decoder, type Instruction } from '@solana/kit';
import { type Keypair } from '@solana/web3.js';
import { getMintToInstruction, getTokenDecoder } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { Indexer } from '../../packages/indexer/src/index.js';
import { json } from '../../packages/indexer/src/events.js';
import { economicsCheckpoint, economicsCapture } from '../../packages/maker-kit/src/capture.js';
import { makerInstructions } from '../../packages/maker-kit/src/examples.js';
import { environment, wait } from '../load/environment.js';
import { WireRpc } from './wire.js';

const dir = process.env.RIVALT_RUN_DIR!, started = Date.now();
const opening: Awaited<ReturnType<typeof economicsCheckpoint>>[] = [];
const openingSol: bigint[] = [], steps: object[] = [], unsignedRejections: string[] = [];
const rpc = new WireRpc(process.env.RIVALT_RPC_URL!);
const manifest = {
  source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
  operatorClass: 'internal-reference', sourceClass: 'signed-synthetic-fixture', observedHedges: false,
  artifactHashes: Object.fromEntries(['clearing', 'maker_a', 'maker_b', 'oracle_fixture'].map(name =>
    [name, createHash('sha256').update(readFileSync(`target/deploy/${name}.so`)).digest('hex')])),
};
writeFileSync(`${dir}/manifest.json`, json(manifest));
let env: Awaited<ReturnType<typeof environment>> | undefined;
try {
  env = await environment({ makerKit: true, beforeStart: async runtime => {
    const snapshot = await runtime.snapshot();
    for (const maker of snapshot.makers) {
      opening.push(await economicsCheckpoint(runtime, maker.r.capital, maker.r.owner));
      openingSol.push(BigInt((await rpc.call('getBalance', [maker.r.owner, { commitment: 'finalized' }])).value));
    }
  } });
  const venue = env;
  await venue.stop('settlement');
  const binding = await venue.runtime.environment();
  const client = new sdk.UserClient({ version: 1, chain: 'solana:localnet', rpcUrl: venue.url, wsUrl: venue.wsUrl,
    genesis: binding.genesis, anchor: binding.anchor, market: venue.a.market, mint: venue.setup.mint.address, domain: binding.domain });

  // Persist original signed bytes before submission. An unknown or failed signed
  // action terminates qualification; it is never silently replaced by a new intent.
  async function submit(label: string, signer: Keypair, instructions: Instruction[]) {
    const { transaction } = await sdk.signInstructions(venue.connection, signer, instructions);
    const wire = Buffer.from(transaction.serialize()).toString('base64');
    const signature = getBase58Decoder().decode(transaction.signatures[0]);
    appendFileSync(`${dir}/signed.jsonl`, json({ label, signature, wire }) + '\n', { mode: 0o600 });
    let acknowledged = false;
    try { assert.equal(await venue.rpc.call('sendTransaction', [wire, { encoding: 'base64', skipPreflight: true }]), signature); acknowledged = true; }
    catch { /* Resolve this original signature, even if its acknowledgement was lost. */ }
    await wait(() => venue.rpc.call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]),
      result => result.value[0]?.confirmationStatus === 'finalized', `original signature ${label}`, 45_000);
    const tx = await venue.rpc.call('getTransaction', [signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    assert(tx?.meta); venue.txLog(label, signature, tx);
    steps.push({ label, signature, acknowledged, error: tx.meta.err, feeLamports: String(tx.meta.fee), slot: tx.slot });
    writeFileSync(`${dir}/steps.json`, json(steps));
    assert.equal(tx.meta.err, null, `${label}: ${tx.meta.logMessages}`);
    return signature;
  }
  async function trade(label: string, signer: Keypair, side: 0 | 1, lots: bigint) {
    const prepared = await wait(async () => {
      try {
        const quote = await venue.runtime.quote(signer.address, side, lots);
        if (!quote.available) { unsignedRejections.push('no-liquidity'); return null; }
        return await client.validateQuote(await client.snapshot('confirmed'), signer.address, side, lots, quote);
      } catch (error) { unsignedRejections.push(error instanceof Error ? error.message : 'quote unavailable'); return null; }
    }, Boolean, `unsigned quote ${label}`, 45_000);
    assert(prepared); return submit(label, signer, prepared.instructions);
  }
  async function indexed() {
    await wait(async () => {
      const [chain, projection] = await Promise.all([venue.runtime.snapshot(), venue.runtime.store.snapshot()]);
      return projection.error === null && projection.state.sequence === chain.m.sequence.toString();
    }, Boolean, 'finalized projection caught up');
  }
  async function capture(label: string) {
    await indexed();
    const results = [];
    for (const [id, checkpoint] of opening.entries()) {
      const result = await economicsCapture(venue.runtime, checkpoint, '5');
      writeFileSync(`${dir}/${label}-maker-${id}.json`, json(result)); results.push(result);
    }
    return results;
  }
  console.log('Maker kit: proving both owner-signed epoch publications');
  await wait(async () => (await venue.runtime.snapshot()).makers,
    makers => makers.every(maker => maker.r.quoteEpoch >= 2n && maker.online), 'both reference bots renewed epochs', 210_000);
  const maker = venue.setup.makers[0];
  await venue.send('provision one additional test collateral atom', [getMintToInstruction({ mint: venue.setup.mint.address,
    token: maker.token.address, mintAuthority: venue.payer, amount: 1n })]);
  const example = await makerInstructions(await client.snapshot(), 0, maker.owner.address);
  await submit('SDK maker deposit', maker.owner, [await example.deposit(maker.token.address, 1n)]);
  console.log('Maker kit: fills and causal funding');
  await trade('trader opens split position', venue.actors[0].owner, 0, 100n);
  const initialFunding = (await venue.runtime.snapshot()).m.fundingIndexScaled;
  await wait(async () => (await venue.runtime.snapshot()).m.fundingIndexScaled,
    funding => funding !== initialFunding, 'causal nonzero materialized funding', 30_000);
  const exposed = await capture('exposed');
  assert(exposed.every(result => result.report.makerFills > 0 && BigInt(result.report.inventoryLots) !== 0n));
  assert(exposed.some(result => BigInt(result.report.fundingPnlScaled) !== 0n));
  await trade('trader closes position', venue.actors[0].owner, 1, 100n);
  const inventory = (await venue.runtime.snapshot()).participants[maker.capital].lots;
  if (inventory !== 0n) await trade('maker aggressive inventory close', maker.owner, inventory > 0n ? 1 : 0, inventory > 0n ? inventory : -inventory);
  assert(Object.values((await venue.runtime.snapshot()).participants).every(participant => participant.lots === 0n));
  venue.start('settlement');
  await wait(async () => (await venue.runtime.store.pool.query("SELECT count(*) FROM events WHERE run_id=$1 AND kind='settlement' AND payload->>'kind'='1'", [venue.runId])).rows[0].count,
    count => Number(count) > 0, 'actual funded gain settlement');
  await wait(async () => Object.values((await venue.runtime.snapshot()).participants),
    participants => participants.every(participant => participant.virtualScaled > -1_000_000_000n && participant.virtualScaled < 1_000_000_000n), 'whole claims settled');

  console.log('Maker kit: stop quoting, reconcile, and owner withdrawal');
  for (const role of ['maker-a', 'maker-b', 'funding', 'settlement']) await venue.stop(role);
  await venue.stopSources();
  await wait(async () => {
    await venue.runtime.execute();
    return Number((await venue.runtime.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')", [venue.runId])).rows[0].count);
  }, count => count === 0, 'all original operator signatures resolved');
  await venue.stop('executor');
  // Explicit venue-authority step: stopping a bot alone does not revoke its
  // standing authority. This fixture owns the venue and discloses that role.
  for (const registered of venue.setup.makers) await venue.send('venue authority quarantines standing maker',
    [await sdk.getQuarantineMakerInstructionAsync({ ...registered, authority: venue.payer })]);
  for (const registered of venue.setup.makers) {
    const beforeCash = (await client.snapshot()).participants[registered.capital].cash;
    const beforeTokens = getTokenDecoder().decode((await venue.read(registered.token.address))!).amount;
    for (let page = 0; page < 10; page++) {
      const exit = await client.exitInstructions(await client.snapshot(), registered.owner.address, registered.token.address, 1n);
      await submit(exit.verificationOnly ? 'SDK complete cohort proof' : 'SDK maker withdrawal', registered.owner, exit.instructions);
      if (!exit.verificationOnly) break;
      assert(page < 9, 'Exit certificate did not complete');
    }
    assert.equal((await client.snapshot()).participants[registered.capital].cash, beforeCash - 1n);
    assert.equal(getTokenDecoder().decode((await venue.read(registered.token.address))!).amount, beforeTokens + 1n);
  }
  await venue.stop('indexer');
  const indexer = new Indexer(venue.config);
  try {
    await indexer.open(); await indexer.cycle(); await indexer.reconcile();
  } finally { await indexer.close(); }
  const final = await capture('final');
  writeFileSync(`${dir}/opening-maker-0.json`, json(opening[0]), { mode: 0o600 });
  execFileSync(process.execPath, ['--import', 'tsx', 'packages/maker-kit/src/record.ts', 'capture',
    `${dir}/maker-a-config.json`, `${dir}/cli-capture.json`, `${dir}/opening-maker-0.json`, '5'], { stdio: 'inherit' });
  assert.deepEqual(JSON.parse(readFileSync(`${dir}/cli-capture.json`, 'utf8')).report, final[0].report);
  execFileSync(process.execPath, ['--import', 'tsx', 'packages/maker-kit/src/report.ts',
    `${dir}/cli-capture.json`, `${dir}/cli-report.json`], { stdio: 'inherit' });
  assert.deepEqual(JSON.parse(readFileSync(`${dir}/cli-report.json`, 'utf8')), final[0].report);
  for (const [id, result] of final.entries()) {
    const closingSol = BigInt((await venue.rpc.call('getBalance', [result.input.owner, { commitment: 'finalized' }])).value);
    assert.equal(openingSol[id] - closingSol, BigInt(result.report.networkFeesLamports), 'Actual maker SOL delta equals captured fees');
    assert.equal(result.report.pendingFeeReservationLamports, '0'); assert.equal(result.report.inventoryLots, '0');
    assert.equal(result.report.withdrawnAtoms, '1');
    execFileSync('python3', ['tests/maker-kit/audit.py', `${dir}/final-maker-${id}.json`], { stdio: 'inherit' });
  }
  assert.equal(final[0].report.depositedAtoms, '1');
  assert(venue.sourceErrors.length === 0, 'Controlled source errors retained in failed report');
  const report = { status: 'pass', manifest, elapsedSeconds: (Date.now() - started) / 1000, steps,
    unsignedQuoteRejections: unsignedRejections, reports: final.map(result => result.report), sourceErrors: venue.sourceErrors,
    limitations: ['Internal operators and synthetic local prices', 'Ordinary lifecycle only', 'One atom withdrawn per maker; remaining cash stays funded',
      'Hedge cost is an assumption; no hedge executed', 'Bounded workflow, not endurance or independent validation'] };
  writeFileSync(`${dir}/report.json`, json(report));
  console.log(json({ status: 'pass', elapsedSeconds: report.elapsedSeconds, directory: dir }));
} catch (error) {
  writeFileSync(`${dir}/failure.json`, json({ status: 'fail', manifest, steps, unsignedRejections,
    error: error instanceof Error ? error.stack : String(error), sourceErrors: env?.sourceErrors }));
  throw error;
} finally { await env?.close(); }
