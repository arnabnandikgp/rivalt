/** Reconcile both market pools from the original finalized clearing instructions. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {AccountRole,getBase58Decoder} from '@solana/kit';
import {VersionedTransaction} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';

type Receipt={id:string;signature:string;slot:number;role:string;error:unknown};
type Root={id:string;cash:string;positions:{lots:string;virtualScaled:string}[]};
type State={roots:Record<string,Root>;ledgers:Record<string,{marketIndex:number;settlement:string}>};
const directory=process.argv[2];
assert(directory,'Pass the completed router-load directory');
const read=(name:string)=>JSON.parse(readFileSync(join(directory,name+'.json'),'utf8'));
const result=read('router-load');
const before=read('sql-ready-snapshot').state as State, after=read('sql-drained-snapshot').state as State;
const flat=Object.entries(before.roots).filter(([,r])=>r.cash==='999974'&&r.positions[0].lots==='0'&&r.positions[0].virtualScaled==='996000000000');
assert.equal(flat.length,1);
const [creditor,opening]=flat[0];
let btcPaid=0n;
const flows=[0,1].map(()=>({collected:0n,paid:0n,payments:0}));
const signatures=new Set<string>();
for(const receipt of result.receipts as Receipt[]){
  assert(!signatures.has(receipt.signature));signatures.add(receipt.signature);
  if(receipt.role!=='settlement'||receipt.error)continue;
  const history=read('landed-'+receipt.signature);
  assert.equal(history.meta.err,null);assert.equal(history.slot,receipt.slot);
  const transaction=VersionedTransaction.deserialize(Buffer.from(history.transaction[0],'base64'));
  assert.equal(getBase58Decoder().decode(transaction.signatures[0]),receipt.signature);
  const message=transaction.message;
  for(const ix of message.compiledInstructions){
    if(message.staticAccountKeys[ix.programIdIndex].address!==sdk.CLEARING_PROGRAM_ADDRESS)continue;
    const discriminator=sdk.hex(ix.data.subarray(0,8));
    if(discriminator===sdk.hex(sdk.COLLECT_ACCOUNT_LOSS_DISCRIMINATOR)){
      const {marketIndex,amount}=sdk.getCollectAccountLossInstructionDataDecoder().decode(ix.data);
      flows[marketIndex].collected+=amount;
    }else if(discriminator===sdk.hex(sdk.PAY_ACCOUNT_GAIN_DISCRIMINATOR)){
      const instruction={programAddress:sdk.CLEARING_PROGRAM_ADDRESS,data:ix.data,
        accounts:Array.from(ix.accountKeyIndexes,index=>{
          const signed=message.isAccountSigner(index),writable=message.isAccountWritable(index);
          const role=signed?(writable?AccountRole.WRITABLE_SIGNER:AccountRole.READONLY_SIGNER):
            (writable?AccountRole.WRITABLE:AccountRole.READONLY);
          return {address:message.staticAccountKeys[index].address,role};
        })};
      const {data,accounts}=sdk.parsePayAccountGainInstruction(instruction);
      flows[data.marketIndex].paid+=data.amount;
      flows[data.marketIndex].payments++;
      if(data.marketIndex===0 && accounts.margin.address===creditor)btcPaid+=data.amount;
    }
  }
}
for(const [address,ledger] of Object.entries(before.ledgers)){
  const flow=flows[ledger.marketIndex],closing=after.ledgers[address];
  assert.equal(ledger.marketIndex,closing.marketIndex);
  assert.equal(BigInt(ledger.settlement)+flow.collected-flow.paid,BigInt(closing.settlement));
}
const closing=after.roots[creditor];
assert.equal(BigInt(closing.cash)-BigInt(opening.cash),btcPaid);
assert.equal(BigInt(closing.positions[0].virtualScaled)+btcPaid*1_000_000_000n,996_000_000_000n);
if(result.followEth)assert(btcPaid===996n&&flows[1].paid>0n);
console.log(JSON.stringify({claimantPaid:btcPaid,flows},(_,v)=>typeof v==='bigint'?v.toString():v));
