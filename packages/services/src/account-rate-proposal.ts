import {createHash} from 'node:crypto';

/** Exact, untrusted off-chain proposal only. Clearing independently verifies the
 * complete frozen cohort, greatest fixed point, insurance passes and all payouts.
 * No float, test-reference process or retained acceptance dump enters this path. */
type Rational={numerator:bigint;denominator:bigint};
const abs=(value:bigint)=>value<0n?-value:value;
function gcd(left:bigint,right:bigint):bigint {while(right!==0n)[left,right]=[right,left%right];return abs(left);}
function ratio(numerator:bigint,denominator=1n):Rational {
  if(denominator===0n)throw new Error('Zero proposal denominator');
  if(denominator<0n){numerator=-numerator;denominator=-denominator;}
  const divisor=gcd(numerator,denominator);return {numerator:numerator/divisor,denominator:denominator/divisor};
}
const ZERO=ratio(0n),ONE=ratio(1n);
const add=(left:Rational,right:Rational)=>ratio(left.numerator*right.denominator+right.numerator*left.denominator,left.denominator*right.denominator);
const subtract=(left:Rational,right:Rational)=>add(left,ratio(-right.numerator,right.denominator));
const multiply=(left:Rational,right:Rational)=>ratio(left.numerator*right.numerator,left.denominator*right.denominator);
const divide=(left:Rational,right:Rational)=>ratio(left.numerator*right.denominator,left.denominator*right.numerator);
const compare=(left:Rational,right:Rational)=>{const difference=left.numerator*right.denominator-right.numerator*left.denominator;return difference<0n?-1:difference>0n?1:0;};
const minimum=(left:Rational,right:Rational)=>compare(left,right)<0?left:right;
const maximum=(left:Rational,right:Rational)=>compare(left,right)>0?left:right;
const sum=(values:Rational[])=>values.reduce(add,ZERO);
const positive=(value:Rational)=>maximum(value,ZERO);
const floor=(value:Rational)=>{if(value.numerator<0n)throw new Error('Negative proposal floor');return value.numerator/value.denominator;};
const bits=(value:bigint)=>value===0n?0:value.toString(2).length;
const SCALE=1_000_000_000n,MAX_CASH=1_000_000_000_000_000n,MAX_CLAIM=100_300_000_000_000_000_000_000_000n;
export type AccountRateInputs={rows:{cash:bigint;claims:[bigint,bigint]}[];pools:[bigint,bigint];budgets:[bigint,bigint]};
type Link={claim:Rational;cap:Rational};
type Segment={lower:Rational;upper:Rational;intercept:Rational;slope:Rational};

/** Every branch of min(1,(base+insurance+incoming capped claims)/positive). */
function segments(positiveClaims:Rational,base:Rational,insurance:bigint,links:Link[]):Segment[] {
  if(positiveClaims.numerator===0n)return [{lower:ZERO,upper:ONE,intercept:ONE,slope:ZERO}];
  const breakpoints=[ZERO,ONE,...links.filter(link=>compare(link.cap,link.claim)<0).map(link=>divide(link.cap,link.claim))]
    .sort(compare).filter((value,index,sorted)=>index===0||compare(value,sorted[index-1])!==0);
  const result:Segment[]=[];
  for(let index=1;index<breakpoints.length;index++) {
    const lower=breakpoints[index-1],upper=breakpoints[index],middle=divide(add(lower,upper),ratio(2n));
    const capped=links.filter(link=>compare(multiply(link.claim,middle),link.cap)>=0);
    const variable=links.filter(link=>compare(multiply(link.claim,middle),link.cap)<0);
    const intercept=divide(sum([base,ratio(insurance),...capped.map(link=>link.cap)]),positiveClaims);
    const slope=divide(sum(variable.map(link=>link.claim)),positiveClaims);
    const at=(rate:Rational)=>add(intercept,multiply(slope,rate));
    if(compare(at(lower),ONE)>=0)result.push({lower,upper,intercept:ONE,slope:ZERO});
    else if(compare(at(upper),ONE)<=0)result.push({lower,upper,intercept,slope});
    else {
      const crossing=divide(subtract(ONE,intercept),slope);
      result.push({lower,upper:crossing,intercept,slope},{lower:crossing,upper,intercept:ONE,slope:ZERO});
    }
  }
  return result;
}

