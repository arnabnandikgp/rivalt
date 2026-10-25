import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makerConfig, protectedJson } from './config.js';

const config = { schemaVersion: 1, operatorClass: 'internal-reference', chain: 'solana:localnet',
  rpcUrl: 'http://127.0.0.1:18899', makerId: 0, owner: '11111111111111111111111111111111',
  market: '11111111111111111111111111111111', domain: '00'.repeat(32), budgetProfile: 'smoke',
  runId: 'operator-1', databaseEnv: 'RIVALT_DATABASE_URL', signerPath: '/private/operator.json' };
describe('operator boundary', () => {
  it('accepts explicit local configuration', () => expect(makerConfig(config)).toEqual(config));
  it.each([
    { chain: 'solana:mainnet' }, { rpcUrl: 'https://remote.example' }, { makerId: 2 },
    { operatorClass: 'independent' }, { domain: '00' }, { databaseEnv: 'HOME' },
    { chain: 'solana:devnet', rpcUrl: 'https://devnet.example', budgetProfile: 'soak24' },
  ])('rejects an unsupported authority/configuration %j', change => expect(() => makerConfig({ ...config, ...change })).toThrow());
  it('refuses operator files readable by other users', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rivalt-maker-'));
    const file = join(directory, 'config.json');
    try {
      writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
      expect(protectedJson(file)).toEqual(config);
      chmodSync(file, 0o644); expect(() => protectedJson(file)).toThrow(/owner/);
    } finally { rmSync(directory, { recursive: true }); }
  });
});
