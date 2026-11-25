/** Offline benchmark of the SDK after its final trade-snapshot RPC response. */
import assert from 'node:assert/strict';
import { loadSnapshotFixture } from './wallet-snapshot-fixture.js';
import { compareWalletTimings, decodeWithMapping, replayWallet, summary } from './wallet-snapshot-replay.js';
import { mock } from 'node:test';
import * as kit from '@solana/kit';

type Stage = 'codeBase64' | 'accountBase64' | 'makerHash' | 'address';
type Interval = { stage: Stage; start: number; end: number };
const { bank, wallets, identity, slot, codeAccounts, codeStrings } = loadSnapshotFixture(process.argv.slice(2));
const codeSizes = new Set([...codeStrings].map((encoded) => Buffer.byteLength(encoded, 'base64')));

let recording: Interval[] | undefined;
let useSdk = false;
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
mock.module(new URL('../../packages/sdk/src/wallet-client.ts', import.meta.url).href, {
  cache: true,
  namedExports: {
    ...client,
    fromBase64(value: string) {
      const decode = useSdk ? client.fromBase64 : decodeWithMapping;
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
  try {
    return await replayWallet(readAccountTradeSnapshot, accountBank, slot, identity, wallet, () => {
      if (intervals) recording = intervals;
    });
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

// Test both decoders against the exact inputs before timing. Snapshot objects
// contain per-call quote closures, so compare all serializable state separately.
const stateJson = (value: unknown) =>
  JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
for (const {
  data: [encoded],
} of bank.values()) {
  const reference = Buffer.from(encoded, 'base64');
  assert.equal(Buffer.compare(client.fromBase64(encoded), reference), 0);
  assert.equal(Buffer.compare(decodeWithMapping(encoded), reference), 0);
}
for (const text of ['', 'YQ', ' YQ==\n', 'YWJjZA=='])
  assert.deepEqual(decodeWithMapping(text), client.fromBase64(text));
for (const decode of [decodeWithMapping, client.fromBase64])
  for (const text of ['Y', 'Y!==', '===', '-_']) {
    assert.throws(() => decode(text), { name: 'InvalidCharacterError' });
  }
for (const wallet of wallets) {
  useSdk = false;
  const original = await replay(wallet);
  useSdk = true;
  assert.equal(stateJson((await replay(wallet)).snapshot), stateJson(original.snapshot));
}
const [key] = codeAccounts,
  originalCode = bank.get(key)!;
const changed = Buffer.from(originalCode.data[0], 'base64');
changed[changed.length - 1] ^= 1;
const alteredBank = new Map(bank).set(key, { ...originalCode, data: [changed.toString('base64'), 'base64'] });
for (const sdk of [true, false]) {
  useSdk = sdk;
  for (const wallet of [wallets[0], wallets[1]]) {
    const { snapshot } = await replay(wallet, undefined, alteredBank);
    const affected = snapshot.liquidity!.adapters.filter(
      (adapter) => adapter.registrationState.programData === key,
    );
    assert(affected.length > 0 && affected.every((adapter) => adapter.unavailable === 'unapproved-code'));
  }
}

useSdk = false;
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

const comparisons = await compareWalletTimings(wallets, (variant, wallet) => {
  useSdk = variant === 'sdk';
  return replay(wallet);
});
console.log(
  JSON.stringify(
    {
      node: process.version,
      slot,
      bankAccounts: bank.size,
      wallets: wallets.length,
      codeBytes: [...codeStrings].map((encoded) => Buffer.byteLength(encoded, 'base64')),
      legacyBreakdown: breakdown,
      comparisons,
    },
    null,
    2,
  ),
);
