import { publicIntents } from '../e2e/evidence.js';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Page } from 'playwright-core';
import { Connection, VersionedTransaction, type Keypair } from '@solana/web3.js';
import { getTransferSolInstruction } from '@solana-program/system';
import { getMintToInstruction } from '@solana-program/token';
import { type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { Indexer } from '../../packages/indexer/src/index.js';
import { api as readApi } from '../../packages/indexer/src/api.js';
import { Runtime } from '../../packages/services/src/runtime.js';
import { json, decode } from '../../packages/indexer/src/events.js';
import { addresses, payerKey, fixtureKey } from '../rpc-contract/custody-cases.js';
import { oracleSetup, type OracleHarness } from '../rpc-contract/oracle-cases.js';
import { orderTools } from '../rpc-contract/order-cases.js';
import { publishFeed } from '../rpc-contract/oracle-fixture.js';
import { WireRpc } from '../rpc-contract/wire.js';
const dir = process.env.RIVALT_RUN_DIR!,
  url = process.env.RIVALT_RPC_URL!,
  database = process.env.RIVALT_DATABASE_URL!,
  runId = dir.split('/').at(-1)!;
const rpc = new WireRpc(url),
  connection = new Connection(url, 'confirmed'),
  payer = await payerKey(),
  a = await addresses();
const custody = JSON.parse(readFileSync(`${dir}/custody.json`, 'utf8')),
  anchor = custody.checks.find((x: any) => x.label === 'initialize custody market').signature;
const unsignedRejections: { label: string; message: string }[] = [];
const signedRejections: { label: string; signature: string; code: number; fee: number }[] = [];
const childRoles = new Map<ChildProcess, string>();
const checks: string[] = [],
  transactions: any[] = [],
  children: ChildProcess[] = [],
  errors: string[] = [],
  walletSigned: string[] = [];
const record = (name: string) => {
  checks.push(name);
  console.log(`Browser: ${name}`);
};
async function wait<T>(
  read: () => Promise<T>,
  accept: (v: T) => boolean,
  label: string,
  timeout = 30000,
): Promise<T> {
  const end = Date.now() + timeout;
  let last: any;
  while (Date.now() < end) {
    try {
      last = await read();
      if (accept(last)) return last;
    } catch (e) {
      last = e;
    }
    await delay(100);
  }
  throw new Error(
    `${label}: ${last instanceof Error ? last.message : JSON.stringify(last, (key, value) => (key === 'wire' ? '[saved signed bytes omitted]' : typeof value === 'bigint' ? value.toString() : value))}`,
  );
}
const read = async (key: string) => {
  const x = await rpc.call('getAccountInfo', [key, { encoding: 'base64', commitment: 'finalized' }]);
  return x.value ? Buffer.from(x.value.data[0], 'base64') : null;
};
const now = async () => (await read('SysvarC1ock11111111111111111111111111111111'))!.readBigInt64LE(32);
const slot = async () => BigInt(await rpc.call('getSlot', [{ commitment: 'finalized' }]));
async function fetched(signature: string) {
  await wait(
    () => rpc.call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]),
    (r) => r.value[0]?.confirmationStatus === 'finalized',
    'finalized',
  );
  const tx = await wait<any>(
    () =>
      rpc.call('getTransaction', [
        signature,
        { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
      ]),
    Boolean,
    'independent transaction fetch',
  );
  transactions.push({ signature, tx });
  return tx;
}
async function send(
  label: string,
  instructions: Instruction[],
  signers: Keypair[] = [],
  error?: number | 'reject',
) {
  const { transaction } = await sdk.signInstructions(connection, payer, instructions, signers),
    signature = await rpc.call('sendTransaction', [
      Buffer.from(transaction.serialize()).toString('base64'),
      { encoding: 'base64', skipPreflight: true },
    ]),
    tx = await fetched(signature);
  if (error === undefined) assert.equal(tx.meta.err, null, `${label}: ${tx.meta.logMessages}`);
  else {
    assert(tx.meta.err);
    if (error !== 'reject')
      assert(tx.meta.logMessages.some((x: string) => x.includes(`Error Number: ${error}.`)));
  }
  return { signature, tx };
}
const h: OracleHarness = {
  send: async (...args) => {
    await send(...args);
  },
  read,
  rent: async (n) => BigInt(await rpc.call('getMinimumBalanceForRentExemption', [n])),
  slot,
  now,
  waitUntil: async (n) => {
    await wait(slot, (x) => x >= n, 'actual slot', 60000);
  },
  waitTime: async (n) => {
    await wait(now, (x) => x >= n, 'actual clock', 60000);
  },
  quote: async () => {
    throw new Error('Unused quote fixture');
  },
};
const setup = await oracleSetup(h),
  t = await orderTools(h, setup),
  { owner, makers } = setup;
