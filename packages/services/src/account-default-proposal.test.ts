import {expect,it} from 'vitest';
import {proposeMarketOrder} from './account-default-proposal.js';
import {decodeSettlementPages} from './settlement-pages.js';
import {accountDeployment} from './account-deployment.js';
import {accountDeploymentSelection} from './account-profile.js';
it('orders literal fractions, stable u64 ties and a complete nonpositive tail',()=>{
  // At 1/3 recovery: payouts 2/3, 5/3, 1/3 and 0. Stable IDs settle equal 2/3 remainders.
  const rows=[{id:9007199254740994n,claims:[2_000_000_000n,0n]},
    {id:9007199254740993n,claims:[5_000_000_000n,0n]},
    {id:77n,claims:[1_000_000_000n,0n]},{id:3n,claims:[-8_000_000_000n,0n]}];
  expect(proposeMarketOrder(rows,0,{numerator:1n,denominator:3n})).toEqual([1n,0n,2n,3n]);
  expect(proposeMarketOrder(rows,1,{numerator:1n,denominator:1n})).toEqual([3n,2n,1n,0n]);
  expect(()=>proposeMarketOrder([...rows,rows[0]],0,{numerator:1n,denominator:1n})).toThrow(/Duplicate/);
});
it('rejects duplicate, oversized, noncanonical or future helper responses',()=>{
  const encode=(pages:any[],extra={})=>JSON.stringify({version:2,schema:10,pages,...extra});
  const page={register:3,index:'9007199254740993',writable:false};
  expect(decodeSettlementPages(encode([page]))).toEqual([{...page,index:9007199254740993n}]);
  for(const value of [encode([page,page]),encode([page],{schema:11}),encode([{...page,index:'01'}]),
    encode([{...page,index:String(2n**64n)}]),encode([{...page,register:71}]),encode([{...page,writable:1}]),
    encode(Array(4).fill(page))])expect(()=>decodeSettlementPages(value)).toThrow();
});
it('binds selected and candidate names to the qualified schema independently of API budget version',()=>{
  expect(accountDeployment('selected')).toMatchObject({schema:10,programProfile:6});
  const candidate=accountDeployment(accountDeploymentSelection('account-scale-candidate'));
  expect(candidate).toMatchObject({schema:10,programProfile:6,artifactSet:'p56-window-ed46603'});
  expect(candidate.artifacts.find(value=>value.name==='clearing')?.sha256).toBe('2637469c4a8b1761c7cefc4c931d38611ebb651e05c60065e9617bbf3af13d3e');
  expect(accountDeployment('selected')).toEqual(candidate);
  expect(()=>accountDeploymentSelection('anything')).toThrow();
});

it('bounds extended descriptors separately and rejects old helper output',()=>{
  const pages=Array.from({length:8},(_,index)=>({register:25+index,index:'0',writable:true}));
  const output=JSON.stringify({version:2,schema:10,pages});
  expect(decodeSettlementPages(output,8)).toHaveLength(8);
  expect(()=>decodeSettlementPages(output)).toThrow();
  expect(()=>decodeSettlementPages(JSON.stringify({version:1,schema:10,pages:[]}))).toThrow();
  expect(()=>decodeSettlementPages(JSON.stringify({version:2,schema:10,pages:[...pages,{register:33,index:'0',writable:true}]}),8)).toThrow();
});
