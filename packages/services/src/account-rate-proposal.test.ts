import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {proposeAccountRates,type AccountRateInputs} from './account-rate-proposal.js';

const SCALE=1_000_000_000n;
const input=(rows:[bigint,[bigint,bigint]][],budgets:[bigint,bigint]=[0n,0n],pools:[bigint,bigint]=[0n,0n]):AccountRateInputs=>
  ({rows:rows.map(([cash,claims])=>({cash,claims:claims.map(value=>value*SCALE) as [bigint,bigint]})),budgets,pools});
const equalRate=(actual:{numerator:bigint;denominator:bigint},numerator:bigint,denominator=1n)=>expect(actual.numerator*denominator).toBe(numerator*actual.denominator);
it('keeps unrelated market losses separate and encodes the exact bounded proposal',()=>{
  const result=proposeAccountRates(input([[100n,[-100n,0n]],[0n,[100n,0n]],[0n,[0n,-100n]],[0n,[0n,100n]]]));
  equalRate(result.rates[0],1n);equalRate(result.rates[1],0n);expect(result.insuranceSpent).toEqual([0n,0n]);
  expect(result.bytes.length).toBe(1560);expect(result.hash).toEqual(createHash('sha256').update(result.bytes).digest());
  const decode=(offset:number,length:number)=>result.bytes.subarray(offset,offset+length).reduceRight((total,byte)=>(total<<8n)+BigInt(byte),0n);
  expect([decode(0,768),decode(768,768)]).toEqual(result.numerators);expect(decode(1536,24)).toBe(result.factor);
});
it('recovers 70/80 and 60/80 from one 100-atom double debtor and separate insurance',()=>{
  const result=proposeAccountRates(input([[100n,[-80n,-80n]],[0n,[80n,0n]],[0n,[0n,80n]]],[20n,10n]));
  equalRate(result.rates[0],7n,8n);equalRate(result.rates[1],3n,4n);
  expect(result.insuranceSpent).toEqual([20n,10n]);expect(result.fractional).toEqual([false,false]);
  expect(result.common).toBe(160n*SCALE);
});
it('selects the greatest cashless cycle and caps setoff at the same root debt',()=>{
  for(const budget of [[0n,0n],[30n,40n]] as [bigint,bigint][]) {
    const cycle=proposeAccountRates(input([[0n,[100n,-100n]],[0n,[-100n,100n]]],budget));
    cycle.rates.forEach(rate=>equalRate(rate,1n));expect(cycle.insuranceSpent).toEqual([0n,0n]);
  }
  const capped=proposeAccountRates(input([[0n,[20n,-5n]],[0n,[-20n,5n]]],[10n,99n]));
  equalRate(capped.rates[0],3n,4n);equalRate(capped.rates[1],1n);expect(capped.insuranceSpent).toEqual([10n,0n]);
});
it('matches closed-form coupled equations without using the branch solver as expected output',()=>{
  let cases=0;
  for(let linked=1n;linked<=7n;linked++)for(let external=1n;external<=4n;external++)
    for(let btc=0n;btc<=external;btc++)for(let eth=0n;eth<=external;eth++) {
      const result=proposeAccountRates(input([[0n,[linked,-linked]],[0n,[-linked,linked]],
        [0n,[external,0n]],[0n,[0n,external]],[btc,[-external,0n]],[eth,[0n,-external]]]));
      const denominator=external*(2n*linked+external);
      equalRate(result.rates[0],(linked+external)*btc+linked*eth,denominator);
      equalRate(result.rates[1],linked*btc+(linked+external)*eth,denominator);cases++;
    }
  expect(cases).toBe(378);
});
it('preserves fractional insurance clipping across the prescribed reevaluations',()=>{
  const value:AccountRateInputs={rows:[{cash:2n,claims:[0n,0n]},{cash:2n,claims:[2n*SCALE/5n,SCALE/5n]},
    {cash:1n,claims:[-3n*SCALE/5n,3n*SCALE/5n]},{cash:2n,claims:[SCALE/5n,-4n*SCALE/5n]}],pools:[0n,0n],budgets:[1n,1n]};
  const passes=[];
  for(let evaluation=0;evaluation<3;evaluation++) {
    const result=proposeAccountRates(value);passes.push(result);
    if(!result.fractional.some(Boolean))break;
    value.budgets=value.budgets.map((budget,index)=>result.fractional[index]?result.insuranceSpent[index]:budget) as [bigint,bigint];
  }
  expect(passes).toHaveLength(3);expect(passes.at(-1)!.insuranceSpent).toEqual([0n,0n]);expect(passes.at(-1)!.fractional).toEqual([false,false]);
  expect(passes.map(result=>result.fractional)).toEqual([[false,true],[true,false],[false,false]]);
  equalRate(passes[1].rates[0],1n);equalRate(passes[1].rates[1],1n,4n);
});
it('handles 64 roots and a greater-than-5,000-bit common denominator with exact limb encoding',()=>{
  const rows:AccountRateInputs['rows']=[];let totalBtc=0n,totalEth=0n;
  for(let index=0n;index<63n;index++) {
    const btc=10n**24n+2n*index+1n,eth=10n**24n+4n*index+3n;
    rows.push({cash:1000n,claims:[-btc,-eth]});totalBtc+=btc;totalEth+=eth;
  }
  rows.push({cash:0n,claims:[totalBtc,totalEth]});
  const result=proposeAccountRates({rows,pools:[0n,0n],budgets:[13n,17n]});
  expect(result.common.toString(2).length).toBeGreaterThan(5000);expect(result.common.toString(2).length).toBeLessThanOrEqual(5632);
  expect(result.factor).toBeLessThan(1n<<186n);expect(result.numerators.every(value=>value<=result.common*result.factor)).toBe(true);
});
it('rejects omitted market claims, invalid cohort size and financial bounds',()=>{
  const balanced=input([[1n,[-1n,0n]],[0n,[1n,0n]]]);
  expect(()=>proposeAccountRates({...balanced,rows:balanced.rows.slice(1)})).toThrow(/claim identity/);
  expect(()=>proposeAccountRates({...balanced,rows:[]})).toThrow(/bounded/);
  expect(()=>proposeAccountRates({...balanced,rows:Array(65).fill({cash:0n,claims:[0n,0n]})})).toThrow(/bounded/);
  expect(()=>proposeAccountRates({...balanced,budgets:[-1n,0n]})).toThrow(/bounded/);
  expect(()=>proposeAccountRates({...balanced,rows:[{cash:10n**16n,claims:[0n,0n]}]})).toThrow(/bounded/);
});
it('cross-checks 80 new deterministic fractional cohorts with the independent Python Fraction reference',()=>{
  let seed=60127n;const next=()=>{seed=(seed*1664525n+1013904223n)&0xffff_ffffn;return seed;};
  const inputs:AccountRateInputs[]=[];
  for(let index=0;index<80;index++) {
    const rows:AccountRateInputs['rows']=[];let totalBtc=0n,totalEth=0n;
    for(let member=0;member<5;member++) {
      const btc=(next()%101n-50n)*SCALE/5n,eth=(next()%101n-50n)*SCALE/5n;
      rows.push({cash:next()%8n,claims:[btc,eth]});totalBtc+=btc;totalEth+=eth;
    }
    rows.push({cash:next()%8n,claims:[-totalBtc,-totalEth]});inputs.push({rows,pools:[0n,0n],budgets:[next()%5n,next()%5n]});
  }
  const script=`import sys,json\nfrom fractions import Fraction\nsys.path.insert(0,'tests/financial')\nfrom account_contract_reference import Account\nfrom clearing_network_reference import clear_rational_cohort\noutput=[]\nfor item in json.load(sys.stdin):\n rows=tuple(Account(int(row['cash']),tuple(Fraction(int(claim),10**9) for claim in row['claims'])) for row in item['rows'])\n result=clear_rational_cohort(rows,tuple(map(int,item['pools'])),tuple(map(int,item['budgets'])),whole_cash_collection=True)\n output.append({'rates':[[str(rate.numerator),str(rate.denominator)] for rate in result.rates],'spent':[str(int(value)) for value in result.insurance_spent],'fractional':[value.denominator!=1 for value in result.insurance_spent]})\nprint(json.dumps(output))`;
  const expected=JSON.parse(execFileSync('python3',['-c',script],{input:JSON.stringify(inputs,(_,value)=>typeof value==='bigint'?value.toString():value),encoding:'utf8'}));
  for(const [index,value] of inputs.entries()) {
    const actual=proposeAccountRates(value);
    actual.rates.forEach((rate,market)=>equalRate(rate,BigInt(expected[index].rates[market][0]),BigInt(expected[index].rates[market][1])));
    expect(actual.insuranceSpent.map(String)).toEqual(expected[index].spent);expect(actual.fractional).toEqual(expected[index].fractional);
  }
});