const funding = await fixtureKey('p10-funding'),
  other = await fixtureKey('p10-other-wallet');
await send('fund separate sampler and second browser account', [
  getMintToInstruction({
    mint: setup.mint.address,
    token: setup.token.address,
    mintAuthority: payer,
    amount: 10_000_000n,
  }),
  getTransferSolInstruction({ source: payer, destination: funding.address, amount: 50_000_000n }),
  getTransferSolInstruction({ source: payer, destination: other.address, amount: 50_000_000n }),
]);
const keyPath = (name: string, key: Keypair) => {
  const path = resolve(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify([...key.secretKey]), { mode: 0o600 });
  return path;
};
const paths = {
  funding: keyPath('funding-key', funding),
  a: keyPath('maker-a-key', makers[0].owner),
  b: keyPath('maker-b-key', makers[1].owner),
};
const indexer = new Indexer({
    rpcUrl: url,
    wsUrl: process.env.RIVALT_WS_URL!,
    databaseUrl: database,
    runId,
    market: a.market,
    anchor,
  }),
  runtime = new Runtime(database, runId, url),
  readServer = readApi(indexer);
let number = 0,
  running = true,
  sourceRunning = true,
  indexLoop: Promise<void> | undefined,
  sourceLoop: Promise<void> | undefined,
  price = 60000n,
  publishedAt = 0n;
function child(role: string, args: string[], extra: Record<string, string> = {}, cwd?: string) {
  const fd = openSync(`${dir}/${role}-${++number}.log`, 'w'),
    p = spawn(process.execPath, args, { cwd, env: { ...process.env, ...extra }, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  children.push(p);
  childRoles.set(p, role);
  return p;
}
const start = (role: string, path?: string) =>
  child(`service-${role}`, ['--import', 'tsx', 'packages/services/src/main.ts'], {
    RIVALT_RUN_ID: runId,
    RIVALT_SERVICE_ROLE: role,
    RIVALT_FUNDING_INTERVAL_SECONDS: '5',
    ...(path ? { RIVALT_SIGNER_PATH: path } : {}),
  });
async function stop(p: ChildProcess) {
  if (p.exitCode !== null || p.signalCode !== null) return;
  const done = new Promise<void>((r) => p.once('exit', () => r()));
  p.kill('SIGTERM');
  await Promise.race([
    done,
    delay(10000).then(() => {
      if (p.exitCode === null && p.signalCode === null) {
        p.kill('SIGKILL');
        throw new Error('Child stop timeout');
      }
    }),
  ]);
}
async function publish() {
  const time = await wait(now, (n) => n > publishedAt, 'new source timestamp');
  await send(
    'signed browser test dependency publication',
    await Promise.all(
      [0, 1, 2, 3].map((i) => publishFeed(i, time, i % 2 === 0 ? { price: price * 1_000_000n } : {})),
    ),
    [setup.primary, setup.guardKey],
  );
  publishedAt = time;
}
const config = sdk.userConfig({
  version: 1,
  chain: 'solana:localnet',
  rpcUrl: url,
  wsUrl: process.env.RIVALT_WS_URL,
  genesis: await rpc.call('getGenesisHash'),
  anchor,
  market: a.market,
  mint: setup.mint.address,
  domain: sdk.hex((await t.market()).domain),
});
const client = new sdk.UserClient(config),
  configPath = resolve(dir, 'trader-public.json');
writeFileSync(configPath, json(config));
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }),
  keys = [owner, other];
