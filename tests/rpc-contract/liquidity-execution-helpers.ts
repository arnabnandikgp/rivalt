// Explicit test intents. This deliberately permits constructing inadmissible
// routes so real on-chain rejection/rollback can be exercised independently of
// the production SDK allocator's filtering.
import type { Address, TransactionSigner } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import type { CanonicalHarness } from './canonical-maker-cases.js';

type Setup = Awaited<ReturnType<typeof liquidityExecutionSetup>>;
export function executionTestHelpers(h: CanonicalHarness, setup: Setup) {
  const root = async (key: Address) => sdk.getMarginAccountDecoder().decode((await h.read(key))!);
  const guard = async (key: Address) => {
    const state = await root(key);
    return { safetyEpoch: sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!).epoch,
      venueTermsEpoch: sdk.getVenueDecoder().decode((await h.read(setup.venue))!).termsEpoch,
      nonce: state.nonce, stateVersion: state.stateVersion };
  };
  const route = async (input: { trader: Address; actor: TransactionSigner; marketIndex: 0 | 1; side: 0 | 1;
    makers: Setup['instances']; lots: bigint[]; reduceOnly?: boolean; generation?: bigint;
    allInLimit?: bigint; maxFee?: bigint; stored?: { id: bigint; version: bigint; filled: bigint } }) => {
    const { trader, actor, marketIndex, side, makers, lots } = input;
    const [first, second] = makers, state = await setup.marketState(marketIndex), slot = await setup.slot();
    const accounts = { ...setup.common, actor, market: setup.markets[marketIndex], otherMarket: setup.markets[1 - marketIndex],
      ledger: setup.ledgers[marketIndex], otherLedger: setup.ledgers[1 - marketIndex], trader,
      registry: first.liquidityRegistry, firstCapital: first.capital, firstRegistration: first.registration,
      firstProgram: first.pricingProgram, firstProgramData: first.controlCommon.programData, firstConfig: first.config, firstPrice: first.price,
      secondCapital: second?.capital ?? null, secondRegistration: second?.registration ?? null, secondProgram: second?.pricingProgram ?? null,
      secondProgramData: second?.controlCommon.programData ?? null, secondConfig: second?.config ?? null, secondPrice: second?.price ?? null };
    const shared = { ...accounts, guard: await guard(trader), startSlot: slot, expirySlot: slot + 100n,
      lots: lots.reduce((sum, value) => sum + value, 0n),
      legs: await Promise.all(makers.map(async (maker, index) => {
        const registered = await maker.registrationState(), config = await maker.state();
        return { lots: lots[index], authorityEpoch: registered.authorityEpoch, controlEpoch: config.controlEpoch,
          shapeEpoch: config.shapeEpoch, depthEpoch: registered.depthEpoch };
      })) };
    if (input.stored) return sdk.getExecuteLiquidityOrderInstructionAsync({ ...shared, ...input.stored });
    return sdk.getExecuteLiquidityRouteInstructionAsync({ ...shared, domain: setup.domain,
      termsEpoch: state.termsEpoch, configEpoch: state.configEpoch, side,
      allInLimit: input.allInLimit ?? (side === 0 ? 1_000_000_000n : 0n), maxFee: input.maxFee ?? 200_000n,
      reduceOnly: input.reduceOnly ?? false, generation: input.generation ?? null });
  };
  return { root, guard, route };
}
