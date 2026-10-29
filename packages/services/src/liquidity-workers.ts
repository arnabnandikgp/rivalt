import {address,getProgramDerivedAddress,type Address} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {json} from '../../indexer/src/events.js';
import type {AccountRuntime,AccountWorkerOutcome} from './account-runtime.js';

/** Internal reference strategy: reanchor to the admitted independent index.
 * No depth replenishment, owner control, inventory funding or hedge is implied. */
export async function repriceLiquidity(runtime:AccountRuntime,marketIndex:0|1,instance:0|1|2,key:Keypair):Promise<AccountWorkerOutcome> {
  const {state}=await runtime.discovery();
  const registration=Object.entries(state.liquidity?.makers??{}).find(([,maker])=>maker.market===state.venue!.markets[marketIndex]&&maker.instance===instance);
  if(!registration)throw new Error('Canonical maker not registered');
  const snapshot=await runtime.snapshot([address(registration[1].capital)],marketIndex);
  const maker=snapshot.liquidity?.adapters.find(candidate=>candidate.registration===registration[0]);
  if(!maker||maker.config.owner!==key.address&&(maker.config.updater!==key.address||snapshot.slot>=maker.config.updaterExpirySlot))
    throw new Error('Canonical updater authority mismatch');
  const budget=await runtime.budget('maker',key,marketIndex,instance);
  await runtime.store.pool.query(`INSERT INTO liquidity_maker_heartbeats(run_id,market_index,instance,registration,updater,process_id,snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(run_id,market_index,instance) DO UPDATE SET
    registration=EXCLUDED.registration,updater=EXCLUDED.updater,process_id=EXCLUDED.process_id,seen_at=now(),snapshot=EXCLUDED.snapshot`,
    [runtime.runId,marketIndex,instance,maker.registration,key.address,process.pid,json({slot:snapshot.slot,capital:maker.registrationState.capital,
      priceSequence:maker.price.sequence,controlEpoch:maker.config.controlEpoch,expiresAt:maker.validUntilTime,unavailable:maker.unavailable})]);
  if(await runtime.pendingBudget(budget))return {status:'blocked',reason:'original-maker-intent-pending'};
  if(maker.registrationState.quarantined||['unapproved-code','disabled'].includes(maker.unavailable??'')||snapshot.safetyState.paused||snapshot.safetyState.mode!==1)
    return {status:'blocked',reason:'maker-admission-or-venue-mode'};
  const market=snapshot.marketStates[marketIndex];
  if(!['Normal','Degraded'].includes(sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot)))
    return {status:'blocked',reason:'reference-index-unavailable'};
  if(snapshot.now-maker.price.updatedTime<1n&&maker.price.controlEpoch===maker.config.controlEpoch)
    return {status:'idle',reason:'maker-reprice-not-due'};
  const module=maker.registrationState.pricingProgram===sdk.makerA.MAKER_A_PROGRAM_ADDRESS?sdk.makerA:sdk.makerB;
  const [eventAuthority]=await getProgramDerivedAddress({programAddress:maker.registrationState.pricingProgram,seeds:[Buffer.from('__event_authority')]});
  const instruction=module.getRepriceV4Instruction({actor:key,config:maker.registrationState.config,price:maker.registrationState.price,
    eventAuthority,program:maker.registrationState.pricingProgram,expectedControl:maker.config.controlEpoch,expectedSequence:maker.price.sequence,anchor:market.referencePrice});
  // Price account belongs to the maker program. Do not invent a clearing-account
  // expiry proof; missing finalized history leaves this original unresolved.
  await runtime.enqueue(`maker:${marketIndex}:${instance}:${maker.config.controlEpoch}:${maker.price.sequence}`,[instruction],key,budget,null);
  return {status:'queued',reason:'internal-index-reference-reprice'};
}

export async function publishLiquidityFunding(runtime:AccountRuntime,marketIndex:0|1,key:Keypair,intervalSeconds:bigint):Promise<AccountWorkerOutcome> {
  const budget=await runtime.budget('funding',key,marketIndex);
  if(await runtime.pendingBudget(budget))return {status:'blocked',reason:'original-funding-intent-pending'};
  const {identity}=await runtime.discovery();
  const input=await sdk.readFundingReport(runtime.rpc,identity.venue,marketIndex);
  if(input.configurationState.publisher!==key.address)throw new Error('Restricted funding publisher signer mismatch');
  if(input.report.observedTime-input.marketState.oracle.sampledAt<intervalSeconds)return {status:'idle',reason:'report-not-due'};
  const [eventAuthority]=await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('__event_authority')]});
  const instruction=sdk.getPublishFundingReportV4Instruction({...input.instructionAccounts,publisher:key,eventAuthority,
    program:sdk.CLEARING_PROGRAM_ADDRESS,report:input.report});
  await runtime.enqueue(`funding:${marketIndex}:${input.report.authorityEpoch}:${input.report.sequence}`,[instruction],key,budget,
    {kind:'accountObservation',venue:identity.venue,account:input.report.market,value:input.marketState.observationSequence.toString()},false,
    {contextSlot:input.contextSlot,accounts:input.accounts,inputDigest:Uint8Array.from(input.report.inputDigest),
      calculation:{kind:'funding-report-v1',trust:'restricted-publisher-attestation',report:input.report,allocations:input.allocations,coverageReason:input.coverageReason}});
  return {status:'queued',reason:input.report.outcome===0?'available-published-funding-depth':`funding-unavailable-outcome-${input.report.outcome}`};
}

export async function quoteLiquidity(runtime:AccountRuntime,actor:Address,trader:Address,marketIndex:0|1,side:0|1,lots:bigint,stored?:sdk.GroupStoredFill) {
  const snapshot=await runtime.snapshot([trader],marketIndex);
  const diagnostic={snapshotCommitment:snapshot.commitment,snapshotSlot:snapshot.slot.toString(),marketIndex,
    sourceModes:snapshot.marketStates.map(market=>sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot)),
    makers:snapshot.liquidity!.adapters.map(maker=>({instance:maker.registrationState.instance,registration:maker.registration,
      priceSequence:maker.price.sequence.toString(),unavailable:maker.unavailable,expiresAt:maker.validUntilTime.toString()}))};
  // A daemon heartbeat is observability, not liquidity authority. An unexpired
  // authenticated quote remains usable after its updater disconnects.
  if(!['Normal','Degraded'].includes(diagnostic.sourceModes[marketIndex]))return {available:false as const,code:'required-market-source-unavailable',diagnostic};
  const quote=await sdk.buildLiquidityRoute({snapshot,trader,marketIndex,side,lots,stored,
    maxFee:1_000_000_000n,allInLimit:side===0?1_000_000_000_000_000n:0n},actor);
  if(!quote)return {available:false as const,code:'maker-depth-or-whole-account-health',diagnostic};
  const slot=await runtime.rpc.call('getSlot',[{commitment:'processed'}]);
  if(!Number.isSafeInteger(slot)||slot<0||quote.expirySlot<=BigInt(slot)+10n)return {available:false as const,code:'quote-expiring',diagnostic};
  return {available:true as const,...quote,diagnostic};
}
