import assert from 'node:assert/strict';
import {address, getAddressDecoder, type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from './events.js';
import {integer} from './rpc.js';
import {reconcileGroupLedger, type GroupState} from './group-projection.js';
import type {GroupBinding} from './group-store.js';

type Account = {owner:string; data:[string,string]} | null;
export type AccountBatch = (keys: string[]) => Promise<{context:{slot:number}; value:Account[]}>;

/** Fetch at most 100 accounts per RPC. Include the monotonically sequenced group
 * in EVERY chunk: account state may be compared only at the same group sequence.
 * This also covers a 64-member cohort with more than 100 total identity accounts. */
export async function reconcileGroupSnapshot(state: GroupState, binding: GroupBinding, read: AccountBatch) {
  assert(state.group, 'Missing group projection');
  reconcileGroupLedger(state);
  const group = address(binding.group), program = address(binding.program), options = {programAddress:program};
  const [canonicalGroup, groupBump] = await sdk.findGroupPda({domain:Buffer.from(binding.domain,'hex')}, options);
  assert.equal(group, canonicalGroup, 'Group PDA');
  const [registry, registryBump] = await sdk.findInitializeGroupV2RegistryPda({group}, options);
  const [vault, vaultBump] = await sdk.findClassifyGroupSurplusV2VaultPda({group}, options);
  assert.equal(state.group.vault, vault, 'Vault PDA');
  const [resolution, resolutionBump] = await sdk.findGroupResolutionPda({group}, options);
  const keys = [...new Set([group, registry, vault, ...Object.keys(state.markets), ...Object.keys(state.portfolios),
    ...state.members, ...Object.keys(state.makers), ...(state.resolution ? [resolution] : [])])];
  const accounts = new Map<string, Account>();
  let referenceGroup: string | undefined, minSlot: number | undefined, maxSlot = 0;
  for (let offset = 1; offset < keys.length; offset += 99) {
    const chunk = [group, ...keys.slice(offset, offset + 99)], response = await read(chunk);
    integer(response.context.slot);
    assert.equal(response.value.length, chunk.length, 'RPC account count');
    const current = response.value[0];
    assert(current && current.owner === program && current.data[1] === 'base64', 'Group account owner/encoding');
    if (referenceGroup) assert.equal(current.data[0], referenceGroup, 'Group changed during reconciliation; retry required');
    referenceGroup = current.data[0];
    minSlot = Math.min(minSlot ?? response.context.slot, response.context.slot);
    maxSlot = Math.max(maxSlot, response.context.slot);
    chunk.forEach((key, index) => accounts.set(key, response.value[index]));
  }
  const raw = (key: string, discriminator?: ReadonlyUint8Array, owner: string = program) => {
    const account = accounts.get(key);
    assert(account && account.owner === owner && account.data[1] === 'base64', 'Missing/foreign reconciliation account');
    const bytes = Buffer.from(account.data[0], 'base64');
    if (discriminator) assert(bytes.subarray(0,8).equals(Buffer.from(discriminator)), 'Wrong account discriminator');
    return bytes;
  };
  const compare = (actual: unknown, expected: object, label: string) => {
    const {discriminator, bump, vaultBump, ...fields} = JSON.parse(json(actual));
    assert.deepEqual(fields, expected, label);
  };
  const currentGroup = sdk.getClearingGroupV2Decoder().decode(raw(group, sdk.CLEARING_GROUP_V2_DISCRIMINATOR));
  assert.equal(currentGroup.sequence.toString(), state.sequence, 'Group sequence differs; backfill required');
  assert.equal(currentGroup.bump, groupBump); assert.equal(currentGroup.vaultBump, vaultBump);
  compare(currentGroup, state.group, 'Group projection');
  const members = sdk.getGroupRegistryV2Decoder().decode(raw(registry, sdk.GROUP_REGISTRY_V2_DISCRIMINATOR));
  assert.equal(members.schemaVersion, 2); assert.equal(members.group, group); assert.equal(members.bump, registryBump);
  assert.equal(members.count, state.members.length); assert.deepEqual(members.members, state.members, 'Complete member registry');
  for (const [key, market] of Object.entries(state.markets)) {
    const [canonical, bump] = await sdk.findGroupMarketPda(group, market.index, program);
    assert.equal(key, canonical);
    const value = sdk.getGroupMarketV2Decoder().decode(raw(key, sdk.GROUP_MARKET_V2_DISCRIMINATOR));
    assert.equal(value.bump, bump); compare(value, market, 'Market projection');
  }
  for (const [key, portfolio] of Object.entries(state.portfolios)) {
    const [canonical, bump] = await sdk.findPortfolioPda({group, owner:address(portfolio.owner), index:portfolio.index}, options);
    assert.equal(key, canonical);
    const value = sdk.getPortfolioV2Decoder().decode(raw(key, sdk.PORTFOLIO_V2_DISCRIMINATOR));
    assert.equal(value.bump, bump); compare(value, portfolio, 'Portfolio projection');
  }
  for (const [key, root] of Object.entries(state.roots)) {
    const [canonical, bump] = await sdk.findMarginPda({portfolio:address(root.portfolio), subaccountIndex:root.subaccountIndex}, options);
    assert.equal(key, canonical);
    const value = sdk.getMarginAccountV2Decoder().decode(raw(key, sdk.MARGIN_ACCOUNT_V2_DISCRIMINATOR));
    assert.equal(value.bump, bump); compare(value, root, 'Margin projection');
  }
  for (const [key, maker] of Object.entries(state.makers)) {
    const [canonical, bump] = await sdk.findGroupMakerPda(address(maker.market), maker.makerId, program);
    assert.equal(key, canonical);
    const value = sdk.getMakerRegistrationV2Decoder().decode(raw(key, sdk.MAKER_REGISTRATION_V2_DISCRIMINATOR));
    assert.equal(value.bump, bump); compare(value, maker, 'Maker projection');
  }
  if (state.resolution) {
    const value = sdk.getGroupResolutionV2Decoder().decode(raw(resolution, sdk.GROUP_RESOLUTION_V2_DISCRIMINATOR));
    assert.equal(value.schemaVersion, 2); assert.equal(value.group, group); assert.equal(value.bump, resolutionBump);
    assert.deepEqual(JSON.parse(json({header:value.header, rows:value.rows})), state.resolution, 'Resolution projection');
  }
  const token = raw(vault, undefined, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  assert.equal(token.length, 165); assert.equal(token[108], 1, 'Initialized SPL vault');
  assert.equal(getAddressDecoder().decode(token.subarray(0,32)), state.group.quoteMint, 'Vault mint');
  assert.equal(getAddressDecoder().decode(token.subarray(32,64)), group, 'Vault authority');
  const actual = token.readBigUInt64LE(64);
  assert(actual >= currentGroup.allocatedVault, 'Vault deficit');
  return {sequence:state.sequence, minSlot:String(minSlot), maxSlot:String(maxSlot), accounts:keys.length, members:members.count,
    actualVault:actual.toString(), allocatedVault:currentGroup.allocatedVault.toString(), unallocatedSurplus:(actual-currentGroup.allocatedVault).toString()};
}
