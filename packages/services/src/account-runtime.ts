import {address,type Address} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {AccountExecution} from './account-execution.js';
import {accountWorkerKeys} from './account-worker-state.js';
import {settleAccounts} from './account-settlement-worker.js';
import {accountRiskWork} from './account-risk-worker.js';
import {defaultBatchSteps} from './account-default-batch.js';
import {publishLiquidityFunding,repriceLiquidity,quoteLiquidity} from './liquidity-workers.js';
import {quantityCandidates} from './quantity-candidates.js';

export type AccountWorkerOutcome={status:'idle'|'queued'|'blocked';reason:string};
export class AccountQuoteUnavailable extends Error {
  constructor(readonly code:string,readonly diagnostic:Record<string,unknown>){super(code);}
}
export const ACCOUNT_HEARTBEAT_MS=3000;

export class AccountRuntime extends AccountExecution {
  riskProbeCursor=0;
  readonly defaultContinuationSteps=defaultBatchSteps();
  async discovery() {
    const binding=await this.environment(),{state}=await this.store.published();
    if(!state.venue||state.members.length===0)throw new Error('Account discovery unavailable');
    const marginLayout=sdk.hasLedgerLanes(binding.artifactSet)?'ledger-lanes' as const:undefined;
    return {binding,state,identity:{venue:address(binding.venue),mint:address(state.venue.quoteMint),domain:binding.domain,boundedEntry:sdk.hasBoundedEntry(binding.artifactSet),closedQuantity:sdk.hasClosedQuantity(binding.artifactSet),marginLayout}};
  }
  async snapshot(margins?:Address[],marketIndex?:0|1) {
    const discovery=await this.discovery(),selected=margins??[address(discovery.state.members[0])];
    const snapshot=marketIndex===undefined?await sdk.readAccountSnapshot(this.rpc,discovery.identity,selected,'confirmed'):
      await sdk.readAccountTradeSnapshot(this.rpc,discovery.identity,selected[0],marketIndex,'confirmed');
    return {...snapshot,marginLayout:discovery.identity.marginLayout,...await accountWorkerKeys(snapshot.venue)};
  }
  async pendingBudget(budget:string) {
    return (await this.store.pool.query("SELECT 1 FROM service_intents WHERE run_id=$1 AND budget=$2 AND status IN ('pending','unresolved') LIMIT 1",[this.runId,budget])).rowCount!==0;
  }
  async heartbeats() {
    return (await this.store.pool.query(`SELECT *,seen_at>now()-($2::int*interval '1 millisecond') AS online
      FROM liquidity_maker_heartbeats WHERE run_id=$1`,[this.runId,ACCOUNT_HEARTBEAT_MS])).rows;
  }
  async quote(actor:Address,trader:Address,marketIndex:0|1,side:0|1,lots:bigint,stored?:sdk.MarginStoredFill) {
    return quoteLiquidity(this,actor,trader,marketIndex,side,lots,stored);
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
        for(const lots of quantityCandidates(remaining)) {
          try {
            const quote=await this.quote(key.address,trader,marketIndex,stored.order.side as 0|1,lots,
              {id:stored.order.id,version:stored.order.version,filled:stored.order.filled});
            if(quote.available) {
              const instructions=snapshot.marginLayout==='ledger-lanes'?
                [...sdk.marketCheckpointsFor(await sdk.venueMarketCheckpoints(snapshot.venue),quote.instructions[0]),...quote.instructions]:quote.instructions;
              await this.enqueue(`order:${root.id}:${marketIndex}:${stored.order.id}:${stored.order.version}:${stored.order.filled}:${quote.guard.stateVersion}`,
                instructions,key,budget,{kind:'accountStateVersion',venue:snapshot.venue,account:trader,value:quote.guard.stateVersion.toString()},true);
              return {status:'queued',reason:'durable-account-order-fill'};
            }
            // Smaller quantities cannot repair a missing market source in this pass.
            // Expiry can improve when a smaller route selects different makers.
            if(quote.code==='required-market-source-unavailable')break;
          } catch(error) {if(error instanceof AccountQuoteUnavailable||error instanceof Error&&error.message==='Risk action presently unavailable')break;throw error;}
        }
      }
    }
    return {status:'idle',reason:'no-admissible-triggered-order'};
  }
  async maker(marketIndex:0|1,makerId:0|1|2,key:Keypair):Promise<AccountWorkerOutcome> {
    return repriceLiquidity(this,marketIndex,makerId,key);
  }
  async funding(marketIndex:0|1,key:Keypair,intervalSeconds=2n):Promise<AccountWorkerOutcome> {
    if(intervalSeconds<2n||intervalSeconds>5n)throw new Error('Local funding cadence must be 2–5 seconds');
    return publishLiquidityFunding(this,marketIndex,key,intervalSeconds);
  }
  private settlementMaintenanceTurn=false;
  async settle(key:Keypair,allowBackgroundPage=true){
    const result=await settleAccounts(this,key,allowBackgroundPage,this.settlementMaintenanceTurn);
    if(result.status==='queued' && result.reason!=='funded-account-loss'){
      this.settlementMaintenanceTurn=result.reason==='certified-market-gain';
    }
    return result;
  }
  riskWork(key:Keypair,receiver?:Address){return accountRiskWork(this,key,receiver);}
}
