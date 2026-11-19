import {expect,it} from 'vitest';
import {matchesRejectedRate,proposeMarketOrder} from './account-default-proposal.js';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decodeSettlementPages,SettlementPages} from './settlement-pages.js';
import {accountDeployment} from './account-deployment.js';
import {accountDeploymentSelection} from './account-profile.js';
it('suppresses only a byte-identical rejected rate across pages and markets',async()=>{
  const factorWords=[1n,0n,0n,0n,0n], numeratorWords=[Array<bigint>(258).fill(2n),[3n]];
  const rates={attempt:7n,factor:factorWords,lengths:[258n,1n],uploaded:[258n,1n]};
  const page=async(market:number,index:bigint)=>{
    const words=numeratorWords[market].slice(Number(index)*256,(Number(index)+1)*256);
    return {attempt:7n,wordCount:words.length,payload:{words}};
  };
  const same={factorWords,numeratorWords};
  expect(await matchesRejectedRate(rates,same,page)).toBe(true);
  for(const [market,offset] of [[0,0],[0,257],[1,0]]) {
    const changed=numeratorWords.map(words=>[...words]);changed[market][offset]++;
    expect(await matchesRejectedRate(rates,{factorWords,numeratorWords:changed},page)).toBe(false);
  }
  expect(await matchesRejectedRate(rates,{...same,factorWords:[2n,0n,0n,0n,0n]},page)).toBe(false);
  expect(await matchesRejectedRate(rates,{...same,numeratorWords:[[],[]]},page)).toBe(false);
  await expect(matchesRejectedRate({...rates,attempt:8n},same,page)).rejects.toThrow(/changed/);
  await expect(matchesRejectedRate({...rates,uploaded:[257n,1n]},same,page)).rejects.toThrow(/incomplete/);
});
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

it('rejects a self-consistent helper manifest from another checkout or a dirty build',()=>{
  const directory=mkdtempSync(join(tmpdir(),'rivalt-helper-test-'));
  try {
    const bytes=Buffer.from('descriptor fixture');
    const manifest={version:2,accountSchema:10,programProfile:6,binary:'rivalt-settlement-pages',
      bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
      revision:'ed466030eccd485b8552b378815bf3f4e28fb658',trackedDirty:false};
    writeFileSync(join(directory,manifest.binary),bytes);
    for(const change of [{revision:'a'.repeat(40)},{trackedDirty:true},{bytes:bytes.length+1}]) {
      writeFileSync(join(directory,'manifest.json'),JSON.stringify({...manifest,...change}));
      expect(()=>new SettlementPages(directory)).toThrow();
    }
    writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest));
    expect(()=>new SettlementPages(directory)).not.toThrow();
    expect(()=>new SettlementPages(directory,'verified-pair-candidate')).toThrow();
    const pair={...manifest,revision:accountDeployment('verified-pair-candidate').helperRevision};
    writeFileSync(join(directory,'manifest.json'),JSON.stringify(pair));
    expect(()=>new SettlementPages(directory,'verified-pair-candidate')).toThrow();
    writeFileSync(join(directory,'manifest.json'),JSON.stringify({...pair,feature:'single-pair-default-qualification'}));
    expect(()=>new SettlementPages(directory,'verified-pair-candidate')).not.toThrow();
    expect(()=>new SettlementPages(directory)).toThrow();
  } finally {rmSync(directory,{recursive:true});}
});
