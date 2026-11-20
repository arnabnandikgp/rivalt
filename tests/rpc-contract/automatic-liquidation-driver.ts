import assert from 'node:assert/strict';
import * as sdk from '@rivalt/sdk';
import {address,type Address} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import type {openSettlementJournal} from './scalable-settlement-journal.js';
import {eventually,type WireRpc,type WireSubscriptions} from './wire.js';

export async function openLiquidationDriver(rpc:WireRpc,ws:WireSubscriptions,
  journal:Awaited<ReturnType<typeof openSettlementJournal>>,refresh:()=>Promise<void>,signer:Keypair,receiver:Address) {
  const runtime=new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',
    process.env.RIVALT_RPC_URL!,4,'integrated-recovery-candidate');
  await journal.checkpoint('initialize-risk-worker',true);
  await runtime.open();
  const call=runtime.rpc.call.bind(runtime.rpc),preflights:unknown[]=[];
  runtime.rpc.call=async(method,params=[])=>{
    const response=await call(method,params);
    if(method==='simulateTransaction'&&response.value.err)
      preflights.push({err:response.value.err,logs:response.value.logs?.slice(-6)});
    return response;
  };
  const receipts:{reason:string;signature:string;slot:number;fee:number;cu:number;bytes:number}[]=[];
  const intents=async()=>(await runtime.store.pool.query<{request_id:string;signature:string;wire:string;status:string}>(
    "SELECT request_id,signature,wire,status FROM service_intents WHERE run_id=$1 AND budget='liquidity-risk' ORDER BY request_id",
    [runtime.runId])).rows;
  const balance=async()=>BigInt((await rpc.call('getBalance',[signer.address,{commitment:'confirmed'}])).value);
  async function check(stage:string,expected:string,queue:boolean,configuredReceiver?:Address) {
    await journal.checkpoint(stage,true);
    await refresh();
    const beforeFee=await balance(),before=await intents();
    const {state}=await runtime.discovery();
    const memberCount=state.members.filter(member=>state.roots[member].positions.some(position=>BigInt(position.lots)!==0n)).length;
    let found=false;
    const outcomes=[];

    for(let cycle=0;cycle<Math.max(1,Math.ceil(memberCount/2));cycle++){
      const result=await runtime.riskWork(signer,configuredReceiver);
      outcomes.push(result);
      if(result.reason===expected){found=true;assert.equal(result.status,queue?'queued':'idle');}
      if(result.status==='queued'){assert.equal(result.reason,expected);break;}
    }
    if(!found){
      const diagnostics=[];
      for(const member of state.members.filter(member=>state.roots[member].role===0&&BigInt(state.roots[member].positions[0].lots)!==0n)){
        const target=address(member),snap=await runtime.snapshot([target],0),root=snap.roots[target];
        const view=sdk.accountBalanceView(root,snap.safetyState,snap.marketStates,snap.now,snap.slot);
        diagnostics.push({target,deficit:view.maintenanceDeficitScaled,equity:view.riskEquityScaled,
          modes:view.positions.map(position=>position.sourceMode),available:snap.liquidity!.adapters.map(maker=>maker.unavailable)});
      }
      assert.fail(JSON.stringify({expected,outcomes,diagnostics,preflights}));
    }
    const rows=await intents();
    if(!queue){assert.deepEqual(rows,before);assert.equal(await balance(),beforeFee);return;}
    const fresh=rows.filter(row=>!before.some(earlier=>earlier.request_id===row.request_id));
    assert.equal(fresh.length,1);
    const [original]=fresh;assert.equal(original.status,'pending');
    const subscription=await ws.call('signatureSubscribe',[original.signature,{commitment:'finalized'}]);
    await eventually(async()=>{await runtime.execute();return (await intents()).find(row=>row.signature===original.signature)?.status;},
      status=>status==='finalized',stage+' original');
    assert.equal((await ws.notification(subscription)).params.result.value.err,null);
    const tx=await rpc.call('getTransaction',[original.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(tx.meta.err,null);assert.equal(tx.transaction[0],original.wire);assert.equal(beforeFee-await balance(),BigInt(tx.meta.fee));
    receipts.push({reason:expected,signature:original.signature,slot:tx.slot,fee:tx.meta.fee,cu:tx.meta.computeUnitsConsumed,bytes:Buffer.from(original.wire,'base64').length});
  }
  return {receipts,close:()=>runtime.close(),
    maker:()=>check('discover-maker','admitted-maker-liquidation',true),
    blocked:()=>check('probe-unfunded-receiver','no-admissible-maker-or-funded-receiver',false,receiver),
    receiver:()=>check('discover-funded-receiver','funded-whole-account-liquidation',true,receiver),
    healthy:()=>check('rescan-restored-health','no-under-maintenance-target-in-probe',false,receiver)};
}
