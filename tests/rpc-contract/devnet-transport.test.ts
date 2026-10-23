import { afterEach, expect, test, vi } from 'vitest';
import { DevnetTransport } from './devnet-transport.js';

afterEach(() => vi.useRealTimers());
test('explicit rate rejection backs off with identical signed bytes', async () => {
  vi.useFakeTimers();
  const call = vi.fn().mockRejectedValueOnce(new Error('RPC HTTP 429')).mockRejectedValueOnce(new Error('RPC HTTP 429')).mockResolvedValue('original-signature');
  const rpc = new DevnetTransport({ call }), params = ['original-signed-wire', { encoding: 'base64' }];
  const pending = rpc.call('sendTransaction', params);
  await vi.runAllTimersAsync();
  expect(await pending).toBe('original-signature');
  expect(call.mock.calls).toEqual(Array(3).fill(['sendTransaction', params]));
  expect(rpc.interruptions.map(x => x.backoffMs)).toEqual([1000, 2000]);
});
test('ambiguous transport failures are not retried as new submissions', async () => {
  vi.useFakeTimers();
  const call = vi.fn().mockRejectedValue(new Error('timeout'));
  const pending = expect(new DevnetTransport({ call }).call('sendTransaction', ['wire'])).rejects.toThrow('timeout');
  await vi.runAllTimersAsync(); await pending;
  expect(call).toHaveBeenCalledTimes(1);
});
test('persistent rate rejection terminates after the finite retry budget', async () => {
  vi.useFakeTimers();
  const call = vi.fn().mockRejectedValue(new Error('RPC HTTP 429'));
  const rpc = new DevnetTransport({ call });
  const pending = expect(rpc.call('getTransaction', ['signature'])).rejects.toThrow('RPC HTTP 429');
  await vi.runAllTimersAsync(); await pending;
  expect(call).toHaveBeenCalledTimes(6);
  expect(rpc.interruptions.map(x => x.backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000]);
});
