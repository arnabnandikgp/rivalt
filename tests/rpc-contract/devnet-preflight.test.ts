import { describe, expect, it } from 'vitest';
import { checkedGenesis, configuration, DEVNET_GENESIS, programDataAddress, programDataIdentity, UPGRADEABLE_LOADER } from './devnet-preflight-support.js';

describe('devnet preflight trust boundary', () => {
  it('rejects any other cluster identity', () => {
    expect(checkedGenesis(DEVNET_GENESIS)).toBe(DEVNET_GENESIS);
    for (const value of [null, 'mainnet', '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d']) expect(() => checkedGenesis(value)).toThrow();
  });
  it('requires explicit secure endpoint pairing without echoing credentials', () => {
    expect(configuration({}).endpointLabel).toBe('official-public-devnet');
    const rpc = 'https://rpc.example/secret-token', ws = 'wss://ws.example/?api-key=secret-token';
    expect(configuration({ RIVALT_DEVNET_RPC_URL: rpc, RIVALT_DEVNET_WS_URL: ws }).endpointLabel).not.toContain('secret');
    for (const bad of ['http://rpc.example/secret-token', 'https://user:secret-token@rpc.example', 'invalid-secret-token']) {
      try { configuration({ RIVALT_DEVNET_RPC_URL: bad, RIVALT_DEVNET_WS_URL: ws }); throw new Error('Expected rejection'); }
      catch (error) { expect(String(error)).not.toContain('secret-token'); expect(String(error)).not.toContain('Expected rejection'); }
    }
    expect(() => configuration({ RIVALT_DEVNET_RPC_URL: rpc })).toThrow();
  });
  it('rejects forged program ownership and exposes actual upgrade authority separately from code', () => {
    const program = Buffer.alloc(36); program.writeUInt32LE(2);
    const account = { owner: UPGRADEABLE_LOADER, executable: true, data: [program.toString('base64'), 'base64'] as [string, string] };
    expect(programDataAddress(account)).toBe('11111111111111111111111111111111');
    expect(() => programDataAddress({ ...account, owner: '11111111111111111111111111111111' })).toThrow();
    expect(() => programDataAddress({ ...account, executable: false })).toThrow();
    const data = Buffer.alloc(49); data.writeUInt32LE(3); data.writeBigUInt64LE(123n, 4); data[45] = 127;
    const stored = { ...account, executable: false, data: [data.toString('base64'), 'base64'] as [string, string] };
    expect(programDataIdentity(stored).upgradeAuthority).toBe(null);
    data[12] = 1; stored.data[0] = data.toString('base64');
    expect(programDataIdentity(stored)).toMatchObject({ deploymentSlot: '123', upgradeAuthority: '11111111111111111111111111111111', allocatedBytes: '49' });
    data[12] = 2; stored.data[0] = data.toString('base64');
    expect(() => programDataIdentity(stored)).toThrow();
  });
});
