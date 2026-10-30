import {enqueueOperator} from './operator-enqueue.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AccountRole, address, createNoopSigner, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import { Connection, Keypair } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import { Store } from '../../indexer/src/store.js';
import { Rpc, integer } from '../../indexer/src/rpc.js';
import { json, hash, decode } from '../../indexer/src/events.js';
import { Queue, type Authority } from './queue.js';
import { localBudgets } from './profile.js';
import { quoteWindow } from './quote-window.js';

export const OPERATOR_CAP=5_000_000n,MAKER_CAP=1_000_000n,HEARTBEAT_MS=3000;
export class QuoteUnavailable extends Error {
  constructor(readonly code:string,message:string,readonly diagnostic?:Record<string,string|number>){super(message);}
}
export function sampleMatchesSnapshot(event:any,s:{market:string;m:Pick<sdk.MarketState,'domain'|'termsEpoch'|'configEpoch'>;risk:sdk.TestRouteState}){
  return event.market===s.market&&event.domain===Buffer.from(s.m.domain).toString('hex')&&
    event.termsEpoch===String(s.m.termsEpoch)&&event.configEpoch===String(s.m.configEpoch)&&
    ['observationSequence','referencePrice','lower','upper','validFrom','validUntil'].every(key=>event[key]===String(s.risk[key as keyof sdk.TestRouteState]))&&
    json(event.oracle)===json(s.risk.oracle);
}
export class Runtime {
  readonly store:Store;readonly rpc:Rpc;readonly queue:Queue;readonly connection:Connection;
  readonly budgets:ReturnType<typeof localBudgets>;
  readonly deployment:ReturnType<typeof sdk.testDeployment>;
  readonly options:{programAddress:ReturnType<typeof sdk.testDeployment>['clearing']};
  constructor(database:string,readonly runId:string,url:string,budgetProfile='smoke',readonly sampleInterval=2n,readonly dispatchMargin=0n,chain:sdk.TestChain='solana:localnet'){
    this.deployment=sdk.testDeployment(chain);this.options={programAddress:this.deployment.clearing};sdk.testRpcUrl(url,chain);
    if(chain==='solana:devnet'&&budgetProfile!=='smoke')throw new Error('Devnet uses bounded smoke budgets');
    quoteWindow(0n,0n,sampleInterval,dispatchMargin);
    this.budgets=localBudgets(budgetProfile,url);
    this.store=new Store(database,runId);this.rpc=new Rpc(url);this.queue=new Queue(this.store,this.rpc,this.deployment.clearing);this.connection=new Connection(url,'confirmed');
  }
  async open(){await this.store.migrate();await this.store.pool.query(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));await this.environment();}
  async environment(){
    const b=(await this.store.snapshot()).binding;
    if(b.program!==this.deployment.clearing||(this.deployment.genesis&&b.genesis!==this.deployment.genesis))throw new Error('Service deployment mismatch');
    if(await this.rpc.call('getGenesisHash')!==b.genesis)throw new Error('Service genesis mismatch');
    const tx=await this.rpc.call('getTransaction',[b.anchor,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    if(!tx || hash(tx.transaction)!==b.anchorHash)throw new Error('Service initialization anchor mismatch');
    return b;
  }
  async snapshot(commitment:'confirmed'|'finalized'='finalized'){
    const b=await this.environment(),row=await this.store.snapshot(),market=address(b.market);
    const [registry]=await sdk.findRegistryPda({market}, this.options),[routeState]=await sdk.findRouteStatePda({market}, this.options),[guard]=await sdk.findGuardPda({market}, this.options),[vault]=await sdk.findVaultPda({market}, this.options);
    const [resolution]=await sdk.findResolutionPda({market}, this.options);
    const [eventAuthority]=await getProgramDerivedAddress({programAddress:this.deployment.clearing,seeds:[Buffer.from('__event_authority')]});
    const pkeys=Object.keys(row.state.participants).sort((a,b)=>row.state.participants[a].id-row.state.participants[b].id).map(address),rkeys=Object.keys(row.state.makers).map(address);
    // Discover bindings, then refetch every value at the explicitly labeled commitment.
    const discovered=await this.rpc.call('getMultipleAccounts',[rkeys,{encoding:'base64',commitment}]);
    const regs=discovered.value.map((x:any)=>{if(x?.owner!==this.deployment.clearing)throw new Error('Maker missing');return sdk.getLegacyMakerRegistrationDecoder().decode(Buffer.from(x.data[0],'base64'));}) as sdk.LegacyMakerRegistration[];
    const clock=address('SysvarC1ock11111111111111111111111111111111');
    const keys=[clock,market,registry,routeState,guard,vault,...pkeys,...rkeys,...regs.flatMap(r=>[r.config,r.programData]),resolution];
    const response=await this.rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment}]);
    const slot=BigInt(integer(response.context.slot));
    const raw=(key:Address,owner:string=this.deployment.clearing)=>{const a=response.value[keys.indexOf(key)];if(!a || a.owner!==owner)throw new Error('Missing/foreign snapshot account');return Buffer.from(a.data[0],'base64');};
    const m=sdk.getMarketStateDecoder().decode(raw(market)),reg=sdk.getParticipantRegistryDecoder().decode(raw(registry));
    if(Buffer.from(m.domain).toString('hex')!==b.domain || m.schemaVersion!==1 || m.profileVersion!==1 || ![1,2,3].includes(m.mode) || (m.mode===1 && m.fundingIndexScaled!==0n))throw new Error('Unsupported service profile');
    assert.deepEqual(reg.members,pkeys);assert.equal(reg.count,pkeys.length);
    const risk=sdk.getTestRouteStateDecoder().decode(raw(routeState));
    const participants=Object.fromEntries(pkeys.map(k=>[k,sdk.getParticipantDecoder().decode(raw(k))]));
    pkeys.forEach((k,id)=>{const p=participants[k];if(p.market!==market || p.schemaVersion!==1 || p.id!==id)throw new Error('Unsupported participant profile');});
    const total=Object.values(participants).reduce((n,p)=>n+p.cash,0n),claims=Object.values(participants).reduce((n,p)=>n+p.virtualScaled+p.lots*p.fundingCheckpointScaled,0n);
    const resolutionAccount=response.value[keys.indexOf(resolution)];
    const resolutionState=resolutionAccount?sdk.getResolutionStateDecoder().decode(raw(resolution)):null;
    if(resolutionState&&(resolutionState.market!==market||resolutionState.version!==1))throw new Error('Resolution binding');
    if(m.mode===3)sdk.reconcileResolution(m,risk,participants,resolutionState);
    else if(total!==m.totalCash || claims!==m.settlement*1_000_000_000n || Object.values(participants).reduce((n,p)=>n+p.lots,0n)!==0n)throw new Error('Snapshot ledger mismatch');
    const actual=raw(vault,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').readBigUInt64LE(64);
    if(m.allocatedVault!==m.totalCash+m.settlement+m.insurance+m.fees || actual<m.allocatedVault)throw new Error('Snapshot vault mismatch');
    const now=raw(clock,'Sysvar1111111111111111111111111111111111111').readBigInt64LE(32);
    const funding=sdk.effectiveFunding(m,risk,now,slot),sourceMode=sdk.oracleMode(m,risk,now,slot);
    if(m.mode!==3)for(const key of pkeys){
      const p=sdk.accruedBalance(participants[key],funding);
      p.reserved=sdk.orderReserve(p,m.termsEpoch,slot,sourceMode==='NoCredibleBounds'?1n:risk.lower,sourceMode==='NoCredibleBounds'?1_000_000n:risk.upper);
      participants[key]=p;
    }
    const heartbeats=(await this.store.pool.query('SELECT *,seen_at>now()-($2::int*interval \'1 millisecond\') AS online FROM maker_heartbeats WHERE run_id=$1',[this.runId,HEARTBEAT_MS])).rows;
    const makers=rkeys.map((registration,i)=>{
      const r=sdk.getLegacyMakerRegistrationDecoder().decode(raw(registration));assert.equal(r.config,regs[i].config);assert.equal(r.programData,regs[i].programData);
      const state=sdk.makerA.getMakerConfigDecoder().decode(raw(r.config,r.pricingProgram)).state;
      const approved=createHash('sha256').update(raw(r.programData,'BPFLoaderUpgradeab1e11111111111111111111111')).digest().equals(Buffer.from(r.approvedHash));
      const heartbeat=heartbeats.find(h=>h.maker_id===r.makerId && h.owner===r.owner);
      return {registration,r,state,approved,online:heartbeat?.online===true,balance:participants[r.capital]};
    });
    return {commitment,market,registry,routeState,guard,vault,resolution,resolutionState,eventAuthority,program:this.deployment.clearing,m,risk,slot,now,funding,sourceMode,participants,members:reg.members,makers,
      certificate:sdk.getExitGuardDecoder().decode(raw(guard)),actual};
  }
  async quote(owner:Address,side:number,lots:bigint,stored?:{id:bigint;version:bigint;filled:bigint},keeper?:Keypair){
    const s=await this.snapshot('confirmed'),[trader]=await sdk.findParticipantPda({market:s.market,owner}, this.options),p=s.participants[trader];
    // Public read-only preview context explains a refusal without authorizing an
    // action or interpreting a declared driver fault window as oracle Normal.
    const diagnostic={snapshotCommitment:s.commitment,snapshotSlot:s.slot.toString(),sequence:s.m.sequence.toString(),
      observation:s.risk.observationSequence.toString(),sourceMode:s.sourceMode,oracleStatus:s.risk.oracle.status,
      chainTime:s.now.toString(),sampledAt:s.risk.oracle.sampledAt.toString(),validFrom:s.risk.validFrom.toString(),validUntil:s.risk.validUntil.toString()};
    const unavailable=(code:string,message:string)=>new QuoteUnavailable(code,message,diagnostic);
    if(!p || p.owner!==owner)throw unavailable('account-unavailable','Funded account unavailable');
    if(s.m.paused)throw unavailable('market-paused','Market is paused');
    if(s.slot<s.risk.validFrom)throw unavailable('observation-not-confirmed','Market observation is ahead of the confirmed preview');
    if(s.slot>=s.risk.validUntil)throw unavailable('observation-expired','Market observation expired');
    if(s.sourceMode==='NoCredibleBounds')throw unavailable('source-unavailable','Credible price bounds unavailable');
    if(s.m.mode===2&&!quoteWindow(s.now,s.risk.oracle.sampledAt,this.sampleInterval,this.dispatchMargin))throw unavailable('observation-update-due','Next scheduled observation is within the dispatch margin');
    const pendingSample=await this.store.pool.query("SELECT signature FROM service_intents WHERE run_id=$1 AND budget='funding' AND status IN ('pending','unresolved')",[this.runId]);
    const confirmedPendingSamples:string[]=[];
    for(const {signature} of pendingSample.rows){
      // A known confirmed sample already present in this preview cannot execute
      // twice. The durable intent/budget still wait for independent finality.
      // Unknown, failed, different or future observations remain unavailable.
      let applied=false;
      try{
        const tx=await this.rpc.call('getTransaction',[signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
        const events=decode(signature,tx,s.eventAuthority,s.program).filter(x=>x.type==='oracle');
        applied=events.length===1&&BigInt(integer(tx.slot))<=s.slot&&sampleMatchesSnapshot(events[0].data,s);
      }catch{ /* No inference from missing or conflicting evidence. */ }
      if(!applied)throw unavailable('observation-update-pending','Observation update is awaiting confirmed preview evidence');
      confirmedPendingSamples.push(signature);
    }
    const order=stored?p.book.orders.find(o=>o.id===stored.id&&o.version===stored.version&&o.filled===stored.filled):undefined;
    if(stored&&(!order||order.side!==side||sdk.orderRemaining(p,order,s.m.termsEpoch,s.slot)<lots||!sdk.orderTriggered(order,s.risk.referencePrice,s.slot)))throw new Error('Stored order unavailable');
    const reduceOnly=order?order.reduceOnly:(side===1 && p.lots>=lots)||(side===0 && -p.lots>=lots);
    if(s.sourceMode!=='Normal' && !reduceOnly)throw unavailable('risk-increase-restricted','Risk increase blocked by oracle mode');
    const eligible=s.makers.filter(x=>x.r.capital!==trader && x.online && x.approved && !x.r.quarantined && x.r.quoteEpoch===x.state.quoteEpoch);
    const candidates=eligible.map(x=>({state:x.state,balance:x.balance,request:{version:1,domain:s.m.domain,market:s.market,capital:x.r.capital,quoteEpoch:x.r.quoteEpoch,authorityEpoch:x.r.authorityEpoch,termsEpoch:s.m.termsEpoch,marketConfigEpoch:s.m.configEpoch,side,lots,inventory:x.balance.lots,cash:x.balance.cash,inventoryLimit:x.r.inventoryLimit,consumed:side===0?x.r.buyConsumed:x.r.sellConsumed,referencePrice:s.risk.referencePrice,slot:s.slot}}));
    const allocation=candidates.length?sdk.allocateRoute({snapshotSlot:s.slot,side,lots,lower:s.risk.lower,upper:s.risk.upper,trader:p,candidates,grossLots:s.risk.grossLots,maxFee:order?order.feeBudget-order.feeCharged:1_000_000_000n,allInLimit:order?order.limit*lots:side===0?1_000_000_000_000_000n:0n,
      notionalPrefix:order?.notional,postReserve:(before,after,gross,fee)=>{
        const original=Object.values(s.participants).find(p=>p.id===before.id)!;
        return sdk.postOrderReserve(original,after,s.m.termsEpoch,s.slot,s.risk.lower,s.risk.upper,
          order&&before.id===p.id?{id:order.id,lots,gross,fee}:undefined);
      }}):null;
    if(!allocation)return {available:false,snapshotCommitment:s.commitment,snapshotSlot:s.slot,universe:s.makers.map(x=>({makerId:x.r.makerId,online:x.online,approved:x.approved})),allocation:null};
    const selected=allocation.legs.map(l=>eligible.find(x=>x.r.makerId===l.makerId)!);const [first,second]=selected;
    const expiry=[s.slot+150n,s.risk.validUntil,...selected.map(x=>x.state.expirySlot)].reduce((a,b)=>a<b?a:b);
    const processedSlot=BigInt(integer(await this.rpc.call('getSlot',[{commitment:'processed'}])));
    if(expiry<=processedSlot+10n)throw unavailable('quote-expiring','Quote has insufficient remaining dispatch slots');
    const accounts={...s,trader,
      firstCapital:first.r.capital,firstRegistration:first.registration,firstProgram:first.r.pricingProgram,firstProgramData:first.r.programData,firstConfig:first.r.config,
      secondCapital:second?.r.capital,secondRegistration:second?.registration,secondProgram:second?.r.pricingProgram,secondProgramData:second?.r.programData,secondConfig:second?.r.config};
    const legs=allocation.legs.map((l,i)=>({lots:l.lots,quoteEpoch:selected[i].r.quoteEpoch,authorityEpoch:selected[i].r.authorityEpoch}));
    const ix=order?await sdk.getExecuteOrderInstructionAsync({...accounts,keeper:keeper!,id:order.id,version:order.version,filled:order.filled,observationSequence:s.risk.observationSequence,startSlot:s.slot,expirySlot:expiry,lots,legs}, this.options):await sdk.getExecuteRouteInstructionAsync({...accounts,owner:createNoopSigner(owner),
      domain:s.m.domain,termsEpoch:s.m.termsEpoch,configEpoch:s.m.configEpoch,observationSequence:s.risk.observationSequence,nonce:p.nonce,startSlot:s.slot,expirySlot:expiry,
      side,lots,maxFee:allocation.fee,allInLimit:allocation.allIn,reduceOnly,generation:p.generation,
      legs}, this.options);
    return {available:true,snapshotCommitment:s.commitment,confirmedPendingSamples,snapshotSlot:s.slot,sequence:s.m.sequence,observation:s.risk.observationSequence,nonce:p.nonce,universe:s.makers.map(x=>({makerId:x.r.makerId,online:x.online,approved:x.approved})),allocation,
      audit:{referencePrice:s.risk.referencePrice,lower:s.risk.lower,upper:s.risk.upper,grossLots:s.risk.grossLots,
        trader:{...p,effectiveOrders:p.book.orders.filter(o=>sdk.orderRemaining(p,o,s.m.termsEpoch,s.slot)>0n).length},
        candidates:eligible.map(x=>({...x.balance,makerId:x.r.makerId,version:x.state.version,startSlot:x.state.startSlot,expirySlot:x.state.expirySlot,inventoryLimit:x.r.inventoryLimit,consumed:side===0?x.r.buyConsumed:x.r.sellConsumed,
          effectiveOrders:x.balance.book.orders.filter(o=>sdk.orderRemaining(x.balance,o,s.m.termsEpoch,s.slot)>0n).length}))},
      instructions:[sdk.routeComputeBudget(),ix].map(i=>({programAddress:i.programAddress,accounts:i.accounts?.map(a=>({address:a.address,role:a.role})),data:Buffer.from(i.data??[]).toString('base64')}))};
  }
  async enqueue(id:string,ixs:Instruction[],payer:Keypair,budget:string,authority:Authority|null,preflight=false){
    return enqueueOperator(this,id,ixs,payer,budget,authority,preflight);
  }

  async maker(id:number,key:Keypair){
    const s=await this.snapshot(),x=s.makers.find(x=>x.r.makerId===id);if(!x || x.r.owner!==key.address)throw new Error('Maker key binding');
    const budget=`maker-${id}`;await this.queue.budget(budget,key.address,this.budgets.maker);
    await this.store.pool.query(`INSERT INTO maker_heartbeats(run_id,maker_id,owner,process_id,snapshot) VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id,maker_id) DO UPDATE SET owner=EXCLUDED.owner,process_id=EXCLUDED.process_id,seen_at=now(),snapshot=EXCLUDED.snapshot`,[this.runId,id,key.address,process.pid,json({slot:s.slot,sequence:s.m.sequence,cash:x.balance.cash,lots:x.balance.lots,virtualScaled:x.balance.virtualScaled,quoteEpoch:x.state.quoteEpoch,expirySlot:x.state.expirySlot})]);
    if(!x.approved || x.r.quarantined || s.m.paused)return;
    if(s.slot>=x.state.expirySlot){
      const api=id===0?sdk.makerA:sdk.makerB;
      await this.enqueue(`maker:${id}:${x.state.quoteEpoch}`,[api.getPublishEpochInstruction({owner:key,config:x.r.config,duration:3600n},{programAddress:x.r.pricingProgram}),await sdk.getSyncMakerEpochInstructionAsync({...s,...x.r,registration:x.registration}, this.options)],key,budget,{kind:'quoteEpoch',account:x.registration,value:x.r.quoteEpoch.toString()});
    }else if(x.state.quoteEpoch!==x.r.quoteEpoch){
      await this.enqueue(`maker-sync:${id}:${x.state.quoteEpoch}`,[await sdk.getSyncMakerEpochInstructionAsync({...s,...x.r,registration:x.registration}, this.options)],key,budget,{kind:'quoteEpoch',account:x.registration,value:x.r.quoteEpoch.toString()});
    }
  }
  async settle(key:Keypair){
    await this.queue.budget('keeper',key.address,this.budgets.operator);
    const pending=await this.store.pool.query("SELECT 1 FROM service_intents WHERE run_id=$1 AND budget='keeper' AND status IN ('pending','unresolved') LIMIT 1",[this.runId]);if(pending.rowCount)return;
    const s=await this.snapshot();
    // Clearing permits ordinary flat-cohort collection/settlement without a
    // live price. Do not strand funded exits when the sponsored feed expires.
    // Every exposed cohort still requires credible bounds; the on-chain scan
    // and signed sequence/observation remain authoritative for every gain.
    const flatSourceExit=s.m.mode===2&&Object.values(s.participants).every(p=>p.lots===0n);
    if(s.m.paused||![1,2].includes(s.m.mode)||(!flatSourceExit&&
      (s.slot<s.risk.validFrom||s.slot>=s.risk.validUntil||s.sourceMode==='NoCredibleBounds')))return;
    const stamp={sequence:s.m.sequence,observation:s.risk.observationSequence},authority:Authority={kind:'sequence',account:s.market,value:s.m.sequence.toString()};
    const base=`keeper:${s.m.sequence}:${s.risk.observationSequence}`;
    for(const participant of s.members){
      const p=s.participants[participant],u=p.virtualScaled+p.lots*s.risk.referencePrice*1_000_000_000n;
      if(u<=-1_000_000_000n && p.cash>0n){
        const loss=(-u)/1_000_000_000n,amount=loss<p.cash?loss:p.cash;
        await this.enqueue(`${base}:collect:${p.id}`,[await sdk.getCollectLossInstructionAsync({...s,...stamp,participant,amount}, this.options)],key,'keeper',authority);return;
      }
    }
    // No default shortcut: an insolvent cohort makes all ordinary exits unavailable.
    if(Object.values(s.participants).some(p=>p.cash*1_000_000_000n+(p.virtualScaled+p.lots*(p.lots<0n?s.risk.upper:s.risk.lower)*1_000_000_000n)<0n))return;
    const g=s.certificate;
    if(g.sequence!==s.m.sequence || g.observation!==s.risk.observationSequence || g.next!==s.members.length){
      const start=g.sequence===s.m.sequence && g.observation===s.risk.observationSequence?g.next:0;
      const ix=await sdk.getCheckExitCohortInstructionAsync({...s,...stamp,start}, this.options);
      const page={...ix,accounts:[...ix.accounts,...s.members.slice(start,start+8).map(address=>({address,role:AccountRole.READONLY}))]};
      await this.enqueue(`${base}:scan:${start}`,[page],key,'keeper',authority);return;
    }
    if(s.m.settlement===0n)return;
    for(const participant of s.members){
      const p=s.participants[participant],u=p.virtualScaled+p.lots*s.risk.referencePrice*1_000_000_000n;
      if(u<1_000_000_000n)continue;
      const gain=u/1_000_000_000n,amount=gain<s.m.settlement?gain:s.m.settlement;
      const adverse=p.virtualScaled-amount*1_000_000_000n+p.lots*(p.lots<0n?s.risk.upper:s.risk.lower)*1_000_000_000n;
      const equity=(p.cash+amount)*1_000_000_000n+(adverse<0n?adverse:0n),im=(((p.lots<0n?-p.lots:p.lots)*s.risk.upper+9n)/10n+p.reserved)*1_000_000_000n;
      if(equity<im)continue;
      await this.enqueue(`${base}:settle:${p.id}`,[await sdk.getSettleGainInstructionAsync({...s,...stamp,participant,amount}, this.options)],key,'keeper',authority);return;
    }
  }
  async funding(key:Keypair,intervalSeconds=2n){
    if(intervalSeconds<2n||intervalSeconds>5n)throw new Error('Local funding cadence must be 2–5 seconds');
    await this.queue.budget('funding',key.address,this.budgets.operator);
    const pending=await this.store.pool.query("SELECT 1 FROM service_intents WHERE run_id=$1 AND budget='funding' AND status IN ('pending','unresolved') LIMIT 1",[this.runId]);if(pending.rowCount)return;
    const s=await this.snapshot(),o=s.risk.oracle;
    if(s.m.mode!==2 || s.m.paused || s.now-o.sampledAt<intervalSeconds)return;
    const [a,b]=[0,1].map(id=>s.makers.find(x=>x.r.makerId===id));if(!a||!b)return;
    const ix=await sdk.getSampleOracleInstructionAsync({...s,primaryBtc:o.sources[0],primaryCollateral:o.sources[1],guardBtc:o.sources[2],guardCollateral:o.sources[3],
      firstCapital:a.r.capital,firstRegistration:a.registration,firstProgram:a.r.pricingProgram,firstProgramData:a.r.programData,firstConfig:a.r.config,
      secondCapital:b.r.capital,secondRegistration:b.registration,secondProgram:b.r.pricingProgram,secondProgramData:b.r.programData,secondConfig:b.r.config}, this.options);
    await this.enqueue(`funding:${s.risk.observationSequence}`,[sdk.fundingComputeBudget(),ix],key,'funding',{kind:'sequence',account:s.market,value:s.m.sequence.toString()});
  }
  async orders(key:Keypair){
    await this.queue.budget('orders',key.address,this.budgets.operator);
    const pending=await this.store.pool.query("SELECT 1 FROM service_intents WHERE run_id=$1 AND budget='orders' AND status IN ('pending','unresolved') LIMIT 1",[this.runId]);if(pending.rowCount)return;
    const s=await this.snapshot();if(s.m.mode!==2||s.m.paused||s.sourceMode==='NoCredibleBounds')return;
    for(const participant of s.members){const p=s.participants[participant];
      for(const o of p.book.orders){
        const remaining=sdk.orderRemaining(p,o,s.m.termsEpoch,s.slot);
        if(remaining===0n||!sdk.orderTriggered(o,s.risk.referencePrice,s.slot)||(!o.reduceOnly&&s.sourceMode!=='Normal'))continue;
        let lots=remaining<64n?remaining:64n;
        let q=await this.quote(p.owner,o.side,lots,{id:o.id,version:o.version,filled:o.filled},key);
        // Bounded search for a smaller admissible atomic subfill when preferred
        // size exceeds current price, capacity or the unspent lifetime fee cap.
        while(!q.available&&lots>1n){lots/=2n;q=await this.quote(p.owner,o.side,lots,{id:o.id,version:o.version,filled:o.filled},key);}
        if(!q.available)continue;
        const instructions=q.instructions!.map(i=>({programAddress:i.programAddress,accounts:i.accounts,data:Buffer.from(i.data,'base64')}));
        await this.enqueue(`order:${p.id}:${o.id}:${o.version}:${o.filled}:${q.sequence}`,instructions,key,'orders',{kind:'nonce',account:participant,value:q.nonce!.toString()});
        return;
      }
    }
  }
  async riskWork(key:Keypair){
    await this.queue.budget('risk',key.address,this.budgets.operator);
    const pending=await this.store.pool.query("SELECT 1 FROM service_intents WHERE run_id=$1 AND budget='risk' AND status IN ('pending','unresolved') LIMIT 1",[this.runId]);if(pending.rowCount)return;
    const s=await this.snapshot();if(!s.resolutionState)throw new Error('Resolution not initialized');
    const o=s.risk.oracle,sources={primaryBtc:o.sources[0],primaryCollateral:o.sources[1],guardBtc:o.sources[2],guardCollateral:o.sources[3]};
    const authority:Authority={kind:'sequence',account:s.market,value:s.m.sequence.toString()};
    const enqueue=async(id:string,ix:Instruction)=>this.enqueue(`risk:${id}:${s.m.sequence}`,[sdk.resolutionComputeBudget(),ix],key,'risk',authority,true);
    if(s.m.mode===3){
      const h=s.resolutionState.header;
      if(h.stage===1||h.stage===12){
        if(h.stage===12){
          if(s.now-h.recoveryLast<2n)return;
          // Once qualified, leave refresh/resume to the explicit authority.
          // Stale sources can make checks succeed without qualifying, so also
          // bound paid attempts durably per resolution epoch across restarts.
          if(h.recoverySince>0n&&h.recoveryLast-h.recoverySince>=6n)return;
          const attempts=await this.store.pool.query("SELECT count(*)::int AS count FROM service_intents WHERE run_id=$1 AND starts_with(request_id,$2)",[this.runId,`risk:check:${h.epoch}:12:`]);
          if(attempts.rows[0].count>=8)return;
        }
        // Permissionless checks cannot resume. Only a separate explicit authority action can.
        await enqueue(`check:${h.epoch}:${h.stage}:${h.recoveryLast}`,await sdk.getRecoverResolutionInstructionAsync({...s,...sources,caller:key,epoch:h.epoch,resume:false}, this.options));return;
      }
      if(h.stage>=2&&h.stage<=11){
        const ix=await sdk.getAdvanceResolutionInstructionAsync({...s,epoch:h.epoch,stage:h.stage,start:h.cursor}, this.options);
        const page={...ix,accounts:[...ix.accounts,...s.members.slice(h.cursor,h.cursor+4).map(address=>({address,role:[3,10].includes(h.stage)?AccountRole.WRITABLE:AccountRole.READONLY}))]};
        await enqueue(`page:${h.epoch}:${h.stage}:${h.cursor}`,page);
      }
      return;
    }
    if(s.m.mode!==2||s.m.paused||s.sourceMode==='NoCredibleBounds')return;
    // Bankruptcy proof is independent of liquidation receiver capacity.
    for(const target of s.members){const p=s.participants[target];
      if(p.cash*1_000_000_000n+p.virtualScaled+p.lots*s.risk.referencePrice*1_000_000_000n<0n){
        await enqueue(`freeze:${p.id}`,await sdk.getFreezeMarketInstructionAsync({...s,...sources,caller:key,target,sequence:s.m.sequence,observation:s.risk.observationSequence,emergency:false}, this.options));return;
      }
    }
    const [receiver]=await sdk.findParticipantPda({market:s.market,owner:key.address}, this.options),capital=s.participants[receiver];
    if(!capital||capital.cash===0n||s.makers.some(x=>x.r.capital===receiver))return;
    for(const target of s.members){const p=s.participants[target];if(target===receiver||sdk.maintenanceDeficit(p,s.risk.lower,s.risk.upper)===0n)continue;
      const exposure=p.lots<0n?-p.lots:p.lots;
      let lots=exposure<64n?exposure:64n;
      while(lots>0n){
        const candidate=sdk.liquidationCandidate(p,capital,lots,s.risk.referencePrice,s.risk.referencePrice,s.risk.lower,s.risk.upper,s.m.termsEpoch,s.slot,s.risk.grossLots);
        if(candidate){await enqueue(`liquidate:${p.id}`,await sdk.getLiquidateInstructionAsync({...s,receiverOwner:key,target,receiver,sequence:s.m.sequence,observation:s.risk.observationSequence,lots,price:s.risk.referencePrice}, this.options));return;}
        lots/=2n;
      }
    }
  }
  async execute(){await this.environment();for(const id of await this.queue.pending())await this.queue.step(id);}
  async close(){await this.store.close();}
}
