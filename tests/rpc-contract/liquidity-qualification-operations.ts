// P34 complete-cohort operations, outside the timed pricing populations.
import assert from 'node:assert/strict';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { Address } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { json } from '../../packages/indexer/src/events.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { qualificationSetup } from './liquidity-qualification-setup.js';
import { qualificationServices, waitFor } from './liquidity-qualification-services.js';
const directory = process.env.RIVALT_RUN_DIR!, revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '');
const transport = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, directory, {
    deferFinality: true, computeUnitLimit: label => label.startsWith('P34 route') ? 800000 : label.includes('publisher') ? 200000 :
        label.startsWith('P34 resume') ? 1200000 : label === 'continuation reprice batch' || label === 'refresh independent sources and six maker publications' ? 600000 : 400000, maxLoadedAccounts: () => 32
});
const { h, rpc, ws, checks, flush } = transport;
let services: Awaited<ReturnType<typeof qualificationServices>> | undefined, feeding = false, feedLoop: Promise<void> | undefined, feedError: unknown;
const riskChildren: ChildProcess[] = [], restarts: unknown[] = [];
async function stop(child: ChildProcess) { if (child.exitCode !== null || child.signalCode !== null)
    return; child.kill('SIGTERM'); await waitFor(async () => child.exitCode !== null || child.signalCode !== null, Boolean, 'risk worker stop', 15); }
