/** Compare exact values, not the incidental fill size used to encode a VWAP. */
export function samePrice(a:{numerator:string;denominator:string},b:{numerator:string;denominator:string}){
  if(BigInt(a.denominator)<=0n||BigInt(b.denominator)<=0n)throw new Error('Nonpositive price denominator');
  return BigInt(a.numerator)*BigInt(b.denominator)===BigInt(b.numerator)*BigInt(a.denominator);
}
