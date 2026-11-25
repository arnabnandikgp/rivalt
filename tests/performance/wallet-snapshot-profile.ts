/** Offline benchmark of the SDK after its final trade-snapshot RPC response. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mock } from 'node:test';
import * as kit from '@solana/kit';

type Stage = 'codeBase64' | 'accountBase64' | 'makerHash' | 'address';
type Interval = { stage: Stage; start: number; end: number };
type BankAccount = { owner: string; executable: boolean; data: [string, 'base64'] };
type Offer = { wallet: number; market: 0 | 1; slot: number };
const [bankFile, runDir, slotArg] = process.argv.slice(2);
assert(
  bankFile && runDir && slotArg,
  'Pass a ledger-tool JSON account export, split run directory and bank slot',
);
const slot = Number(slotArg);
assert(Number.isSafeInteger(slot) && slot > 0);
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const bank = new Map<string, BankAccount>(
  (read(bankFile).accounts as { pubkey: string; account: BankAccount }[]).map(({ pubkey, account }) => [
    pubkey,
    account,
  ]),
);
const { state, binding } = read(join(runDir, 'sql-wallet-contention-snapshot.json'));
// The journal identifies the two deployed binaries. Verify their complete
// ProgramData (including the loader header) independently on the exported bank.
const codeAccounts = new Set<string>();
for (const maker of Object.values(state.liquidity.makers) as {
  programData: string;
  approvedHash: string;
}[]) {
  const account = bank.get(maker.programData);
  assert(account && !account.executable && account.owner === 'BPFLoaderUpgradeab1e11111111111111111111111');
  assert.equal(
    createHash('sha256').update(Buffer.from(account.data[0], 'base64')).digest('hex'),
    maker.approvedHash,
  );
  codeAccounts.add(maker.programData);
}
assert.equal(codeAccounts.size, 2);
const codeStrings = new Set([...codeAccounts].map((key) => bank.get(key)!.data[0]));
const codeSizes = new Set([...codeStrings].map((text) => Buffer.byteLength(text, 'base64')));
const { roles, windows, placement } = read(join(runDir, 'contention-windows.json'));
assert.equal(placement, 'split');
const window = windows.find((entry: { wallets: number }) => entry.wallets === 12);
const offers: Offer[] = window.entries;
assert(slot < Math.min(...offers.map((offer) => offer.slot)));
const identity = {
  venue: kit.address(binding.venue),
  mint: kit.address(state.venue.quoteMint),
  domain: binding.domain,
  marginLayout: 'ledger-lanes',
} as const;
const wallets = [...new Set(offers.map((offer) => offer.wallet))].map((wallet) => {
  const market = offers.find((offer) => offer.wallet === wallet)!.market;
  const trader = Object.keys(roles).find((key) => roles[key] === 'wallet margin ' + wallet);
  assert(
    trader && offers.filter((offer) => offer.wallet === wallet).every((offer) => offer.market === market),
  );
  return { trader: kit.address(trader), market };
});
assert.equal(wallets.length, 12);

let recording: Interval[] | undefined;
let useCandidate = false;
const originalPda = kit.getProgramDerivedAddress;
mock.module('@solana/kit', {
  cache: true,
  namedExports: {
    ...kit,
    getProgramDerivedAddress(...args: Parameters<typeof originalPda>) {
      const log = recording;
      if (!log) return originalPda(...args);
      const start = performance.now();
      return originalPda(...args).finally(() =>
        log.push({ stage: 'address', start, end: performance.now() }),
      );
    },
  },
});
const client = await import('../../packages/sdk/src/wallet-client.js');
// Preserve atob's input validation and replace only the per-character mapping.
function decodeWithLoop(value: string) {
  const text = atob(value),
    bytes = new Uint8Array(text.length);
  for (let offset = 0; offset < text.length; offset++) bytes[offset] = text.charCodeAt(offset);
  return bytes;
}
mock.module(new URL('../../packages/sdk/src/wallet-client.ts', import.meta.url).href, {
  cache: true,
  namedExports: {
    ...client,
    fromBase64(value: string) {
      const decode = useCandidate ? decodeWithLoop : client.fromBase64;
      if (!recording) return decode(value);
      const start = performance.now(),
        bytes = decode(value);
      const end = performance.now();
      recording.push({ stage: codeStrings.has(value) ? 'codeBase64' : 'accountBase64', start, end });
      return bytes;
    },
  },
});
const digest = crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest = (algorithm, input) => {
  // PDA seed digests are small and already belong to address derivation.
  const log = recording;
  if (!log || !codeSizes.has(input.byteLength)) return digest(algorithm, input);
  assert.equal(algorithm, 'SHA-256');
  const start = performance.now();
  return digest(algorithm, input).finally(() =>
    log.push({ stage: 'makerHash', start, end: performance.now() }),
  );
};
const { readAccountTradeSnapshot } = await import('../../packages/sdk/src/account-snapshot.js');

async function replay(wallet: (typeof wallets)[number], intervals?: Interval[], accountBank = bank) {
  let reads = 0,
    start = 0;
  const rpc = {
    async call(method: string, params: unknown[] = []) {
      assert.equal(method, 'getMultipleAccounts');
      const [keys, opts] = params as [string[], { encoding: string; minContextSlot?: number }];
      assert.equal(opts.encoding, 'base64');
      assert((opts.minContextSlot ?? 0) <= slot);
      const values = keys.map((key) => {
        const account = accountBank.get(key);
        assert(account, 'Missing bank account ' + key);
        return account;
      });
      assert.equal(keys.length, [1, 4, 5, 44][reads++]);
      if (reads === 4) {
        if (intervals) recording = intervals;
        start = performance.now();
      }
      return { context: { slot }, value: values };
    },
  };
  try {
    const snapshot = await readAccountTradeSnapshot(rpc, identity, wallet.trader, wallet.market);
    const end = performance.now();
    assert.equal(reads, 4);
    assert.equal(snapshot.slot, BigInt(slot)); // Verify the bank export against its real Clock bytes.
    assert.equal(snapshot.liquidity!.adapters.length, 4);
    return { start, end, snapshot };
  } finally {
    if (intervals) recording = undefined;
  }
}

function profile(start: number, end: number, intervals: Interval[]) {
  // Address derivations may run concurrently. Charge their union once; detect
  // cross-category overlaps explicitly. All remaining time stays unattributed.
  const boundaries = [
    ...new Set([start, end, ...intervals.flatMap((event) => [event.start, event.end])]),
  ].sort((a, b) => a - b);
  assert.equal(boundaries[0], start);
  assert.equal(boundaries.at(-1), end);
  const totals = { codeBase64: 0, accountBase64: 0, makerHash: 0, address: 0, overlap: 0, other: 0 };
  for (let i = 1; i < boundaries.length; i++) {
    const left = boundaries[i - 1],
      right = boundaries[i];
    const active = new Set(
      intervals.filter((event) => event.start <= left && event.end >= right).map((event) => event.stage),
    );
    const [stage] = active;
    totals[active.size > 1 ? 'overlap' : (stage ?? 'other')] += right - left;
  }
  assert.equal(intervals.filter((event) => event.stage === 'makerHash').length, 2);
  assert.equal(intervals.filter((event) => event.stage === 'codeBase64').length, 2);
  assert(
    intervals.some((event) => event.stage === 'accountBase64') &&
      intervals.some((event) => event.stage === 'address'),
  );
  const partition = Object.values(totals).reduce((sum, duration) => sum + duration, 0);
  assert(Math.abs(partition - (end - start)) < 1e-6);
  return totals;
}

const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p: number) => Number(sorted[Math.ceil(sorted.length * p) - 1].toFixed(2));
  return { samples: values.length, p50Ms: quantile(0.5), p95Ms: quantile(0.95) };
};
// Test both decoders against the exact inputs before timing. Snapshot objects
// contain per-call quote closures, so compare all serializable state separately.
const stateJson = (value: unknown) =>
  JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
for (const {
  data: [encoded],
} of bank.values()) {
  const reference = Buffer.from(encoded, 'base64');
  assert.equal(Buffer.compare(client.fromBase64(encoded), reference), 0);
  assert.equal(Buffer.compare(decodeWithLoop(encoded), reference), 0);
}
for (const text of ['', 'YQ', ' YQ==\n', 'YWJjZA=='])
  assert.deepEqual(decodeWithLoop(text), client.fromBase64(text));
for (const decode of [decodeWithLoop, client.fromBase64])
  for (const text of ['Y', 'Y!==', '===', '-_']) {
    assert.throws(() => decode(text), { name: 'InvalidCharacterError' });
  }
for (const wallet of wallets) {
  useCandidate = false;
  const original = await replay(wallet);
  useCandidate = true;
  assert.equal(stateJson((await replay(wallet)).snapshot), stateJson(original.snapshot));
}
const [key] = codeAccounts,
  originalCode = bank.get(key)!;
const changed = Buffer.from(originalCode.data[0], 'base64');
changed[changed.length - 1] ^= 1;
const alteredBank = new Map(bank).set(key, { ...originalCode, data: [changed.toString('base64'), 'base64'] });
for (const candidate of [true, false]) {
  useCandidate = candidate;
  for (const wallet of [wallets[0], wallets[1]]) {
    const { snapshot } = await replay(wallet, undefined, alteredBank);
    const affected = snapshot.liquidity!.adapters.filter(
      (adapter) => adapter.registrationState.programData === key,
    );
    assert(affected.length > 0 && affected.every((adapter) => adapter.unavailable === 'unapproved-code'));
  }
}

useCandidate = false;
const profiled: ReturnType<typeof profile>[] = [];
for (let round = 0; round < 4; round++)
  for (const wallet of wallets) {
    const intervals: Interval[] = [],
      { start, end } = await replay(wallet, intervals);
    profiled.push(profile(start, end, intervals));
  }
const stages = Object.keys(profiled[0]) as (keyof (typeof profiled)[number])[];
const total = profiled.reduce((sum, one) => sum + Object.values(one).reduce((a, b) => a + b, 0), 0);
const breakdown = Object.fromEntries(
  stages.map((stage) => [
    stage,
    {
      ...summary(profiled.map((one) => one[stage])),
      percent: Number(((100 * profiled.reduce((sum, one) => sum + one[stage], 0)) / total).toFixed(2)),
    },
  ]),
);

// Alternate execution order so neither decoder always benefits from running second.
const timings = {
  original: { single: [] as number[], twelve: [] as number[] },
  candidate: { single: [] as number[], twelve: [] as number[] },
};
for (let round = 0; round < 6; round++) {
  for (const variant of (round % 2 ? ['candidate', 'original'] : ['original', 'candidate']) as (
    'original' | 'candidate'
  )[]) {
    useCandidate = variant === 'candidate';
    for (const wallet of wallets) {
      const { start, end } = await replay(wallet);
      timings[variant].single.push(end - start);
    }
    const batch = await Promise.all(wallets.map((wallet) => replay(wallet)));
    timings[variant].twelve.push(...batch.map(({ start, end }) => end - start));
  }
}
const comparisons = Object.fromEntries(
  Object.entries(timings).map(([variant, samples]) => [
    variant,
    {
      single: summary(samples.single),
      twelve: summary(samples.twelve),
    },
  ]),
);
console.log(
  JSON.stringify(
    {
      node: process.version,
      slot,
      bankAccounts: bank.size,
      wallets: wallets.length,
      codeBytes: [...codeStrings].map((encoded) => Buffer.byteLength(encoded, 'base64')),
      breakdown,
      comparisons,
    },
    null,
    2,
  ),
);
