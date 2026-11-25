import {AccountRole, createNoopSigner, type Address, type Instruction} from '@solana/kit';
import * as clearing from './generated/index.js';
import {previewLiquidityRoute, type LiquidityRouteInput} from './liquidity-route.js';
import {makerDepth, selectMakerIds} from './maker-shortlist.js';
import {LiquiditySearchLimitError} from './quantity-search.js';
import {accountGuard} from './account-snapshot.js';
import {requiredAccountMarkets, requiredAccountLiabilities} from './account-markets.js';
import {marketCheckpointsFor, venueMarketCheckpoints} from './market-checkpoints.js';
import {MAX_ACTION_LOTS} from './quantity-limits.js';
import {requireValue} from './wallet-client.js';

export const BEST_ROUTE_HEAP_BYTES = 128 * 1024;

function shortlist(input: LiquidityRouteInput, width: number, legLimit: number, priceDirectory: boolean) {
  const makers = input.snapshot.liquidity!.adapters;
  if (makers.length <= width) return [...makers];
  let previewIds: number[] = [];
  try {
    const quote = previewLiquidityRoute(input, true).allocation;
    previewIds = quote?.legs.map(leg => leg.instance) ?? [];
  } catch (error) {
    if (!(error instanceof LiquiditySearchLimitError)) throw error;
  }
  const depths = makers.map(maker => makerDepth(input, maker));
  let selected = selectMakerIds(depths, input.side, input.lots, legLimit, width, previewIds);
  if (priceDirectory) {
    try {
      const compared = previewLiquidityRoute(input, true, selected);
      if (compared.candidateInstances) selected = new Set(compared.candidateInstances);
    } catch (error) {
      if (!(error instanceof LiquiditySearchLimitError)) throw error;
    }
  }
  return makers.filter(maker => selected.has(maker.config.instance));
}

/** Ordinary market order against the signed shortlist at execution time. A snapshot
 * supplies identities and structural epochs. The signer does not pick legs. */
export async function buildBestRoute(input: LiquidityRouteInput, actor: Address) {
  return buildMarketOrder(input,actor,false,3);
}

/** Sign the separate local multi-maker instruction and its full candidate set. */
export async function buildMultiMakerRoute(input: LiquidityRouteInput, actor: Address, width = 3,
    deployment: 'multi-maker' | 'funded-multi-maker' = 'multi-maker') {
  requireValue(Number.isInteger(width) && width>=3 && width<=8,'Multi-maker candidate count must be between three and eight.');
  return buildMarketOrder(input,actor,true,width, deployment === 'funded-multi-maker');
}

async function buildMarketOrder(input: LiquidityRouteInput, actor: Address, multi: boolean, width: number, priceDirectory = false) {
  const {snapshot, trader, lots, marketIndex, side, maxFee, allInLimit} = input;
  const root = snapshot.roots[trader];
  requireValue(!input.stored && snapshot.commitment === 'confirmed' && snapshot.marginLayout === 'ledger-lanes'
    && snapshot.safetyState.mode === 1 && !snapshot.safetyState.paused && root?.role === 0
    && (actor === root.owner || actor === root.delegate && snapshot.slot < root.delegateExpirySlot),
    'An active ordinary market order requires its live trading authority.');
  requireValue(lots > 0n && lots <= MAX_ACTION_LOTS && (side === 0 || side === 1)
    && maxFee >= 0n && allInLimit >= 0n, 'Invalid order size, side or limits.');
  const liquidity = snapshot.liquidity;
  requireValue(liquidity && liquidity.adapters.length === liquidity.registryState.count && liquidity.adapters.length >= 3
    && liquidity.adapters.every((entry, index) => entry.registrationState.instance === index),
    'The complete ordered maker registry is required.');
  const candidates = shortlist(input,width,multi ? width : 2,priceDirectory);
  const [zero, one, two] = candidates;
  const roots = [root, ...candidates.map(maker => maker.capital)];
  const required = requiredAccountMarkets(roots, 1 << marketIndex);
  const liabilities = requiredAccountLiabilities(roots, 1 << marketIndex);
  const market = snapshot.marketStates[marketIndex];
  const expirySlot = snapshot.slot + 150n < market.validUntil ? snapshot.slot + 150n : market.validUntil;
  requireValue(expirySlot > snapshot.slot, 'Order risk window expired.');
  const position = root.positions[marketIndex];
  const accounts = {
    actor: createNoopSigner(actor), program: clearing.CLEARING_PROGRAM_ADDRESS, venue: snapshot.venue, safety: snapshot.safety, trader,
    registry: liquidity.registry, market: snapshot.markets[marketIndex], ledger: snapshot.ledgers[marketIndex],
    otherMarket: required & (1 << (1-marketIndex)) ? snapshot.markets[1-marketIndex] : undefined,
    otherLedger: liabilities & (1 << (1-marketIndex)) ? snapshot.ledgers[1-marketIndex] : undefined,
    zeroCapital: zero.registrationState.capital, zeroRegistration: zero.registration, zeroProgram: zero.registrationState.pricingProgram,
    zeroProgramData: zero.registrationState.programData, zeroConfig: zero.registrationState.config, zeroPrice: zero.registrationState.price,
    oneCapital: one.registrationState.capital, oneRegistration: one.registration, oneProgram: one.registrationState.pricingProgram,
    oneProgramData: one.registrationState.programData, oneConfig: one.registrationState.config, onePrice: one.registrationState.price,
    twoCapital: two.registrationState.capital, twoRegistration: two.registration, twoProgram: two.registrationState.pricingProgram,
    twoProgramData: two.registrationState.programData, twoConfig: two.registrationState.config, twoPrice: two.registrationState.price,
  };
  const epochs = candidates.map(maker => ({
    authority: maker.registrationState.authorityEpoch, control: maker.config.controlEpoch,
    shape: maker.config.shapeEpoch, depth: maker.registrationState.depthEpoch,
  }));
  const order = {
    guard: accountGuard(snapshot, trader), domain: snapshot.venueState.domain, configEpoch: market.configEpoch,
    termsEpoch: market.termsEpoch, startSlot: snapshot.slot, expirySlot, side, lots, maxFee, allInLimit,
    reduceOnly: input.reduceOnly ?? (side === 1 ? position.lots >= lots : -position.lots >= lots),
    generation: position.generation, makerEpochs:epochs.slice(0,3),
  };
  let instruction: Instruction = multi
    ? await clearing.getExecuteMultiRouteInstructionAsync({...accounts,order,extraEpochs:epochs.slice(3)})
    : await clearing.getExecuteBestRouteInstructionAsync({...accounts,...order});
  const ids = candidates.map(maker=>maker.config.instance);
  const missingLanes = liquidity.registryState.registrations.flatMap((address,id) =>
    !ids.includes(id) && ids.some(instance=>instance%3===id) ? [{address,role:AccountRole.WRITABLE}] : []);
  const bundles=candidates.slice(3).flatMap(maker=>[
    {address:maker.registrationState.capital,role:AccountRole.WRITABLE},
    {address:maker.registration,role:AccountRole.WRITABLE},
    ...[maker.registrationState.pricingProgram,maker.registrationState.programData,maker.registrationState.config,
      maker.registrationState.price].map(address=>({address,role:AccountRole.READONLY})),
  ]);
  if(bundles.length||missingLanes.length) instruction={...instruction,accounts:[...instruction.accounts!,...bundles,...missingLanes]};
  const checkpoints = marketCheckpointsFor(await venueMarketCheckpoints(snapshot.venue), instruction);
  return {instructions: [...checkpoints, instruction], expirySlot,candidateInstances:ids};
}
