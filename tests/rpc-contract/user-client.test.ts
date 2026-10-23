import { describe, it, expect } from 'vitest';
import { address, blockhash, createNoopSigner, getProgramDerivedAddress } from '@solana/kit';
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import { fixtureKey } from './custody-cases.js';

const env: sdk.UserConfig = {
  version: 1,
  chain: 'solana:localnet',
  rpcUrl: 'http://127.0.0.1:18899',
  wsUrl: 'ws://127.0.0.1:18900',
  genesis: '11111111111111111111111111111111',
  anchor: '1'.repeat(88),
  market: address('11111111111111111111111111111111'),
  mint: address('11111111111111111111111111111111'),
  domain: '00'.repeat(32),
};
const participant = (changes: Record<string, unknown> = {}) =>
  ({
    cash: 1_000_000n,
    lots: 0n,
    virtualScaled: 0n,
    fundingCheckpointScaled: 0n,
    generation: 0n,
    book: sdk.emptyOrderBook(),
    ...changes,
  }) as any;
function snapshot(p: any, pool = 0n) {
  return {
    m: { mode: 2, paused: false, termsEpoch: 1n, configEpoch: 1n, fundingIndexScaled: 0n, settlement: pool },
    risk: { referencePrice: 60000n, lower: 59400n, upper: 60600n, oracle: { heldEpoch: 0n } },
    funding: 0n,
    slot: 100n,
    sourceMode: 'Normal',
    participants: {
      trader: p,
      counterparty: participant({
        cash: 1_000_000_000n,
        lots: -p.lots,
        virtualScaled: pool * 1_000_000_000n - p.virtualScaled,
        fundingCheckpointScaled: p.fundingCheckpointScaled,
      }),
    },
  } as unknown as sdk.UserSnapshot;
}

describe('direct user financial previews', () => {
  it('never uses positive unpaid profit as withdrawal collateral and rounds adverse loss upward', () => {
    const p = participant({ lots: 10n, virtualScaled: -590_000_000_000_000n }),
      s = snapshot(p);
    // Profit is 10,000 atoms at the index, but only cash minus 60,600 IM can leave.
    expect(sdk.userCapacity(s, p).withdrawable).toBe(939_400n);
    p.lots = -10n;
    p.virtualScaled = 590_000_000_000_000n;
    expect(sdk.userCapacity(snapshot(p), p).withdrawable).toBe(923_400n); // 16,000 liability + 60,600 IM.
    p.lots = 0n;
    p.virtualScaled = -1n;
    expect(sdk.userCapacity(snapshot(p), p).withdrawable).toBe(999_999n);
    p.cash = 3n;
    p.virtualScaled = 15_000_000_000n;
    expect(sdk.userCapacity(snapshot(p, 5n), p)).toMatchObject({ withdrawable: 3n, settleable: 5n });
  });
  it('reserves the full remaining order loss/IM and fee budget', () => {
    const p = participant(),
      s = snapshot(p);
    Object.assign(p.book.orders[0], {
      id: 1n,
      state: 1,
      side: 0,
      lots: 1n,
      filled: 0n,
      limit: 66000n,
      feeBudget: 100n,
      feeCharged: 0n,
      termsEpoch: 1n,
      startSlot: 1n,
      expirySlot: 200n,
    });
    expect(sdk.userCapacity(s, p).withdrawable).toBe(987_240n); // 6,600 loss + 6,060 IM + 100 fee.
    p.book.orders[0].termsEpoch = 0n;
    expect(sdk.userCapacity(s, p).withdrawable).toBe(1_000_000n);
  });
  it('requires complete conservative cohort solvency, credible exposed valuation and recovery', () => {
    const p = participant(),
      s = snapshot(p),
      other = participant({ cash: 10n, lots: 1n, virtualScaled: -59_400_000_000_000n });
    s.participants.other = other;
    s.participants.maker = participant({ lots: -1n, virtualScaled: 59_400_000_000_000n });
    s.risk!.oracle = {
      heldEpoch: 1n,
      sampledAt: 0n,
      heldUntil: 3600n,
      fundingBase: 0n,
      premiumScaled: 11_000_000_000n,
    } as any;
    expect(sdk.userCapacity(s, p).withdrawable).toBe(0n); // Future held endpoint exceeds the other account's cash.
    s.sourceMode = 'NoCredibleBounds';
    expect(sdk.userCapacity(s, p).withdrawable).toBe(0n);
    s.sourceMode = 'Normal';
    s.m.mode = 3;
    expect(sdk.userCapacity(s, p)).toMatchObject({ withdrawable: 0n, settleable: 0n });
  });
  it('binds the explicit local profile and rejects remote/wrong-cluster configuration', () => {
    expect(sdk.userConfig(env).chain).toBe('solana:localnet');
    expect(() => sdk.userConfig({ ...env, chain: 'solana:mainnet' })).toThrow(/test network/);
    expect(() => sdk.userConfig({ ...env, rpcUrl: 'https://api.devnet.solana.com' })).toThrow(
      /test RPC/,
    );
  });
});

