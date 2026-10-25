import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { Runtime } from '@rivalt/services';
import { makerConfig, protectedJson } from './config.js';
import { makerFailureReason } from './diagnostics.js';

const config = makerConfig(protectedJson(process.argv[2]));
const database = process.env[config.databaseEnv]; assert(database, 'Configure the private operator database environment');
const signer = await Keypair.fromSecretKey(Uint8Array.from(protectedJson(config.signerPath)));
assert.equal(signer.address, config.owner, 'Wrong maker signer');
const runtime = new Runtime(database, config.runId, config.rpcUrl, config.budgetProfile, 5n, 1n, config.chain);
let stop = false, unavailable = false;
process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });
try {
  await runtime.open();
  const binding = await runtime.environment();
  assert.equal(binding.market, config.market); assert.equal(binding.domain, config.domain);
  console.log(JSON.stringify({ role: 'reference-maker', makerId: config.makerId, operatorClass: config.operatorClass, pid: process.pid, status: 'started' }));
  while (!stop) {
    try {
      await runtime.maker(config.makerId, signer);
      if (unavailable) console.log(JSON.stringify({ makerId: config.makerId, status: 'recovered' }));
      unavailable = false;
    } catch (error) {
      if (!unavailable) console.log(JSON.stringify({ makerId: config.makerId, status: 'unavailable', reason: makerFailureReason(error, database) }));
      unavailable = true;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
} finally {
  await runtime.close();
  console.log(JSON.stringify({ makerId: config.makerId, status: 'stopped', standingAuthorityRevoked: false }));
}
