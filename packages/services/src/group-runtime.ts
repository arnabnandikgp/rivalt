import {address,getProgramDerivedAddress,type Address} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {json} from '../../indexer/src/events.js';
import {decodeGroup} from '../../indexer/src/group-events.js';
import {groupSampleMatches,GroupQuoteUnavailable} from './group-quote.js';
import {groupDefaultProbeMembers,groupReceiver,groupResolutionPage,groupRiskSources} from './group-risk.js';
import {groupClaimAmount,groupCertificatePage} from './group-settlement.js';
import {GroupExecution,groupBudget} from './group-execution.js';

export const GROUP_HEARTBEAT_MS=3000;
export type GroupWorkerOutcome={status:'idle'|'queued'|'blocked';reason:string};
export class GroupRuntime extends GroupExecution {
  // Discovery only; no financial progress/authority lives in this cursor.
  private riskProbeCursor=0;
  async snapshot(commitment:'confirmed'|'finalized'='finalized'){
    const binding=await this.environment(),projection=await this.store.snapshot();
    if(!projection.state.group)throw new Error('Group projection unavailable');
    const snapshot=await sdk.readGroupSnapshot(this.rpc,{group:address(binding.group),mint:address(projection.state.group.quoteMint),domain:binding.domain},commitment);
    const makers=await sdk.readGroupMakers(this.rpc,snapshot);
    const [eventAuthority]=await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('__event_authority')]});
    const heartbeats=(await this.store.pool.query(`SELECT *,seen_at>now()-($2::int*interval '1 millisecond') AS online FROM group_maker_heartbeats WHERE run_id=$1`,[this.runId,GROUP_HEARTBEAT_MS])).rows;
    return {...snapshot,eventAuthority,program:sdk.CLEARING_PROGRAM_ADDRESS,
      makers:makers.map(maker=>({...maker,online:heartbeats.some(heartbeat=>heartbeat.market_index===maker.marketIndex&&heartbeat.maker_id===maker.makerId&&
        heartbeat.registration===maker.registration&&heartbeat.owner===maker.registrationState.owner&&heartbeat.online===true)}))};
  }
  private async pendingBudget(budget:string){
    return (await this.store.pool.query("SELECT 1 FROM service_intents WHERE run_id=$1 AND budget=$2 AND status IN ('pending','unresolved') LIMIT 1",[this.runId,budget])).rowCount!==0;
  }
  async quote(actor:Address,trader:Address,marketIndex:0|1,side:0|1,lots:bigint,stored?:sdk.GroupStoredFill){
    const snapshot=await this.snapshot('confirmed'),market=snapshot.marketStates[marketIndex];
    if(!market)throw new Error('Unknown quote market');
    const diagnostic={snapshotCommitment:snapshot.commitment,snapshotSlot:snapshot.slot.toString(),sequence:snapshot.state.sequence.toString(),
      marketIndex,observation:market.observationSequence.toString(),sourceMode:sdk.groupSourceMode(snapshot.state,market,snapshot.now,snapshot.slot)};
    const pending=(await this.store.pool.query("SELECT signature FROM service_intents WHERE run_id=$1 AND budget IN ('group-funding-0','group-funding-1') AND status IN ('pending','unresolved')",[this.runId])).rows;
    const confirmedSamples:string[]=[];
    for(const {signature} of pending){
      let applied=false;
      try{
        const transaction=await this.rpc.call('getTransaction',[signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
        const events=decodeGroup(signature,transaction,snapshot.eventAuthority,snapshot.group).filter(event=>event.type==='group-oracle');
        applied=events.length===1&&BigInt(transaction.slot)<=snapshot.slot&&groupSampleMatches(events[0].data,snapshot);
      }catch{ /* A missing/foreign sample still blocks the quote; no fee/history inference. */ }
      if(!applied)throw new GroupQuoteUnavailable('group-observation-update-pending',diagnostic);
      confirmedSamples.push(signature);
    }
    let quote;
    try{quote=await sdk.buildGroupRoute({snapshot,trader,marketIndex,side,lots,stored,makers:snapshot.makers.filter(maker=>maker.online),
      maxFee:1_000_000_000n,allInLimit:side===0?1_000_000_000_000_000n:0n},actor);}
    catch(error){
      const code=error instanceof Error&&error.message.includes('source unavailable')?'required-market-source-unavailable':
        error instanceof Error&&error.message.includes('Stored group order')?'stored-order-unavailable':'group-account-or-authority-unavailable';
      throw new GroupQuoteUnavailable(code,diagnostic);
    }
    if(!quote)return {available:false as const,code:'maker-capacity-or-whole-account-health',diagnostic};
    const processed=await this.rpc.call('getSlot',[{commitment:'processed'}]);
    if(!Number.isSafeInteger(processed)||processed<0||quote.expirySlot<=BigInt(processed)+10n)throw new GroupQuoteUnavailable('group-quote-expiring',diagnostic);
    return {available:true as const,...quote,diagnostic,confirmedSamples};
  }
  async orders(key:Keypair):Promise<GroupWorkerOutcome>{
    const budget=await this.budget('orders',key);
    if(await this.pendingBudget(budget))return {status:'blocked',reason:'original-order-intent-pending'};
    const snapshot=await this.snapshot();
    if(![1,2].includes(snapshot.state.mode)||snapshot.state.paused)return {status:'blocked',reason:'group-mode'};
    for(const trader of snapshot.members){const root=snapshot.roots[trader];
      for(const entry of root.book.orders){
        const marketIndex=entry.marketIndex as 0|1,market=snapshot.marketStates[marketIndex];if(!market)continue;
        const remaining=sdk.groupOrderRemaining(root,entry,market,snapshot.slot);
        if(remaining===0n||!sdk.orderTriggered(entry.order,market.referencePrice,snapshot.slot))continue;
        let lots=remaining<64n?remaining:64n;
        while(lots>0n){
          try{
            const quote=await this.quote(key.address,trader,marketIndex,entry.order.side as 0|1,lots,
              {id:entry.order.id,version:entry.order.version,filled:entry.order.filled});
            if(quote.available){
              await this.enqueue(`order:${root.id}:${marketIndex}:${entry.order.id}:${entry.order.version}:${entry.order.filled}:${quote.sequence}`,
                quote.instructions,key,budget,{kind:'marginNonce',group:snapshot.group,account:trader,value:quote.nonce.toString()});
              return {status:'queued',reason:'durable-group-order-fill'};
            }
          }catch(error){if(!(error instanceof GroupQuoteUnavailable))throw error;break;}
          lots/=2n;
        }
      }
    }
    return {status:'idle',reason:'no-admissible-triggered-order'};
  }
  async settle(key:Keypair):Promise<GroupWorkerOutcome>{
    const budget=await this.budget('settlement',key);
    if(await this.pendingBudget(budget))return {status:'blocked',reason:'original-settlement-intent-pending'};
    const snapshot=await this.snapshot('confirmed');
    if(![1,2].includes(snapshot.state.mode)||snapshot.state.paused)return {status:'blocked',reason:'group-mode'};
    const stamp={sequence:snapshot.state.sequence,observations:snapshot.marketStates.map(market=>market.observationSequence)};
    const authority={kind:'groupSequence' as const,group:snapshot.group,account:snapshot.group,value:stamp.sequence.toString()};
    const base=`keeper:${stamp.sequence}:${stamp.observations.join(':')}`;
    const change=async(margin:Address,marketIndex:0|1,amount:bigint,gain:boolean)=>{
      const instruction=sdk.getChangeGroupClaimV2Instruction({...snapshot,...stamp,margin,marketIndex,amount,gain});
      await this.enqueue(`${base}:${gain?'gain':'loss'}:${snapshot.roots[margin].id}:${marketIndex}`,
        [sdk.routeComputeBudget(),instruction],key,budget,authority,true);
      return {status:'queued' as const,reason:gain?'guarded-group-gain':'funded-group-loss'};
    };
    // Collection is permissionless and requires no gain certificate. Neither
    // collection nor this worker may net opposite closed claims for their owner.
    for(const margin of snapshot.members)for(const marketIndex of [0,1] as const){
      const amount=groupClaimAmount(snapshot,margin,marketIndex,false);
      if(amount>0n)return change(margin,marketIndex,amount,false);
    }
    // A current adverse preview can refuse a scan, never authorize an exit or
    // prove default. The on-chain proof also checks all funding-bound corners.
    for(const margin of snapshot.members){
      const view=sdk.groupBalanceView(snapshot.roots[margin],snapshot.state,snapshot.marketStates,snapshot.now,snapshot.slot);
      if(view.riskEquityScaled===null||BigInt(view.riskEquityScaled)<0n)return {status:'blocked',reason:'cohort-solvency-or-source-unavailable'};
    }
    let page;
    try{page=groupCertificatePage(snapshot);}catch{return {status:'blocked',reason:'group-certificate-needs-fresh-observation'};}
    if(page){
      // Proofs change the guard without advancing group sequence. An unchanged
      // group stamp cannot prove their nonexecution after missing history.
      await this.enqueue(`${base}:proof:${page.start}`,[sdk.resolutionComputeBudget(),page.instruction],key,budget,null,true);
      return {status:'queued',reason:'complete-group-proof-page'};
    }
    for(const margin of snapshot.members)for(const marketIndex of [0,1] as const){
      const amount=groupClaimAmount(snapshot,margin,marketIndex,true);
      if(amount>0n)return change(margin,marketIndex,amount,true);
    }
    return {status:'idle',reason:'no-admissible-whole-atom-claim'};
  }
  async riskWork(key:Keypair,receiver?:Address):Promise<GroupWorkerOutcome>{
    const budget=await this.budget('risk',key);
    if(await this.pendingBudget(budget))return {status:'blocked',reason:'original-risk-intent-pending'};
    const snapshot=await this.snapshot('confirmed'),header=snapshot.resolutionState?.header;
    if(!header)throw new Error('Group resolution state missing');
    const authority={kind:'groupSequence' as const,group:snapshot.group,account:snapshot.group,value:snapshot.state.sequence.toString()};
    const submit=async(id:string,instruction:Parameters<typeof this.enqueue>[1][number],resolution=false)=>{
      try{
        await this.enqueue(`risk:${id}:${snapshot.state.sequence}`,
          [resolution?sdk.resolutionComputeBudget():sdk.routeComputeBudget(),instruction],key,budget,authority,true);
        return true;
      }catch(error){
        // A rejected signed simulation was never persisted/broadcast. Transport,
        // identity, budget and ambiguous-queue errors must not select new bytes.
        if(error instanceof Error&&error.message==='Risk action presently unavailable')return false;
        throw error;
      }
    };
    if(snapshot.state.mode===3){
      if(header.stage>=2&&header.stage<=11){
        return await submit(`page:${header.epoch}:${header.stage}:${header.cursor}`,groupResolutionPage(snapshot),true)?
          {status:'queued',reason:'complete-group-resolution-page'}:{status:'blocked',reason:'resolution-page-simulation-rejected'};
      }
      if(header.stage===1||header.stage===12){
        if(header.stage===12){
          if(snapshot.now-header.recoveryLast<2n)return {status:'idle',reason:'recovery-check-not-due'};
          if(header.recoverySince>0n&&header.recoveryLast-header.recoverySince>=6n)return {status:'blocked',reason:'explicit-authority-resume-required'};
          const attempts=await this.store.pool.query('SELECT count(*)::int AS count FROM service_intents WHERE run_id=$1 AND starts_with(request_id,$2)',
            [this.runId,`risk:check:${header.epoch}:12:`]);
          if(attempts.rows[0].count>=8)return {status:'blocked',reason:'bounded-recovery-checks-exhausted'};
        }
        const instruction=sdk.getRecoverGroupResolutionV2Instruction({...snapshot,...groupRiskSources(snapshot),caller:key,epoch:header.epoch,resume:false});
        return await submit(`check:${header.epoch}:${header.stage}:${header.recoveryLast}`,instruction,true)?
          {status:'queued',reason:header.stage===1?'awaited-complete-group-valuation':'permissionless-group-recovery-check'}:
          {status:'blocked',reason:'fresh-group-recovery-sources-unavailable'};
      }
      return {status:'blocked',reason:'unsupported-frozen-stage'};
    }
    if(![1,2].includes(snapshot.state.mode))return {status:'blocked',reason:'group-mode'};
    const stamp={sequence:snapshot.state.sequence,observations:snapshot.marketStates.map(market=>market.observationSequence)};
    const members=groupDefaultProbeMembers(snapshot),probes:Address[]=[];
    // At most two current-source bankruptcy probes per iteration, in registry
    // order. This also works during a pause or stale cached oracle observation.
    for(let offset=0;offset<Math.min(2,members.length);offset++)probes.push(members[(this.riskProbeCursor+offset)%members.length]);
    this.riskProbeCursor=members.length?(this.riskProbeCursor+probes.length)%members.length:0;
    for(const target of probes){
      const instruction=sdk.getFreezeGroupV2Instruction({...snapshot,...groupRiskSources(snapshot),...stamp,caller:key,target,emergency:false});
      if(await submit(`freeze:${snapshot.roots[target].id}`,instruction))return {status:'queued',reason:'authenticated-net-insolvency'};
    }
    // Workers never initiate authority-only emergency freeze or resume. A
    // consenting receiver is an explicit account, never an inferred sibling.
    if(snapshot.state.paused)return {status:'blocked',reason:'group-paused-after-default-probes'};
    const capital=groupReceiver(snapshot,key.address,receiver);
    if(!capital||!receiver)return {status:'blocked',reason:'no-configured-funded-receiver'};
    const target=probes.find(margin=>margin!==receiver&&(()=>{
      const view=sdk.groupBalanceView(snapshot.roots[margin],snapshot.state,snapshot.marketStates,snapshot.now,snapshot.slot);
      return view.maintenanceDeficitScaled!==null&&BigInt(view.maintenanceDeficitScaled)>0n;
    })());
    if(!target)return {status:'idle',reason:'no-current-liquidation-candidate'};
    for(const marketIndex of [0,1] as const){
      if(capital.mode===1&&capital.isolatedMarketIndex!==marketIndex)continue;
      const quantity=snapshot.roots[target].positions[marketIndex].lots;
      let lots=quantity<0n?-quantity:quantity;if(lots>64n)lots=64n;
      while(lots>0n){
        const instruction=sdk.getLiquidateGroupV2Instruction({...snapshot,...stamp,receiverOwner:key,target,receiver,marketIndex,lots,
          price:snapshot.marketStates[marketIndex].referencePrice});
        if(await submit(`liquidate:${snapshot.roots[target].id}:${marketIndex}:${lots}`,instruction))return {status:'queued',reason:'funded-whole-account-liquidation'};
        lots/=2n;
      }
    }
    return {status:'blocked',reason:'no-post-fee-progress-or-receiver-capacity'};
  }
  async maker(marketIndex:0|1,makerId:0|1,key:Keypair):Promise<GroupWorkerOutcome>{
    const budget=groupBudget('maker',marketIndex,makerId).name,snapshot=await this.snapshot();
    const maker=snapshot.makers.find(candidate=>candidate.marketIndex===marketIndex&&candidate.makerId===makerId);
    if(!maker||maker.registrationState.owner!==key.address)throw new Error('Market-specific maker key binding');
    await this.budget('maker',key,marketIndex,makerId);
    const registration=maker.registrationState;
    await this.store.pool.query(`INSERT INTO group_maker_heartbeats(run_id,market_index,maker_id,registration,owner,process_id,snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(run_id,market_index,maker_id) DO UPDATE SET
      registration=EXCLUDED.registration,owner=EXCLUDED.owner,process_id=EXCLUDED.process_id,seen_at=now(),snapshot=EXCLUDED.snapshot`,
      [this.runId,marketIndex,makerId,maker.registration,key.address,process.pid,json({sequence:snapshot.state.sequence,slot:snapshot.slot,
        capital:registration.capital,cash:maker.capital.cash,positions:maker.capital.positions,quoteEpoch:maker.state.quoteEpoch,expirySlot:maker.state.expirySlot,
        approved:maker.approved,quarantined:registration.quarantined,synchronized:maker.synchronized})]);
    if(!maker.approved||registration.quarantined||snapshot.state.paused||![1,2].includes(snapshot.state.mode))return {status:'blocked',reason:'maker-admission-or-group-mode'};
    if(await this.pendingBudget(budget))return {status:'blocked',reason:'original-maker-intent-pending'};
    const update=sdk.getUpdateGroupMakerV2Instruction({...snapshot,...registration,registration:maker.registration,actor:key,operation:1});
    const authority={kind:'groupQuoteEpoch' as const,group:snapshot.group,account:maker.registration,value:registration.quoteEpoch.toString()};
    if(snapshot.slot>=maker.state.expirySlot){
      const api=makerId===0?sdk.makerA:sdk.makerB;
      const publish=api.getPublishGroupEpochInstruction({owner:key,config:registration.config,duration:3600n});
      // Clearing authenticates a read-only config; transaction-wide writability
      // promotion forbids combining publication with its later clearing sync.
      // Publication does not change the registration epoch, so that epoch also
      // cannot prove nonexecution when original publication history is missing.
      await this.enqueue(`maker:${marketIndex}:${makerId}:${maker.state.quoteEpoch}`,[sdk.routeComputeBudget(),publish],key,budget,null);
      return {status:'queued',reason:'expired-maker-epoch-publication'};
    }
    if(!maker.synchronized){
      await this.enqueue(`maker-sync:${marketIndex}:${makerId}:${maker.state.quoteEpoch}`,[sdk.routeComputeBudget(),update],key,budget,authority);
      return {status:'queued',reason:'owner-epoch-sync'};
    }
    return {status:'idle',reason:'current-maker-epoch'};
  }
  async funding(marketIndex:0|1,key:Keypair,intervalSeconds=2n):Promise<GroupWorkerOutcome>{
    if(intervalSeconds<2n||intervalSeconds>5n)throw new Error('Local funding cadence must be 2–5 seconds');
    const budget=await this.budget('funding',key,marketIndex);
    if(await this.pendingBudget(budget))return {status:'blocked',reason:'original-funding-intent-pending'};
    const snapshot=await this.snapshot(),market=snapshot.marketStates[marketIndex];
    if(![1,2].includes(snapshot.state.mode)||snapshot.state.paused)return {status:'blocked',reason:'group-mode'};
    if(snapshot.now-market.oracle.sampledAt<intervalSeconds)return {status:'idle',reason:'sample-not-due'};
    const makers=[0,1].map(makerId=>snapshot.makers.find(maker=>maker.marketIndex===marketIndex&&maker.makerId===makerId));
    if(makers.some(maker=>!maker))return {status:'blocked',reason:'incomplete-market-makers'};
    const [first,second]=makers.map(maker=>maker!),firstRegistration=first.registrationState,secondRegistration=second.registrationState;
    // Sampling must record loss of source/maker coverage too. Do not suppress it
    // because a heartbeat, quote epoch or source became unavailable; clearing
    // authenticates inputs and transitions to its restrictive oracle mode.
    const instruction=sdk.getSampleGroupOracleV2Instruction({...snapshot,market:snapshot.markets[marketIndex],
      primaryAsset:market.oracle.sources[0],primaryCollateral:market.oracle.sources[1],guardAsset:market.oracle.sources[2],guardCollateral:market.oracle.sources[3],
      firstCapital:firstRegistration.capital,firstRegistration:first.registration,firstProgram:firstRegistration.pricingProgram,firstProgramData:firstRegistration.programData,firstConfig:firstRegistration.config,
      secondCapital:secondRegistration.capital,secondRegistration:second.registration,secondProgram:secondRegistration.pricingProgram,secondProgramData:secondRegistration.programData,secondConfig:secondRegistration.config});
    await this.enqueue(`funding:${marketIndex}:${market.observationSequence}`,[sdk.fundingComputeBudget(),instruction],key,budget,
      {kind:'groupObservationSequence',group:snapshot.group,account:snapshot.markets[marketIndex],value:market.observationSequence.toString()});
    return {status:'queued',reason:'market-observation-due'};
  }
}
