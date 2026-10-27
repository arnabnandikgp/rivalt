import {address,type Address} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {json} from '../../indexer/src/events.js';
import {AccountExecution} from './account-execution.js';
import {accountWorkerKeys} from './account-worker-state.js';
import {settleAccounts} from './account-settlement-worker.js';
import {accountRiskWork} from './account-risk-worker.js';

export type AccountWorkerOutcome={status:'idle'|'queued'|'blocked';reason:string};
export class AccountQuoteUnavailable extends Error {
  constructor(readonly code:string,readonly diagnostic:Record<string,unknown>){super(code);}
}
export const ACCOUNT_HEARTBEAT_MS=3000;

export class AccountRuntime extends AccountExecution {
  riskProbeCursor=0;
  async discovery() {
    const binding=await this.environment(),{state}=await this.store.snapshot();
    if(!state.venue||state.members.length===0)throw new Error('Account discovery unavailable');
    return {binding,state,identity:{venue:address(binding.venue),mint:address(state.venue.quoteMint),domain:binding.domain}};
  }
  async snapshot(margins?:Address[],marketIndex?:0|1) {
    const discovery=await this.discovery(),selected=margins??[address(discovery.state.members[0])];
    const snapshot=marketIndex===undefined?await sdk.readAccountSnapshot(this.rpc,discovery.identity,selected,'confirmed'):
      await sdk.readAccountTradeSnapshot(this.rpc,discovery.identity,selected[0],marketIndex,'confirmed');
    return {...snapshot,...await accountWorkerKeys(snapshot.venue)};
  }
  async pendingBudget(budget:string) {
    return (await this.store.pool.query("SELECT 1 FROM service_intents WHERE run_id=$1 AND budget=$2 AND status IN ('pending','unresolved') LIMIT 1",[this.runId,budget])).rowCount!==0;
  }
  async heartbeats() {
    return (await this.store.pool.query(`SELECT *,seen_at>now()-($2::int*interval '1 millisecond') AS online
      FROM account_maker_heartbeats WHERE run_id=$1`,[this.runId,ACCOUNT_HEARTBEAT_MS])).rows;
  }
  async quote(actor:Address,trader:Address,marketIndex:0|1,side:0|1,lots:bigint,stored?:sdk.GroupStoredFill) {
    const snapshot=await this.snapshot([trader],marketIndex),heartbeats=await this.heartbeats();
    const diagnostic={snapshotCommitment:snapshot.commitment,snapshotSlot:snapshot.slot.toString(),
      marketIndex,sourceModes:snapshot.marketStates.map(market=>sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot))};
    snapshot.makers=snapshot.makers.filter(maker=>heartbeats.some(heartbeat=>heartbeat.market_index===marketIndex&&
      heartbeat.maker_id===maker.makerId&&heartbeat.registration===maker.registration&&heartbeat.owner===maker.registrationState.owner&&heartbeat.online));
    if(!snapshot.makers.length)throw new AccountQuoteUnavailable('market-makers-offline',diagnostic);
    // Funding updates are deliberately not a quote barrier. The V3 instruction
    // checks current relevant sources, funding and health under its user limits.
    let quote;
    try {quote=await sdk.buildAccountRoute({snapshot,trader,marketIndex,side,lots,stored,
      maxFee:1_000_000_000n,allInLimit:side===0?1_000_000_000_000_000n:0n},actor);}
    catch(error) {
      const message=error instanceof Error?error.message:'';
      throw new AccountQuoteUnavailable(message.includes('source unavailable')?'required-market-source-unavailable':
        message.includes('Stored')?'stored-order-unavailable':'account-mode-or-authority-unavailable',diagnostic);
    }
    if(!quote)return {available:false as const,code:'maker-capacity-or-whole-account-health',diagnostic};
    const slot=await this.rpc.call('getSlot',[{commitment:'processed'}]);
    if(!Number.isSafeInteger(slot)||slot<0||quote.expirySlot<=BigInt(slot)+10n)throw new AccountQuoteUnavailable('account-quote-expiring',diagnostic);
    return {available:true as const,...quote,diagnostic};
  }
  async orders(key:Keypair):Promise<AccountWorkerOutcome> {
    const budget=await this.budget('orders',key);
    if(await this.pendingBudget(budget))return {status:'blocked',reason:'original-order-intent-pending'};
    const {state}=await this.discovery();
    for(const member of state.members) {
      if(!state.roots[member].book.orders.some(stored=>[1,2].includes(stored.order.state)))continue;
      const trader=address(member),snapshot=await this.snapshot([trader]),root=snapshot.roots[trader];
      if(snapshot.safetyState.mode!==1||snapshot.safetyState.paused)return {status:'blocked',reason:'venue-mode'};
      for(const stored of root.book.orders) {
        const marketIndex=stored.marketIndex as 0|1,market=snapshot.marketStates[marketIndex];if(!market)continue;
        const remaining=sdk.accountOrderRemaining(root,stored,market,snapshot.slot);
        if(!remaining||!sdk.orderTriggered(stored.order,market.referencePrice,snapshot.slot))continue;
        for(let lots=remaining<64n?remaining:64n;lots>0n;lots/=2n) {
          try {
            const quote=await this.quote(key.address,trader,marketIndex,stored.order.side as 0|1,lots,
              {id:stored.order.id,version:stored.order.version,filled:stored.order.filled});
            if(quote.available) {
              await this.enqueue(`order:${root.id}:${marketIndex}:${stored.order.id}:${stored.order.version}:${stored.order.filled}:${quote.guard.stateVersion}`,
                quote.instructions,key,budget,{kind:'accountStateVersion',venue:snapshot.venue,account:trader,value:quote.guard.stateVersion.toString()},true);
              return {status:'queued',reason:'durable-account-order-fill'};
            }
          } catch(error) {if(error instanceof AccountQuoteUnavailable||error instanceof Error&&error.message==='Risk action presently unavailable')break;throw error;}
        }
      }
    }
    return {status:'idle',reason:'no-admissible-triggered-order'};
  }
  async maker(marketIndex:0|1,makerId:0|1,key:Keypair):Promise<AccountWorkerOutcome> {
    const {state}=await this.discovery(),registration=Object.values(state.makers).find(maker=>maker.marketIndex===marketIndex&&maker.makerId===makerId);
    if(!registration||registration.owner!==key.address)throw new Error('Market-specific maker key binding');
    const snapshot=await this.snapshot([address(registration.capital)],marketIndex);
    const maker=snapshot.makers.find(candidate=>candidate.makerId===makerId)!;
    if(maker.registrationState.owner!==key.address)throw new Error('Maker owner changed');
    const budget=await this.budget('maker',key,marketIndex,makerId);
    await this.store.pool.query(`INSERT INTO account_maker_heartbeats(run_id,market_index,maker_id,registration,owner,process_id,snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(run_id,market_index,maker_id) DO UPDATE SET
      registration=EXCLUDED.registration,owner=EXCLUDED.owner,process_id=EXCLUDED.process_id,seen_at=now(),snapshot=EXCLUDED.snapshot`,
      [this.runId,marketIndex,makerId,maker.registration,key.address,process.pid,json({slot:snapshot.slot,capital:registration.capital,
        quoteEpoch:maker.state.quoteEpoch,expirySlot:maker.state.expirySlot,approved:maker.approved,synchronized:maker.synchronized})]);
    if(!maker.approved||maker.registrationState.quarantined||snapshot.safetyState.paused||snapshot.safetyState.mode!==1)
      return {status:'blocked',reason:'maker-admission-or-venue-mode'};
    if(await this.pendingBudget(budget))return {status:'blocked',reason:'original-maker-intent-pending'};
    if(snapshot.slot>=maker.state.expirySlot) {
      const api=makerId===0?sdk.makerA:sdk.makerB;
      await this.enqueue(`maker:${marketIndex}:${makerId}:${maker.state.quoteEpoch}`,[sdk.routeComputeBudget(),
        api.getPublishAccountEpochInstruction({owner:key,config:maker.registrationState.config,duration:3600n})],key,budget,null);
      return {status:'queued',reason:'expired-maker-epoch-publication'};
    }
    if(!maker.synchronized) {
      await this.enqueue(`maker-sync:${marketIndex}:${makerId}:${maker.state.quoteEpoch}`,[sdk.routeComputeBudget(),
        sdk.getUpdateAccountMakerV3Instruction({...snapshot,...maker.registrationState,registration:maker.registration,actor:key,operation:1})],key,budget,
        {kind:'accountMakerEpoch',venue:snapshot.venue,account:maker.registration,value:maker.registrationState.quoteEpoch.toString()});
      return {status:'queued',reason:'owner-epoch-sync'};
    }
    return {status:'idle',reason:'current-maker-epoch'};
  }
  async funding(marketIndex:0|1,key:Keypair,intervalSeconds=2n):Promise<AccountWorkerOutcome> {
    if(intervalSeconds<2n||intervalSeconds>5n)throw new Error('Local funding cadence must be 2–5 seconds');
    const budget=await this.budget('funding',key,marketIndex);
    if(await this.pendingBudget(budget))return {status:'blocked',reason:'original-funding-intent-pending'};
    const {state}=await this.discovery(),registration=Object.values(state.makers).find(maker=>maker.marketIndex===marketIndex);
    if(!registration)return {status:'blocked',reason:'incomplete-market-makers'};
    const snapshot=await this.snapshot([address(registration.capital)],marketIndex),market=snapshot.marketStates[marketIndex];
    if(snapshot.safetyState.mode!==1||snapshot.safetyState.paused)return {status:'blocked',reason:'venue-mode'};
    if(snapshot.now-market.oracle.sampledAt<intervalSeconds)return {status:'idle',reason:'sample-not-due'};
    const [first,second]=[0,1].map(id=>snapshot.makers.find(maker=>maker.makerId===id)!);
    const firstState=first.registrationState,secondState=second.registrationState;
    const instruction=sdk.getSampleAccountOracleV3Instruction({...snapshot,market:snapshot.markets[marketIndex],
      primaryAsset:market.oracle.sources[0],primaryCollateral:market.oracle.sources[1],guardAsset:market.oracle.sources[2],guardCollateral:market.oracle.sources[3],
      firstCapital:firstState.capital,firstRegistration:first.registration,firstProgram:firstState.pricingProgram,firstProgramData:firstState.programData,firstConfig:firstState.config,
      secondCapital:secondState.capital,secondRegistration:second.registration,secondProgram:secondState.pricingProgram,secondProgramData:secondState.programData,secondConfig:secondState.config});
    await this.enqueue(`funding:${marketIndex}:${market.observationSequence}`,[sdk.fundingComputeBudget(),instruction],key,budget,
      {kind:'accountObservation',venue:snapshot.venue,account:snapshot.markets[marketIndex],value:market.observationSequence.toString()});
    return {status:'queued',reason:'market-observation-due'};
  }
  settle(key:Keypair){return settleAccounts(this,key);}
  riskWork(key:Keypair,receiver?:Address){return accountRiskWork(this,key,receiver);}
}
