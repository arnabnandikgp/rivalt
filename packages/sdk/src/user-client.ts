import {WalletClient, hex, toBase64, fromBase64, requireValue, rpcInteger} from './wallet-client.js';
export {UserRpc, hex, toBase64, fromBase64, rpcInteger, transactionError, walletMessageDifference} from './wallet-client.js';
export type {PreparedTransaction, SignedIntent} from './wallet-client.js';
import {
  AccountRole,
  address,
  createNoopSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from '@solana/kit';
import { getMintDecoder, getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import * as c from './generated/index.js';
import * as makerA from './generatedMakerA/index.js';
import { effectiveFunding, oracleMode, accruedBalance } from './oracle-policy.js';
import { orderReserve } from './order-policy.js';
import { quoteMaker } from './quote-maker.js';
import { routeComputeBudget } from './route-budget.js';
import { testDeployment, testRpcUrl, DEVNET_GENESIS, type TestChain } from './test-deployment.js';
import { reconcileResolution } from './resolution-policy.js';

const SCALE = 1_000_000_000n;
const clock = address('SysvarC1ock11111111111111111111111111111111');
const bytes = (s: string) => new TextEncoder().encode(s);
const min = (...xs: bigint[]) => xs.reduce((a, b) => (a < b ? a : b)),
  max = (a: bigint, b: bigint) => (a > b ? a : b),
  abs = (n: bigint) => (n < 0n ? -n : n);

export type UserConfig = {
  version: 1;
  chain: TestChain;
  rpcUrl: string;
  wsUrl: string;
  genesis: string;
  anchor: string;
  market: Address;
  mint: Address;
  domain: string;
};
export function userConfig(value: any): UserConfig {
  requireValue(
    value?.version === 1 && ['solana:localnet', 'solana:devnet'].includes(value.chain),
    'This build requires a configured test network.',
  );
  testDeployment(value.chain);
  if (value.chain === 'solana:devnet') requireValue(value.genesis === DEVNET_GENESIS, 'Devnet genesis mismatch.');
  for (const key of ['rpcUrl', 'wsUrl'] as const) {
    testRpcUrl(value[key], value.chain, key === 'wsUrl');
    // Browser configuration uses credential-free public endpoints or a local proxy.
    const url = new URL(value[key]);
    requireValue(!url.search && !url.hash, 'Public RPC configuration cannot contain credentials.');
  }
  requireValue(
    typeof value.domain === 'string' && /^[0-9a-f]{64}$/.test(value.domain),
    'Invalid market domain.',
  );
  requireValue(
    typeof value.anchor === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value.anchor),
    'Missing initialization identity.',
  );
  return {
    ...value,
    market: address(value.market),
    mint: address(value.mint),
    genesis: address(value.genesis),
  };
}

export type UserSnapshot = Awaited<ReturnType<UserClient['snapshot']>>;

/** User-owned RPC operations. No venue HTTP service, relay key or private key is required. */
export class UserClient extends WalletClient {
  readonly deployment: ReturnType<typeof testDeployment>;
  readonly options: { programAddress: ReturnType<typeof testDeployment>['clearing'] };
  constructor(readonly config: UserConfig) {
    super(userConfig(config).rpcUrl);
    this.deployment = testDeployment(config.chain);
    this.options = { programAddress: this.deployment.clearing };
  }
  async environment() {
    const [genesis, anchor] = await Promise.all([
      this.rpc.call('getGenesisHash'),
      this.rpc.call('getTransaction', [
        this.config.anchor,
        { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 0 },
      ]),
    ]);
    requireValue(
      genesis === this.config.genesis,
      'Wrong cluster. The RPC genesis differs from this test deployment.',
    );
    requireValue(
      anchor?.meta?.err === null && anchor.transaction?.signatures?.[0] === this.config.anchor,
      'Deployment history is unavailable or this test deployment was reset.',
    );
  }
  async snapshot(commitment: 'confirmed' | 'finalized' = 'finalized') {
    requireValue(['confirmed', 'finalized'].includes(commitment), 'Unsupported snapshot commitment.');
    await this.environment();
    const market = this.config.market;
    const [[canonical], [registry], [routeState], [guard], [vault], [resolution], [eventAuthority]] =
      await Promise.all([
        c.findMarketPda(this.options),
        c.findRegistryPda({ market }, this.options),
        c.findRouteStatePda({ market }, this.options),
        c.findGuardPda({ market }, this.options),
        c.findVaultPda({ market }, this.options),
        c.findResolutionPda({ market }, this.options),
        getProgramDerivedAddress({
          programAddress: this.deployment.clearing,
          seeds: [bytes('__event_authority')],
        }),
      ]);
    requireValue(market === canonical, 'Market address mismatch.');
    const registrations = await Promise.all(
      [0, 1].map(
        async (id) =>
          (
            await getProgramDerivedAddress({
              programAddress: this.deployment.clearing,
              seeds: [bytes('maker'), getAddressEncoder().encode(market), Uint8Array.of(id)],
            })
          )[0],
      ),
    );
    const first = await this.rpc.call('getMultipleAccounts', [
      [registry, ...registrations],
      { encoding: 'base64', commitment },
    ]);
    const decodeAccount = <T>(account: any, owner: string, decode: (data: Uint8Array) => T): T => {
      requireValue(
        account?.owner === owner && account.data?.[1] === 'base64',
        'Missing or foreign account. Refresh the deployment.',
      );
      return decode(fromBase64(account.data[0]));
    };
    const initialRegistry = decodeAccount(first.value[0], this.deployment.clearing, (b) =>
      c.getParticipantRegistryDecoder().decode(b),
    );
    requireValue(
      initialRegistry.count === initialRegistry.members.length && initialRegistry.count <= 64,
      'Unsupported registry.',
    );
    const initialMakers = registrations.flatMap((registration, i) =>
      first.value[i + 1]
        ? [
            {
              registration,
              r: decodeAccount(first.value[i + 1], this.deployment.clearing, (b) =>
                c.getMakerRegistrationDecoder().decode(b),
              ),
            },
          ]
        : [],
    );
    const keys = [
      clock,
      market,
      registry,
      routeState,
      guard,
      vault,
      this.config.mint,
      resolution,
      ...initialRegistry.members,
      ...initialMakers.flatMap((x) => [x.registration, x.r.config, x.r.programData]),
    ];
    const response = await this.rpc.call('getMultipleAccounts', [
      keys,
      { encoding: 'base64', commitment },
    ]);
    const raw = (key: Address, owner: string = this.deployment.clearing) =>
      decodeAccount(response.value[keys.indexOf(key)], owner, (b) => b);
    const m = c.getMarketStateDecoder().decode(raw(market)),
      reg = c.getParticipantRegistryDecoder().decode(raw(registry));
    requireValue(
      m.schemaVersion === 1 &&
        m.profileVersion === 1 &&
        [0, 1, 2, 3].includes(m.mode) &&
        hex(m.domain) === this.config.domain &&
        m.quoteMint === this.config.mint &&
        m.vault === vault,
      'Market profile or deployment binding differs.',
    );
    requireValue(
      reg.market === market &&
        reg.count === initialRegistry.count &&
        reg.members.every((k, i) => k === initialRegistry.members[i]),
      'Registry changed; refresh.',
    );
    const participants = Object.fromEntries(
      await Promise.all(
        reg.members.map(async (k, id) => {
          const p = c.getParticipantDecoder().decode(raw(k));
          requireValue(
            p.schemaVersion === 1 &&
              p.market === market &&
              p.id === id &&
              (await c.findCapitalPda({ market, owner: p.owner }, this.options))[0] === k,
            'Participant binding mismatch.',
          );
          return [k, p] as const;
        }),
      ),
    );
    const mint = getMintDecoder().decode(raw(this.config.mint, TOKEN_PROGRAM_ADDRESS));
    requireValue(mint.decimals === 6, 'Test collateral must have six decimals.');
    const token = getTokenDecoder().decode(raw(vault, TOKEN_PROGRAM_ADDRESS));
    requireValue(token.mint === this.config.mint && token.owner === market, 'Vault binding mismatch.');
    const risk = response.value[keys.indexOf(routeState)]
      ? c.getTestRouteStateDecoder().decode(raw(routeState))
      : null;
    const certificate = response.value[keys.indexOf(guard)]
      ? c.getExitGuardDecoder().decode(raw(guard))
      : null;
    const resolutionState = response.value[keys.indexOf(resolution)]
      ? c.getResolutionStateDecoder().decode(raw(resolution))
      : null;
    requireValue(!risk || risk.market === market, 'Risk account binding mismatch.');
    requireValue(!certificate || certificate.market === market, 'Exit account binding mismatch.');
    requireValue(
      !resolutionState || (resolutionState.market === market && resolutionState.version === 1),
      'Resolution binding mismatch.',
    );
    const cash = Object.values(participants).reduce((n, p) => n + p.cash, 0n);
    requireValue(
      cash === m.totalCash &&
        m.allocatedVault === cash + m.settlement + m.insurance + m.fees &&
        token.amount >= m.allocatedVault,
      'Vault or cash reconciliation unavailable.',
    );
    if (m.mode === 3) reconcileResolution(m, risk, participants, resolutionState);
    else
      requireValue(
        Object.values(participants).reduce((n, p) => n + p.lots, 0n) === 0n &&
          Object.values(participants).reduce(
            (n, p) => n + p.virtualScaled + p.lots * p.fundingCheckpointScaled,
            0n,
          ) ===
            m.settlement * SCALE,
        'Position or claim reconciliation unavailable.',
      );
    const clockBytes = raw(clock, 'Sysvar1111111111111111111111111111111111111');
    const now = new DataView(clockBytes.buffer, clockBytes.byteOffset).getBigInt64(32, true),
      slot = rpcInteger(response.context.slot);
    const makers = await Promise.all(
      initialMakers.map(async (x) => {
        const r = c.getMakerRegistrationDecoder().decode(raw(x.registration)),
          program = r.makerId === 0 ? this.deployment.makerA : this.deployment.makerB;
        requireValue(
          r.makerId === registrations.indexOf(x.registration) &&
            r.market === market &&
            r.pricingProgram === program &&
            r.config === x.r.config &&
            r.programData === x.r.programData &&
            participants[r.capital]?.owner === r.owner,
          'Maker binding mismatch.',
        );
        const state = makerA.getMakerConfigDecoder().decode(raw(r.config, program)).state;
        const approved =
          hex(
            new Uint8Array(
              await crypto.subtle.digest(
                'SHA-256',
                new Uint8Array(raw(r.programData, 'BPFLoaderUpgradeab1e11111111111111111111111')),
              ),
            ),
          ) === hex(r.approvedHash);
        return { registration: x.registration, r, state, approved };
      }),
    );
    return {
      commitment,
      market,
      registry,
      routeState,
      guard,
      vault,
      resolution,
      eventAuthority,
      program: this.deployment.clearing,
      m,
      risk,
      certificate,
      resolutionState,
      participants,
      members: reg.members,
      makers,
      slot,
      now,
      funding: effectiveFunding(m, risk, now, slot),
      sourceMode: oracleMode(m, risk, now, slot),
      actualVault: token.amount,
    };
  }
  async walletTokens(owner: Address) {
    const result = await this.rpc.call('getTokenAccountsByOwner', [
      owner,
      { mint: this.config.mint },
      { encoding: 'base64', commitment: 'finalized' },
    ]);
    return result.value.map((x: any) => {
      requireValue(x.account.owner === TOKEN_PROGRAM_ADDRESS, 'Foreign collateral account.');
      const token = getTokenDecoder().decode(fromBase64(x.account.data[0]));
      requireValue(
        token.owner === owner && token.mint === this.config.mint,
        'Collateral owner/mint mismatch.',
      );
      return { address: address(x.pubkey), amount: token.amount };
    }) as { address: Address; amount: bigint }[];
  }
  async user(s: UserSnapshot, owner: Address) {
    const [participant] = await c.findCapitalPda({ market: s.market, owner }, this.options);
    return { participant, p: s.participants[participant], signer: createNoopSigner(owner) };
  }
  async validateQuote(s: UserSnapshot, owner: Address, side: number, lots: bigint, quote: any) {
    const { participant, p, signer } = await this.user(s, owner);
    requireValue(p && s.risk && !s.m.paused && s.m.mode === 2, 'Trading is unavailable.');
    requireValue(quote?.snapshotCommitment === 'confirmed' && s.commitment === 'confirmed',
      'Refresh the confirmed quote preview. Finalized balances are separate.');
    requireValue(
      quote?.available === true &&
        quote.instructions?.length === 2 &&
        quote.allocation?.legs?.length >= 1 &&
        quote.allocation.legs.length <= 2,
      'No supported quote available.',
    );
    const encoded = fromBase64(quote.instructions[1].data);
    const [d, end] = c.getExecuteRouteInstructionDataDecoder().read(encoded, 0);
    requireValue(
      end === encoded.length &&
        d.side === side &&
        d.lots === lots &&
        d.nonce === p.nonce &&
        d.termsEpoch === s.m.termsEpoch &&
        d.configEpoch === s.m.configEpoch &&
        d.observationSequence === s.risk.observationSequence &&
        hex(d.domain) === hex(s.m.domain),
      'Quote changed or expired. Request a new quote.',
    );
    const reduceOnly = (side === 1 && p.lots >= lots) || (side === 0 && -p.lots >= lots);
    requireValue(
      d.reduceOnly === reduceOnly && d.generation.__option === 'Some' && d.generation.value === p.generation,
      'Quote position authority mismatch.',
    );
    requireValue(
      s.sourceMode === 'Normal' || (s.sourceMode === 'Degraded' && reduceOnly),
      'Source conditions block this trade.',
    );
    requireValue(
      d.startSlot <= s.slot &&
        d.expirySlot > s.slot &&
        d.expirySlot <= d.startSlot + 150n &&
        d.expirySlot <= s.risk.validUntil,
      'Quote expired. Request a new quote.',
    );
    const selected = quote.allocation.legs.map((l: any) => s.makers.find((m) => m.r.makerId === l.makerId));
    requireValue(
      selected.every(Boolean) &&
        new Set(selected.map((x: any) => x.r.makerId)).size === selected.length &&
        selected.length === d.legs.length,
      'Quote maker identity mismatch.',
    );
    const legs: { makerId: number; lots: bigint; gross: bigint }[] = selected.map(
      (x: UserSnapshot['makers'][number], i: number) => {
        const leg = d.legs[i],
          capital = s.participants[x.r.capital];
        requireValue(
          x.approved &&
            !x.r.quarantined &&
            x.r.capital !== participant &&
            leg.quoteEpoch === x.r.quoteEpoch &&
            leg.authorityEpoch === x.r.authorityEpoch &&
            d.expirySlot <= x.state.expirySlot,
          'Maker quote expired or unavailable.',
        );
        const result = quoteMaker(x.state, {
          version: 1,
          domain: s.m.domain,
          market: s.market,
          capital: x.r.capital,
          quoteEpoch: x.r.quoteEpoch,
          authorityEpoch: x.r.authorityEpoch,
          termsEpoch: s.m.termsEpoch,
          marketConfigEpoch: s.m.configEpoch,
          side,
          lots: leg.lots,
          inventory: capital.lots,
          cash: capital.cash,
          inventoryLimit: x.r.inventoryLimit,
          consumed: side === 0 ? x.r.buyConsumed : x.r.sellConsumed,
          referencePrice: s.risk!.referencePrice,
          slot: s.slot,
        });
        requireValue(
          String(leg.lots) === quote.allocation.legs[i].lots &&
            String(result.grossQuote) === quote.allocation.legs[i].grossQuote,
          'Quote price changed. Request a new quote.',
        );
        return { makerId: x.r.makerId, lots: leg.lots, gross: result.grossQuote };
      },
    );
    const gross = legs.reduce((n: bigint, l: any) => n + l.gross, 0n),
      fee = (gross + 4999n) / 5000n,
      allIn = side === 0 ? gross + fee : gross - fee;
    requireValue(
      legs.reduce((n: bigint, l: any) => n + l.lots, 0n) === lots &&
        d.maxFee === fee &&
        d.allInLimit === allIn &&
        quote.allocation.grossQuote === String(gross) &&
        quote.allocation.fee === String(fee) &&
        quote.allocation.allIn === String(allIn),
      'Quote amount or fee mismatch.',
    );
    const [first, second] = selected;
    const ix = await c.getExecuteRouteInstructionAsync({
      ...s,
      owner: signer,
      trader: participant,
      ...d,
      generation: p.generation,
      firstCapital: first.r.capital,
      firstRegistration: first.registration,
      firstProgram: first.r.pricingProgram,
      firstProgramData: first.r.programData,
      firstConfig: first.r.config,
      secondCapital: second?.r.capital,
      secondRegistration: second?.registration,
      secondProgram: second?.r.pricingProgram,
      secondProgramData: second?.r.programData,
      secondConfig: second?.r.config,
    }, this.options);
    const instructions = [routeComputeBudget(), ix];
    instructions.forEach((expected, i) => {
      const actual = quote.instructions[i];
      requireValue(
        actual.programAddress === expected.programAddress &&
          actual.data === toBase64(expected.data!) &&
          JSON.stringify(actual.accounts ?? []) ===
            JSON.stringify(expected.accounts?.map((a) => ({ address: a.address, role: a.role })) ?? []),
        'Unexpected quote instruction. Nothing was signed.',
      );
    });
    return { instructions, legs, gross, fee, allIn, expirySlot: d.expirySlot };
  }
  async exitInstructions(
    s: UserSnapshot,
    owner: Address,
    userToken: Address,
    amount: bigint,
    settle = false,
  ) {
    const { participant, p, signer } = await this.user(s, owner);
    requireValue(p && amount > 0n && !s.m.paused && s.m.mode !== 3, 'Exit is unavailable.');
    if (s.m.mode === 0) {
      requireValue(!settle, 'No settlement in custody mode.');
      return {
        instructions: [
          await c.getWithdrawInstructionAsync({
            ...s,
            owner: signer,
            participant,
            quoteMint: this.config.mint,
            userToken,
            amount,
          }, this.options),
        ],
        verificationOnly: false,
      };
    }
    requireValue(s.risk && s.certificate, 'Exit accounts are unavailable.');
    const stamp = { sequence: s.m.sequence, observation: s.risk.observationSequence };
    const valid =
      s.certificate.sequence === stamp.sequence &&
      s.certificate.observation === stamp.observation &&
      s.certificate.count === s.members.length;
    const start = valid ? s.certificate.next : 0,
      instructions: Instruction[] = [];
    if (start < s.members.length) {
      const page = s.members.slice(start, start + 8);
      const ix = await c.getCheckExitCohortInstructionAsync({ ...s, ...stamp, start }, this.options);
      instructions.push({
        ...ix,
        accounts: [...ix.accounts, ...page.map((key) => ({ address: key, role: AccountRole.READONLY }))],
      });
      // Solana promotes account writability across the whole message. Combining
      // a proof containing this participant with its cash mutation would violate
      // the proof instruction's read-only cohort contract. Verify explicitly,
      // then prepare a new transaction against the completed, unchanged stamp.
      return { instructions: [routeComputeBudget(), ...instructions], verificationOnly: true };
    }
    instructions.push(
      settle
        ? await c.getSettleGainInstructionAsync({ ...s, participant, ...stamp, amount }, this.options)
        : await c.getWithdrawTradingInstructionAsync({
            ...s,
            owner: signer,
            participant,
            quoteMint: this.config.mint,
            userToken,
            ...stamp,
            amount,
          }, this.options),
    );
    return { instructions: [routeComputeBudget(), ...instructions], verificationOnly: false };
  }
}

/** Conservative displayed capacity; an actual simulated cohort check still precedes signing. */
export function userCapacity(s: UserSnapshot, p: c.Participant) {
  if (s.m.paused || s.m.mode === 3)
    return { withdrawable: 0n, settleable: 0n, reason: 'Market recovery is in progress.' };
  if (s.m.mode === 0) return { withdrawable: p.cash, settleable: 0n, reason: null };
  if (
    !s.risk ||
    (s.sourceMode === 'NoCredibleBounds' && Object.values(s.participants).some((x) => x.lots !== 0n))
  )
    return { withdrawable: 0n, settleable: 0n, reason: 'A complete cohort needs credible valuation.' };
  const r = s.risk!,
    o = r.oracle;
  const end =
    s.m.mode === 2 && o.heldEpoch === s.m.configEpoch && o.heldUntil > o.sampledAt
      ? o.fundingBase + (o.premiumScaled * (o.heldUntil - o.sampledAt)) / 3600n
      : s.funding;
  const bounds = [
    min(s.funding, end, s.m.fundingIndexScaled),
    max(max(s.funding, end), s.m.fundingIndexScaled),
  ];
  const liability = (x: c.Participant, f: bigint) => {
    const a = accruedBalance(x, f),
      u = a.virtualScaled + a.lots * (a.lots >= 0n ? max(r.lower, 1n) : max(r.upper, 1n)) * SCALE;
    return u < 0n ? (-u + SCALE - 1n) / SCALE : 0n;
  };
  if (Object.values(s.participants).some((x) => bounds.some((f) => x.cash < liability(x, f))))
    return { withdrawable: 0n, settleable: 0n, reason: 'Cohort solvency check is unavailable.' };
  const current = accruedBalance(p, s.funding),
    unpaid = current.virtualScaled + current.lots * r.referencePrice * SCALE;
  const reserve = orderReserve(
    current,
    s.m.termsEpoch,
    s.slot,
    s.sourceMode === 'NoCredibleBounds' ? 1n : r.lower,
    s.sourceMode === 'NoCredibleBounds' ? 1_000_000n : r.upper,
  );
  const im = (abs(p.lots) * max(r.upper, 1n) + 9n) / 10n;
  const needed = liability(p, s.funding) + im + reserve,
    available = max(0n, min(unpaid / SCALE, s.m.settlement));
  return {
    withdrawable: max(0n, p.cash - needed),
    settleable: p.cash + available >= needed ? available : 0n,
    reason: null,
  };
}
