import { expect, it } from 'vitest';
import { makerFailureReason } from './diagnostics.js';

it('preserves a useful local failure reason', () => {
  expect(makerFailureReason(new Error('Maker key binding'), 'postgresql://private')).toBe('Maker key binding');
});
it('redacts the entire configured database value, including unusual credential characters', () => {
  const database = 'postgresql://operator:quote"secret@localhost/rivalt';
  expect(makerFailureReason(new Error(`Cannot connect to ${database}; retry ${database}`), database))
    .toBe('Cannot connect to [redacted-database-url]; retry [redacted-database-url]');
});
it('redacts incidental database, HTTP and WebSocket URLs without logging their credentials', () => {
  const message = 'Failed https://rpc.example/?api-key=rpc-secret and WSS://user:ws-secret@socket.example/path; postgres://user:db-secret@database.example/run';
  const reason = makerFailureReason(new Error(message), 'postgresql://configured');
  expect(reason).toBe('Failed [redacted-url] and [redacted-url] [redacted-url]');
  expect(reason).not.toMatch(/secret|example/);
});
it('redacts long URLs before bounding and normalizing the log field', () => {
  expect(makerFailureReason(new Error(`Failed\nhttps://rpc.example/${'secret'.repeat(1000)}\tend`), ''))
    .toBe('Failed [redacted-url] end');
  expect(makerFailureReason(new Error('x'.repeat(2000)), '').length).toBe(512);
});
it('never stringifies unknown thrown values or serializes an error cause', () => {
  expect(makerFailureReason({ password: 'private' }, '')).toBe('Unknown maker failure');
  expect(makerFailureReason(new Error('Connection failed', { cause: 'private' }), '')).toBe('Connection failed');
});
