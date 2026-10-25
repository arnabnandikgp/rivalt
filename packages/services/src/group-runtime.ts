import {address,getProgramDerivedAddress,type Address} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {json} from '../../indexer/src/events.js';
import {GroupExecution,groupBudget} from './group-execution.js';

export const GROUP_HEARTBEAT_MS=3000;
export type GroupWorkerOutcome={status:'idle'|'queued'|'blocked';reason:string};
export class GroupRuntime extends GroupExecution {
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
      await this.enqueue(`maker:${marketIndex}:${makerId}:${maker.state.quoteEpoch}`,[sdk.routeComputeBudget(),publish,update],key,budget,authority);
      return {status:'queued',reason:'expired-maker-epoch'};
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
      {kind:'groupSequence',group:snapshot.group,account:snapshot.group,value:snapshot.state.sequence.toString()});
    return {status:'queued',reason:'market-observation-due'};
  }
}
