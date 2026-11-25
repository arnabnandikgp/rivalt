import { describe, expect, it } from 'vitest';
import { fromBase64 } from './wallet-client.js';

describe('wallet RPC base64', () => {
  it('decodes the whole byte range into a fresh buffer each time', () => {
    const expected = Uint8Array.from({length: 256}, (_, index) => index);
    const encoded = Buffer.from(expected).toString('base64');
    const first = fromBase64(encoded);
    const second = fromBase64(encoded);
    expect(first).toEqual(expected);
    first.fill(0);
    expect(second).toEqual(expected);
  });

  it.each([['', []], [' Y\tQ\r\n== ', [97]], ['AP8', [0, 255]]] as const)(
    'accepts atob-compatible input %j', (value, bytes) => {
      expect([...fromBase64(value)]).toEqual(bytes);
    },
  );

  it.each(['Y', '===', 'YQ===', 'YQ==x', '-_', 'é'])('rejects malformed %j', value => {
    expect(() => fromBase64(value)).toThrow(expect.objectContaining({name: 'InvalidCharacterError'}));
  });
});
