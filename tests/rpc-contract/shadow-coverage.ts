// Fresh local qualification only. Both signers and the real settlement worker keep their normal economic instructions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type { CanonicalHarness } from './canonical-maker-cases.js';
import type { liquidityExecutionSetup } from './liquidity-execution-setup.js';

const tag = (name: string) => createHash('sha256').update('global:' + name).digest().subarray(0, 8);
const read = (address: Address) => ({ address, role: AccountRole.READONLY });
const write = (address: Address) => ({ address, role: AccountRole.WRITABLE });
function instruction(name: string, accounts: Instruction['accounts'], args: number[] = []): Instruction {
  return {programAddress: sdk.CLEARING_PROGRAM_ADDRESS, accounts, data: Buffer.concat([tag(name), Buffer.from(args)])};
}

export async function startShadow(h: CanonicalHarness, setup: Awaited<ReturnType<typeof liquidityExecutionSetup>>) {
  const {venue, registry, markets} = setup;
  const inputs = [venue, registry, ...markets].map(read);
  const lanes = await Promise.all(Array.from({length: 8}, async (_, index) => (await getProgramDerivedAddress({
    programAddress: sdk.CLEARING_PROGRAM_ADDRESS, seeds: [Buffer.from('coverage-lane'), getAddressEncoder().encode(venue), Uint8Array.of(index)],
  }))[0]));
  const roots = [...setup.roots, ...setup.instances.map(maker => maker.capital)];
  const body = new Map<Address, Address>();
  for (const key of roots) {
    const margin = sdk.getMarginAccountDecoder().decode((await h.read(key))!);
    assert.equal(margin.venue, venue);
    body.set(key, lanes[Number(margin.id % 8n)]);
  }
  assert.equal(BigInt(body.size), sdk.getVenueRegistryDecoder().decode((await h.read(registry))!).financialCount);
  const record = (key: Address) => instruction('record_coverage_row', [read(key), write(body.get(key)!)]);
  const observe = (target: number) => instruction('observe_coverage', [...inputs, ...lanes.map(read)], [target]);
  for (const [index, key] of lanes.entries()) {
    await h.send('open coverage lane ' + index, [instruction('open_coverage_lane', [
      {address: setup.payer.address, role: AccountRole.WRITABLE_SIGNER}, ...inputs, write(key), read(address('11111111111111111111111111111111')),
    ], [index])]);
  }
  // Nobody is trading while we copy the existing, completely provisioned financial set.
  // A signed observation must refuse until the last member is present.
  for (const [index, key] of roots.entries()) {
    if (index === roots.length - 1) {
      await h.send('reject incomplete coverage', [observe(1)], [], sdk.CLEARING_ERROR__EXIT_COHORT);
    }
    await h.send('seed coverage member ' + index, [record(key)]);
  }
  await h.send('observe initial ETH debtors', [observe(1)]);
  function decorate(instructions: Instruction[]) {
    return instructions.flatMap(ix => {
      if (ix.programAddress !== sdk.CLEARING_PROGRAM_ADDRESS) return [ix];
      const keys = new Set(ix.accounts?.filter(meta => body.has(meta.address) && (meta.role & 1) !== 0).map(meta => meta.address));
      const prefix: Instruction[] = [];
      if (Buffer.from(ix.data ?? []).subarray(0,8).equals(Buffer.from(sdk.PAY_ACCOUNT_GAIN_DISCRIMINATOR))) {
        prefix.push(observe(sdk.getPayAccountGainInstructionDataDecoder().decode(ix.data!).marketIndex));
      }
      return [...prefix, ix, ...Array.from(keys, record)];
    });
  }
  // Decode all eight lane bodies independently against the current canonical roots in one RPC bank.
  async function audit(rpc: {call(method: string, args: any[]): Promise<any>}) {
    const response = await rpc.call('getMultipleAccounts', [[...lanes, ...roots, registry], {encoding:'base64',commitment:'finalized'}]);
    const data = (index: number) => {
      const account = response.value[index];
      assert.equal(account.owner, sdk.CLEARING_PROGRAM_ADDRESS);
      return Buffer.from(account.data[0],'base64');
    };
    const decoded = new Map<bigint, Buffer>();
    const epoch = sdk.getVenueRegistryDecoder().decode(data(lanes.length + roots.length)).membershipEpoch;
    for (const [index] of lanes.entries()) {
      const bytes = data(index);
      assert(bytes.subarray(0,8).equals(createHash('sha256').update('account:CoverageLane').digest().subarray(0,8)));
      assert(bytes.subarray(8,40).equals(Buffer.from(getAddressEncoder().encode(venue))));
      assert.equal(bytes[40],index);
      assert.equal(bytes.readBigUInt64LE(42), epoch);
      const count = bytes.readUInt32LE(322);
      assert(count <= 16);
      for (let n=0; n<count; n++) {
        const row = bytes.subarray(326+64*n,326+64*(n+1)), id=row.readBigUInt64LE();
        assert.equal(Number(id % 8n),index); assert(!decoded.has(id)); decoded.set(id,row);
      }
    }
    assert.equal(decoded.size,roots.length);
    const signed128 = (bytes: Buffer, offset: number) => (bytes.readBigInt64LE(offset+8)<<64n)+bytes.readBigUInt64LE(offset);
    for (const [index] of roots.entries()) {
      const margin = sdk.getMarginAccountDecoder().decode(data(lanes.length+index)), row=decoded.get(margin.id)!;
      assert.equal(row.readBigUInt64LE(8),margin.cash);
      margin.positions.forEach((pos, market) => {
        assert.equal(row.readBigInt64LE(16+market*8),pos.lots);
        assert.equal(signed128(row,32+16*market),pos.virtualScaled+pos.lots*pos.fundingCheckpointScaled);
      });
    }
    return {slot:response.context.slot, members:decoded.size, membershipEpoch:epoch, lanes};
  }
  return {decorate, observe, audit, lanes, roots};
}
