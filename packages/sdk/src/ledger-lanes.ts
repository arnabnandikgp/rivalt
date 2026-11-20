import {getMakerRegistrationDecoder} from './generated/index.js';
import {decodeBackingSummary} from './account-backing.js';
import {decodeFeeLedger,decodeMakerFeeLane} from './market-fees.js';
import {requireValue} from './wallet-client.js';

export type BackingChange = {bad:bigint;quantity:bigint;positive:bigint;negative:bigint;required:bigint[]};
export const emptyBackingChange=():BackingChange=>({bad:0n,quantity:0n,positive:0n,negative:0n,required:[0n,0n]});
const maxU64=(1n<<64n)-1n;
const laneBound=((1n<<127n)-1n)/4n;
function integer(bytes:Uint8Array,offset:number,size:number){
  let value=0n;
  for(let i=offset+size-1;i>=offset;i--)value=(value<<8n)+BigInt(bytes[i]);
  return value;
}
function write(bytes:Uint8Array,offset:number,size:number,value:bigint,signed=false){
  const bits=size*8;
  requireValue((signed?BigInt.asIntN(bits,value):BigInt.asUintN(bits,value))===value,'Ledger summary overflow.');
  for(let i=0;i<size;i++){bytes[offset+i]=Number(value&255n);value>>=8n;}
}
export function applyBackingChanges(summary:ArrayLike<number>,changes:readonly BackingChange[]){
  const result=Uint8Array.from(summary);
  decodeBackingSummary(result);
  const fields=[{offset:16,size:8},{offset:24,size:16},{offset:40,size:24},{offset:64,size:24},{offset:88,size:8},{offset:96,size:8}];
  const values=changes.map(change=>[change.bad,change.quantity,change.positive,change.negative,...change.required]);
  requireValue(values.every(row=>row.length===6&&row.every(delta=>delta>=-laneBound&&delta<=laneBound)),'Invalid backing lane magnitude.');
  fields.forEach(({offset,size},i)=>{
    const raw=integer(result,offset,size),base=i===1?BigInt.asIntN(128,raw):raw;
    write(result,offset,size,values.reduce((sum,row)=>sum+row[i],base),i===1);
  });
  decodeBackingSummary(result);
  return result;
}

/** Read the ledger and its three PDA-authenticated registrations at the same RPC context. */
export function ledgerFromExecutionLanes(escrow:ReturnType<typeof decodeFeeLedger>,rows:readonly {bytes:Uint8Array;bump:number}[]){
  const ledger=escrow.state,changes:BackingChange[]=[];
  requireValue(rows.length===3&&ledger.revision>0n,'Incomplete ledger checkpoint.');
  let fills=0n,liabilities=0n,fees=0n;
  const start=getMakerRegistrationDecoder().fixedSize+64;
  let collected=0n;
  for(const [instance,{bytes,bump}] of rows.entries()){
    const registration=decodeMakerFeeLane(bytes,'ledger-lanes');
    const state=registration.state;
    requireValue(state.schemaVersion===10&&state.instance===instance&&state.bump===bump&&state.market===ledger.market&&state.venue===ledger.venue,'Foreign ledger lane.');
    collected+=registration.collected;
    const view=new DataView(bytes.buffer,bytes.byteOffset+start,128),revision=view.getBigUint64(0,true);
    requireValue(revision<=ledger.revision,'Future ledger lane.');
    if(revision<ledger.revision)continue;
    fills+=view.getBigUint64(8,true);liabilities+=view.getBigUint64(16,true);fees+=view.getBigUint64(24,true);
    const delta=(offset:number)=>BigInt.asIntN(128,integer(bytes,start+offset,16));
    changes.push({bad:delta(32),quantity:delta(48),positive:delta(64),negative:delta(80),required:[delta(96),delta(112)]});
  }
  const pendingFees=escrow.pendingFees+fees;
  requireValue(collected===escrow.classifiedFees+pendingFees&&ledger.fees+fees<=maxU64&&ledger.version+fills<=maxU64&&ledger.liabilityVersion+liabilities<=maxU64,'Ledger lane totals exceed checkpoint bounds.');
  if(ledger.backing.epoch===0n)requireValue(changes.every(c=>[c.bad,c.quantity,c.positive,c.negative,...c.required].every(v=>v===0n)),'Uninitialized backing changes.');
  const backing=ledger.backing.epoch?{...ledger.backing,summary:applyBackingChanges(ledger.backing.summary,changes)}:ledger.backing;
  return {...escrow,pendingFees,state:{...ledger,backing,fees:ledger.fees+fees,version:ledger.version+fills,liabilityVersion:ledger.liabilityVersion+liabilities}};
}
