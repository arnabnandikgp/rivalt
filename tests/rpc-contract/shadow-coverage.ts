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

export async function coverageLanes(venue: Address) {
  return Promise.all(Array.from({length: 8}, async (_, index) => (await getProgramDerivedAddress({
    programAddress: sdk.CLEARING_PROGRAM_ADDRESS, seeds: [Buffer.from('coverage-lane'), getAddressEncoder().encode(venue), Uint8Array.of(index)],
  }))[0]));
}

export function openCoverageLane(payer: Address, inputs: Address[], key: Address, index: number) {
  return instruction('open_coverage_lane', [
    {address: payer, role: AccountRole.WRITABLE_SIGNER}, ...inputs.map(read), write(key), read(address('11111111111111111111111111111111')),
  ], [index]);
}

export function observeCoverage(inputs: Address[], lanes: Address[], target: number) {
  return instruction('observe_coverage', [...inputs.map(read), ...lanes.map(read)], [target]);
}

export async function startShadow(h: CanonicalHarness, setup: Awaited<ReturnType<typeof liquidityExecutionSetup>>) {
  const {venue, registry, markets} = setup;
  const inputs = [venue, registry, ...markets];
  const lanes = await coverageLanes(venue);
  const roots = [...setup.roots, ...setup.instances.map(maker => maker.capital)];
  const body = new Map<Address, Address>();
  for (const key of roots) {
    const margin = sdk.getMarginAccountDecoder().decode((await h.read(key))!);
    assert.equal(margin.venue, venue);
    body.set(key, lanes[Number(margin.id % 8n)]);
  }
  assert.equal(BigInt(body.size), sdk.getVenueRegistryDecoder().decode((await h.read(registry))!).financialCount);
  const record = (key: Address) => instruction('record_coverage_row', [read(key), write(body.get(key)!)]);
  const observe = (target: number) => observeCoverage(inputs, lanes, target);
  for (const [index, key] of lanes.entries()) {
    await h.send('open coverage lane ' + index, [openCoverageLane(setup.payer.address, inputs, key, index)]);
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
      // Clearing requires contiguous market/ledger checkpoints immediately before the payout.
      // Observe after the payment and before copying its new root. The lanes still contain
      // the pre-payment book, and the instruction uses the same slot and checkpointed markets.
      const observations: Instruction[] = [];
      if (Buffer.from(ix.data ?? []).subarray(0,8).equals(Buffer.from(sdk.PAY_ACCOUNT_GAIN_DISCRIMINATOR))) {
        observations.push(observe(sdk.getPayAccountGainInstructionDataDecoder().decode(ix.data!).marketIndex));
      }
      return [ix, ...observations, ...Array.from(keys, record)];
    });
  }
  const audit = (rpc: BankReader) => auditCoverage(rpc, venue, registry, lanes, roots);
  return {decorate, observe, audit, lanes, roots};
}

type BankReader = {call(method: string, args: any[]): Promise<any>};