it('verifies a real wallet signature and rejects a changed message before any broadcast', async () => {
  const owner = await fixtureKey('p10-signature-unit'),
    client = new sdk.UserClient(env);
  client.environment = async () => {};
  const [eventAuthority] = await getProgramDerivedAddress({
    programAddress: sdk.CLEARING_PROGRAM_ADDRESS,
    seeds: [new TextEncoder().encode('__event_authority')],
  });
  const ix = await sdk.getCancelOrderInstructionAsync({
    owner: createNoopSigner(owner.address),
    market: env.market,
    eventAuthority,
    program: sdk.CLEARING_PROGRAM_ADDRESS,
    id: 1n,
    version: 1n,
  });
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: blockhash(env.genesis),
      instructions: [ix],
    }).compileToV0Message(),
  );
  const prepared: sdk.PreparedTransaction = {
    label: 'Cancel order',
    transaction,
    message: sdk.toBase64(transaction.message.serialize()),
    owner: owner.address,
    fee: 5000n,
    lastValidBlockHeight: 100n,
    details: [],
  };
  await transaction.sign([owner]);
  const intent = await client.signed(prepared, transaction);
  expect(intent.status).toBe('pending');
  let broadcasts = 0;
  client.rpc.call = async () => {
    broadcasts++;
    return intent.signature;
  };
  await expect(client.broadcast({ ...intent, signature: 'foreign' })).rejects.toThrow(/identity mismatch/);
  expect(broadcasts).toBe(0);
  await client.broadcast(intent);
  expect(broadcasts).toBe(1);
  await expect(client.signed({ ...prepared, message: 'different' }, transaction)).rejects.toThrow(
    /different transaction/,
  );
  transaction.signatures[0] = new Uint8Array(64) as any;
  await expect(client.signed(prepared, transaction)).rejects.toThrow(/Invalid wallet signature/);
});

it('rebuilds the entire two-maker message and rejects malicious fees, accounts, side and stale authority', async () => {
  const { addresses } = await import('./custody-cases.js'),
    { makerAddresses } = await import('./maker-cases.js');
  const a = await addresses(),
    owner = await fixtureKey('p10-quote-unit'),
    [trader] = await sdk.findParticipantPda({ market: a.market, owner: owner.address });
  const domain = new Uint8Array(32),
    makers = await Promise.all(
      [0, 1].map(async (makerId) => {
        const x = await makerAddresses(makerId);
        return {
          registration: x.registration,
          approved: true,
          r: {
            makerId,
            market: a.market,
            owner: x.owner.address,
            capital: x.capital,
            pricingProgram: x.pricingProgram,
            programData: x.programData,
            config: x.config,
            quarantined: false,
            quoteEpoch: 1n,
            authorityEpoch: 1n,
            buyConsumed: 0n,
            sellConsumed: 0n,
            inventoryLimit: 100000n,
          },
          state: {
            version: 1,
            makerId,
            domain,
            market: a.market,
            capital: x.capital,
            quoteEpoch: 1n,
            startSlot: 1n,
            expirySlot: 1000n,
          },
        };
      }),
    );
  const [routeState] = await sdk.findRouteStatePda({ market: a.market }),
    p = participant({ owner: owner.address, nonce: 0n, generation: 0n });
  const s = {
    ...a,
    commitment: 'confirmed',
    routeState,
    m: { mode: 2, paused: false, domain, termsEpoch: 1n, configEpoch: 1n },
    risk: { referencePrice: 60000n, observationSequence: 1n, validUntil: 1000n },
    sourceMode: 'Normal',
    slot: 100n,
    makers,
    participants: {
      [trader]: p,
      ...Object.fromEntries(makers.map((x) => [x.r.capital, participant({ cash: 500000000n })])),
    },
  } as unknown as sdk.UserSnapshot;
  const [x, y] = makers,
    legs = [
      { lots: 21n, quoteEpoch: 1n, authorityEpoch: 1n },
      { lots: 79n, quoteEpoch: 1n, authorityEpoch: 1n },
    ];
  // Independent arithmetic: A 21*60010 + (0+...+20) = 1260420; B 79*60030 = 4742370.
  const ix = await sdk.getExecuteRouteInstructionAsync({
    ...a,
    routeState,
    owner: createNoopSigner(owner.address),
    trader,
    domain,
    termsEpoch: 1n,
    configEpoch: 1n,
    observationSequence: 1n,
    nonce: 0n,
    startSlot: 100n,
    expirySlot: 140n,
    side: 0,
    lots: 100n,
    allInLimit: 6003991n,
    maxFee: 1201n,
    reduceOnly: false,
    generation: 0n,
    legs,
    firstCapital: x.r.capital,
    firstRegistration: x.registration,
    firstProgram: x.r.pricingProgram,
    firstProgramData: x.r.programData,
    firstConfig: x.r.config,
    secondCapital: y.r.capital,
    secondRegistration: y.registration,
    secondProgram: y.r.pricingProgram,
    secondProgramData: y.r.programData,
    secondConfig: y.r.config,
  });
  const quote = {
    available: true,
    snapshotCommitment: 'confirmed',
    allocation: {
      legs: [
        { makerId: 0, lots: '21', grossQuote: '1260420' },
        { makerId: 1, lots: '79', grossQuote: '4742370' },
      ],
      grossQuote: '6002790',
      fee: '1201',
      allIn: '6003991',
    },
    instructions: [sdk.routeComputeBudget(), ix].map((i) => ({
      programAddress: i.programAddress,
      data: sdk.toBase64(i.data!),
      accounts: i.accounts?.map((a) => ({ address: a.address, role: a.role })) ?? [],
    })),
  };
  const client = new sdk.UserClient({ ...env, market: a.market });
  expect(await client.validateQuote(s, owner.address, 0, 100n, quote)).toMatchObject({
    gross: 6002790n,
    fee: 1201n,
    allIn: 6003991n,
  });
  const attacks = [
    (q: typeof quote) => { q.snapshotCommitment = 'finalized'; },
    (q: typeof quote) => {
      q.allocation.fee = '0';
    },
    (q: typeof quote) => {
      q.instructions[1].accounts[0].address = env.market;
    },
    (q: typeof quote) => {
      q.instructions[0].data = '';
    },
    (q: typeof quote) => {
      q.allocation.legs[1].makerId = 0;
    },
  ];
  await expect(client.validateQuote({ ...s, commitment: 'finalized' }, owner.address, 0, 100n, quote)).rejects.toThrow(/confirmed quote preview/);
  for (const change of attacks) {
    const q = structuredClone(quote);
    change(q);
    await expect(client.validateQuote(s, owner.address, 0, 100n, q)).rejects.toThrow();
  }
  await expect(client.validateQuote(s, owner.address, 1, 100n, quote)).rejects.toThrow(/changed/);
  await expect(client.validateQuote({ ...s, slot: 140n }, owner.address, 0, 100n, quote)).rejects.toThrow(
    /expired/,
  );
  p.nonce = 1n;
  await expect(client.validateQuote(s, owner.address, 0, 100n, quote)).rejects.toThrow(/changed/);
});

