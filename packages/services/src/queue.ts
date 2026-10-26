import { createPublicKey, verify } from 'node:crypto';
import { VersionedTransaction } from '@solana/web3.js';
import { getBase58Decoder, getAddressEncoder, type Address } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { Store } from '../../indexer/src/store.js';
import { Rpc, integer } from '../../indexer/src/rpc.js';
import { json } from '../../indexer/src/events.js';
import {groupAuthorityValue, type GroupAuthority} from './group-authority.js';

export const RESERVATION=20_000n;
export type Authority={kind:'nonce'|'sequence'|'quoteEpoch';account:string;value:string} | GroupAuthority;
export function signedWire(wire:string) {
  if(typeof wire!=='string' || wire.length>1644)throw new Error('Invalid transaction size');
  const bytes=Buffer.from(wire,'base64');if(bytes.length>1232 || bytes.toString('base64')!==wire)throw new Error('Noncanonical transaction');
  const tx=VersionedTransaction.deserialize(bytes);
  if(tx.message.version!==0 || tx.message.addressTableLookups.length)throw new Error('Only v0 static-account messages supported');
  if(!Buffer.from(tx.serialize()).equals(bytes))throw new Error('Noncanonical wire encoding');
  const message=tx.message.serialize(),keys=tx.message.staticAccountKeys.map(k=>k.toString());
  if(tx.signatures.length!==tx.message.header.numRequiredSignatures)throw new Error('Signature count');
  tx.signatures.forEach((sig,i)=>{
    const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(getAddressEncoder().encode(tx.message.staticAccountKeys[i].address))]),format:'der',type:'spki'});
    if(!verify(null,message,publicKey,sig))throw new Error('Invalid signature');
  });
  return {tx,keys,signature:getBase58Decoder().decode(tx.signatures[0]),blockhash:tx.message.recentBlockhash};
}
// External ingress accepts only one wallet-owned financial action. No relay key
// or sponsorship is exposed by this API, and a wallet signature is never rebuilt.
export function userAuthority(wire:string,market:string,program:Address=sdk.CLEARING_PROGRAM_ADDRESS):Authority|null {
  const {tx,keys}=signedWire(wire);const instructions=tx.message.compiledInstructions;
  let economic:typeof instructions[number]|undefined;
  const budgets=new Set<string>();
  for(const ix of instructions){
    if(keys[ix.programIdIndex]==='ComputeBudget111111111111111111111111111111'){
      const data=Buffer.from(ix.data),kind=data.equals(Buffer.from(sdk.routeComputeBudget().data!))?'limit':data.equals(Buffer.from(sdk.zeroPriorityFee().data!))?'price':null;
      if(!kind||economic||ix.accountKeyIndexes.length||budgets.has(kind))throw new Error('Unsupported compute budget');
      budgets.add(kind);
    }else{if(economic || keys[ix.programIdIndex]!==program)throw new Error('Unsupported transaction');economic=ix;}
  }
  if(!economic || instructions.length>3 || (budgets.has('price')&&!budgets.has('limit')))throw new Error('Expected one financial action');
  const ix=economic,accounts=ix.accountKeyIndexes.map(i=>keys[i]);
  if(accounts[0]!==keys[0] || accounts[1]!==market)throw new Error('Wallet fee payer/market mismatch');
  const disc=Buffer.from(ix.data).subarray(0,8);
  if(disc.equals(Buffer.from(sdk.EXECUTE_ROUTE_DISCRIMINATOR))){
    const d=sdk.getExecuteRouteInstructionDataDecoder().decode(ix.data);
    return {kind:'nonce',account:accounts[2],value:d.nonce.toString()};
  }
  if(disc.equals(Buffer.from(sdk.WITHDRAW_TRADING_DISCRIMINATOR))){
    const d=sdk.getWithdrawTradingInstructionDataDecoder().decode(ix.data);
    return {kind:'sequence',account:market,value:d.sequence.toString()};
  }
  if(disc.equals(Buffer.from(sdk.DEPOSIT_DISCRIMINATOR))) { sdk.getDepositInstructionDataDecoder().decode(ix.data);return null; }
  const orders=[sdk.PLACE_ORDER_DISCRIMINATOR,sdk.REPLACE_ORDER_DISCRIMINATOR,sdk.CANCEL_ORDER_DISCRIMINATOR,sdk.PLACE_PROTECTION_DISCRIMINATOR,sdk.CANCEL_PROTECTION_DISCRIMINATOR];
  if(orders.some(d=>disc.equals(Buffer.from(d))))return null; // Chain versions bind authority; never infer nonexecution from missing history.
  throw new Error('Unsupported financial action');
}
export class Queue {
  constructor(readonly store:Pick<Store,'pool'|'runId'>,readonly rpc:Rpc,readonly program:Address=sdk.CLEARING_PROGRAM_ADDRESS){}
  async budget(name:string,wallet:string,cap:bigint){
    await this.store.pool.query('INSERT INTO service_budgets(run_id,name,wallet,cap) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[this.store.runId,name,wallet,cap.toString()]);
    const r=(await this.store.pool.query('SELECT * FROM service_budgets WHERE run_id=$1 AND name=$2',[this.store.runId,name])).rows[0];
    if(r.wallet!==wallet || BigInt(r.cap)!==cap)throw new Error('Budget identity changed');
  }
  async put(id:string,wire:string,authority:Authority|null,budget:string|null=null){
    if(!/^[a-zA-Z0-9:._-]{1,160}$/.test(id))throw new Error('Invalid request identity');
    const signed=signedWire(wire),c=await this.store.pool.connect();
    try{
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${this.store.runId}/intent/${id}`]);
      const old=(await c.query('SELECT * FROM service_intents WHERE run_id=$1 AND request_id=$2',[this.store.runId,id])).rows[0];
      if(old){if(old.wire!==wire)throw new Error('Idempotency key has different signed bytes');await c.query('COMMIT');return old;}
      if(budget){
        const row=(await c.query(`UPDATE service_budgets SET committed=committed+$3 WHERE run_id=$1 AND name=$2 AND wallet=$4 AND committed+spent+$3<=cap RETURNING *`,[this.store.runId,budget,RESERVATION.toString(),signed.keys[0]])).rows[0];
        if(!row)throw new Error('Operator budget exhausted or payer mismatch');
        const fee=await this.rpc.call('getFeeForMessage',[Buffer.from(signed.tx.message.serialize()).toString('base64'),{commitment:'confirmed'}]);
        if(fee.value===null || BigInt(integer(fee.value))>RESERVATION)throw new Error('Operator fee exceeds reserved budget');
      }
      const r=(await c.query(`INSERT INTO service_intents(run_id,request_id,signature,wire,blockhash,authority,budget) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[this.store.runId,id,signed.signature,wire,signed.blockhash,authority?json(authority):null,budget])).rows[0];
      // PostgreSQL delivers this hint only after the signed bytes are committed.
      await c.query("SELECT pg_notify('rivalt_intents',$1)",[this.store.runId]);
      await c.query('COMMIT');return r;
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async get(id:string){return (await this.store.pool.query('SELECT request_id,signature,status,attempts,result FROM service_intents WHERE run_id=$1 AND request_id=$2',[this.store.runId,id])).rows[0]??null;}
  async pending(){return (await this.store.pool.query(`SELECT request_id FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved','expired-unexecuted') AND next_attempt<=now() ORDER BY next_attempt LIMIT 32`,[this.store.runId])).rows.map(r=>r.request_id as string);}
  async step(id:string){
    const c=await this.store.pool.connect();
    try{
      await c.query('BEGIN');
      const r=(await c.query(`SELECT * FROM service_intents WHERE run_id=$1 AND request_id=$2 AND status IN ('pending','unresolved','expired-unexecuted') FOR UPDATE SKIP LOCKED`,[this.store.runId,id])).rows[0];
      if(!r){await c.query('COMMIT');return;}
      let status=r.status==='expired-unexecuted'?r.status:'unresolved',result:any=r.status==='expired-unexecuted'?r.result:null,release=false;
      try{
        const s=(await this.rpc.call('getSignatureStatuses',[[r.signature],{searchTransactionHistory:true}])).value[0];
        if(s?.confirmationStatus==='finalized'){
          const tx=await this.rpc.call('getTransaction',[r.signature,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:0}]);
          if(tx?.meta && tx.transaction?.signatures?.[0]===r.signature && json(tx.meta.err)===json(s.err)){
            status=tx.meta.err===null?'finalized':'failed';result={slot:integer(tx.slot).toString(),fee:integer(tx.meta.fee).toString(),error:tx.meta.err};release=true;
          }
        }else if(!s){
          const valid=await this.rpc.call('isBlockhashValid',[r.blockhash,{commitment:'finalized'}]);
          if(valid.value===false && r.authority){
            const a=await this.rpc.call('getAccountInfo',[r.authority.account,{encoding:'base64',commitment:'finalized',minContextSlot:integer(valid.context.slot)}]);
            if(a.value?.owner===this.program){
              const bytes=Buffer.from(a.value.data[0],'base64');
              const value=['marginNonce','groupSequence','groupQuoteEpoch','groupObservationSequence'].includes(r.authority.kind)?groupAuthorityValue(r.authority,bytes):r.authority.kind==='nonce'?sdk.getParticipantDecoder().decode(bytes).nonce:
                r.authority.kind==='quoteEpoch'?sdk.getMakerRegistrationDecoder().decode(bytes).quoteEpoch:
                sdk.getMarketStateDecoder().decode(bytes).sequence;
              // Unchanged authority rules out the economic effect, not a failed
              // landing/network fee hidden by incomplete history. Keep any fee
              // reservation until independent transaction evidence exists.
              if(value.toString()===r.authority.value){status='expired-unexecuted';result={slot:integer(a.context.slot).toString(),fee:null,error:null,economicEffect:'not-applied'};}
            }
          }else if(valid.value===true){
            // The INSERT was committed before this worker can broadcast. Lost
            // acknowledgements and process death only cause identical-byte retries.
            console.log(JSON.stringify({event:'executor-broadcast',runId:this.store.runId,requestId:id,signature:r.signature,at:Date.now()}));
            await this.rpc.call('sendTransaction',[r.wire,{encoding:'base64',skipPreflight:true,maxRetries:0}]);status='pending';
          }
        }
      }catch{ /* No negative inference from transport errors or absent history. */ }
      if(release && r.budget){
        const fee=BigInt(result.fee);if(fee>RESERVATION)throw new Error('Actual fee exceeds reservation');
        await c.query('UPDATE service_budgets SET committed=committed-$3,spent=spent+$4 WHERE run_id=$1 AND name=$2',[this.store.runId,r.budget,RESERVATION.toString(),fee.toString()]);
      }
      await c.query("UPDATE service_intents SET status=$3,result=$4,attempts=attempts+1,updated_at=now(),next_attempt=now()+interval '1 second' WHERE run_id=$1 AND request_id=$2",[this.store.runId,id,status,result?json(result):null]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
}
