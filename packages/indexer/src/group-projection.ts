import * as sdk from '@rivalt/sdk';
import type { ReadonlyUint8Array } from '@solana/kit';
import { json } from './events.js';
import type { GroupEvent } from './group-events.js';

export type Canonical<T> = T extends bigint | string ? string : T extends ReadonlyUint8Array ? string :
  T extends readonly (infer Item)[] ? Canonical<Item>[] : T extends object ? { [Key in keyof T]: Canonical<T[Key]> } : T;
type AccountFields<T> = Canonical<Omit<T, 'discriminator' | 'bump' | 'vaultBump'>>;
export type GroupRoot = AccountFields<sdk.MarginAccountV2>;
export type GroupMarket = AccountFields<sdk.GroupMarketV2>;
export type GroupState = {
  sequence: string;
  group: AccountFields<sdk.ClearingGroupV2> | null;
  portfolios: Record<string, AccountFields<sdk.PortfolioV2>>;
  members: string[];
  roots: Record<string, GroupRoot>;
  markets: Record<string, GroupMarket>;
  makers: Record<string, AccountFields<sdk.MakerRegistrationV2>>;
  resolution: { header: Canonical<sdk.GroupResolutionHeaderV2>; rows: Canonical<sdk.GroupResolutionRowV2>[] } | null;
};
export const emptyGroup = (): GroupState => ({sequence:'0', group:null, portfolios:{}, members:[], roots:{}, markets:{}, makers:{}, resolution:null});
const scale = 1_000_000_000n;
const abs = (value: bigint) => value < 0n ? -value : value;
const requireState = <T>(value: T | null | undefined, name: string): T => {
  if (value == null) throw new Error(`Missing group ${name}`);
  return value;
};
function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`Group projection: ${reason}`);
}
/** Bumps/discriminators are authenticated by RPC reconciliation, not invented by
 * an event which does not carry them. All economic fields remain exact. */
function fields<T>(value: T): AccountFields<T> {
  const {discriminator, bump, vaultBump, ...account} = JSON.parse(json(value));
  return account;
}
function zeroAccount<T>(decoder: {fixedSize: number; decode(bytes: Uint8Array): T}): AccountFields<T> {
  return fields(decoder.decode(new Uint8Array(decoder.fixedSize)));
}
const groupFields = ['schemaVersion','profileVersion','domain','authority','quoteMint','vault','markets','marketCount',
  'termsEpoch','configEpoch','sequence','mode','paused','totalCash','settlement','insurance','fees','allocatedVault'] as const;
const pools = ['mode','paused','termsEpoch','configEpoch','totalCash','settlement','insurance','fees','allocatedVault'] as const;

/** Replay one authenticated event. The caller stages a clone and commits it only
 * after this complete projection reconciles against one finalized RPC snapshot. */
