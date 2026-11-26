import assert from 'node:assert/strict';
import {AccountRole, type Address, type Instruction, type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import {coverageLanes, openCoverageLane} from './shadow-coverage.js';

const is = (ix: Instruction, discriminator: ReadonlyUint8Array) => ix.programAddress === sdk.CLEARING_PROGRAM_ADDRESS
  && Buffer.from(ix.data ?? []).subarray(0,8).equals(Buffer.from(discriminator));
export const appendCoverage = (ix: Instruction, keys: Address[]): Instruction => ({...ix, accounts:[
  ...(ix.accounts ?? []), ...Array.from(new Set(keys), address => ({address,role:AccountRole.WRITABLE})),
]});

export function coverageProvisioning(transport: CanonicalHarness, payer: {address: Address},
  before?: (operation: string, ix: Instruction, keys: Address[], signers: Parameters<CanonicalHarness['send']>[2]) => Promise<void>) {
  const members = new Map<Address, Address>();
  const lanes: Address[] = [];
const h: CanonicalHarness = {...transport, async send(label, instructions, signers, error) {
  const decorated: Instruction[] = [];
  for (const ix of instructions) {
    const keys = (ix.accounts ?? []).filter(meta=>(meta.role & 1)!==0 && members.has(meta.address)).map(meta=>members.get(meta.address)!);
    if (is(ix,sdk.ACTIVATE_MARGIN_DISCRIMINATOR) || is(ix,sdk.DEPOSIT_ACCOUNT_DISCRIMINATOR)) {
      assert.equal(keys.length,1);
      await before?.(is(ix,sdk.ACTIVATE_MARGIN_DISCRIMINATOR) ? 'join' : 'deposit',ix,keys,signers);
      decorated.push(appendCoverage(ix,keys));
    } else decorated.push(ix);
  }
  await transport.send(label,decorated,signers,error);
  if (error!==undefined) return;
  for (const ix of instructions) {
    if (!ix.accounts || !ix.data) continue;
    const fixed = {...ix, accounts:ix.accounts, data:ix.data};
    if (is(ix,sdk.INITIALIZE_MARKET_DISCRIMINATOR)) {
      const parsed = sdk.parseInitializeMarketInstruction(fixed);
      if (parsed.data.index===1) {
        const venue = parsed.accounts.venue.address;
        const [registry] = await sdk.deriveVenueComponent(venue,'registry');
        const markets = sdk.getVenueDecoder().decode((await transport.read(venue))!).markets;
        lanes.push(...await coverageLanes(venue));
        for (const [index,key] of lanes.entries()) {
          await transport.send('open maintained lane '+index,[openCoverageLane(payer.address,[venue,registry,...markets],key,index)]);
        }
      }
    } else if (is(ix,sdk.REGISTER_MARGIN_DISCRIMINATOR)) {
      const key = sdk.parseRegisterMarginInstruction(fixed).accounts.margin.address;
      const margin = sdk.getMarginAccountDecoder().decode((await transport.read(key))!);
      members.set(key,lanes[Number(margin.id % 8n)]);
    }
  }
}};

  return {h, lanes, members};
}
