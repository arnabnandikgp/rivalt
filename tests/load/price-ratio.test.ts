import { expect,it } from 'vitest';
import { samePrice } from './price-ratio.js';
it('accepts equal candle extremes from different fill sizes without rounding unequal prices',()=>{
  expect(samePrice({numerator:'60030',denominator:'1'},{numerator:'6003000',denominator:'100'})).toBe(true);
  expect(samePrice({numerator:'60030',denominator:'1'},{numerator:'6003001',denominator:'100'})).toBe(false);
  expect(()=>samePrice({numerator:'0',denominator:'0'},{numerator:'0',denominator:'1'})).toThrow();
});
