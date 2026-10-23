import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Rpc } from '../../packages/indexer/src/rpc.js';
import { checkedGenesis, configuration, programDataAddress, programDataIdentity, unsigned } from './devnet-preflight-support.js';

const config = configuration(process.env), rpc = new Rpc(config.rpc);
const build = JSON.parse(readFileSync('.local/devnet/build.json', 'utf8'));
assert.equal(build.sourceDirty, false, 'Deploy only an identified clean build');
const genesis = checkedGenesis(await rpc.call('getGenesisHash'));
const rows = Object.entries(build.artifacts) as Array<[string, { program: string; elfBytes: string; elfSha256: string; idlSha256?: string }]>;
const programs = await rpc.call('getMultipleAccounts', [rows.map(([, a]) => a.program), { encoding: 'base64', commitment: 'finalized' }]);
const addresses = programs.value.map(programDataAddress);
const data = await rpc.call('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized', minContextSlot: Number(unsigned(programs.context.slot)) }]);
const artifacts = rows.map(([name, artifact], i) => {
  const identity = programDataIdentity(data.value[i]);
  assert.equal(identity.upgradeAuthority, build.profile.deployer);
  const bytes = Buffer.from(data.value[i].data[0], 'base64').subarray(45);
  const elf = readFileSync(`.local/devnet/deploy/${name}.so`);
  assert.equal(createHash('sha256').update(elf).digest('hex'), artifact.elfSha256);
  assert.equal(elf.length.toString(), artifact.elfBytes);
  assert(bytes.subarray(0, elf.length).equals(elf) && bytes.subarray(elf.length).every(x => x === 0), 'Deployed bytes differ from tested ELF');
  return { name, ...artifact, programData: addresses[i], ...identity, programLamports: unsigned(programs.value[i].lamports), programDataLamports: unsigned(data.value[i].lamports), exactElfWithZeroPadding: true };
});
const balance = await rpc.call('getBalance', [build.profile.deployer, { commitment: 'finalized' }]);
const report = { result: 'pass', observedUtc: new Date().toISOString(), buildRevision: build.revision, genesis, endpoint: config.endpointLabel,
  programContext: unsigned(programs.context.slot), programDataContext: unsigned(data.context.slot), artifacts, deployerBalanceLamports: unsigned(balance.value), a18Complete: false };
writeFileSync('.local/devnet/deployed.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: 'pass', programs: artifacts.length, report: '.local/devnet/deployed.json', a18Complete: false }));
