// Separate clients stop and resume a diagnostic on an actual clearing freeze.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {address,AccountRole,getAddressEncoder,getProgramDerivedAddress,type Address,type Instruction} from '@solana/kit';
import {Keypair} from '@solana/web3.js';
import {deriveFrozenMarginPage} from '@rivalt/sdk';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {payerKey} from './harness.js';

const program=address('92GA4Cm7NZq8GEwY5r7zLwdLeYLuQYa79Ut9f3gAQ8U7');
const dir=process.env.RIVALT_RUN_DIR!, phase=process.argv[2];
const hash=(...bytes:Uint8Array[])=>{const h=createHash('sha256');for(const part of bytes)h.update(part);return h.digest();};
const tag=(name:string)=>hash(Buffer.from(name)).subarray(0,8);
const u64=(value:bigint|number|string)=>{const data=Buffer.alloc(8);data.writeBigUInt64LE(BigInt(value));return data;};
const key=(value:Address)=>Buffer.from(getAddressEncoder().encode(value));
if(phase==='write-key'){
  const signer=await Keypair.fromSeed(hash(Buffer.from('rivalt/frozen-plan-probe/local-only')));
  assert.equal(signer.address,program);
  writeFileSync(dir+'/proof-key.json',JSON.stringify([...signer.secretKey]),{mode:0o600,flag:'wx'});
  process.exit(0);
}
assert(phase==='start'||phase==='resume');
const input=JSON.parse(readFileSync(dir+'/proof-input.json','utf8')) as {
  venue:Address;prepared:Address;resolution:Address;revision:string;epoch:string;debtor:Address;
  registryHash:number[];rows:{key:Address;id:string;lots:string[]}[];
  comparison:{cash:Record<string,string>;winnerCharges:Record<string,number>;collections:number[];charges:number[]}
};
const dest=dir+'/proof-'+phase;mkdirSync(dest);
const {h,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,dest,
  {instructionConformance:()=>false});
const payer=await payerKey();
const readonly=(address:Address)=>({address,role:AccountRole.READONLY});
const source=[readonly(input.prepared),readonly(input.resolution)];
const ix=(name:string,accounts:NonNullable<Instruction['accounts']>,...data:Uint8Array[]):Instruction=>({
  programAddress:program,accounts,data:Buffer.concat([tag('global:'+name),...data])});
try {
  for(const nonce of [1,2]){
    const [proof]=await getProgramDerivedAddress({programAddress:program,seeds:[Buffer.from('linked-check'),key(payer.address),u64(nonce)]});
    const writable={address:proof,role:AccountRole.WRITABLE};
    const ordinal=input.rows.findIndex(row=>row.key===input.debtor);
    assert(ordinal>=0);
    const page=async (i:number)=>readonly((await deriveFrozenMarginPage(input.venue,BigInt(i)>>3n))[0]);
    const charges=input.rows.map(row=>row.lots.map((qty,market)=>BigInt(qty)<0n?BigInt(input.comparison.winnerCharges[row.key]??0):0n));
    // Move one BTC atom between the two winners. Both markets still reach the exact same full recovery.
    if(nonce===2){
      const winners=charges.filter(value=>value[0]>0n);
      assert.equal(winners.length,2);
      winners[0][0]++;winners[1][0]--;
    }
    const suffix:Buffer[]=Array(input.rows.length+1);suffix[input.rows.length]=Buffer.alloc(32);
    for(let i=input.rows.length-1;i>=0;i--)suffix[i]=hash(Buffer.from('Rivalt/linked-charges/v1'),u64(i),...charges[i].map(u64),suffix[i+1]);
    const step=async(i:number,root=input.rows[i].key,rest=suffix[i+1])=>ix('step',[writable,...source,await page(i),readonly(root)],
      u64(i),...charges[i].map(u64),rest);
    const seal=ix('seal',[writable,...source]);
    const raw=async()=>{const bytes=(await h.read(proof))!;assert(bytes);assert.deepEqual(bytes.subarray(0,8),tag('account:Comparison'));return bytes;};
    const reject=async(label:string,instruction:Instruction,code:number)=>{
      const before=await h.read(proof);await h.send(label,[instruction],[],code);assert.deepEqual(await h.read(proof),before);
    };
    const half=Math.floor(input.rows.length/2);
    if(phase==='start'){
      const begin=(epoch:bigint)=>ix('begin',[{address:payer.address,role:AccountRole.WRITABLE_SIGNER},writable,...source,
        debtorPage,readonly(address('11111111111111111111111111111111'))],u64(nonce),u64(epoch),u64(ordinal),suffix[0]);
      const debtorPage=await page(ordinal);
      if(nonce===1)await reject('wrong frozen episode',begin(BigInt(input.epoch)+1n),6000);
      await h.send('open frozen plan '+nonce,[begin(BigInt(input.epoch))]);
      if(nonce===1){
        await reject('incomplete schedule',seal,6005);
        await reject('different frozen margin',await step(0,input.rows[1].key),6000);
        await reject('skipped first ordinal',await step(1),6001);
        await reject('changed committed suffix',await step(0,input.rows[0].key,Buffer.alloc(32)),6002);
      }
      for(let i=0;i<half;i++)await h.send('scan '+nonce+' member '+i,[await step(i)]);
      assert.equal((await raw()).readBigUInt64LE(56),BigInt(half));
    }else{
      const checkpoint=await raw();
      assert.equal(checkpoint.readBigUInt64LE(56),BigInt(half));
      assert.deepEqual(checkpoint.subarray(184,216),suffix[half]);
      if(nonce===1)await reject('replayed completed ordinal',await step(half-1),6001);
      for(let i=half;i<input.rows.length;i++)await h.send('resume '+nonce+' member '+i,[await step(i)]);
      if(nonce===2){await reject('full recovery with inferior proportional allocation',seal,6006);continue;}
      await h.send('seal optimal two-market schedule',[seal]);
      await reject('reseal completed result',seal,6001);
      const sealed=await raw();
      assert.equal(sealed[248],1);
      assert.deepEqual(sealed.subarray(8,40),key(input.prepared));
      const values=(offset:number)=>[0,1].map(market=>sealed.readBigUInt64LE(offset+8*market));
      assert.deepEqual(values(96),input.comparison.collections.map(BigInt));
      assert.deepEqual(values(128),input.comparison.charges.map(BigInt));
      // Independent per-member terminal payment and lot vector from the enumerated book.
      let outcome=hash(Buffer.from('Rivalt/linked-payout/v1'),key(input.prepared),u64(input.epoch),u64(input.revision),Buffer.from(input.registryHash));
      let total=0n;
      input.rows.forEach((row,i)=>{
        const cash=BigInt(input.comparison.cash[row.key]);total+=cash;
        const matched=charges[i].map((amount,market)=>{
          if(!amount)return 0n;assert.equal(row.lots[market],'-1');return 1n;
        });
        outcome=hash(outcome,key(row.key),u64(row.id),u64(cash),...charges[i].map(u64),...matched.map(u64));
      });
      assert.deepEqual(sealed.subarray(216,248),outcome);
      assert.equal(sealed.readBigUInt64LE(176),total);
    }
  }
  await flush();
  writeFileSync(dest+'/checks.json',JSON.stringify(checks,null,2));
}finally{ws.close();}