export function projectGroup(state: GroupState, event: GroupEvent, group: string, domain: string) {
  const change = structuredClone(event.data);
  check(change.group === group, 'event group mismatch');
  check(BigInt(change.sequence) === BigInt(state.sequence) + 1n, 'critical sequence gap');
  const updateMarket = (market: any, key?: string) => {
    check(market.schemaVersion === 2 && market.group === group && [0,1].includes(market.index), 'market identity/version');
    const expected = requireState(state.group, 'state').markets[market.index];
    check(!key || key === expected, 'market key/index');
    const prior = requireState(state.markets[expected], 'market');
    check(market.symbol === prior.symbol && market.lotsPerUnit === prior.lotsPerUnit, 'immutable market units');
    state.markets[expected] = fields<sdk.GroupMarketV2>(market);
  };
  const updateRoot = (root: any, key?: string) => {
    const expected = state.members[root.id], prior = requireState(state.roots[expected], 'root');
    check(!key || key === expected, 'root key/ID');
    for (const field of ['schemaVersion','group','portfolio','owner','subaccountIndex','id','mode','isolatedMarketIndex','role'] as const)
      check(root[field] === prior[field], `immutable root ${field}`);
    state.roots[expected] = fields<sdk.MarginAccountV2>(root);
  };
  const updateMaker = (maker: any, key?: string) => {
    check(maker.schemaVersion === 2 && maker.group === group, 'maker schema/group');
    check(maker.market === state.group?.markets[maker.marketIndex] && [0,1].includes(maker.makerId), 'maker market/ID');
    const priorKey = key ?? Object.keys(state.makers).find(address => state.makers[address].capital === maker.capital);
    check(priorKey, 'unknown route maker');
    const capital = requireState(state.roots[maker.capital], 'maker capital');
    check(capital.role === 1 && capital.mode === 1 && capital.isolatedMarketIndex === maker.marketIndex && capital.owner === maker.owner, 'isolated maker capital');
    const prior = state.makers[priorKey];
    if (prior) for (const field of ['capital','owner','group','market','marketIndex','makerId','pricingProgram','config','programData'] as const)
      check(prior[field] === maker[field], `immutable maker ${field}`);
    state.makers[priorKey] = fields<sdk.MakerRegistrationV2>(maker);
  };
  switch (event.type) {
    case 'group-custody': {
      check(change.schemaVersion === 2 && change.profileVersion === 2 && change.domain === domain, 'custody schema/domain');
      check(Number.isInteger(change.kind) && change.kind >= 0 && change.kind <= 9, 'custody operation');
      if (change.kind === 0) {
        check(!state.group && change.sequence === '1', 'duplicate initialization');
        state.group = Object.fromEntries(groupFields.map(field => [field, change[field]])) as GroupState['group'];
      } else {
        const prior = requireState(state.group, 'state');
        for (const field of ['authority','quoteMint','vault','domain'] as const) check(prior[field] === change[field], `immutable group ${field}`);
        for (const field of groupFields) (prior as any)[field] = change[field];
      }
      if (change.kind === 1) {
        check(!state.markets[change.subject] && [0,1].includes(change.index) && state.group?.markets[change.index] === change.subject, 'market registration');
        const symbol = Buffer.alloc(8); symbol.write(change.index === 0 ? 'BTC' : 'ETH');
        state.markets[change.subject] = {...zeroAccount(sdk.getGroupMarketV2Decoder()), schemaVersion:2, group:change.group,
          index:change.index, symbol:symbol.toString('hex'), lotsPerUnit:change.index === 0 ? '1000000' : '100000', termsEpoch:'1', configEpoch:'1'};
      }
      if (change.kind === 2) {
        check(!state.portfolios[change.subject] && change.index < 4, 'portfolio registration');
        state.portfolios[change.subject] = {schemaVersion:2, group:change.group, owner:change.actor, index:change.index, children:0};
      }
      check(change.members.length <= 2 && new Set(change.members.map((member: any) => member.margin)).size === change.members.length, 'custody member shape');
      for (const member of change.members) {
        if (change.kind === 3) {
          check(member.id === state.members.length && member.id < 64 && member.margin === change.subject && !state.roots[member.margin], 'stable member identity');
          const portfolio = requireState(state.portfolios[member.portfolio], 'portfolio');
          check(member.owner === portfolio.owner && member.subaccountIndex <= 8 && !(portfolio.children & (1 << member.subaccountIndex)), 'immutable child');
          portfolio.children |= 1 << member.subaccountIndex;
          state.members.push(member.margin);
          const {margin, ...identity} = member;
          state.roots[margin] = {...zeroAccount(sdk.getMarginAccountV2Decoder()), ...identity, schemaVersion:2, group:change.group, delegateEpoch:'1'};
        } else {
          const root = requireState(state.roots[member.margin], 'custody root');
          for (const field of ['portfolio','owner','subaccountIndex','id','mode','isolatedMarketIndex','role'] as const)
            check(root[field] === member[field], `custody identity ${field}`);
          root.cash = member.cash; root.stateVersion = member.stateVersion;
        }
      }
      break;
    }
    case 'group-maker':
      check([0,1,2,3].includes(change.operation), 'maker operation');
      check((change.operation === 0) === !state.makers[change.registration], 'maker registration history');
      updateMaker(change.state, change.registration);
      requireState(state.markets[change.market], 'maker market').configEpoch = change.configEpoch;
      break;
    case 'group-oracle': updateMarket(change.state, change.market); break;
    case 'margin-authority': updateRoot(change.state, change.margin); break;
    case 'margin-netting':
      check(BigInt(change.cancelledScaled) > 0n, 'netting amount');
      updateRoot(change.state, change.margin);
      change.markets.forEach((market: any) => updateMarket(market));
      break;
    case 'group-order': case 'margin-order':
      updateRoot(change.state, change.margin);
      updateMarket(change.marketState, change.market);
      if (event.type === 'margin-order') updateMarket(change.otherMarketState, change.otherMarket);
      break;
    case 'group-route': case 'margin-route':
      check([2,3].includes(change.rootStates.length) && [1,2].includes(change.makerStates.length), 'route shape');
      check(new Set(change.rootStates.map((root: any) => root.id)).size === change.rootStates.length, 'duplicate route root');
      change.rootStates.forEach((root: any) => updateRoot(root));
      change.makerStates.forEach((maker: any) => updateMaker(maker));
      updateMarket(change.marketState, change.market);
      if (event.type === 'margin-route') updateMarket(change.otherMarketState, change.otherMarket);
      requireState(state.group, 'state').totalCash = change.totalCash;
      requireState(state.group, 'state').fees = change.fees;
      break;
    case 'group-liquidation':
      check(change.target.id !== change.receiver.id && BigInt(change.deficitAfter) < BigInt(change.deficitBefore), 'liquidation progress/identity');
      updateRoot(change.target); updateRoot(change.receiver);
      change.markets.forEach((market: any) => updateMarket(market));
      break;
    case 'group-safety': case 'group-resolution': {
      check(event.type === 'group-safety' ? [0,1,2,3,4,5,6].includes(change.kind) : [0,1,2,3].includes(change.kind), 'safety operation');
      const current = requireState(state.group, 'state');
      for (const field of pools) (current as any)[field] = change[field];
      change.markets.forEach((market: any) => updateMarket(market));
      check(change.roots.length <= 4 && new Set(change.roots.map((root: any) => root.id)).size === change.roots.length, 'safety roots');
      change.roots.forEach((root: any) => updateRoot(root));
      if (event.type === 'group-resolution') {
        if (change.kind === 0) {
          check(change.header.count === state.members.length && BigInt(change.header.epoch) === BigInt(state.resolution?.header.epoch ?? 0) + 1n, 'resolution cohort/epoch');
          const decoder = sdk.getGroupResolutionRowV2Decoder();
          state.resolution = {header:change.header, rows:Array.from({length:change.header.count}, () => JSON.parse(json(decoder.decode(new Uint8Array(decoder.fixedSize)))))};
        } else {
          const resolution = requireState(state.resolution, 'resolution');
          check(change.header.epoch === resolution.header.epoch && change.header.count === resolution.header.count, 'resolution identity');
          resolution.header = change.header;
        }
        check(change.rows.length <= 4 && new Set(change.rows.map((row: any) => row.id)).size === change.rows.length, 'resolution page');
        for (const update of change.rows) {
          check(update.id >= 0 && update.id < change.header.count, 'resolution row ID');
          state.resolution!.rows[update.id] = update.row;
        }
      }
      break;
    }
    default: throw new Error('Unsupported group projection event');
  }
  state.sequence = change.sequence;
  requireState(state.group, 'state').sequence = change.sequence;
  reconcileGroupLedger(state);
}