it('does not report final success for missing/conflicting fetched bytes or an expired unknown transaction', async () => {
  const client = new sdk.UserClient(env);
  client.environment = async () => {};
  const intent: sdk.SignedIntent = {
    id: 'one',
    owner: env.market,
    signature: 'sig',
    wire: 'saved',
    blockhash: 'hash',
    lastValidBlockHeight: '10',
    label: 'Deposit',
    createdAt: 0,
    status: 'pending',
  };
  client.rpc.call = async (method) =>
    method === 'getSignatureStatuses'
      ? { value: [{ confirmationStatus: 'finalized', err: null }] }
      : { meta: { err: null, fee: 5000 }, transaction: ['different', 'base64'] };
  expect((await client.reconcile(intent)).status).toBe('unresolved');
  client.rpc.call = async (method) =>
    method === 'getSignatureStatuses' ? { value: [null] } : { value: false };
  expect((await client.reconcile(intent)).status).toBe('unresolved');
  client.rpc.call = async (method) =>
    method === 'getSignatureStatuses'
      ? { value: [{ confirmationStatus: 'finalized', err: null }] }
      : { meta: { err: null, fee: 5000 }, transaction: ['saved', 'base64'] };
  expect(await client.reconcile(intent)).toMatchObject({ status: 'finalized', fee: '5000' });
});

it('keeps the read-only cohort proof separate from a participant cash mutation', async () => {
  const { addresses } = await import('./custody-cases.js'),
    a = await addresses(),
    owner = await fixtureKey('p10-exit-unit');
  const [participant] = await sdk.findParticipantPda({ market: a.market, owner: owner.address }),
    [guard] = await sdk.findGuardPda({ market: a.market }),
    [routeState] = await sdk.findRouteStatePda({ market: a.market });
  const s = {
    ...a,
    guard,
    routeState,
    m: { mode: 2, paused: false, sequence: 10n },
    risk: { observationSequence: 5n },
    certificate: { sequence: 0n, observation: 0n, count: 0, next: 0 },
    members: [participant],
    participants: { [participant]: { owner: owner.address } },
  } as unknown as sdk.UserSnapshot;
  const client = new sdk.UserClient(env),
    proof = await client.exitInstructions(s, owner.address, env.mint, 1n);
  expect(proof.verificationOnly).toBe(true);
  expect(proof.instructions).toHaveLength(2);
  const message = new TransactionMessage({
    payerKey: owner.publicKey,
    recentBlockhash: blockhash(env.genesis),
    instructions: proof.instructions,
  }).compileToV0Message();
  const index = message.staticAccountKeys.findIndex((k) => k.address === participant);
  expect(message.isAccountWritable(index)).toBe(false);
  Object.assign(s.certificate!, { sequence: 10n, observation: 5n, count: 1, next: 1 });
  const exit = await client.exitInstructions(s, owner.address, env.mint, 1n);
  expect(exit.verificationOnly).toBe(false);
  expect(exit.instructions).toHaveLength(2);
  expect(sdk.getWithdrawTradingInstructionDataDecoder().decode(exit.instructions[1].data!).amount).toBe(1n);
});
