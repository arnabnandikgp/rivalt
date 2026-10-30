import assert from 'node:assert/strict';
import {statSync,readFileSync} from 'node:fs';
export function protectedJson(path: string) {
  assert.equal(statSync(path).mode & 0o077, 0, 'Operator files must be readable only by their owner');
  return JSON.parse(readFileSync(path, 'utf8'));
}
