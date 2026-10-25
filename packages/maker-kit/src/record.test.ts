import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const boundary = vi.hoisted(() => ({
  open: vi.fn(), close: vi.fn(), environment: vi.fn(), snapshot: vi.fn(), checkpoint: vi.fn(), capture: vi.fn(),
}));
vi.mock('@rivalt/services', () => ({ Runtime: class {
  open = boundary.open; close = boundary.close; environment = boundary.environment; snapshot = boundary.snapshot;
} }));
vi.mock('./capture.js', () => ({ economicsCheckpoint: boundary.checkpoint, economicsCapture: boundary.capture }));

const owner = '11111111111111111111111111111111', otherOwner = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const capital = 'configured-maker-capital', domain = '00'.repeat(32);
const originalArgv = process.argv;
let directory: string, configPath: string, openingPath: string, output: string;
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubEnv('RIVALT_RECORD_TEST_DATABASE_URL', 'unused-mocked-boundary');
  directory = mkdtempSync(join(tmpdir(), 'rivalt-record-'));
  configPath = join(directory, 'config.json'); openingPath = join(directory, 'opening.json'); output = join(directory, 'capture.json');
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, operatorClass: 'internal-reference', chain: 'solana:localnet',
    rpcUrl: 'http://127.0.0.1:18899', databaseEnv: 'RIVALT_RECORD_TEST_DATABASE_URL', signerPath: '/unused/owner.json',
    runId: 'same-run', makerId: 1, owner, market: owner, domain, budgetProfile: 'smoke' }), { mode: 0o600 });
  boundary.environment.mockResolvedValue({ market: owner, domain });
  boundary.snapshot.mockResolvedValue({ makers: [{ r: { makerId: 1, owner, capital } }] });
  boundary.capture.mockResolvedValue({ report: { owner, capital } });
  boundary.checkpoint.mockResolvedValue({ owner, capital });
  process.argv = ['node', 'record.ts', 'capture', configPath, output, openingPath, '5'];
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  process.argv = originalArgv; vi.unstubAllEnvs(); vi.restoreAllMocks(); rmSync(directory, { recursive: true });
});

it.each([
  [{ owner: otherOwner, capital }, /owner differs/],
  [{ owner, capital: 'other-maker-capital' }, /capital differs/],
])('rejects a foreign checkpoint before database capture or output: %j', async (identity, reason) => {
  writeFileSync(openingPath, JSON.stringify({ runId: 'same-run', market: owner, domain, ...identity }));
  await expect(import('./record.js')).rejects.toThrow(reason);
  expect(boundary.capture).not.toHaveBeenCalled(); expect(existsSync(output)).toBe(false);
  expect(boundary.close).toHaveBeenCalledOnce();
});
it('captures the configured owner and capital with the requested hedge assumption', async () => {
  const opening = { runId: 'same-run', market: owner, domain, owner, capital };
  writeFileSync(openingPath, JSON.stringify(opening));
  await import('./record.js');
  expect(boundary.capture).toHaveBeenCalledWith(expect.anything(), opening, '5');
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({ report: { owner, capital } });
});
it('keeps checkpoint creation independent of an opening file', async () => {
  process.argv = ['node', 'record.ts', 'checkpoint', configPath, output];
  await import('./record.js');
  expect(boundary.checkpoint).toHaveBeenCalledWith(expect.anything(), capital, owner);
  expect(boundary.capture).not.toHaveBeenCalled();
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({ owner, capital });
});
