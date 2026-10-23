import { expect, it } from 'vitest';
import { units, fixed, rational } from './amount.js';
it('preserves exact collateral/BTC decimals and large unpaid fractions', () => {
  expect(units('0.000001', 6)).toBe(1n);
  expect(units('9007199.254741', 6)).toBe(9007199254741n);
  expect(() => units('1.0000001', 6)).toThrow();
  expect(() => units('1e3', 6)).toThrow();
  expect(() => units('-1', 6)).toThrow();
  expect(fixed('9007199254740993', 9)).toBe('9,007,199.254740993');
  expect(fixed(-1n, 15)).toBe('−0.000000000000001');
  expect(rational(6002790n, 100n)).toBe('60,027.90');
});
