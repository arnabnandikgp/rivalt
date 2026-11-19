/** Financial effects of the authenticated paged settlement, separate from its
 * readonly arithmetic scratch. IDs stay decimal strings on this boundary. */
import {address} from '@solana/kit';
import {multiLotBookPlan} from '@rivalt/sdk/multi-lot-book';
import {isMultiLotArtifact} from '@rivalt/sdk';
import {inventoryBookPlan,twoDebtorRecovery,singleLotWinnerOrder} from '@rivalt/sdk/frozen-order';
import {isBookInventoryArtifact,isSharedInventoryArtifact,PARTIAL_INVENTORY_ARTIFACT_SET,FOREIGN_CREDITOR_ARTIFACT_SET,LINKED_ALLOCATION_ARTIFACT_SET,LINKED_FLAT_ARTIFACT_SET} from '@rivalt/sdk';
import type {AccountEvent} from './account-events.js';
import {accountCheck, present, type AccountState} from './account-projection.js';
import {isDeepStrictEqual} from 'node:util';
export type PagedSettlement = {
  plan:string; epoch:string; stage:number; cursor:string; count:string; adoptionRevision:string;
  remainingCash:string; appliedCash:string; marketMovements:string[]; insuranceSpent:string[];
};
const scale=1_000_000_000n;
const eq=(left:unknown,right:unknown,label:string)=>accountCheck(isDeepStrictEqual(left,right),`paged ${label}`);
const claims=(root:AccountState['roots'][string],prices:string[],funding:string[])=>root.positions.map((position,index)=>
  (BigInt(position.virtualScaled)+BigInt(position.lots)*(BigInt(prices[index])*scale-BigInt(funding[index])+BigInt(position.fundingCheckpointScaled))).toString());
