import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AccountRole, address, createNoopSigner, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import { Connection, Keypair } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import { Store } from '../../indexer/src/store.js';
import { Rpc, integer } from '../../indexer/src/rpc.js';
import { json, hash } from '../../indexer/src/events.js';
import { Queue, type Authority } from './queue.js';

export const OPERATOR_CAP=5_000_000n,MAKER_CAP=1_000_000n,HEARTBEAT_MS=3000;
export class Runtime {
  readonly store:Store;readonly rpc:Rpc;readonly queue:Queue;readonly connection:Connection;
  constructor(database:string,readonly runId:string,url:string){
    this.store=new Store(database,runId);this.rpc=new Rpc(url);this.queue=new Queue(this.store,this.rpc);this.connection=new Connection(url,'confirmed');
  }
  async open(){await this.store.migrate();await this.store.pool.query(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));await this.environment();}
  async environment(){
    const b=(await this.store.snapshot()).binding;
    if(await this.rpc.call('getGenesisHash')!==b.genesis)throw new Error('Service genesis mismatch');
    const tx=await this.rpc.call('getTransaction',[b.anchor,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    if(!tx || hash(tx.transaction)!==b.anchorHash)throw new Error('Service initialization anchor mismatch');
    return b;
  }
  async snapshot(){
    const b=await this.environment(),row=await this.store.snapshot(),market=address(b.market);
    const [registry]=await sdk.findRegistryPda({market}),[routeState]=await sdk.findRouteStatePda({market}),[guard]=await sdk.findGuardPda({market}),[vault]=await sdk.findVaultPda({market});
    const [eventAuthority]=await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('__event_authority')]});
    const pkeys=Object.keys(row.state.participants).sort((a,b)=>row.state.participants[a].id-row.state.participants[b].id).map(address),rkeys=Object.keys(row.state.makers).map(address);
    // Discover bindings, then refetch every value from a single finalized bank.
    const discovered=await this.rpc.call('getMultipleAccounts',[rkeys,{encoding:'base64',commitment:'finalized'}]);
    const regs=discovered.value.map((x:any)=>{if(x?.owner!==sdk.CLEARING_PROGRAM_ADDRESS)throw new Error('Maker missing');return sdk.getMakerRegistrationDecoder().decode(Buffer.from(x.data[0],'base64'));}) as sdk.MakerRegistration[];
    const clock=address('SysvarC1ock11111111111111111111111111111111');
    const keys=[clock,market,registry,routeState,guard,vault,...pkeys,...rkeys,...regs.flatMap(r=>[r.config,r.programData])];
    const response=await this.rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'finalized'}]);
    const slot=BigInt(integer(response.context.slot));
    const raw=(key:Address,owner:string=sdk.CLEARING_PROGRAM_ADDRESS)=>{const a=response.value[keys.indexOf(key)];if(!a || a.owner!==owner)throw new Error('Missing/foreign snapshot account');return Buffer.from(a.data[0],'base64');};
    const m=sdk.getMarketStateDecoder().decode(raw(market)),reg=sdk.getParticipantRegistryDecoder().decode(raw(registry));
    if(Buffer.from(m.domain).toString('hex')!==b.domain || m.schemaVersion!==1 || m.profileVersion!==1 || ![1,2].includes(m.mode) || (m.mode===1 && m.fundingIndexScaled!==0n))throw new Error('Unsupported service profile');
    assert.deepEqual(reg.members,pkeys);assert.equal(reg.count,pkeys.length);
    const risk=sdk.getTestRouteStateDecoder().decode(raw(routeState));
    const participants=Object.fromEntries(pkeys.map(k=>[k,sdk.getParticipantDecoder().decode(raw(k))]));
    pkeys.forEach((k,id)=>{const p=participants[k];if(p.market!==market || p.schemaVersion!==1 || p.id!==id || p.reserved!==0n || p.orderIds.some(n=>n!==0n))throw new Error('Unsupported participant profile');});
    const total=Object.values(participants).reduce((n,p)=>n+p.cash,0n),claims=Object.values(participants).reduce((n,p)=>n+p.virtualScaled+p.lots*p.fundingCheckpointScaled,0n);
    if(total!==m.totalCash || claims!==m.settlement*1_000_000_000n || Object.values(participants).reduce((n,p)=>n+p.lots,0n)!==0n)throw new Error('Snapshot ledger mismatch');
    const actual=raw(vault,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').readBigUInt64LE(64);
    if(m.allocatedVault!==m.totalCash+m.settlement+m.insurance+m.fees || actual<m.allocatedVault)throw new Error('Snapshot vault mismatch');
    const now=raw(clock,'Sysvar1111111111111111111111111111111111111').readBigInt64LE(32);
    const funding=sdk.effectiveFunding(m,risk,now,slot),sourceMode=sdk.oracleMode(m,risk,now,slot);
    for(const key of pkeys)participants[key]=sdk.accruedBalance(participants[key],funding);
    const heartbeats=(await this.store.pool.query('SELECT *,seen_at>now()-($2::int*interval \'1 millisecond\') AS online FROM maker_heartbeats WHERE run_id=$1',[this.runId,HEARTBEAT_MS])).rows;
    const makers=rkeys.map((registration,i)=>{
      const r=sdk.getMakerRegistrationDecoder().decode(raw(registration));assert.equal(r.config,regs[i].config);assert.equal(r.programData,regs[i].programData);
      const state=sdk.makerA.getMakerConfigDecoder().decode(raw(r.config,r.pricingProgram)).state;
      const approved=createHash('sha256').update(raw(r.programData,'BPFLoaderUpgradeab1e11111111111111111111111')).digest().equals(Buffer.from(r.approvedHash));
      const heartbeat=heartbeats.find(h=>h.maker_id===r.makerId && h.owner===r.owner);
      return {registration,r,state,approved,online:heartbeat?.online===true,balance:participants[r.capital]};
    });
    return {market,registry,routeState,guard,vault,eventAuthority,program:sdk.CLEARING_PROGRAM_ADDRESS,m,risk,slot,now,funding,sourceMode,participants,members:reg.members,makers,
      certificate:sdk.getExitGuardDecoder().decode(raw(guard)),actual};
  }
  async quote(owner:Address,side:number,lots:bigint){
    const s=await this.snapshot(),[trader]=await sdk.findParticipantPda({market:s.market,owner}),p=s.participants[trader];
    if(!p || p.owner!==owner || s.m.paused || s.slot<s.risk.validFrom || s.slot>=s.risk.validUntil || s.sourceMode==='NoCredibleBounds')throw new Error('Quote unavailable');
    const reduceOnly=(side===1 && p.lots>=lots)||(side===0 && -p.lots>=lots);
    if(s.sourceMode!=='Normal' && !reduceOnly)throw new Error('Risk increase blocked by oracle mode');
    const eligible=s.makers.filter(x=>x.online && x.approved && !x.r.quarantined && x.r.quoteEpoch===x.state.quoteEpoch);
    const candidates=eligible.map(x=>({state:x.state,balance:x.balance,request:{version:1,domain:s.m.domain,market:s.market,capital:x.r.capital,quoteEpoch:x.r.quoteEpoch,authorityEpoch:x.r.authorityEpoch,termsEpoch:s.m.termsEpoch,marketConfigEpoch:s.m.configEpoch,side,lots,inventory:x.balance.lots,cash:x.balance.cash,inventoryLimit:x.r.inventoryLimit,consumed:side===0?x.r.buyConsumed:x.r.sellConsumed,referencePrice:s.risk.referencePrice,slot:s.slot}}));
    const allocation=candidates.length?sdk.allocateRoute({snapshotSlot:s.slot,side,lots,lower:s.risk.lower,upper:s.risk.upper,trader:p,candidates,grossLots:s.risk.grossLots,maxFee:1_000_000_000n,allInLimit:side===0?1_000_000_000_000_000n:0n}):null;
    if(!allocation)return {available:false,snapshotSlot:s.slot,universe:s.makers.map(x=>({makerId:x.r.makerId,online:x.online,approved:x.approved})),allocation:null};
    const selected=allocation.legs.map(l=>eligible.find(x=>x.r.makerId===l.makerId)!);const [first,second]=selected;
    const expiry=[s.slot+150n,s.risk.validUntil,...selected.map(x=>x.state.expirySlot)].reduce((a,b)=>a<b?a:b);
    const ix=await sdk.getExecuteRouteInstructionAsync({...s,owner:createNoopSigner(owner),trader,
      firstCapital:first.r.capital,firstRegistration:first.registration,firstProgram:first.r.pricingProgram,firstProgramData:first.r.programData,firstConfig:first.r.config,
      secondCapital:second?.r.capital,secondRegistration:second?.registration,secondProgram:second?.r.pricingProgram,secondProgramData:second?.r.programData,secondConfig:second?.r.config,
      domain:s.m.domain,termsEpoch:s.m.termsEpoch,configEpoch:s.m.configEpoch,observationSequence:s.risk.observationSequence,nonce:p.nonce,startSlot:s.slot,expirySlot:expiry,
      side,lots,maxFee:allocation.fee,allInLimit:allocation.allIn,reduceOnly,generation:p.generation,
      legs:allocation.legs.map((l,i)=>({lots:l.lots,quoteEpoch:selected[i].r.quoteEpoch,authorityEpoch:selected[i].r.authorityEpoch}))});
    return {available:true,snapshotSlot:s.slot,universe:s.makers.map(x=>({makerId:x.r.makerId,online:x.online,approved:x.approved})),allocation,
      instructions:[sdk.routeComputeBudget(),ix].map(i=>({programAddress:i.programAddress,accounts:i.accounts?.map(a=>({address:a.address,role:a.role})),data:Buffer.from(i.data??[]).toString('base64')}))};
  }
  async enqueue(id:string,ixs:Instruction[],payer:Keypair,budget:string,authority:Authority|null){
    if(await this.queue.get(id))return;
    const {transaction}=await sdk.signInstructions(this.connection,payer,ixs);
    await this.queue.put(id,Buffer.from(transaction.serialize()).toString('base64'),authority,budget);
  }
  async maker(id:number,key:Keypair){
    const s=await this.snapshot(),x=s.makers.find(x=>x.r.makerId===id);if(!x || x.r.owner!==key.address)throw new Error('Maker key binding');
    const budget=`maker-${id}`;await this.queue.budget(budget,key.address,MAKER_CAP);
    await this.store.pool.query(`INSERT INTO maker_heartbeats(run_id,maker_id,owner,process_id,snapshot) VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id,maker_id) DO UPDATE SET owner=EXCLUDED.owner,process_id=EXCLUDED.process_id,seen_at=now(),snapshot=EXCLUDED.snapshot`,[this.runId,id,key.address,process.pid,json({slot:s.slot,sequence:s.m.sequence,cash:x.balance.cash,lots:x.balance.lots,virtualScaled:x.balance.virtualScaled,quoteEpoch:x.state.quoteEpoch,expirySlot:x.state.expirySlot})]);
    if(!x.approved || x.r.quarantined || s.m.paused)return;
    if(s.slot>=x.state.expirySlot){
      const api=id===0?sdk.makerA:sdk.makerB;
      await this.enqueue(`maker:${id}:${x.state.quoteEpoch}`,[api.getPublishEpochInstruction({owner:key,config:x.r.config,duration:3600n}),await sdk.getSyncMakerEpochInstructionAsync({...s,...x.r,registration:x.registration})],key,budget,null);
    }else if(x.state.quoteEpoch!==x.r.quoteEpoch){
      await this.enqueue(`maker-sync:${id}:${x.state.quoteEpoch}`,[await sdk.getSyncMakerEpochInstructionAsync({...s,...x.r,registration:x.registration})],key,budget,null);
    }
  }
  async settle(key:Keypair){
    await this.queue.budget('keeper',key.address,OPERATOR_CAP);
    const pending=await this.store.pool.query("SELECT 1 FROM service_intents WHERE run_id=$1 AND request_id LIKE 'keeper:%' AND status IN ('pending','unresolved') LIMIT 1",[this.runId]);if(pending.rowCount)return;
    const s=await this.snapshot();if(s.m.paused || s.slot<s.risk.validFrom || s.slot>=s.risk.validUntil || s.sourceMode==='NoCredibleBounds')return;
    const stamp={sequence:s.m.sequence,observation:s.risk.observationSequence},authority:Authority={kind:'sequence',account:s.market,value:s.m.sequence.toString()};
    const base=`keeper:${s.m.sequence}:${s.risk.observationSequence}`;
    for(const participant of s.members){
      const p=s.participants[participant],u=p.virtualScaled+p.lots*s.risk.referencePrice*1_000_000_000n;
      if(u<=-1_000_000_000n && p.cash>0n){
        const loss=(-u)/1_000_000_000n,amount=loss<p.cash?loss:p.cash;
        await this.enqueue(`${base}:collect:${p.id}`,[await sdk.getCollectLossInstructionAsync({...s,...stamp,participant,amount})],key,'keeper',authority);return;
      }
    }
    // No default shortcut: an insolvent cohort makes all ordinary exits unavailable.
    if(Object.values(s.participants).some(p=>p.cash*1_000_000_000n+(p.virtualScaled+p.lots*(p.lots<0n?s.risk.upper:s.risk.lower)*1_000_000_000n)<0n))return;
    const g=s.certificate;
    if(g.sequence!==s.m.sequence || g.observation!==s.risk.observationSequence || g.next!==s.members.length){
      const start=g.sequence===s.m.sequence && g.observation===s.risk.observationSequence?g.next:0;
      const ix=await sdk.getCheckExitCohortInstructionAsync({...s,...stamp,start});
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
      await this.enqueue(`${base}:settle:${p.id}`,[await sdk.getSettleGainInstructionAsync({...s,...stamp,participant,amount})],key,'keeper',authority);return;
    }
  }
  async funding(key:Keypair){
    await this.queue.budget('funding',key.address,OPERATOR_CAP);
    const pending=await this.store.pool.query("SELECT 1 FROM service_intents WHERE run_id=$1 AND request_id LIKE 'funding:%' AND status IN ('pending','unresolved') LIMIT 1",[this.runId]);if(pending.rowCount)return;
    const s=await this.snapshot(),o=s.risk.oracle;
    if(s.m.mode!==2 || s.m.paused || s.now-o.sampledAt<2n)return;
    const [a,b]=[0,1].map(id=>s.makers.find(x=>x.r.makerId===id));if(!a||!b)return;
    const ix=await sdk.getSampleOracleInstructionAsync({...s,primaryBtc:o.sources[0],primaryCollateral:o.sources[1],guardBtc:o.sources[2],guardCollateral:o.sources[3],
      firstCapital:a.r.capital,firstRegistration:a.registration,firstProgram:a.r.pricingProgram,firstProgramData:a.r.programData,firstConfig:a.r.config,
      secondCapital:b.r.capital,secondRegistration:b.registration,secondProgram:b.r.pricingProgram,secondProgramData:b.r.programData,secondConfig:b.r.config});
    await this.enqueue(`funding:${s.risk.observationSequence}`,[sdk.fundingComputeBudget(),ix],key,'funding',{kind:'sequence',account:s.market,value:s.m.sequence.toString()});
  }
  async execute(){await this.environment();for(const id of await this.queue.pending())await this.queue.step(id);}
  async close(){await this.store.close();}
}