export function proposeAccountRates(input:AccountRateInputs) {
  if(!Array.isArray(input.rows)||input.rows.length<1||input.rows.length>64||input.pools.length!==2||input.budgets.length!==2||
    [...input.pools,...input.budgets].some(value=>typeof value!=='bigint'||value<0n||value>MAX_CASH)||
    input.rows.some(row=>typeof row.cash!=='bigint'||row.cash<0n||row.cash>MAX_CASH||row.claims.length!==2||row.claims.some(value=>typeof value!=='bigint'||abs(value)>MAX_CLAIM)))
    throw new Error('Invalid bounded rate proposal input');
  for(const market of [0,1])if(input.rows.reduce((total,row)=>total+row.claims[market],0n)!==input.pools[market]*SCALE)
    throw new Error('Incomplete per-market frozen claim identity');
  const incoming:[Link[],Link[]]=[[],[]],collections:[Rational[],Rational[]]=[[],[]];
  let common=1n;
  for(const row of input.rows) {
    const debts=row.claims.map(claim=>claim<0n?-claim:0n),totalDebt=debts[0]+debts[1];
    const collected=totalDebt/SCALE<row.cash?totalDebt/SCALE:row.cash;
    if(debts.every(debt=>debt>0n)&&collected>0n)common*=totalDebt;
    const collectedParts=debts.map(debt=>totalDebt===0n?ZERO:ratio(collected*debt,totalDebt));
    for(const market of [0,1]) {
      collections[market].push(collectedParts[market]);
      const claim=ratio(row.claims[market],SCALE),destination=1-market;
      const remaining=subtract(ratio(debts[destination],SCALE),collectedParts[destination]);
      if(claim.numerator>0n&&remaining.numerator>0n)incoming[destination].push({claim,cap:remaining});
    }
  }
  if(bits(common)>5632)throw new Error('Proposal common denominator exceeds bounded layout');
  const positives=[0,1].map(market=>sum(input.rows.map(row=>positive(ratio(row.claims[market],SCALE)))));
  const bases=[0,1].map(market=>add(ratio(input.pools[market]),sum(collections[market])));
  const curves=[0,1].map(market=>segments(positives[market],bases[market],input.budgets[market],incoming[market]));
  const incomingAt=(market:number,otherRate:Rational)=>sum(incoming[market].map(link=>minimum(link.cap,multiply(link.claim,otherRate))));
  const evaluate=(market:number,otherRate:Rational)=>positives[market].numerator===0n?ONE:
    minimum(ONE,divide(sum([bases[market],ratio(input.budgets[market]),incomingAt(market,otherRate)]),positives[market]));
  const candidates:[Rational,Rational][]=[];
  for(const first of curves[0])for(const second of curves[1]) {
    const determinant=subtract(ONE,multiply(first.slope,second.slope));
    const intercept=add(first.intercept,multiply(first.slope,second.intercept));
    let firstRate:Rational;
    if(determinant.numerator===0n) {
      if(intercept.numerator!==0n)continue;
      // An unbacked closed cycle may admit a continuum. Its greatest endpoint
      // resolves circular setoff without inventing a spend of insurance.
      const lower=maximum(second.lower,add(first.intercept,multiply(first.slope,first.lower)));
      const upper=minimum(second.upper,add(first.intercept,multiply(first.slope,first.upper)));
      if(compare(lower,upper)>0)continue;firstRate=upper;
    }else firstRate=divide(intercept,determinant);
    const secondRate=add(second.intercept,multiply(second.slope,firstRate));
    if(compare(firstRate,second.lower)<0||compare(firstRate,second.upper)>0||compare(secondRate,first.lower)<0||compare(secondRate,first.upper)>0)continue;
    if(compare(firstRate,evaluate(0,secondRate))===0&&compare(secondRate,evaluate(1,firstRate))===0)candidates.push([firstRate,secondRate]);
  }
  if(!candidates.length)throw new Error('No exact clearing rate proposal');
  const rates=candidates.reduce((chosen,candidate)=>compare(sum(candidate),sum(chosen))>0?candidate:chosen);
  if(candidates.some(candidate=>candidate.some((rate,index)=>compare(rate,rates[index])>0)))throw new Error('Rate proposal has no componentwise greatest point');
  const spent=[0,1].map(market=>positive(subtract(subtract(multiply(positives[market],rates[market]),bases[market]),incomingAt(market,rates[1-market]))));
  if(spent.some((value,index)=>compare(value,ratio(input.budgets[index]))>0))throw new Error('Rate proposal exceeds insurance budget');
  const denominator=rates[0].denominator/gcd(rates[0].denominator,rates[1].denominator)*rates[1].denominator;
  const factor=denominator/gcd(common,denominator);
  if(factor<=0n||factor>=1n<<186n)throw new Error('Rate factor exceeds bounded layout');
  const numerators=rates.map(rate=>{
    const value=multiply(rate,ratio(common*factor));if(value.denominator!==1n)throw new Error('Nonintegral encoded rate');return value.numerator;
  });
  const bytes=Buffer.alloc(1560);
  function encode(value:bigint,offset:number,length:number) {
    if(value<0n||bits(value)>length*8)throw new Error('Rate proposal encoding overflow');
    for(let index=0;index<length;index++){bytes[offset+index]=Number(value&255n);value>>=8n;}
  }
  numerators.forEach((value,index)=>encode(value,index*768,768));encode(factor,1536,24);
  return {common,factor,numerators,rates,insuranceSpent:spent.map(floor),fractional:spent.map(value=>value.denominator!==1n),
    bytes,hash:createHash('sha256').update(bytes).digest(),segmentPairs:curves[0].length*curves[1].length};
}