/** Accounting checks span the entire cohort; they never sum cash once per market. */
export function reconcileGroupLedger(state: GroupState) {
  const group = requireState(state.group, 'state'), roots = state.members.map(key => requireState(state.roots[key], 'member'));
  check(BigInt(group.allocatedVault) === BigInt(group.totalCash) + BigInt(group.settlement) + BigInt(group.insurance) + BigInt(group.fees), 'cash conservation');
  check(roots.reduce((sum, root) => sum + BigInt(root.cash), 0n) === BigInt(group.totalCash), 'root cash sum');
  roots.forEach((root, id) => {
    check(root.id === id && root.schemaVersion === 2 && root.positions.length === 2 && root.book.orders.length === 4 && root.book.protections.length === 2, 'bounded root shape');
    check([0,1].includes(root.mode) && (root.mode === 0 ? root.isolatedMarketIndex === 255 && root.role !== 1 : [0,1].includes(root.isolatedMarketIndex)), 'margin mode');
    if (root.mode === 1) root.positions.forEach((position, index) => {
      if (index !== root.isolatedMarketIndex) check(Object.values(position).every(value => value === '0'), 'foreign isolated position');
    });
    let reserved = 0n;
    for (const slot of root.book.orders) {
      const order = slot.order;
      if (![1,2].includes(order.state)) { check(BigInt(order.reserve) === 0n, 'inactive order reserve'); continue; }
      check([0,1].includes(slot.marketIndex) && (root.mode === 0 || slot.marketIndex === root.isolatedMarketIndex), 'order market');
      check(BigInt(order.filled) < BigInt(order.lots) && BigInt(order.feeCharged) === (BigInt(order.notional) + 4999n) / 5000n, 'order prefix');
      reserved += BigInt(order.reserve);
    }
    check(reserved === BigInt(root.reserved), 'cached order sum');
  });
  for (let index = 0; index < group.marketCount; index++) {
    const market = requireState(state.markets[group.markets[index]], 'market');
    const lots = roots.reduce((sum, root) => sum + BigInt(root.positions[index].lots), 0n);
    const gross = roots.reduce((sum, root) => sum + abs(BigInt(root.positions[index].lots)), 0n);
    check(lots === (group.mode === 3 ? BigInt(requireState(state.resolution, 'resolution').header.remainingLots[index]) : 0n), 'net exposure');
    check(gross === BigInt(market.grossLots), 'gross exposure');
  }
  if (group.mode === 3) { reconcileFrozenGroup(state); return; }
  const claims = roots.reduce((sum, root) => root.positions.reduce((total, position) => total + BigInt(position.virtualScaled) + BigInt(position.lots) * BigInt(position.fundingCheckpointScaled), sum), 0n);
  check(claims === BigInt(group.settlement) * scale, 'claims conservation');
}

