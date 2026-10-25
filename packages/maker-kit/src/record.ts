import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Runtime } from '@rivalt/services';
import { makerConfig, protectedJson } from './config.js';
import { economicsCapture, economicsCheckpoint } from './capture.js';

const [mode, configPath, output, openingPath, hedgeBps = '0'] = process.argv.slice(2);
assert(['checkpoint', 'capture'].includes(mode) && output, 'Usage: maker:record checkpoint|capture CONFIG NEW_OUTPUT [OPENING [ASSUMED_HEDGE_BPS]]');
const config = makerConfig(protectedJson(configPath));
const database = process.env[config.databaseEnv]; assert(database, 'Private database configuration required');
const runtime = new Runtime(database, config.runId, config.rpcUrl, config.budgetProfile, 5n, 1n, config.chain);
try {
  await runtime.open();
  const binding = await runtime.environment();
  assert.equal(binding.market, config.market); assert.equal(binding.domain, config.domain);
  const maker = (await runtime.snapshot()).makers.find(candidate => candidate.r.makerId === config.makerId);
  assert(maker && maker.r.owner === config.owner, 'Maker identity mismatch');
  let result;
  if (mode === 'checkpoint') result = await economicsCheckpoint(runtime, maker.r.capital, config.owner);
  else {
    const opening = JSON.parse(readFileSync(openingPath, 'utf8'));
    assert.equal(opening.owner, config.owner, 'Opening checkpoint owner differs from configured maker');
    assert.equal(opening.capital, maker.r.capital, 'Opening checkpoint capital differs from configured maker');
    result = await economicsCapture(runtime, opening, hedgeBps);
  }
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'recorded', mode, independentMakerValidation: false }));
} finally { await runtime.close(); }