await context.exposeBinding('rivaltSign', async (_source, input: { index: number; wire: number[] }) => {
  const key = keys[input.index];
  assert(key);
  const transaction = VersionedTransaction.deserialize(Uint8Array.from(input.wire));
  assert.equal(transaction.message.staticAccountKeys[0].address, key.address);
  assert.equal(transaction.signatures.length, 1);
  await transaction.sign([key]);
  const wire = Buffer.from(transaction.serialize()).toString('base64');
  walletSigned.push(wire);
  return [...transaction.serialize()];
});
// Serialize plain JS rather than tsx's function.toString(), which can contain
// host-only name-preservation helpers. Only public account bytes cross over.
const walletSource = stripTypeScriptTypes(
  readFileSync('tests/browser/wallet.ts', 'utf8').replace(
    'export function installWallet',
    'function installWallet',
  ),
);
await context.addInitScript({
  content:
    walletSource +
    '\ninstallWallet(' +
    JSON.stringify(keys.map((k) => ({ address: k.address, publicKey: [...k.publicKey.toBytes()] }))) +
    ');',
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => errors.push(e.message));
const text = (id: string) => page.getByTestId(id).textContent();
const receipts = async () =>
  page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([k]) => k.startsWith('rivalt:receipts:'))
      .flatMap(([, v]) => JSON.parse(v)),
  ) as Promise<sdk.SignedIntent[]>;