export function projectSettlement(state:AccountState,event:AccountEvent,root:(value:any,key?:string)=>void,artifactSet?:string) {
  const change=event.data,current=present(state.resolution,'paged source'),safety=present(state.safety,'paged safety');
  eq(change.epoch,current.epoch,'epoch');
  if(event.type==='MultiLotBookVerified') {
    accountCheck(isMultiLotArtifact(artifactSet) && current.stage===2 && !current.inventoryBook && !current.pair &&
      !current.sharedInventory && !current.foreignCreditors && !current.joint && !current.allocation && !current.linkedAllocation,'unique multi-lot certificate');
    eq(current.poolsBefore,['0','0'],'empty settlement pools');
    eq(String(state.members.length),current.count,'complete multi-lot membership');
    const rates=new Map<string,readonly [bigint,bigint]>(change.capacities.map(([id,,num,den]:string[])=>[id,[BigInt(num),BigInt(den)]]));
    const rows=state.members.map(key=>{
      const member=state.roots[key], [btc,eth]=claims(member,current.prices,current.funding).map(BigInt);
      const [lots,ethLots]=member.positions.map(position=>BigInt(position.lots));
      eq([btc%scale,eth,ethLots],[0n,0n,0n],'whole BTC book');
      return {id:BigInt(member.id),cash:BigInt(member.cash),face:btc/scale,lots,rate:rates.get(member.id)??[0n,1n] as const};
    });
    eq(current.remainingGross,[String(rows.reduce((sum,row)=>sum+(row.lots<0n?-row.lots:row.lots),0n)),'0'],'complete exposure');
    const plan=present(multiLotBookPlan(address(change.venue),BigInt(current.epoch),BigInt(current.prices[0]),BigInt(current.insuranceBefore[0]),rows),'multi-lot proof');
    eq(plan.capacities.map(row=>row.map(String)),change.capacities,'bounded frozen rates');
    eq(plan.pairs.map(row=>row.map(String)),change.pairs,'canonical multi-lot fills');
    eq(String(plan.total),change.total,'total charge');
    current.inventoryBook={multiLot:true,total:change.total,digest:plan.digest,capacities:change.capacities,pairs:change.pairs};
    return;
  }
  if(event.type==='InventoryBookVerified') {
    accountCheck(isBookInventoryArtifact(artifactSet) && current.stage===2 && !current.inventoryBook &&
      !current.sharedInventory && !current.foreignCreditors && !current.pair && !current.joint &&
      !current.allocation && !current.linkedAllocation,'unique book certificate');
    eq(current.poolsBefore,['0','0'],'empty frozen pools');
    eq(String(state.members.length),current.count,'complete frozen membership');
    const debtors:{id:bigint;amount:bigint}[]=[], winners:{id:bigint;amount:bigint}[]=[];
    const capacity=new Map<string,string>(change.capacities.map(([id,amount]:string[])=>[id,amount]));
    let debtSide=0n,winnerSide=0n,totalFace=0n;
    for(const key of state.members) {
      const member=state.roots[key], id=BigInt(member.id);
      const [btc,eth]=claims(member,current.prices,current.funding).map(BigInt);
      const [lots,ethLots]=member.positions.map(position=>BigInt(position.lots));
      eq([eth,ethLots],[0n,0n],'empty ETH claims and positions');
      totalFace+=btc;
      if(lots===0n) {
        accountCheck(btc>=0n,'flat creditor');continue;
      }
      eq(btc%scale,0n,'whole active face');
      accountCheck(lots===1n||lots===-1n,'one lot per member');
      if(btc<0n) {
        accountCheck(!debtSide||debtSide===lots,'consistent debtor side');debtSide=lots;
        const loss=-btc/scale-BigInt(member.cash);
        debtors.push({id,amount:loss>0n?loss:0n});
      } else {
        accountCheck(!winnerSide||winnerSide===lots,'consistent winner side');winnerSide=lots;
        const amount=BigInt(present(capacity.get(member.id),'frozen winning capacity'));
        accountCheck(amount>=0n && amount<=btc/scale,'capacity within original claim');
        winners.push({id,amount});
      }
    }
    eq(totalFace,0n,'BTC conservation');
    eq(winnerSide,-debtSide,'opposing sides');
    eq(current.remainingGross,[String(debtors.length+winners.length),'0'],'complete gross exposure');
    const losses=debtors.reduce((sum,member)=>sum+member.amount,0n);
    const residual=losses-BigInt(current.insuranceBefore[0]);
    const budgets=debtors.map(member=>({...member,amount:residual>0n?member.amount*residual/losses:0n}));
    const plan=inventoryBookPlan(address(change.venue),BigInt(change.epoch),budgets,winners,debtSide,BigInt(current.prices[0]));
    eq(plan.capacities.map(row=>row.map(String)),change.capacities,'complete winning capacities');
    eq(plan.pairs.map(row=>row.map(String)),change.pairs,'canonical charges and prices');
    eq(String(plan.total),change.total,'recovered amount');
    current.inventoryBook={digest:plan.digest,total:change.total,capacities:change.capacities,pairs:change.pairs};
    return;
  }
  if(event.type==='SharedInventoryVerified') {
    accountCheck(isSharedInventoryArtifact(artifactSet),'shared inventory deployment');
    const partial=artifactSet===PARTIAL_INVENTORY_ARTIFACT_SET;
    accountCheck(current.stage===2 && !current.sharedInventory && !current.foreignCreditors && !current.pair && !current.joint &&
      !current.allocation && !current.linkedAllocation,'one certificate per freeze');
    const {members,charges,eligible,prices}=change;
    eq(new Set(members).size,4,'four inventory owners');
    accountCheck(BigInt(members[0])<BigInt(members[1]),'canonical debtor order');
    eq(current.poolsBefore,['0','0'],'empty frozen pools');
    eq(current.remainingGross,['4','0'],'complete one-lot market');
    eq(String(state.members.length),current.count,'complete membership');
    const roles=members.map((id:string)=>{
      const key=state.identities[id];
      accountCheck(state.members.includes(key),'financial inventory owner');
      return state.roots[key];
    }) as AccountState['roots'][string][];
    const side=BigInt(roles[0].positions[0].lots);
    accountCheck(side===1n||side===-1n,'one lot per owner');
    const face=roles.map((member,index)=>{
      const [btc,eth]=claims(member,current.prices,current.funding).map(BigInt);
      eq([btc%scale,eth],[0n,0n],'whole original BTC claim');
      eq(member.positions.map(pos=>BigInt(pos.lots)),[index<2?side:-side,0n],'opposing single lot');
      accountCheck(index<2?btc<0n:partial?btc>=0n:btc>0n,'inventory claim direction');
      return btc/scale;
    });
    let flatClaims=0n;
    for(const key of state.members) {
      const member=state.roots[key];
      if(!members.includes(member.id)) {
        const [btc,eth]=claims(member,current.prices,current.funding).map(BigInt);
        accountCheck(eth===0n && (partial?btc>=0n:btc===0n),'flat creditor claims');
        flatClaims+=btc;
        eq(member.positions.map(pos=>pos.lots),['0','0'],'neutral lots');
      }
    }
    eq(face.reduce((a,b)=>a+b)*scale+flatClaims,0n,'complete BTC faces');
    const losses=roles.slice(0,2).map((member,index)=>-face[index]-BigInt(member.cash));
    const total=losses[0]+losses[1], residual=total-BigInt(current.insuranceBefore[0]);
    accountCheck(residual>0n && losses.every(loss=>partial?loss>=0n:loss>0n),'positive uncovered losses');
    const budgets=losses.map(loss=>loss*residual/total);
    const participants=(ids:string[],amounts:bigint[])=>ids.map((id,i)=>({id:BigInt(id),amount:amounts[i]}));
    const debtors=participants(members.slice(0,2),budgets);
    const winners=participants(members.slice(2),eligible.map(BigInt));
    if(partial) {
      const canonical=[...winners].sort((left,right)=>left.id<right.id?-1:1);
      const plan=twoDebtorRecovery(address(change.venue),BigInt(change.epoch),debtors,canonical);
      accountCheck(!!plan,'complete assignment');
      eq(plan!.charges,charges.map(BigInt),'maximal feasible recovery');
      eq(plan!.order.map(index=>canonical[index].id),winners.map(winner=>winner.id),'optimal pairing');
    } else {
      eq(charges.map(BigInt),budgets,'verified debtor shares');
      eq(singleLotWinnerOrder(address(change.venue),BigInt(change.epoch),debtors,winners),[0,1],'optimal pairing');
    }
    for(const i of [0,1]) {
      const charge=BigInt(charges[i]),capacity=BigInt(eligible[i]);
      accountCheck(charge<=budgets[i] && charge<=capacity && capacity<=face[i+2] && (partial || charge>0n),'original winning capacity');
      eq(BigInt(prices[i]),charge?BigInt(current.prices[0])+side*charge:0n,'one-lot fill price');
    }
    current.sharedInventory={members,charges,eligible,prices};
    return;
  }
  if(event.type==='ForeignCreditorsVerified') {
    accountCheck(artifactSet===FOREIGN_CREDITOR_ARTIFACT_SET || isSharedInventoryArtifact(artifactSet),'foreign creditor deployment');
    accountCheck(current.stage===2 && !current.sharedInventory && !current.foreignCreditors && !current.joint && !current.pair && !current.allocation && !current.linkedAllocation,'unique recovery');
    const {members,charges,eligible,matchedLots,basePrices,extraTickLots}=change;
    eq(new Set(members).size,4,'distinct frozen creditor roles');
    eq(current.poolsBefore,['0','0'],'empty settlement pools');
    eq(String(state.members.length),current.count,'complete foreign-creditor membership');
    const roles:AccountState['roots'][string][]=members.map((id:string)=>present(state.roots[state.identities[id]],'frozen creditor member'));
    const faces=roles.map((member)=>claims(member,current.prices,current.funding).map(value=>{
      eq(BigInt(value)%scale,0n,'whole original face');return BigInt(value)/scale;
    }));
    const [debt,flat,gain,ethDebt]=[-faces[0][0],faces[1][0],faces[2][0],faces[3][1]];
    accountCheck(flat>0n && gain>0n && ethDebt>0n,'original creditor faces');
    eq(faces,[[-debt,0n],[flat,0n],[gain,-ethDebt],[0n,ethDebt]],'complete creditor claims');
    eq(debt,gain+flat,'BTC conservation');
    const lots=roles.map((member)=>member.positions.map((pos:{lots:string})=>BigInt(pos.lots)));
    eq(lots,[[-lots[2][0],0n],[0n,0n],[lots[2][0],-lots[3][1]],[0n,lots[3][1]]],'offsetting inventory');
    for(const key of state.members) {
      const member=state.roots[key];
      if(!members.includes(member.id)) {
        eq(claims(member,current.prices,current.funding),['0','0'],'neutral claims');
        eq(member.positions.map(pos=>pos.lots),['0','0'],'neutral inventory');
      }
    }
    const backing=BigInt(roles[0].cash)+BigInt(current.insuranceBefore[0]);
    const ethCash=BigInt(roles[2].cash)+BigInt(current.insuranceBefore[1]);
    const [btcCharge,ethCharge]=charges.map(BigInt);
    const beforeEth=ethCash*debt+gain*backing, afterEth=ethCash+gain-btcCharge;
    eq(btcCharge,debt-backing,'full BTC shortfall');
    accountCheck(backing>0n && gain>btcCharge && ethDebt*debt>beforeEth,'supported linked obligations');
    eq(ethCharge,(ethDebt*debt-beforeEth)/debt,'whole ETH shortfall');
    accountCheck((afterEth+ethCharge)*debt>=beforeEth && afterEth<=ethDebt-ethCharge,'ETH exact and rounded protection');
    for(const market of [0,1]) {
      const signed=lots[market+2][market],quantity=signed<0n?-signed:signed;
      const amount=BigInt(charges[market]),matched=BigInt(matchedLots[market]),capacity=BigInt(eligible[market]);
      eq(2n*quantity,BigInt(current.remainingGross[market]),'exhausted frozen side');
      accountCheck(amount>0n && amount<=capacity && capacity<=faces[market+2][market] && matched>0n && matched<=quantity,'admitted schedule');
      eq(BigInt(basePrices[market]),BigInt(current.prices[market])-(signed>0n?1n:-1n)*(amount/matched),'fill price');
      eq(BigInt(extraTickLots[market]),amount%matched,'extra ticks');
    }
    current.foreignCreditors={members,charges,eligible,matchedLots,basePrices,extraTickLots};
    return;
  }
  if(event.type==='FrozenJointReductionVerified') {
    accountCheck(current.stage===2 && !current.joint && !current.pair && !current.allocation,'unique joint freeze');
    const debtor=present(state.roots[state.identities[change.debtorId]],'joint debtor');
    const debts=claims(debtor,current.prices,current.funding).map(value=>-BigInt(value));
    accountCheck(debts.every(debt=>debt>0n && debt%scale===0n),'whole original debts');
    const face=debts.map(debt=>debt/scale), total=face[0]+face[1];
    const available=BigInt(debtor.cash)<total?BigInt(debtor.cash):total;
    accountCheck(new Set([change.debtorId,...change.winners]).size===3,'distinct joint members');
    for(const market of [0,1]) {
      const winner=present(state.roots[state.identities[change.winners[market]]],'joint winner');
      const signedLots=BigInt(winner.positions[market].lots), quantity=signedLots<0n?-signedLots:signedLots;
      eq(BigInt(current.remainingGross[market]),2n*quantity,'complete maker inventory');
      eq(BigInt(debtor.positions[market].lots),-signedLots,'complete opposite inventory');
      eq(winner.positions[1-market].lots,'0','isolated winner inventory');
      const won=claims(winner,current.prices,current.funding);
      eq(won[1-market],'0','isolated winner cash claim');
      const totalClaims=debts[market]+BigInt(current.poolsBefore[market])*scale;
      const remainder=totalClaims-BigInt(won[market]);
      if(market===0 && (artifactSet===LINKED_FLAT_ARTIFACT_SET || artifactSet===LINKED_ALLOCATION_ARTIFACT_SET) && remainder!==0n) {
        accountCheck(remainder>0n && remainder%scale===0n,'whole flat BTC claim');
        eq(String(state.members.length),current.count,'complete frozen membership');
        const creditors=state.members.filter(key=>{
          const member=state.roots[key];
          if(member.id===change.debtorId || member.id===winner.id) return false;
          const [btc,eth]=claims(member,current.prices,current.funding).map(BigInt);
          if(btc===0n) return false;
          accountCheck(btc===remainder && eth===0n && member.positions.every(position=>position.lots==='0'),
            'flat BTC creditor identity and face');
          return true;
        });
        eq(creditors.length,1,'one flat BTC creditor');
      } else {
        eq(remainder,0n,'sole creditor');
      }
      const share=BigInt(change.shares[market]),charge=BigInt(change.charges[market]);
      eq(share*total,available*face[market],'frozen cash split');
      eq(charge,face[market]-share-BigInt(current.insuranceBefore[market]),'full verified loss');
      const matched=BigInt(change.matchedLots[market]);
      accountCheck(charge>0n && charge*scale<=BigInt(won[market]) && charge<=BigInt(change.eligible[market]) && matched>0n && matched<=quantity,'joint capacity');
      eq(BigInt(change.extraTickLots[market]),charge%matched,'joint extra ticks');
      eq(BigInt(change.basePrices[market]),BigInt(current.prices[market])-(signedLots>0n?1n:-1n)*(charge/matched),'joint fill');
    }
    const {debtorId,winners,shares,charges,eligible,matchedLots,basePrices,extraTickLots}=change;
    current.joint={debtorId,winners,shares,charges,eligible,matchedLots,basePrices,extraTickLots};
    return;
  }
  if(event.type==='FrozenLinkedAllocationRow') {
    eq(artifactSet,LINKED_ALLOCATION_ARTIFACT_SET,'linked allocation deployment');
    eq(current.stage,2,'allocation at freeze');
    const ordinal=BigInt(change.ordinal);
    accountCheck(ordinal<BigInt(current.count)&&BigInt(current.count)===BigInt(state.members.length),'complete linked membership');
    const member=state.roots[state.members[Number(ordinal)]];
    eq(member.id,change.memberId,'canonical linked member');
    if(ordinal===0n) {
      const previous=current.linkedAllocation;
      accountCheck(!current.joint&&!current.pair&&!current.allocation&&(!previous||
        previous.status===2&&BigInt(previous.attempt)<BigInt(change.attempt)),'new linked attempt');
      const debtor=present(state.roots[state.identities[change.debtorId]],'linked debtor');
      const debts=claims(debtor,current.prices,current.funding).map(claim=>-BigInt(claim));
      accountCheck(debts.every(debt=>debt>0n&&debt%scale===0n),'whole debtor claims');
      const face=debts.map(debt=>debt/scale),total=face[0]+face[1];
      const available=BigInt(debtor.cash)<total?BigInt(debtor.cash):total;
      for(const market of [0,1]) {
        const lots=BigInt(debtor.positions[market].lots);
        eq(BigInt(current.remainingGross[market]),2n*(lots<0n?-lots:lots),'original market side');
        eq(BigInt(change.shares[market])*total,available*face[market],'original market cash');
        eq(BigInt(change.targets[market]),face[market]-BigInt(change.shares[market])-BigInt(current.insuranceBefore[market]),'full market recovery');
        accountCheck(lots!==0n&&BigInt(change.targets[market])>0n,'positive market exposure');
      }
      current.linkedAllocation={attempt:change.attempt,debtorId:change.debtorId,shares:change.shares,targets:change.targets,
        cursor:'0',recovered:['0','0'],status:0,charges:{}};
    }
    const plan=present(current.linkedAllocation,'linked allocation');
    eq([plan.attempt,plan.debtorId,plan.shares,plan.targets,plan.cursor,plan.status],
      [change.attempt,change.debtorId,change.shares,change.targets,change.ordinal,0],'linked scan binding');
    const face=claims(member,current.prices,current.funding).map(BigInt);
    const lots=member.positions.map(pos=>BigInt(pos.lots));
    if(member.id!==plan.debtorId)accountCheck(face.every(value=>value>=0n&&value%scale===0n)
      &&lots.some((lot,market)=>lot===0n&&face[market]===0n),'separate creditor markets');
    let excess=false;
    for(const market of [0,1]) {
      const charge=BigInt(change.charges[market]),eligible=BigInt(change.eligible[market]),matched=BigInt(change.matchedLots[market]);
      const open=lots[market],quantity=open<0n?-open:open;
      accountCheck(charge<=eligible && matched<=quantity && (charge===0n)===(matched===0n) &&
        (member.id===plan.debtorId||open===0n?eligible===0n:eligible*scale<=face[market]),'eligible linked terms');
      eq(BigInt(change.extraTickLots[market]),matched===0n?0n:charge%matched,'linked price remainder');
      eq(BigInt(change.basePrices[market]),matched===0n?0n:BigInt(current.prices[market])-(open>0n?1n:-1n)*(charge/matched),'linked fill price');
      const total=BigInt(plan.recovered[market])+charge;
      if(total>BigInt(plan.targets[market]))excess=true;else plan.recovered[market]=String(total);
    }
    plan.charges[member.id]=change.charges;plan.cursor=String(ordinal+1n);
    const complete=plan.cursor===current.count;
    plan.status=excess||complete&&plan.recovered.some((amount,market)=>amount!==plan.targets[market])?2:complete?1:0;
    eq(change.status,plan.status,'linked proof outcome');
    return;
  }
  if(event.type==='FrozenBtcAllocationRow') {
    eq(current.stage,2,'allocation at freeze');
    const ordinal=BigInt(change.ordinal),id=change.memberId;
    if(ordinal===0n) {
      accountCheck(!current.allocation||current.allocation.status===2&&BigInt(current.allocation.attempt)<BigInt(change.attempt),'new allocation attempt');
      current.allocation={attempt:change.attempt,debtorId:change.debtorId,shortfall:change.shortfall,cursor:'0',recovered:'0',capacity:'0',status:0,charges:{}};
    }
    const plan=present(current.allocation,'allocation scan');
    eq(plan.attempt,change.attempt,'allocation attempt');eq(plan.cursor,change.ordinal,'allocation cursor');
    eq(plan.debtorId,change.debtorId,'allocation debtor');eq(plan.shortfall,change.shortfall,'allocation shortfall');
    const account=present(state.roots[state.identities[id]],'frozen member'),lots=BigInt(account.positions[0].lots);
    const limit=BigInt(change.eligible),charge=BigInt(change.charge),matched=BigInt(change.matchedLots);
    accountCheck(plan.status===0&&!(id in plan.charges)&&charge<=limit&&matched<=(lots<0n?-lots:lots)&&
      (charge===0n)===(matched===0n)&&(!(id===plan.debtorId||lots===0n)||limit===0n),'frozen charge terms');
    eq(BigInt(change.extraTickLots),matched===0n?0n:charge%matched,'allocation remainder');
    eq(BigInt(change.basePrice),matched===0n?0n:BigInt(current.prices[0])-(lots>0n?1n:-1n)*(charge/matched),'allocation price');
    const total=BigInt(plan.recovered)+charge,capacity=BigInt(plan.capacity)+limit,shortfall=BigInt(plan.shortfall);
    plan.recovered=String(total);plan.capacity=String(capacity<shortfall?capacity:shortfall);
    plan.charges[id]=change.charge;plan.cursor=String(ordinal+1n);
    const finished=plan.cursor===String(current.count);
    plan.status=total>shortfall||finished&&plan.capacity!==plan.recovered?2:finished?1:0;
    eq(plan.status,change.status,'verified allocation outcome');return;
  }
  if(event.type==='FrozenPairVerified'||event.type==='FrozenBtcReductionVerified') {
    eq(current.stage,2,'pair at freeze');eq(current.prices[0],change.mark,'frozen BTC price');
    accountCheck(!current.pair&&change.debtorId!==change.winnerId,'unique frozen pair');
    const debtor=present(state.roots[state.identities[change.debtorId]],'paired debtor');
    const winner=present(state.roots[state.identities[change.winnerId]],'paired winner');
    const gain=BigInt(change.charge),mark=BigInt(change.mark),lots=BigInt(winner.positions[0].lots);
    const quantity=lots<0n?-lots:lots,direction=lots<0n?-1n:1n;
    const residual=event.type==='FrozenBtcReductionVerified';
    const matched=residual?BigInt(change.matchedLots):gain===0n?0n:1n;
    const extra=residual?BigInt(change.extraTickLots):0n;
    const price=residual?change.basePrice:change.price;
    eq(current.remainingGross,[(2n*quantity).toString(),'0'],'unique open pair');
    eq(BigInt(debtor.positions[0].lots),-lots,'opposite lots');
    accountCheck(quantity>0n&&(residual||quantity===1n)&&gain>=0n&&gain<=BigInt(change.unpaidGainCap),'eligible charge');
    accountCheck(matched>=0n&&matched<=quantity&&(matched===0n)===(gain===0n),'matched lots');
    eq(extra,matched===0n?0n:gain%matched,'extra tick lots');
    eq(BigInt(price),matched===0n?0n:mark-direction*(gain/matched),'paired execution price');
    current.pair={debtorId:change.debtorId,winnerId:change.winnerId,charge:change.charge,price,unpaidGainCap:change.unpaidGainCap,
      ...(residual?{matchedLots:change.matchedLots,extraTickLots:change.extraTickLots}:{})};
    return;
  }
  if(event.type==='SettlementMarginApplied') {
    const plan=present(state.pagedSettlement,'adopted plan'),id=BigInt(change.id),ordinal=BigInt(change.ordinal);
    accountCheck(current.stage===14&&plan.stage===9&&ordinal===BigInt(plan.cursor)&&ordinal<BigInt(plan.count),'paged next Apply');
    // Financial ordinal and stable identity are distinct after empty-account churn.
    const member=state.members.find(key=>BigInt(state.roots[key].id)===id);
    eq(member,change.member,'member');
    const previous=present(state.roots[change.member],'original margin');
    const frozen=present(current.rows[previous.id],'frozen row');
    accountCheck(!frozen.applied,'paged once-only root');
    eq(change.cashBefore,previous.cash,'original cash');
    const economic=claims(previous,current.prices,current.funding),pair=current.pair;
    eq(economic,frozen.claimsScaled,'original frozen claims');
    if(current.inventoryBook) {
      const net=current.inventoryBook.pairs.reduce((value,[debtor,winner,amount])=>
        previous.id===debtor?value+BigInt(amount):previous.id===winner?value-BigInt(amount):value,0n);
      economic[0]=String(BigInt(economic[0])+net*scale);
    } else if(current.sharedInventory) {
      const {members,charges}=current.sharedInventory;
      const index=members.indexOf(previous.id);
      if(index>=0) {
        const adjustment=index<2?BigInt(charges[index]):-BigInt(charges[index-2]);
        economic[0]=(BigInt(economic[0])+adjustment*scale).toString();
      }
    } else if(current.foreignCreditors) {
      const {members,charges}=current.foreignCreditors;
      const debtors=[members[0],members[2]];
      for(const market of [0,1]) {
        const charge=BigInt(charges[market]);
        const delta=previous.id===debtors[market]?charge:previous.id===members[market+2]?-charge:0n;
        economic[market]=(BigInt(economic[market])+delta*scale).toString();
      }
    } else if(current.linkedAllocation?.status===1) {
      const allocation=current.linkedAllocation;
      for(const market of [0,1]) {
        const adjustment=previous.id===allocation.debtorId?BigInt(allocation.targets[market]):-BigInt(allocation.charges[previous.id][market]);
        economic[market]=(BigInt(economic[market])+adjustment*scale).toString();
      }
    } else if(current.joint) {
      const {charges,debtorId,winners}=current.joint;
      for(const market of [0,1]) {
        const charge=BigInt(charges[market]);
        const delta=previous.id===debtorId?charge:previous.id===winners[market]?-charge:0n;
        economic[market]=(BigInt(economic[market])+delta*scale).toString();
      }
    } else if(current.allocation?.status===1) {
      const allocation=current.allocation;
      const delta=previous.id===allocation.debtorId?BigInt(allocation.recovered):-BigInt(allocation.charges[previous.id]);
      economic[0]=(BigInt(economic[0])+delta*scale).toString();
    } else if(pair) {
      const delta=previous.id===pair.debtorId?BigInt(pair.charge):previous.id===pair.winnerId?-BigInt(pair.charge):0n;
      economic[0]=(BigInt(economic[0])+delta*scale).toString();
    }
    eq(change.claims,economic,'claims');
    eq(change.lots,previous.positions.map(position=>position.lots),'lots');
    const movements=change.claims.map((claim:string,index:number)=>BigInt(claim)===0n?0n:(BigInt(claim)<0n?-1n:1n)*BigInt(change.flows[index]));
    eq(BigInt(change.state.cash),BigInt(previous.cash)+movements[0]+movements[1],'payout conservation');
    accountCheck(BigInt(change.state.cash)>=BigInt(frozen.cashBefore)-BigInt(frozen.collected),'retained own cash');
    for(const counter of ['nonce','stateVersion','delegateEpoch'] as const)
      eq(BigInt(change.state[counter]),BigInt(previous[counter])+1n,counter);
    eq(change.state.book.lastOrderId,previous.book.lastOrderId,'order ID');
    eq(change.state.book.lastGroupId,previous.book.lastGroupId,'protection ID');
    eq(change.state.revision,previous.revision,'root predecessor');
    for(let market=0;market<2;market++) {
      current.remainingLots[market]=(BigInt(current.remainingLots[market])-BigInt(change.lots[market])).toString();
      // Unapplied margin accounts still store their original positions. Their
      // running sum differs from the payout basis between the two paired rows.
      current.remainingClaims[market]=(BigInt(current.remainingClaims[market])-BigInt(frozen.claimsScaled[market])).toString();
      const lots=BigInt(change.lots[market]);
      current.remainingGross[market]=(BigInt(current.remainingGross[market])-(lots<0n?-lots:lots)).toString();
      plan.marketMovements[market]=(BigInt(plan.marketMovements[market])+movements[market]).toString();
      state.markets[state.venue!.markets[market]].grossLots=current.remainingGross[market];
    }
    plan.remainingCash=(BigInt(plan.remainingCash)-BigInt(previous.cash)).toString();
    plan.appliedCash=(BigInt(plan.appliedCash)+BigInt(change.state.cash)).toString();
    current.remainingCash=plan.remainingCash;current.appliedCash=plan.appliedCash;
    plan.cursor=(ordinal+1n).toString();
    Object.assign(frozen,{applied:true,flows:change.flows,cashAfter:change.state.cash});
    root(change.state,change.member);
    return;
  }
  accountCheck(event.type==='SettlementPlanProgress','paged event kind');
  let plan=state.pagedSettlement;
  if(!plan) {
    accountCheck(current.stage===2&&current.cursor==='0'&&change.stage===9&&change.cursor==='0','paged adoption transition');
    eq(change.count,String(state.members.length),'complete count');
    eq(change.remainingCash,current.cashBefore,'original total');eq(change.appliedCash,'0','initial payout');
    eq(change.marketMovements,['0','0'],'initial movements');
    accountCheck(BigInt(change.adoptionRevision)>0n,'adoption revision');
    const sourceEntry=Object.values(state.revisions).filter(entry=>entry.kind===10);
    accountCheck(sourceEntry.length===1&&BigInt(sourceEntry[0].revision)+1n===BigInt(change.adoptionRevision),'source revision handover');
    for(let market=0;market<2;market++)accountCheck(BigInt(change.insuranceSpent[market])<=BigInt(current.insuranceBefore[market]),'insurance bound');
    for(const [id,key] of state.members.entries()) {
      const source=state.roots[key],values=claims(source,current.prices,current.funding);
      const debt=values.reduce((sum,value)=>sum+(BigInt(value)<0n?-BigInt(value):0n),0n)/scale;
      const cash=BigInt(source.cash);
      current.rows[source.id]={member:key,originalRevision:source.revision,activationGeneration:source.activationGeneration,cashBefore:source.cash,lots:source.positions.map(position=>position.lots),
        generations:source.positions.map(position=>position.generation),claimsScaled:values,collected:(cash<debt?cash:debt).toString()};
    }
    plan=state.pagedSettlement={plan:change.plan,epoch:change.epoch,stage:9,cursor:'0',count:change.count,
      adoptionRevision:change.adoptionRevision,remainingCash:change.remainingCash,appliedCash:'0',marketMovements:['0','0'],insuranceSpent:change.insuranceSpent};
  } else {
    eq(change.plan,plan.plan,'plan key');eq(change.count,plan.count,'count');eq(change.adoptionRevision,plan.adoptionRevision,'adoption binding');
    eq(change.insuranceSpent,plan.insuranceSpent,'immutable expenditure');
    const transition=plan.stage===9&&(change.stage===9&&change.cursor===plan.cursor
      ||change.stage===10&&plan.cursor===plan.count&&change.cursor==='0')
      ||plan.stage===10&&BigInt(change.cursor)===BigInt(plan.cursor)+1n
        &&change.stage===(change.cursor===plan.count?11:10)
      ||plan.stage===11&&change.stage===12&&change.cursor===plan.count;
    accountCheck(transition,'paged stage/cursor transition');
    eq(change.remainingCash,plan.remainingCash,'remaining original cash');eq(change.appliedCash,plan.appliedCash,'applied cash');
    eq(change.marketMovements,plan.marketMovements,'market movements');
  }
  eq(change.gross,current.remainingGross,'remaining gross');
  eq(change.allocated,state.custody!.allocatedVault,'allocated vault');
  accountCheck(BigInt(change.actualVault)>=BigInt(change.allocated),'vault deficit');
  eq(change.fees,current.feesBefore,'protected fees');
  const distributed=change.stage>=10,completed=change.stage===12;
  for(const ledger of Object.values(state.ledgers)) {
    const market=ledger.marketIndex;
    eq(change.pools[market],distributed?'0':current.poolsBefore[market],'settlement bucket');
    eq(change.insurance[market],(BigInt(current.insuranceBefore[market])-(distributed?BigInt(plan.insuranceSpent[market]):0n)).toString(),'insurance ownership');
    const distributing=plan.stage===9&&change.stage===10;
    eq(BigInt(change.ledgerVersions[market]),BigInt(ledger.version)+(distributing?1n:0n),'ledger version');
    eq(BigInt(change.liabilityVersions[market]),BigInt(ledger.liabilityVersion)+(distributing?1n:0n),'liability version');
    accountCheck(typeof change.insuranceFeeRemainders==='string'&&/^[0-9a-f]{4}$/.test(change.insuranceFeeRemainders),'carry encoding');
    eq(Buffer.from(change.insuranceFeeRemainders,'hex')[market],ledger.insuranceFeeRemainder,'protected fee carry');
    Object.assign(ledger,{settlement:change.pools[market],insurance:change.insurance[market],version:change.ledgerVersions[market],liabilityVersion:change.liabilityVersions[market]});
  }
  if(distributed) {
    eq(plan.remainingCash,'0','all original cash processed');
    eq(plan.marketMovements,current.poolsBefore.map((pool,index)=>(BigInt(pool)+BigInt(plan!.insuranceSpent[index])).toString()),'complete market conservation');
    eq(plan.appliedCash,(BigInt(current.cashBefore)+plan.marketMovements.reduce((sum,value)=>sum+BigInt(value),0n)).toString(),'complete cash conservation');
  }
  eq(change.resolutionStage,completed?11:14,'source stage');
  eq(change.mode,completed?3:2,'safety mode');eq(change.paused,!completed,'paused');
  eq(BigInt(change.safetyEpoch),BigInt(safety.epoch)+(completed?1n:0n),'safety epoch');
  current.stage=change.resolutionStage;
  if(completed) {
    current.cursor=current.count;current.safetyEpoch=change.safetyEpoch;
    current.insuranceSpent=plan.insuranceSpent;current.budgets=plan.marketMovements;
  }
  Object.assign(safety,{mode:change.mode,paused:change.paused,epoch:change.safetyEpoch});
  plan.stage=change.stage;plan.cursor=change.cursor;
}