function reconcileFrozenGroup(state: GroupState) {
  const group = state.group!, resolution = requireState(state.resolution, 'resolution'), header = resolution.header;
  check(group.paused && header.stage >= 1 && header.stage <= 12 && header.count === state.members.length && resolution.rows.length === header.count, 'frozen cohort');
  const insured = header.insuranceMoved ? BigInt(header.insuredAtoms) : 0n;
  check(BigInt(group.totalCash) === BigInt(header.initialCash) - BigInt(header.collectedTotal) + BigInt(header.paidApplied), 'frozen cash');
  check(BigInt(group.settlement) === BigInt(header.initialPool) + BigInt(header.collectedTotal) + insured - BigInt(header.paidApplied), 'frozen settlement');
  check(BigInt(group.insurance) === BigInt(header.initialInsurance) - insured && group.fees === header.initialFees && group.allocatedVault === header.initialVault, 'protected buckets');
  header.funding.forEach((funding, index) => check(state.markets[group.markets[index]].fundingIndexScaled === funding, 'frozen funding'));
  let collected = 0n, paid = 0n, originalClaims = 0n;
  for (const key of state.members) {
    const root = state.roots[key], row = resolution.rows[root.id];
    if (!(header.stage > 2 || header.stage === 2 && root.id < header.cursor)) continue;
    collected += BigInt(row.collected);
    originalClaims += BigInt(row.claimScaled) - BigInt(row.collected) * scale;
    const applied = header.stage > 10 || header.stage === 10 && root.id < header.cursor;
    check(BigInt(root.cash) === BigInt(row.cashBefore) - BigInt(row.collected) + (applied ? BigInt(row.paid) : 0n), 'frozen root cash');
    if (applied) {
      paid += BigInt(row.paid);
      root.positions.forEach((position, index) => check(position.lots === '0' && position.virtualScaled === '0' && position.fundingCheckpointScaled === (root.mode === 0 || root.isolatedMarketIndex === index ? header.funding[index] : '0') && BigInt(position.generation) === BigInt(row.generations[index]) + (row.lots[index] === '0' ? 0n : 1n), 'applied position'));
      check(root.reserved === '0' && root.book.orders.every(slot => ![1,2].includes(slot.order.state)) && root.book.protections.every(slot => slot.protection.remaining === '0'), 'applied authority');
    } else {
      const claim = root.positions.reduce((total, position, index) => {
        check(position.lots === row.lots[index] && position.generation === row.generations[index], 'frozen position');
        return total + BigInt(position.virtualScaled) + BigInt(position.lots) * (BigInt(header.prices[index]) * scale - BigInt(header.funding[index]) + BigInt(position.fundingCheckpointScaled));
      }, 0n);
      check(claim + BigInt(row.collected) * scale === BigInt(row.claimScaled), 'frozen valued claim');
    }
  }
  check(collected === BigInt(header.collectedTotal) && paid === BigInt(header.paidApplied), 'frozen applied totals');
  if (header.stage > 2) check(originalClaims === BigInt(header.initialPool) * scale, 'complete valued claims');
  if (header.stage >= 10) {
    const sum = (field: 'paid' | 'roundingScaled' | 'insuredScaled' | 'impairedScaled') => resolution.rows.reduce((total, row) => total + BigInt(row[field]), 0n);
    check(sum('paid') === BigInt(header.planPool) && sum('insuredScaled') === BigInt(header.insuredAtoms) * scale && sum('impairedScaled') === BigInt(header.debt) - BigInt(header.insuredAtoms) * scale, 'complete payment plan');
    check(sum('roundingScaled') === 0n && resolution.rows.every(row => abs(BigInt(row.roundingScaled)) < scale), 'fractional ownership');
  }
}