async function uiReady() {
  await wait(
    () => text('source-mode'),
    (x) => x === 'Normal',
    'browser Normal state',
    60000,
  );
  await wait(
    () => page.getByRole('button', { name: 'Get quote', exact: true }).isEnabled(),
    Boolean,
    'API and wallet ready',
  );
}
async function reviewAction(button: string, label: string) {
  const before = walletSigned.length;
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.getByRole('button', { name: button, exact: true }).click();
    const preview = await wait(
      async () => ({
        dialog: await page.getByRole('dialog').isVisible(),
        message: await page
          .getByRole('alert')
          .first()
          .textContent({ timeout: 100 })
          .catch(() => ''),
      }),
      (x) => x.dialog || Boolean(x.message),
      'explicit transaction preview',
    );
    if (preview.dialog) break;
    assert.equal(walletSigned.length, before, 'unsigned retry must not replace any signature');
    assert(
      /Quote.*(unavailable|changed|expired)|Quote price changed|Preview rejected.*(6118|6122|6124)/i.test(
        preview.message ?? '',
      ),
      preview.message ?? 'No preview',
    );
    unsignedRejections.push({ label, message: preview.message! });
    await delay(300);
  }
  assert(await page.getByRole('dialog').isVisible(), 'no valid preview within eight explicit attempts');
  const actualLabel = (await page.getByRole('dialog').getByRole('heading').textContent())!;
  assert(actualLabel === label || actualLabel === 'Verify exit cohort');
  return actualLabel;
}
async function signedAction(
  button: string,
  label: string,
  proofPages = 0,
  failedAttempts = 0,
): Promise<sdk.SignedIntent> {
  const before = walletSigned.length,
    actualLabel = await reviewAction(button, label);
  const effectKeys = [a.vault, setup.trader, ...makers.map((m) => m.capital)],
    beforeEffect = await Promise.all(effectKeys.map(read));
  await page.getByRole('button', { name: 'Sign transaction', exact: true }).click();
  const receipt = await wait(
    receipts,
    (x) =>
      x.some(
        (r) =>
          r.label === actualLabel &&
          ['finalized', 'failed'].includes(r.status) &&
          !transactions.some((t) => t.signature === r.signature),
      ),
    `${label} final receipt`,
  );
  const r = receipt.find(
    (r) =>
      r.label === actualLabel &&
      ['finalized', 'failed'].includes(r.status) &&
      !transactions.some((t) => t.signature === r.signature),
  )!;
  assert.equal(walletSigned.length, before + 1);
  const tx = await fetched(r.signature);
  if (r.status === 'failed') {
    const code = tx.meta.err?.InstructionError?.[1]?.Custom;
    assert(
      [6118, 6122, 6124].includes(code),
      `unexpected finalized rejection ${JSON.stringify(tx.meta.err)}`,
    );
    assert.deepEqual(
      await Promise.all(effectKeys.map(read)),
      beforeEffect,
      'rejected action leaves the actual vault and funded participants unchanged',
    );
    signedRejections.push({ label: actualLabel, signature: r.signature, code, fee: tx.meta.fee });
    assert(failedAttempts < 3, 'too many finalized races for this action');
    // Explicit user retry only after independently proving final failure and no
    // financial effect. Missing/expired/ambiguous outcomes never enter this path.
    return signedAction(button, label, proofPages, failedAttempts + 1);
  }
  assert.equal(tx.meta.err, null);
  if (actualLabel === 'Verify exit cohort') {
    assert(proofPages < 8, 'exit proof must advance');
    return signedAction(button, label, proofPages + 1, failedAttempts);
  }
  return r;
}
try {
  await indexer.open();
  await indexer.cycle();
  await runtime.open();
  await readServer.listen({ host: '127.0.0.1', port: 18084 });
  indexLoop = (async () => {
    while (running) {
      try {
        await indexer.cycle();
      } catch {}
      await delay(100);
    }
  })();
  await t.recover();
  await publish();
  sourceLoop = (async () => {
    while (sourceRunning) {
      await delay(1200);
      if (sourceRunning) await publish();
    }
  })();
  void sourceLoop.catch((e) => errors.push(`Source publisher: ${e.message}`));
  start('executor');
  start('maker-a', paths.a);
  start('maker-b', paths.b);
  start('funding', paths.funding);
  let apiProcess = start('api');
  child(
    'vite',
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '18083', '--strictPort'],
    { RIVALT_TRADER_CONFIG: configPath },
    resolve('apps/trader'),
  );
  await wait(
    () => fetch('http://127.0.0.1:18083/rivalt-config.json').then((r) => r.status),
    (x) => x === 200,
    'trader server',
  );
  await page.goto('http://127.0.0.1:18083');
  await page.getByRole('button', { name: 'Select Wallet', exact: true }).click();
  await page.getByRole('button', { name: /Rivalt Test Wallet/ }).click();
  await uiReady();
  assert.equal(await text('funded-cash'), '100');
  record('Wallet Standard account connects to a genesis/domain/initialization-bound finalized cohort');
  // Rejection has no signed bytes and no collateral movement.
  const initial = await t.participant(),
    signedBefore = walletSigned.length;
  await page.getByLabel('Collateral amount', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Deposit', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.evaluate(() => (window as any).rivaltWallet.reject());
  await page.getByRole('button', { name: 'Sign transaction', exact: true }).click();
  await page
    .getByText('Signature declined or wallet unavailable. Nothing was sent.', { exact: true })
    .waitFor();
  assert.equal(walletSigned.length, signedBefore);
  assert.equal((await t.participant()).cash, initial.cash);
  record('wallet rejection sends nothing and preserves funded cash');
  await signedAction('Deposit', 'Deposit');
  await wait(
    () => text('funded-cash'),
    (x) => x === '101',
    'deposit UI equals chain',
  );
  assert.equal((await t.participant()).cash, initial.cash + 1_000_000n);
  record('browser deposit is a real SPL transfer with independently fetched finalized bytes');
  // A wallet switch invalidates the unsigned review. It cannot sign the old owner's message.
  await page.getByRole('button', { name: 'Deposit', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  const beforeSwitch = walletSigned.length;
  await page.evaluate(() => (window as any).rivaltWallet.switch(1));
  await wait(
    () => page.getByRole('dialog').isVisible(),
    (x) => !x,
    'review cleared on switch',
  );
  assert.equal(walletSigned.length, beforeSwitch);
  await page.getByRole('button', { name: 'Register account', exact: true }).waitFor();
  await signedAction('Register account', 'Register account');
  await page.evaluate(() => (window as any).rivaltWallet.switch(0, 'solana:devnet'));
  await wait(
    () => page.getByRole('button', { name: 'Get quote', exact: true }).isDisabled(),
    Boolean,
    'unsupported wallet chain disabled',
  );
  await page.evaluate(() => (window as any).rivaltWallet.switch(0));
  await uiReady();
  record('account switch clears review; wrong wallet chain blocks signing; second wallet registers on chain');
  // Wrong endpoint identity is a real RPC response fault, not an invented successful balance.
  await page.route(url, async (route) => {
    const body = route.request().postDataJSON();
    if (body.method === 'getGenesisHash')
      await route.fulfill({
        json: { jsonrpc: '2.0', id: body.id, result: '11111111111111111111111111111111' },
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText(/Wrong cluster\. The RPC genesis/).waitFor();
  assert(await page.getByRole('button', { name: 'Get quote', exact: true }).isDisabled());
  await page.unroute(url);
  await page.getByRole('button', { name: 'Retry RPC', exact: true }).click();
  await uiReady();
  record('wrong RPC genesis visibly blocks preparation and recovers after the original endpoint returns');
  // Open across the competing maker curves through the actual quote API.
  await page.getByLabel('BTC size', { exact: true }).fill('0.0001');
  const opened = await signedAction('Get quote', 'Buy BTC');
  const open = transactions.find((t) => t.signature === opened.signature)!,
    routeEvents = decode(open.signature, open.tx, indexer.eventAuthority).filter((e) => e.type === 'route');
  assert.equal(routeEvents.length, 1);
  assert.equal(routeEvents[0].data.legs.length, 2);
  await wait(
    () => text('position'),
    (x) => x === '0.0001 BTC',
    'open position',
  );
  assert.equal((await t.participant()).lots, 100n);
  record('browser two-maker route commits atomically and position matches decoded RPC fill');
  // Materialize a profitable close from authenticated source changes, then collect actual maker debt.
  price = 61000n;
  await wait(
    () => runtime.snapshot(),
    (s) => s.sourceMode === 'Normal' && s.risk.referencePrice === price,
    'index rise',
  );
  await uiReady();
  await page.getByRole('button', { name: 'Sell / short', exact: true }).click();
  await signedAction('Get quote', 'Sell BTC');
  const profitable = await t.participant();
  assert.equal(profitable.lots, 0n);
  assert(profitable.virtualScaled > 0n);
  const cashBefore = profitable.cash;
  await wait(
    () => text('unpaid-pnl'),
    (x) => Boolean(x) && x !== '0' && !x!.startsWith('−'),
    'positive unpaid view',
  );
  assert.equal((await t.participant()).cash, cashBefore);
  for (const m of makers) {
    const snapshot = await runtime.snapshot(),
      p = snapshot.participants[m.capital],
      v =
        p.virtualScaled -
        p.lots * (snapshot.funding - p.fundingCheckpointScaled) +
        p.lots * snapshot.risk.referencePrice * 1_000_000_000n;
    if (v < 0n) {
      const amount = -v / 1_000_000_000n;
      if (amount)
        await send('collect actual maker liability to fund user settlement', [
          await sdk.getCollectLossInstructionAsync({
            ...setup,
            participant: m.capital,
            sequence: snapshot.m.sequence,
            observation: snapshot.risk.observationSequence,
            amount,
          }),
        ]);
    }
  }
  const eligible = await wait(
      () => client.snapshot(),
      (s) => sdk.userCapacity(s, s.participants[setup.trader]).settleable > 0n,
      'funded gain available',
    ),
    gain = sdk.userCapacity(eligible, eligible.participants[setup.trader]).settleable;
  await page
    .getByLabel('Collateral amount', { exact: true })
    .fill(gain / 1_000_000n + '.' + (gain % 1_000_000n).toString().padStart(6, '0'));
  await wait(
    () => page.getByRole('button', { name: 'Settle profit via RPC', exact: true }).isEnabled(),
    Boolean,
    'settlement enabled',
  );
  await signedAction('Settle profit via RPC', 'Settle profit');
  assert.equal((await t.participant()).cash, cashBefore + gain);
  record(
    'positive unpaid profit has zero margin credit; real collected losses fund browser settlement into cash',
  );
  // Persistent authority: actual permissionless partial fill followed by wallet replacement and direct cancel.
  await page.getByLabel('Execution limit', { exact: true }).fill('66000');
  await page.getByLabel('Order BTC size', { exact: true }).fill('0.00001');
  await signedAction('Review order', 'Place order');
  const orderId = (await t.participant()).book.lastOrderId;
  await t.fill(orderId, 2n, 'actual keeper partial for browser order');
  await wait(
    () => page.getByTestId(`order-${orderId}`).textContent(),
    (x) => x?.includes('Partial') === true,
    'partial fill view',
  );
  await page.getByRole('button', { name: `Edit order ${orderId}`, exact: true }).click();
  await page.getByLabel('Order BTC size', { exact: true }).fill('0.000012');
  await signedAction('Review replacement', `Replace order ${orderId}`);
  assert.equal((await t.order(orderId)).filled, 2n);
  assert.equal((await t.order(orderId)).version, 2n);
  await signedAction(`Cancel order ${orderId} via RPC`, `Cancel order ${orderId}`);
  assert.equal((await t.order(orderId)).state, 4);
  record(
    'on-chain partial fill, replacement fee prefix and API-independent owner cancellation match the order table',
  );
  // Protective pair applies only to an existing generation; edit an individual protective leg.
  await page.getByLabel('Execution limit', { exact: true }).fill('54000');
  await page.getByLabel('Protected BTC', { exact: true }).fill('0.000002');
  await page.getByLabel('Take profit index', { exact: true }).fill('62000');
  await page.getByLabel('Stop loss index', { exact: true }).fill('60000');
  await signedAction('Review TP/SL', 'Place TP/SL');
  const pair = (await t.participant()).book.orders.filter((o) => o.groupId > 0n && o.state === 1);
  assert.equal(pair.length, 2);
  assert(pair.every((o) => o.generation === profitable.generation + 1n));
  await page.getByRole('button', { name: `Edit order ${pair[0].id}`, exact: true }).click();
  await page.getByLabel('Execution limit', { exact: true }).fill('53000');
  await signedAction('Review replacement', `Replace order ${pair[0].id}`);
  const group = (await t.participant()).book.groups.find((g) => g.id === pair[0].groupId)!;
  assert.equal(group.remaining, 2n);
  await signedAction(`Cancel TP/SL group ${group.id}`, `Cancel TP/SL ${group.id}`);
  record('existing-position TP/SL shares one allowance and protective replacement preserves generation');
  await page.getByLabel('Execution limit', { exact: true }).fill('53000');
  await signedAction('Review TP/SL', 'Place TP/SL');
  const activePair = (await t.participant()).book.orders.filter((o) => o.groupId > group.id && o.state === 1);
  assert.equal(activePair.length, 2);
  // Close, reopen and show old generation authority cannot return.
  await page.getByLabel('BTC size', { exact: true }).fill('0.000002');
  await signedAction('Get quote', 'Sell BTC');
  assert.equal((await t.participant()).lots, 0n);
  await page.getByRole('button', { name: 'Buy / long', exact: true }).click();
  await signedAction('Get quote', 'Buy BTC');
  assert((await t.participant()).generation > group.generation);
  const reopened = await t.participant();
  assert(activePair.every((o) => sdk.orderRemaining(reopened, o, eligible.m.termsEpoch, 0n) === 0n));
  record('close and reopen advances generation; old protective authority stays inactive');
  // Lose only the acknowledgement after the real relay persists the transaction, then reload.
  await page.getByLabel('Collateral amount', { exact: true }).fill('0.1');
  const beforeLost = (await t.participant()).cash,
    signedLost = walletSigned.length;
  await page.route(
    '**/api/v1/submit',
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Deposit', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Sign transaction', exact: true }).click();
  await wait(
    receipts,
    (x) => x.filter((r) => r.label === 'Deposit').length === 2,
    'saved before lost acknowledgement',
  );
  await page.reload();
  await uiReady();
  await wait(
    () => t.participant(),
    (p) => p.cash === beforeLost + 100000n,
    'one actual deposit despite lost ack',
  );
  await wait(
    receipts,
    (x) => x.filter((r) => r.label === 'Deposit' && r.status === 'finalized').length === 2,
    'reload reconciles original signature',
  );
  assert.equal(walletSigned.length, signedLost + 1);
  record(
    'lost relay acknowledgement and browser reload reconcile the original signed deposit without a second signature',
  );
  // A prepared quote becomes stale while the user reviews it. No automatic replacement is signed.
  await reviewAction('Get quote', 'Buy BTC');
  const positionBefore = (await t.participant()).lots;
  const reviewedSlot = await slot();
  await wait(slot, (n) => n > reviewedSlot + 160n, 'actual stale quote lifetime');
  const beforeStale = walletSigned.length,
    previousReceipts = new Set((await receipts()).map((r) => r.id));
  await page.getByRole('button', { name: 'Sign transaction', exact: true }).click();
  await wait(
    receipts,
    (x) =>
      x.some(
        (r) =>
          !previousReceipts.has(r.id) && r.label === 'Buy BTC' && ['failed', 'unresolved'].includes(r.status),
      ),
    'stale quote visibly rejected or unresolved',
    60000,
  );
  await wait(
    () => page.locator('.announcements [role=status]').first().textContent(),
    (x) => Boolean(x && /Buy BTC (failed|remains unresolved)/.test(x)),
    'stale outcome notice',
  );
  assert.equal((await t.participant()).lots, positionBefore);
  assert.equal(walletSigned.length, beforeStale + 1);
  record(
    'real expired quote cannot execute and stays failed/unresolved without an automatic replacement signature',
  );
  // Leave a nonmarketable order, then stop the actual API process before direct cancel and cash exit.
  // Reload intentionally resets the unsigned edit form to new-order mode.
  const newOrder = page.getByRole('button', { name: 'New order', exact: true });
  if (await newOrder.count()) await newOrder.click();
  await page.getByLabel('Order side', { exact: true }).selectOption('0');
  await page.getByRole('checkbox', { name: 'Reduce existing position only' }).uncheck();
  await page.getByLabel('Order BTC size', { exact: true }).fill('0.00001');
  await page.getByLabel('Execution limit', { exact: true }).fill('10000');
  await signedAction('Review order', 'Place order');
  const directId = (await t.participant()).book.lastOrderId;
  await stop(apiProcess);
  await wait(
    () =>
      page
        .getByText('Venue data is unavailable. Direct RPC balances and exits remain available.', {
          exact: true,
        })
        .isVisible(),
    Boolean,
    'API stopped state',
  );
  await signedAction(`Cancel order ${directId} via RPC`, `Cancel order ${directId}`);
  const beforeWithdrawal = (await t.participant()).cash;
  await page.getByLabel('Collateral amount', { exact: true }).fill('0.01');
  await signedAction('Withdraw via RPC', 'Withdraw');
  assert.equal((await t.participant()).cash, beforeWithdrawal - 10000n);
  record(
    'actual venue API process stopped: browser direct cancellation and admissible withdrawal finalize over RPC',
  );
  apiProcess = start('api');
  await uiReady();
  // Honest chart contract, bounded latest reads, keyboard/dialog and responsive layouts.
  await wait(
    () => page.getByRole('img', { name: /One-minute candles/ }).isVisible(),
    Boolean,
    'actual-fill chart',
  );
  const latest = await fetch('http://127.0.0.1:18084/v1/trades?latest=true&limit=2').then((r) => r.json());
  assert.equal(latest.items.length, 2);
  assert(BigInt(latest.items[1].sequence) > BigInt(latest.items[0].sequence));
  assert.equal(latest.next, null);
  assert.equal(latest.deployment.anchor, anchor);
  assert.equal((await fetch('http://127.0.0.1:18084/v1/events?latest=true&after=0')).status, 400);
  for (const width of [375, 768, 1280])
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: 900 });
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page.getByRole('button', { name: `Use ${theme} theme`, exact: true }).click();
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `no page overflow ${width}`,
      );
      const unlabeled = await page.evaluate(() =>
        [...document.querySelectorAll('input,select,button')]
          .filter(
            (e) =>
              !(
                e.getAttribute('aria-label') ||
                e.textContent?.trim() ||
                e.closest('label')?.textContent?.trim()
              ),
          )
          .map((e) => e.outerHTML),
      );
      assert.deepEqual(unlabeled, []);
      await page.screenshot({ path: `${dir}/trader-${width}-${theme}.png`, fullPage: true });
    }
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement !== document.body));
  record(
    'actual-fill candles, bounded latest history, keyboard focus and 375/768/1280 light/dark layouts pass',
  );
  // Stop autonomous writers, reconcile exact chain/DB and rebuild from finalized history.
  sourceRunning = false;
  await sourceLoop;
  for (const p of children.filter(
    (p) => !['service-executor', 'service-api', 'vite'].includes(childRoles.get(p)!),
  ))
    await stop(p);
  await wait(
    () =>
      runtime.store.pool.query(
        "SELECT count(*)::int AS n FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",
        [runId],
      ),
    (r) => r.rows[0].n === 0,
    'operator intents reconciled',
  );
  for (const p of children) await stop(p);
  running = false;
  await indexLoop;
  await indexer.cycle();
  const final = await client.snapshot(),
    row = await indexer.store.snapshot();
  assert.equal(row.state.sequence, String(final.m.sequence));
  assert.equal(row.state.participants[setup.trader].cash, String(final.participants[setup.trader].cash));
  assert(indexer.metrics.notifications > 0);
  const budgets = (
    await runtime.store.pool.query(
      'SELECT name,wallet,cap,committed,spent FROM service_budgets WHERE run_id=$1 ORDER BY name',
      [runId],
    )
  ).rows;
  assert(budgets.every((b) => b.committed === '0' && BigInt(b.spent) <= BigInt(b.cap)));
  const rebuild = new Indexer({ ...indexer.config, runId: runId + '-rebuild' });
  try {
    await rebuild.open();
    await rebuild.cycle();
    assert.deepEqual((await rebuild.store.snapshot()).state, row.state);
  } finally {
    await rebuild.close();
  }
  const saved = await receipts();
  for (const r of saved)
    if (r.status === 'finalized') {
      const tx = await fetched(r.signature);
      assert.equal(tx.meta.err, null);
      const exact = await rpc.call('getTransaction', [
        r.signature,
        { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 },
      ]);
      assert.equal(exact.transaction[0], r.wire);
    }
  assert.deepEqual(errors, []);
  record(
    'all finalized browser signatures fetched independently; actual vault, PostgreSQL projection and fresh replay agree with WS evidence',
  );
  writeFileSync(
    `${dir}/browser.json`,
    json({
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
      browser: browser.version(),
      fixture: 'instrumented Wallet Standard; private keys stay in Node; no external provider claim',
      intents: await publicIntents(runtime.store.pool, runId),
      checks,
      unsignedRejections,
      signedRejections,
      fundingIntervalSeconds: 5,
      config,
      walletSignatures: saved.map(({ wire, ...r }) => ({
        ...r,
        wireSha256: createHash('sha256').update(Buffer.from(wire, 'base64')).digest('hex'),
      })),
      walletSignatureCount: walletSigned.length,
      metrics: indexer.metrics,
      budgets,
      final,
      projection: row.state,
      errors,
    }),
  );
  writeFileSync(`${dir}/browser-transactions.json`, json(transactions));
} catch (error) {
  await Promise.allSettled([
    runtime.snapshot().then((state) => writeFileSync(`${dir}/browser-failure-state.json`, json(state))),
    runtime.store.pool
      .query(
        'SELECT request_id,signature,status,attempts,result FROM service_intents WHERE run_id=$1 ORDER BY request_id',
        [runId],
      )
      .then((result) => writeFileSync(`${dir}/browser-failure-queue.json`, json(result.rows))),
  ]);
  writeFileSync(
    `${dir}/browser-failure-page.txt`,
    await page
      .locator('body')
      .innerText()
      .catch(() => ''),
  );
  writeFileSync(`${dir}/browser-failure.json`, json({ checks, error: (error as Error).stack, errors }));
  await page.screenshot({ path: `${dir}/browser-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  sourceRunning = false;
  await sourceLoop?.catch(() => {});
  for (const p of children) await stop(p).catch(() => {});
  running = false;
  await indexLoop;
  await browser.close();
  await readServer.close();
  await indexer.close();
  await runtime.close();
}
