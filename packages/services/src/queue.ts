import { createPublicKey, verify } from 'node:crypto';
import { VersionedTransaction } from '@solana/web3.js';
import { getBase58Decoder, getAddressEncoder, type Address } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {Pool} from 'pg';
import { Rpc, integer } from '../../indexer/src/rpc.js';
import { json } from '../../indexer/src/events.js';
import {accountAuthorityValue, type AccountAuthority} from './account-authority.js';
import {persistLiquidityInputs,type LiquidityInputs} from './liquidity-inputs.js';
import {liquidityPriceSequence,type LiquidityPriceAuthority} from './liquidity-authority.js';
import {prepareDispatch,reserveDispatch} from './dispatch.js';

export const RESERVATION=20_000n;
export type Authority=AccountAuthority | LiquidityPriceAuthority;
export function signedWire(wire:string,maxVersion:0|1=0) {
  const maximum=maxVersion===1?4096:1232;
  if(typeof wire!=='string' || wire.length>4*Math.ceil(maximum/3))throw new Error('Invalid transaction size');
  const bytes=Buffer.from(wire,'base64');if(bytes.length>maximum || bytes.toString('base64')!==wire)throw new Error('Noncanonical transaction');
  const tx=VersionedTransaction.deserialize(bytes);
  if(tx.message.version!==0&&!(maxVersion===1&&tx.message.version===1))throw new Error('Unsupported transaction version');
  if(tx.message.version===0&&(tx.message.addressTableLookups.length||bytes.length>1232))throw new Error('Only bounded static-account messages supported');
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
export class Queue {
  constructor(readonly store:{pool:Pool;runId:string},readonly rpc:Rpc,readonly program:Address=sdk.CLEARING_PROGRAM_ADDRESS,readonly maxVersion:0|1=0){}
  async prepare(){await prepareDispatch(this.store.pool,this.store.runId);}
  async budget(name:string,wallet:string,cap:bigint){
    await this.store.pool.query('INSERT INTO service_budgets(run_id,name,wallet,cap) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[this.store.runId,name,wallet,cap.toString()]);
    const r=(await this.store.pool.query('SELECT * FROM service_budgets WHERE run_id=$1 AND name=$2',[this.store.runId,name])).rows[0];
    if(r.wallet!==wallet || BigInt(r.cap)!==cap)throw new Error('Budget identity changed');
  }
  async put(id:string,wire:string,authority:Authority|null,budget:string|null=null,inputs?:LiquidityInputs){
    if(!/^[a-zA-Z0-9:._-]{1,160}$/.test(id))throw new Error('Invalid request identity');
    const signed=signedWire(wire,this.maxVersion),c=await this.store.pool.connect();
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
      if(inputs){if(this.maxVersion!==1)throw new Error('Input provenance requires the canonical queue');await persistLiquidityInputs(c,this.store.runId,id,inputs,wire);}
      // PostgreSQL delivers this hint only after the signed bytes are committed.
      await c.query("SELECT pg_notify('rivalt_intents',$1)",[this.store.runId]);
      await c.query('COMMIT');return r;
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async get(id:string){return (await this.store.pool.query('SELECT request_id,signature,status,attempts,result FROM service_intents WHERE run_id=$1 AND request_id=$2',[this.store.runId,id])).rows[0]??null;}
  async pending(){return (await this.store.pool.query(`SELECT request_id FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved','expired-unexecuted') AND next_attempt<=now() ORDER BY next_attempt LIMIT 32`,[this.store.runId])).rows.map(r=>r.request_id as string);}
  async step(id:string){
    const c=await this.store.pool.connect();
    const requestLock=`${this.store.runId}/dispatch-original/${id}`;
    let owned=false,destroy=false;
    try{
      owned=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',[requestLock])).rows[0]?.acquired===true;
      if(!owned)return;
      await c.query('BEGIN');
      const r=(await c.query(`SELECT * FROM service_intents WHERE run_id=$1 AND request_id=$2 AND status IN ('pending','unresolved','expired-unexecuted') FOR UPDATE SKIP LOCKED`,[this.store.runId,id])).rows[0];
      if(!r){await c.query('COMMIT');return;}
      if(r.status!=='expired-unexecuted') {
        await c.query('SAVEPOINT admission');
        if(!await reserveDispatch(c,this.store.runId,id,r.wire)) {
          await c.query('ROLLBACK TO SAVEPOINT admission');
          // Let later independent work enter the bounded due-work list. This is
          // scheduling deferral, not an RPC attempt or a new economic outcome.
          await c.query("UPDATE service_intents SET next_attempt=now()+interval '1 second' WHERE run_id=$1 AND request_id=$2",[this.store.runId,id]);
          await c.query('COMMIT');return;
        }
      }
      // Crash here or after send leaves the resource reservation durable. The
      // per-original session lock excludes a second worker across this commit.
      await c.query('COMMIT');
      await c.query('BEGIN');
      let status=r.status==='expired-unexecuted'?r.status:'unresolved',result:any=r.status==='expired-unexecuted'?r.result:null,release=false;
      try{
        const s=(await this.rpc.call('getSignatureStatuses',[[r.signature],{searchTransactionHistory:true}])).value[0];
        if(this.maxVersion===1&&s&&['confirmed','finalized'].includes(s.confirmationStatus))
          console.log(JSON.stringify({event:'executor-observed',runId:this.store.runId,requestId:id,signature:r.signature,
            commitment:s.confirmationStatus,at:Date.now()}));
        if(s?.confirmationStatus==='finalized'){
          const tx=await this.rpc.call('getTransaction',[r.signature,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:this.maxVersion}]);
          if(tx?.meta && tx.transaction?.signatures?.[0]===r.signature && json(tx.meta.err)===json(s.err)){
            status=tx.meta.err===null?'finalized':'failed';result={slot:integer(tx.slot).toString(),fee:integer(tx.meta.fee).toString(),error:tx.meta.err};release=true;
          }
        }else if(!s){
          const valid=await this.rpc.call('isBlockhashValid',[r.blockhash,{commitment:'finalized'}]);
          if(valid.value===false && r.authority){
            if(r.authority.kind==='liquidityPriceSequence') {
              if(this.maxVersion!==1)throw new Error('Canonical authority requires profile 4');
              const proof=await liquidityPriceSequence(this.rpc,r.authority,integer(valid.context.slot));
              if(proof.value.toString()===r.authority.value) {
                status='expired-unexecuted';result={slot:proof.slot.toString(),fee:null,error:null,economicEffect:'not-applied'};
              }
            }else{
            const a=await this.rpc.call('getAccountInfo',[r.authority.account,{encoding:'base64',commitment:'finalized',minContextSlot:integer(valid.context.slot)}]);
            if(a.value?.owner===this.program){
              const bytes=Buffer.from(a.value.data[0],'base64');
              const value=await accountAuthorityValue(r.authority,bytes);
              // Unchanged authority rules out the economic effect, not a failed
              // landing/network fee hidden by incomplete history. Keep any fee
              // reservation until independent transaction evidence exists.
              if(value.toString()===r.authority.value){status='expired-unexecuted';result={slot:integer(a.context.slot).toString(),fee:null,error:null,economicEffect:'not-applied'};}
            }
            }
          }else if(valid.value===true&&r.status!=='expired-unexecuted'){
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
      if(release||status==='expired-unexecuted')
        await c.query('DELETE FROM service_dispatch_access WHERE run_id=$1 AND request_id=$2',[this.store.runId,id]);
      await c.query("UPDATE service_intents SET status=$3,result=$4,attempts=attempts+1,updated_at=now(),next_attempt=now()+interval '1 second' WHERE run_id=$1 AND request_id=$2",[this.store.runId,id,status,result?json(result):null]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{
      if(owned)try{await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[requestLock]);}catch{destroy=true;}
      c.release(destroy);
    }
  }
}
