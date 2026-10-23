import assert from 'node:assert/strict';
import { appendFileSync,writeFileSync,statfsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import * as sdk from '@rivalt/sdk';
import { json } from '../../packages/indexer/src/events.js';
import { wait,type environment } from './environment.js';
import { QuoteUnavailable } from '../../packages/services/src/runtime.js';
import { Continuity } from './continuity.js';
import { submissionFault } from './submission-fault.js';
import { resources as diskResources } from './resources.js';

export function sustained(e:Awaited<ReturnType<typeof environment>>,duration:number,capture:(label:string)=>Promise<any>,pollUi:()=>Promise<void>){
  const start=performance.now(),clock=new Continuity(Date.now(),start),long=duration>=86400,qualification=duration===1800,tail=duration===360,finalOnly=duration===180,orderCadence=tail?30:300;
  const roles=finalOnly?[]:qualification?['funding','executor','indexer']:tail?['funding','indexer','settlement']:['maker-a','maker-b','executor','funding','indexer','settlement'];
  const times=long?[3600,10800,21600,32400,43200,64800]:qualification?[300,600,900]:tail?[60,150,270]:[60,330,600,660,750,840];
  const plan=roles.map((role,i)=>({role,atSeconds:times[i],durationSeconds:role.startsWith('maker')?210:role==='executor'?0:role==='indexer'?60:30}));
  writeFileSync(`${e.dir}/fault-plan.json`,json({durationSeconds:duration,plan,classification:'From outage start through observed recovery; set before any affected offered attempt'}));
  const events:any[]=[],orders:any[]=[],resources:any[]=[];let active:string|null=null,stopping=false,fatal:unknown,nextFault=0,lastCapture=-60,lastOrder=-orderCadence,action:Promise<void>|null=null,orderAction:Promise<void>|null=null;
  const abort=new AbortController();
  async function until<T>(read:()=>Promise<T>,ok:(v:T)=>boolean,label:string,ms:number){const end=Date.now()+ms;while(!stopping&&Date.now()<end){try{const v=await read();if(ok(v))return v;}catch{}await delay(100,undefined,{signal:abort.signal});}throw new Error(label+' interrupted or timed out');}
  const elapsed=()=>(performance.now()-start)/1000;
  const record=(file:string,row:any)=>appendFileSync(`${e.dir}/${file}.jsonl`,json(row)+'\n');
  async function fault(p:typeof plan[number]){
    active=p.role;const before=await e.runtime.store.snapshot(),event:any={...p,startedAt:new Date().toISOString(),startedSeconds:elapsed(),beforeCheckpoint:before.checkpoint,beforeSequence:before.state.sequence};events.push(event);record('faults',{...event,event:'start'});
    if(p.role==='executor')event.proof=await submissionFault(e,'fault:sustained-executor');
    else{
      if(p.role==='indexer'){const child=e.children.get(p.role)!;child.kill('SIGKILL');await wait(async()=>child.signalCode==='SIGKILL',Boolean,'actual indexer death');}
      await e.stop(p.role);await delay(p.durationSeconds*1000,undefined,{signal:abort.signal});if(stopping)throw new Error('Outage interrupted');
      if(p.role.startsWith('maker')){const s=await e.runtime.snapshot(),maker=s.makers.find(x=>x.r.makerId===(p.role==='maker-a'?0:1))!;event.expirySlot=String(maker.state.expirySlot);event.outageSlot=String(s.slot);assert(s.slot>=maker.state.expirySlot,'Maker must actually expire during its outage');}
      e.start(p.role);
    }
    await until(async()=>{const s=await e.runtime.snapshot();const r=await fetch('http://127.0.0.1:18083/ready',{signal:AbortSignal.timeout(2000)});return s.sourceMode==='Normal'&&s.makers.every(x=>x.online)&&r.ok;},Boolean,`${p.role} normal recovery`,90_000);
    const after=await e.runtime.store.snapshot();event.afterSequence=after.state.sequence;event.afterCheckpoint=after.checkpoint;event.finishedSeconds=elapsed();event.result='pass';
    if(p.role==='indexer')assert(BigInt(after.state.sequence)>BigInt(event.beforeSequence),'Indexer outage must recover actual new history');
    record('faults',{...event,event:'recovered'});active=null;
  }
  // Actual durable authority is placed for the separate funded receiver, never a load trader.
  async function placeOrder(){
    const s=await e.runtime.snapshot(),p=s.participants[e.receiver.participant];
    if(p.book.orders.some(o=>sdk.orderRemaining(p,o,s.m.termsEpoch,s.slot)>0n))return;
    const side=p.lots>0n?1:0,q=await e.runtime.quote(e.receiver.owner.address,side,1n);
    if(!q.available){lastOrder=elapsed()-orderCadence+5;return;}
    const id=p.book.lastOrderId+1n,at=elapsed();
    const signature=await e.send('sustained durable order placement',[await sdk.getPlaceOrderInstructionAsync({...e.a,owner:e.receiver.owner,participant:e.receiver.participant,expectedId:id,terms:{side,lots:1n,limit:side===0?66000n:54000n,feeBudget:100n,startSlot:s.slot,expirySlot:s.slot+3600n,trigger:0,threshold:0n,reduceOnly:side===1,generation:side===1?p.generation:0n}})],[e.receiver.owner]);
    const row:any={id:String(id),side,placedSeconds:at,signature};orders.push(row);record('orders',row);
    const filled=await until(async()=>sdk.getParticipantDecoder().decode((await e.read(e.receiver.participant))!).book.orders.find(o=>o.id===id),o=>o?.filled===1n,'durable order executes through real worker',120_000);
    row.filledSeconds=elapsed();row.notional=String(filled!.notional);row.fee=String(filled!.feeCharged);record('orders',row);
  }
  // Keep monitoring independent of a 210-second outage/recovery action.
  const loop=(async()=>{while(!stopping){
    try{
      clock.observe(Date.now(),performance.now());const time=elapsed();
      if(!action&&nextFault<plan.length&&time>=plan[nextFault].atSeconds){const p=plan[nextFault++];action=fault(p).catch(err=>{fatal=err;}).finally(()=>{action=null;});}
      if(!finalOnly&&!orderAction&&!active&&time<duration-120&&time-lastOrder>=orderCadence){lastOrder=time;orderAction=placeOrder().catch(err=>{
        // Unsigned unavailable quotes are retained; any signed/other failure is fatal.
        if(err instanceof QuoteUnavailable){record('orders',{atSeconds:elapsed(),unavailable:err.code});lastOrder=elapsed()-orderCadence+5;}else fatal=err;
      }).finally(()=>{orderAction=null;});}
      if(time-lastCapture>=60){lastCapture=time;const sample=await capture(`sustained-${Math.floor(time)}`),free=statfsSync('.');
        const inventory=execFileSync('ps',['-Ao','pid=,ppid=,%cpu=,rss=,etime=,comm='],{encoding:'utf8'}).trim().split('\n').map(line=>{const fields=line.trim().split(/\s+/);return{pid:Number(fields[0]),parent:Number(fields[1]),rssKiB:Number(fields[3]),line};});
        const owned=new Set([process.pid,Number(process.env.RIVALT_SURFPOOL_PID)]);let changed=true;
        while(changed){changed=false;for(const p of inventory)if(owned.has(p.parent)&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}
        const selected=inventory.filter(p=>owned.has(p.pid));
        const value={atSeconds:time,databaseBytes:sample.databaseBytes,diskFreeBytes:free.bavail*free.bsize,processes:selected.map(p=>p.line).join('\n'),
          summedOwnedRssKiB:selected.reduce((n,p)=>n+p.rssKiB,0),postgresVmCapMiB:512,storage:await diskResources(e)};resources.push(value);record('resources',value);
        assert(value.diskFreeBytes>Math.max(512*1024*1024,Number(sample.databaseBytes)*1.25),'Insufficient reserved disk for final rebuild; soak incomplete');
        assert.equal(e.sourceErrors.length,0,'Source publication errors');
        for(const role of ['indexer','api','executor','maker-a','maker-b','funding','settlement','orders','risk'])if(role!==active){const child=e.children.get(role);assert(child&&child.exitCode===null&&child.signalCode===null,`Unexpected ${role} process exit`);}
      }
      await pollUi();
    }catch(err){fatal=err;}
    if(fatal)break;await delay(500);
  }})();
  return {fault:()=>active!==null,assertHealthy(){if(fatal)throw fatal;},
    async close(){stopping=true;await loop;await Promise.all([action,orderAction]);clock.observe(Date.now(),performance.now());if(fatal)throw fatal;assert.equal(nextFault,plan.length);assert(events.every(x=>x.result==='pass'));assert(orders.length>=(finalOnly?0:tail?3:1)&&orders.every(x=>x.filledSeconds!==undefined),'Stored open/close/reopen must actually fill');
      const result={durationSeconds:duration,continuity:clock.result(),faults:events,orders,resources};writeFileSync(`${e.dir}/sustained.json`,json(result));return result;},
    async abort(){stopping=true;abort.abort();await loop;await Promise.all([action,orderAction]);}
  };
}