try {
    const setup = await qualificationSetup(h, rpc, 'treatment'), canonical = setup.canonical!;
    services = await qualificationServices(setup, transport, 'treatment', directory);
    const { runtime, client } = services;
    feeding = true;
    feedLoop = (async () => { while (feeding) {
        try {
            await canonical.fresh();
        }
        catch (error) {
            feedError ??= error;
            return;
        }
        await delay(1000);
    } })();
    async function normal(btc = 60000n, eth = 30000n) {
        await waitFor(() => client.snapshot([setup.cross], 'confirmed'), value => value.marketStates[0].referencePrice === btc && value.marketStates[1].referencePrice === eth && value.marketStates.every(market => sdk.accountSourceMode(value.safetyState, market, value.now, value.slot) === 'Normal'), 'fresh operational sources', 60);
    }
    async function root(margin: Address) { return (await client.snapshot([margin], 'confirmed')).roots[margin]; }
    async function withdraw(margin: Address, amount: bigint) {
        const owner = setup.makerRoots.includes(margin) ? canonical.owner : setup.owner;
        const token = setup.makerRoots.includes(margin) ? canonical.token : setup.token;
        const prepared = await client.exit(await client.snapshot([margin], 'confirmed'), owner.address, margin, token.address, amount);
        await h.send('P34 flat funded cash withdrawal', prepared.instructions, [owner]);
    }
    async function route(marketIndex: 0 | 1, lots: bigint, side: 0 | 1 = 0) {
        await normal();
        const snapshot = await client.tradeSnapshot(setup.cross, marketIndex);
        const quote = await client.route({ snapshot, trader: setup.cross, marketIndex, side, lots, maxFee: 10000n, allInLimit: side === 0 ? 10000000n : 0n }, setup.owner.address);
        assert(quote);
        await h.send('P34 route operational exposure', quote.instructions, [setup.owner]);
    }
    const keys = [setup.venue, setup.custody, setup.safety, setup.vault, setup.registry, setup.mint.address, ...setup.allRoots, ...setup.markets, ...setup.ledgers,
        canonical.token.address, setup.token.address, canonical.resolution, canonical.work, ...canonical.pages];
    async function raw() { const response = await rpc.call('getMultipleAccounts', [keys, { encoding: 'base64', commitment: 'confirmed' }]); return Object.fromEntries(keys.map((key, index) => [key, response.value[index]?.data[0] ?? null])); }
    function startRisk(receiver?: Address) {
        const signerPath = `${directory}/risk-signer.json`;
        writeFileSync(signerPath, JSON.stringify([...setup.owner.secretKey]), { mode: 0o600 });
        const child = spawn(process.execPath, ['--import', 'tsx', 'packages/services/src/account-worker-main.ts'], { cwd: process.cwd(),
            env: { ...process.env, RIVALT_RPC_URL: process.env.RIVALT_RPC_URL!, RIVALT_DATABASE_URL: runtime.store.pool.options.connectionString!, RIVALT_RUN_ID: runtime.runId,
                RIVALT_ACCOUNT_PROFILE: 'liquidity-execution-qualification', RIVALT_ACCOUNT_ROLE: 'risk', RIVALT_SIGNER_PATH: signerPath, ...receiver ? { RIVALT_RECEIVER_MARGIN: receiver } : {} }, stdio: ['ignore', 'pipe', 'pipe'] });
        const output = createWriteStream(`${directory}/risk-${riskChildren.length}.log`);
        child.stdout!.pipe(output, { end: false });
        child.stderr!.pipe(output, { end: false });
        child.once('exit', () => output.end());
        riskChildren.push(child);
        return child;
    }
    async function riskResolved() { await waitFor(async () => (await runtime.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND budget='liquidity-risk' AND status NOT IN ('finalized','failed')", [runtime.runId])).rows[0].count, value => value === '0', 'risk originals finalized'); }
    const header = async () => sdk.getResolutionDecoder().decode((await h.read(canonical.resolution))!);
    await normal();
    await withdraw(setup.cross, 600000n);
    await route(0, 40n);
    await route(1, 20n);
    canonical.sourcePrices.btc = 52000000000n;
    await normal(52000n);
    const before = await raw(), beforeTarget = await root(setup.cross);
    assert(BigInt(client.balance(await client.snapshot([setup.cross], 'confirmed'), setup.cross).maintenanceDeficitScaled!) > 0n);
    let risk = startRisk(setup.operations);
    await waitFor(() => root(setup.cross), value => value.positions[0].lots < beforeTarget.positions[0].lots, 'actual profile-4 liquidation', 60);
    await stop(risk);
    await riskResolved();
    const after = await raw();
    // The actual worker may transfer all BTC exposure. A separate remaining ETH
    // exposure is sufficient for deterministic net insolvency after fresh stress.
    canonical.sourcePrices.btc = 40000000000n;
    canonical.sourcePrices.eth = 2000000000n;
    await canonical.freshSources();
    risk = startRisk();
    await waitFor(header, value => value.stage === 2, 'complete-cohort default freeze', 60);
    const capture: any = { roots: setup.allRoots, markets: setup.markets, ledgers: setup.ledgers, custody: setup.custody, vault: setup.vault,
        mint: setup.mint.address, userTokens: [canonical.token.address, setup.token.address], resolution: canonical.resolution, work: canonical.work, pages: canonical.pages,
        liquidation: { target: setup.cross, receiver: setup.operations, before, after }, frozenAccounts: await raw() };
    writeFileSync(`${directory}/financial-capture.json`, json(capture));
    const deadline = Date.now() + 300000;
    let restarted = false;
    while ((await header()).stage !== 11) {
        assert(Date.now() < deadline, 'Complete bounded default');
        const current = await header();
        if (current.stage === 4 && current.proposalUploaded > 0 && !restarted) {
            risk.kill('SIGKILL');
            await waitFor(async () => risk.signalCode === 'SIGKILL', Boolean, 'risk SIGKILL');
            restarts.push({ stage: current.stage, uploaded: current.proposalUploaded, pid: risk.pid });
            risk = startRisk();
            restarted = true;
        }
        await delay(100);
    }
    await stop(risk);
    await riskResolved();
    assert(restarted);
    capture.completedAccounts = await raw();
    writeFileSync(`${directory}/financial-capture.json`, json(capture));
    canonical.sourcePrices.btc = 60000000000n;
    canonical.sourcePrices.eth = 3000000000n;
    risk = startRisk();
    await waitFor(async () => sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!), value => value.recoverySince > 0n && value.recoveryLast - value.recoverySince >= 6n, 'sustained independent recovery', 45);
    await stop(risk);
    await riskResolved();
    feeding = false;
    await feedLoop;
    if (feedError)
        throw feedError;
    const snapshot = await runtime.snapshot();
    await h.send('P34 resume complete recovery', [sdk.getRecoverAccountsInstruction({ ...snapshot, caller: setup.payer, epoch: (await header()).epoch, resume: true,
            primaryBtc: canonical.feeds[0].feed, primaryCollateral: canonical.feeds[1].feed, guardBtc: canonical.feeds[2].feed, guardCollateral: canonical.feeds[3].feed,
            primaryEth: canonical.feeds[4].feed, guardEth: canonical.feeds[5].feed })]);
    capture.recoveredAccounts = await raw();
    await withdraw(setup.allRoots[0], 100n);
    capture.finalAccounts = await raw();
    writeFileSync(`${directory}/financial-capture.json`, json(capture));
    const audit = execFileSync('python3', ['tests/financial/account-workers-reference.py', `${directory}/financial-capture.json`], { encoding: 'utf8' });
    writeFileSync(`${directory}/independent-audit.txt`, audit);
    for (const margin of setup.allRoots) {
        const account = await root(margin);
        assert(account.positions.every(position => position.lots === 0n && position.virtualScaled === 0n));
        if (account.cash > 0n)
            await withdraw(margin, account.cash);
    }
    await services.pause();
    await flush();
    const serviceReport = await services.report();
    assert.equal(serviceReport.state.custody!.totalCash, '0');
    assert(Object.values(serviceReport.state.roots).every(account => account.cash === '0'));
    const remaining = Object.values(serviceReport.state.ledgers).reduce((sum, ledger) => sum + BigInt(ledger.fees) + BigInt(ledger.insurance), 0n);
    assert.equal(BigInt(serviceReport.reconciliation.actualVault), remaining);
    assert.equal(serviceReport.reconciliation.unallocatedSurplus, '0');
    assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '');
    writeFileSync(`${directory}/summary.json`, json({ revision, trackedDirty: false, checks, restarts, serviceReport, audit, allFundedAccountsExited: true,
        remainingVaultAtoms: remaining, remainingVaultScope: 'market insurance and protocol fees only', defaultDevnetActivation: false, externalGateClosed: false }));
}
finally {
    feeding = false;
    await feedLoop;
    for (const child of riskChildren)
        await stop(child).catch(() => child.kill('SIGKILL'));
    await services?.close();
    try {
        await flush();
    }
    finally {
        ws.close();
    }
}
