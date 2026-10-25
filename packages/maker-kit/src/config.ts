import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { address } from '@solana/kit';
import { testDeployment, testRpcUrl, type TestChain } from '@rivalt/sdk';

export type MakerConfig = {
  schemaVersion: 1; operatorClass: 'internal-reference'; chain: TestChain;
  rpcUrl: string; databaseEnv: string; signerPath: string; runId: string; makerId: 0 | 1;
  owner: string; market: string; domain: string; budgetProfile: 'smoke' | 'soak24';
};
export function makerConfig(value: any): MakerConfig {
  assert.equal(value.schemaVersion, 1); assert.equal(value.operatorClass, 'internal-reference');
  testDeployment(value.chain); testRpcUrl(value.rpcUrl, value.chain);
  assert(value.makerId === 0 || value.makerId === 1);
  assert(['smoke', 'soak24'].includes(value.budgetProfile));
  assert(value.budgetProfile !== 'soak24' || value.chain === 'solana:localnet');
  assert(/^[a-zA-Z0-9._-]{1,120}$/.test(value.runId));
  assert(/^[0-9a-f]{64}$/.test(value.domain)); address(value.market); address(value.owner);
  assert(/^RIVALT_[A-Z0-9_]+$/.test(value.databaseEnv));
  assert(typeof value.signerPath === 'string' && value.signerPath.length > 0);
  return value;
}
export function protectedJson(path: string) {
  assert.equal(statSync(path).mode & 0o077, 0, 'Operator files must be readable only by their owner');
  return JSON.parse(readFileSync(path, 'utf8'));
}
