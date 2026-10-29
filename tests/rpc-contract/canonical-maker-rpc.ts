import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as sdk from '@rivalt/sdk';
import { canonicalMakerCases } from './canonical-maker-cases.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
const runDir = process.env.RIVALT_RUN_DIR!;
const { rpc,ws,h,checks,conformance } = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,runDir);
const serialize = (value: unknown) => JSON.stringify(value,(_,item) => typeof item === 'bigint' ? item.toString() : item,2)+'\n';

try {
  const result = await canonicalMakerCases(h);
  const parity = await conformance.finish(runDir, [
    ...result.registrations.map(key => ({ program: sdk.CLEARING_PROGRAM_ADDRESS, name: 'makerRegistrationV4', key })),
    ...await Promise.all(result.markets.map(async market => ({ program: sdk.CLEARING_PROGRAM_ADDRESS,
      name: 'liquidityRegistryV4', key: (await sdk.findLiquidityRegistryV4Pda({ market }))[0] }))),
    ...result.makerAccounts.flatMap(item => [{ program: item.program, name: 'makerCurveV4', key: item.config },
      { program: item.program, name: 'makerPriceV4', key: item.price }]),
  ], h.read);
  assert(checks.some(check => check.version === 1 && Number(check.bytes) > 1232), 'real oversized v1 transaction required');
  writeFileSync(`${runDir}/summary.json`, serialize({ revision: execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim(),
    trackedDirty: execFileSync('git', ['status','--porcelain','--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
    runtime: await rpc.call('getVersion'), genesis: await rpc.call('getGenesisHash'),
    binaries: Object.fromEntries(['clearing','maker_a','maker_b'].map(name => [name, createHash('sha256').update(readFileSync(`.local/canonical-maker/${name}.so`)).digest('hex')])),
    checks, result, parity, wsNotifications: ws.notifications.length }));
  console.log(`P30: ${checks.length} signed RPC/WS outcomes; includes v1 submission and independent fetch/dual decode.`);
} finally { ws.close(); }