// Each batch reads its roots, registry and eight lanes in the same finalized bank.
export async function auditCoverage(rpc: BankReader, venue: Address, registry: Address, lanes: Address[], roots: Address[], maintained = false, rowsPerLane = 16, grouped = false) {
    const witnesses = [...lanes, registry];
    const chunkSize = 100 - witnesses.length;
    assert(lanes.length === 8 && new Set(roots).size === roots.length);
    let witnessBytes: Buffer[] | undefined;
    const rootBytes: Buffer[] = [];
    let slot = 0;
    for (let offset = 0; offset < roots.length || offset === 0; offset += chunkSize) {
      const keys = [...witnesses, ...roots.slice(offset, offset + chunkSize)];
      const response = await rpc.call('getMultipleAccounts', [keys, {encoding:'base64',commitment:'finalized',minContextSlot:slot}]);
      assert.equal(response.value.length, keys.length);
      assert(response.context.slot >= slot);
      slot = response.context.slot;
      const bytes = response.value.map((account: {owner:string;data:[string,string]}) => {
        assert.equal(account.owner, sdk.CLEARING_PROGRAM_ADDRESS);
        return Buffer.from(account.data[0],'base64');
      });
      const batchWitnesses = bytes.slice(0, witnesses.length);
      if (witnessBytes) assert.deepEqual(batchWitnesses, witnessBytes, 'Coverage changed between audit batches');
      else witnessBytes = batchWitnesses;
      rootBytes.push(...bytes.slice(witnesses.length));
    }
    assert(witnessBytes);
    const decoded = new Map<bigint, Buffer>();
    const state = sdk.getVenueRegistryDecoder().decode(witnessBytes[lanes.length]);
    const epoch = state.membershipEpoch;
    assert.equal(state.financialCount, BigInt(roots.length));
    const signed128 = (bytes: Buffer, offset: number) => (bytes.readBigInt64LE(offset+8)<<64n)+bytes.readBigUInt64LE(offset);
    const groupRevisions: string[][] = [];
    let openMembers = 0;
    const openByMarket = [0,0];
    for (const [index] of lanes.entries()) {
      const bytes: Buffer = witnessBytes[index];
      assert(bytes.subarray(0,8).equals(createHash('sha256').update('account:CoverageLane').digest().subarray(0,8)));
      assert(bytes.subarray(8,40).equals(Buffer.from(getAddressEncoder().encode(venue))));
      assert.equal(bytes[40],index);
      assert.equal(bytes.readBigUInt64LE(42), maintained ? 1n : epoch);
      const count = bytes.readUInt32LE(322);
      assert(count <= rowsPerLane);
      if (rowsPerLane === 125) assert.equal(bytes.length, 326 + 64*rowsPerLane + 74 + (grouped ? 8*138 : 0));
      if (grouped) {
        const revisions: string[] = [];
        for (let first=0; first<count; first+=16) {
          const size = Math.min(16,count-first);
          const start = 8400 + (first/16)*138;
          const revision = bytes.readBigUInt64LE(start);
          assert(revision>0n);
          revisions.push(String(revision));
          assert.equal(bytes[start+8], size);
          const infinity = 1n<<127n;
          const ranges = Array.from({length:4},()=>[-infinity,infinity-1n]);
          let funded = true;
          // Independently intersect integer solutions of lots * price >= -(cash budget + fixed claim).
          const floor = (a:bigint,b:bigint) => a/b - (a%b<0n ? 1n : 0n);
          for (let offset=first; offset<first+size; offset++) {
            const row = bytes.subarray(326+64*offset);
            const lots=[row.readBigInt64LE(16),row.readBigInt64LE(24)];
            const fixed=[signed128(row,32),signed128(row,48)];
            const free=row.readBigUInt64LE(8)*1_000_000_000n+fixed.reduce((sum,value,m)=>
              sum+(lots[m]===0n && value<0n ? value : 0n),0n);
            funded &&= free>=0n;
            for(const [m,quantity] of lots.entries()) {
              if(!quantity) continue;
              const cross=lots.every(value=>value!==0n);
              const budgets=cross ? [[m,m===0 ? free/2n : free-free/2n],[m+2,0n]] as const : [[m,free]] as const;
              for(const [index,budget] of budgets) {
                const limit=quantity>0n ? -floor(fixed[m]+budget,quantity) : floor(fixed[m]+budget,-quantity);
                if(quantity>0n && limit>ranges[index][0]) ranges[index][0]=limit;
                if(quantity<0n && limit<ranges[index][1]) ranges[index][1]=limit;
              }
            }
          }
          assert.equal(bytes[start+9], Number(funded));
          ranges.flat().forEach((value,i)=>assert.equal(signed128(bytes,start+10+16*i),value));
        }
        groupRevisions.push(revisions);
      }
      for (let n=0; n<count; n++) {
        const row = bytes.subarray(326+64*n,326+64*(n+1)), id=row.readBigUInt64LE();
        assert.equal(Number(id % 8n),index); assert(!decoded.has(id)); decoded.set(id,row);
      }
    }
    assert.equal(decoded.size,roots.length);
    for (const [index] of roots.entries()) {
      const margin = sdk.getMarginAccountDecoder().decode(rootBytes[index]), row=decoded.get(margin.id)!;
      if (margin.positions.some(pos=>pos.lots!==0n)) openMembers++;
      assert.equal(row.readBigUInt64LE(8),margin.cash);
      margin.positions.forEach((pos, market) => {
        if (pos.lots!==0n) openByMarket[market]++;
        assert.equal(row.readBigInt64LE(16+market*8),pos.lots);
        assert.equal(signed128(row,32+16*market),pos.virtualScaled+pos.lots*pos.fundingCheckpointScaled);
      });
    }
    return {slot, members:decoded.size, membershipEpoch:epoch, lanes, openMembers, openByMarket, ...(grouped ? {groupRevisions} : {})};
  }
