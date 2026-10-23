/** Read-only reconciliation of the frozen ledger. Values accept canonical JSON
 * decimal strings or decoded bigint accounts. It never mutates financial state. */
const S=1_000_000_000n;
const n=(x:any)=>BigInt(x);
const abs=(x:bigint)=>x<0n?-x:x;
function check(ok:boolean,message:string):asserts ok {if(!ok)throw new Error(`Frozen resolution: ${message}`);}
export const RESOLUTION_STAGES=['Idle','AwaitValuation','Value','Collect','InsuranceFloors','InsuranceAwards','ImpairmentFloors','ImpairmentAwards','PaymentFloors','PaymentAwards','Apply','Reconcile','Complete','Resumed'] as const;
export function reconcileResolution(m:any,r:any,participants:Record<string,any>,state:any){
  const h=state?.header,ps=Object.values(participants).sort((a,b)=>a.id-b.id);
  check(m.mode===3&&m.paused&&h&&h.stage>=1&&h.stage<=12,'mode/stage');
  check(h.count===ps.length&&h.count>0&&h.count<=64&&state.rows.length===h.count,'complete cohort');
  check(n(h.epoch)>0n&&n(h.funding)===n(m.fundingIndexScaled),'frozen funding');
  const z=h.insuranceMoved?n(h.insuredAtoms):0n;
  check(n(m.totalCash)===n(h.initialCash)-n(h.collectedTotal)+n(h.paidApplied),'cash ledger');
  check(n(m.settlement)===n(h.initialPool)+n(h.collectedTotal)+z-n(h.paidApplied),'pool ledger');
  check(n(m.insurance)===n(h.initialInsurance)-z&&n(m.fees)===n(h.initialFees)&&n(m.allocatedVault)===n(h.initialVault),'protected buckets');
  check(ps.reduce((v,p)=>v+n(p.cash),0n)===n(m.totalCash),'participant cash');
  check(ps.reduce((v,p)=>v+n(p.lots),0n)===n(h.remainingLots),'remaining net lots');
  check(ps.reduce((v,p)=>v+abs(n(p.lots)),0n)===n(h.remainingGross)&&n(r.grossLots)===n(h.remainingGross),'remaining gross lots');
  let collected=0n,paid=0n,claims=0n;
  for(const p of ps){
    check(p.id>=0&&p.id<h.count,'stable ID');
    const row=state.rows[p.id];
    const valued=h.stage>2||(h.stage===2&&p.id<h.cursor);
    if(!valued)continue;
    const applied=h.stage>10||(h.stage===10&&p.id<h.cursor);
    collected+=n(row.collected);claims+=n(row.claim)-n(row.collected)*S;
    if(applied){
      paid+=n(row.paid);
      check(n(p.cash)===n(row.cashBefore)-n(row.collected)+n(row.paid),'applied cash');
      check(n(p.lots)===0n&&n(p.virtualScaled)===0n&&n(p.fundingCheckpointScaled)===n(h.funding),'final position');
      check(n(p.generation)===n(row.generation)+(n(row.lots)===0n?0n:1n),'final generation');
      check(n(p.reserved)===0n&&p.orderIds.every((id:any)=>n(id)===0n)&&p.book.orders.every((o:any)=>o.state!==1&&o.state!==2)&&p.book.groups.every((g:any)=>n(g.remaining)===0n),'final order authority');
    } else {
      check(n(p.cash)===n(row.cashBefore)-n(row.collected)&&n(p.lots)===n(row.lots)&&n(p.generation)===n(row.generation),'frozen participant');
      const u=n(p.virtualScaled)+n(p.lots)*(n(h.price)*S-n(h.funding)+n(p.fundingCheckpointScaled));
      check(u+n(row.collected)*S===n(row.claim),'valued collection adjustment');
    }
  }
  check(collected===n(h.collectedTotal)&&paid===n(h.paidApplied),'applied totals');
  if(h.stage>2)check(claims===n(h.initialPool)*S,'complete initial valued claims');
  if(h.stage<=3)check(n(h.insuredAtoms)===0n&&!h.insuranceMoved,'no premature insurance');
  if(h.stage>=10){
    check(state.rows.reduce((v:bigint,row:any)=>v+n(row.paid),0n)===n(h.planPool),'complete payment plan');
    check(state.rows.reduce((v:bigint,row:any)=>v+n(row.roundingScaled),0n)===0n&&state.rows.every((row:any)=>abs(n(row.roundingScaled))<S),'terminal rounding');
    check(state.rows.reduce((v:bigint,row:any)=>v+n(row.insuredScaled),0n)===n(h.insuredAtoms)*S,'insurance plan');
    check(state.rows.reduce((v:bigint,row:any)=>v+n(row.impairedScaled),0n)===n(h.debt)-n(h.insuredAtoms)*S,'impairment plan');
  }
}
export function resolutionBalance(p:any,state:any){
  const h=state.header,row=state.rows[p.id],valued=h.stage>2||(h.stage===2&&p.id<h.cursor);
  const applied=h.stage>10||(h.stage===10&&p.id<h.cursor),planned=h.stage>=10;
  return {epoch:h.epoch,stage:RESOLUTION_STAGES[h.stage],cursor:h.cursor,count:h.count,
    pinnedPrice:n(h.price)===0n?null:h.price,funding:h.funding,valued,
    claimAfterCollectionScaled:valued?row.claim:null,collected:valued?row.collected:'0',
    plannedPayment:planned?row.paid:null,paymentApplied:applied,appliedPayment:applied?row.paid:'0',
    impairmentScaled:planned?row.impairedScaled:null,terminalAdjustmentScaled:planned?row.roundingScaled:null};
}
