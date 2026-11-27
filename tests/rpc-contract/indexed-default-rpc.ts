// Build frozen books from signed orders, then reconcile their terminal SPL withdrawals.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {AccountRole,address,getAddressEncoder,getProgramDerivedAddress,type Address,type Instruction} from '@solana/kit';
import {getCreateAccountInstruction,getTransferSolInstruction} from '@solana-program/system';
import {getInitializeAccount3Instruction,getInitializeMint2Instruction,getMintToInstruction,getTokenDecoder,TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {fixtureKey,payerKey} from './harness.js';
import {fingerprint,readRoot,replayOrders} from './slot-orders-history.js';
import {assertSettlementReceipt,encodeProof,IndexedReplay,reference,u32,type Probe,type Certificate} from './indexed-default-history.js';

const program=address('sDPXvpEPwCzVKHdpxntiM1khVvtCj2V6ozCr5euajBi'),system=address('11111111111111111111111111111111');
const operator=await payerKey(),keeper=await fixtureKey('indexed-keeper'),mint=await fixtureKey('indexed-mint');
const joint=process.env.RIVALT_PROOF_SCOPE==='joint-competing-indexed-default';
const partial=process.env.RIVALT_PROOF_SCOPE==='partial-indexed-default';
const competing=process.env.RIVALT_PROOF_SCOPE==='competing-indexed-default';
const residual=process.env.RIVALT_PROOF_SCOPE==='residual-indexed-default';
const insured=process.env.RIVALT_PROOF_SCOPE==='insured-indexed-default';
const twoDestinations=residual || insured;
const ids=twoDestinations?[13,18,23]:[13,18,23,28], traderCount=twoDestinations?3:2;
const modes=joint?[65535,18,18,13,13,23,28]:(competing||partial)?[65535,18,18,13,23,28]:[...Array<number>(traderCount).fill(65535),...ids];
const deposits=joint?[4000,298,1000,298,1000,2000,2000]:(competing||partial)?[7897,289,1000,2000,2000,2000]:twoDestinations?[425,2003,2006,396,1200,1200]:[1004,1004,548,548,300,300];
const expectedOutcomes={
  'joint-competing-indexed-default':{cash:[4586,0,1001,0,1001,2000,2000],retained:8,fills:8,alterRateAt:2},
  'partial-indexed-default':{cash:[8180,0,1000,2000,2000,2000],retained:6,fills:6,alterRateAt:2},
  'competing-indexed-default':{cash:[0,0,1174,7000,4000,3000],retained:12,fills:7,alterRateAt:2},
  'residual-indexed-default':{cash:[0,2068,2156,196,1226,1573],retained:11,fills:12,alterRateAt:2},
  'insured-indexed-default':{cash:[0,2263,2155,0,1227,1573],retained:12,fills:13,alterRateAt:5},
  'indexed-default':{cash:[348,348,0,0,1500,1500],retained:8,fills:8,alterRateAt:4},
};
const scope=process.env.RIVALT_PROOF_SCOPE;
assert(scope==='joint-competing-indexed-default' || scope==='partial-indexed-default' || scope==='competing-indexed-default' || scope==='residual-indexed-default' || scope==='insured-indexed-default' || scope==='indexed-default');
const outcome=expectedOutcomes[scope];
const owners=await Promise.all(modes.map((_,i)=>fixtureKey('indexed-owner-'+i)));
const wallets=await Promise.all(modes.map((_,i)=>fixtureKey('indexed-wallet-'+i)));
const key=(a:Address)=>Buffer.from(getAddressEncoder().encode(a));
const u16=(n:number)=>{const b=Buffer.alloc(2); b.writeUInt16LE(n); return b;};
const u64=(n:number)=>{const b=Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b;};
const pda=async(seed:string,...rest:Buffer[])=>(await getProgramDerivedAddress({programAddress:program,seeds:[Buffer.from(seed),...rest]}))[0];
const ro=(address:Address)=>({address,role:AccountRole.READONLY}),rw=(address:Address)=>({address,role:AccountRole.WRITABLE});
const signer=(address:Address)=>({address,role:AccountRole.READONLY_SIGNER}),paying=(address:Address)=>({address,role:AccountRole.WRITABLE_SIGNER});
const custody=await pda('slot-custody',key(operator.address),key(mint.address)),vault=await pda('slot-vault',key(custody));
const roots=await Promise.all(owners.map((o,i)=>pda('trade-root',key(custody),key(o.address),u16(modes[i]))));
const markets=await Promise.all(ids.map(id=>pda('trade-market',key(custody),u16(id))));
const complete=[...roots,...markets],watched=[custody,vault,...complete,...wallets.map(w=>w.address)];
const dir=process.env.RIVALT_RUN_DIR!;
const {rpc,h,ws,checks}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,dir,{
  instructionConformance:()=>false,payerFor:label=>label.startsWith('keeper ')?keeper:undefined,
  computeUnitLimit:label=>label.startsWith('keeper ')?1_400_000:undefined,
});
const expected=new Map<string,number>();
async function send(label:string,name:string,accounts:NonNullable<Instruction['accounts']>,parts:Buffer[]=[],actor=operator,error?:number) {
  const snapshot=()=>Promise.all(watched.map(h.read));
  const before=error?await snapshot():null;
  await h.send(label,[{programAddress:program,accounts,data:Buffer.concat([fingerprint('global:'+name),...parts])}],actor===operator?[]:[actor],error);
  const receipt=checks.at(-1)!;
  assert.equal(receipt.ws,true); expected.set(String(receipt.signature),error??0);
  if(before) assert.deepEqual(await snapshot(),before,label);
  return String(receipt.signature);
}
const root=async(i:number)=>readRoot((await h.read(roots[i]))!);
const balance=async(a:Address)=>getTokenDecoder().decode((await h.read(a))!).amount;
async function wallet(i:number,amount:number,withdraw=false,error?:number,actor=i) {
  await send((withdraw?'withdraw ':'deposit ')+amount+' member '+i,withdraw?'withdraw_trade_cash':'deposit_trade_cash',
    [signer(owners[actor].address),ro(custody),rw(roots[i]),ro(mint.address),rw(vault),rw(wallets[actor].address),ro(TOKEN_PROGRAM_ADDRESS)],
    [u64((await root(i)).rev),u64(amount)],owners[actor],error);
}
async function publish(m:number,price:number,error?:number) {
  await send('publish '+ids[m]+' at '+price,'publish_trade_market',[signer(operator.address),ro(custody),rw(markets[m])],
    [u64(Number((await h.read(markets[m]))!.readBigUInt64LE(42))),u64(price),u64(0)],operator,error);
}
async function trade(t:number,m:number,price:number,close=false,sell=close,makerIndex=m+traderCount,lots=1) {
  await publish(m,price);
  const trader=await root(t),maker=await root(makerIndex);
  const marketSet=(extra:number[])=>Array.from(new Set([...trader.slots.map(s=>s.id),ids[m],...extra])).sort((a,b)=>a-b);
  const expires=Number(await rpc.call('getSlot',[{commitment:'confirmed'}]))+5000;
  await send('place member '+t+' market '+ids[m],'place_trade_order',
    [signer(owners[t].address),ro(custody),rw(roots[t]),...marketSet([]).map(id=>ro(markets[ids.indexOf(id)]))],
    [u64(trader.rev),u16(ids[m]),Buffer.from([+sell]),u64(lots),u64(price),u64(Math.ceil(lots*price/5000)),u64(expires),Buffer.from([+close])],owners[t]);
  await send('fill member '+t+' market '+ids[m],'fill_trade_order',
    [signer(owners[makerIndex].address),ro(custody),rw(markets[m]),rw(roots[t]),rw(roots[makerIndex]),
      ...marketSet(maker.slots.map(s=>s.id)).filter(id=>id!==ids[m]).map(id=>ro(markets[ids.indexOf(id)]))],
    [u64((await root(t)).rev),u64(maker.rev),u64(Number((await h.read(markets[m]))!.readBigUInt64LE(42))),u64(lots)],owners[makerIndex]);
}
async function bookHash() {
  const hash=(...parts:Buffer[])=>createHash('sha256').update(Buffer.concat(parts)).digest();
  let digest=hash(Buffer.from('Rivalt/local-indexed-settlement/v1'),key(program),key(custody),key(mint.address));
  for(const addr of complete) digest=hash(digest,key(addr),(await h.read(addr))!);
  return digest;
}
async function settleBook(label:string,proof:Certificate,hash:Buffer,accounts:NonNullable<Instruction['accounts']>,error?:number) {
  return send('keeper '+label,'settle_indexed_book',[rw(custody),ro(vault),...accounts],[hash,encodeProof(proof)],operator,error);
}
async function probe(width:number,padding:number,cycle=false) {
  const data=reference<Probe>({probe:[width,padding,cycle]});
  const columns=data.rows[0][1].length;
  const encode=(proof:Certificate)=>[Buffer.from([columns]),u32(data.rows.length),...data.rows.flatMap(([cash,cells],i)=>
    [u32(cash),u32(cells.length),...cells.map((claim,m)=>{const b=Buffer.alloc(7),[lots,cap]=data.positions[i][m];
      b.writeInt32LE(claim); b.writeInt8(lots,4); b.writeUInt16LE(cap,5); return b;})]),encodeProof(proof)];
  const inspect=(label:string,proof:Certificate,error?:number)=>send('keeper '+label,'inspect_indexed_book',[signer(keeper.address)],encode(proof),operator,error);
  const tag=data.rows.length+' members '+columns+' markets';
  const signature=await inspect('inspect '+tag,data.proof);
  const tx=await rpc.call('getTransaction',[signature,{commitment:'finalized',maxSupportedTransactionVersion:1}]);
  assert.equal(tx.meta.returnData.programId,program);
  assert.deepEqual(Buffer.from(tx.meta.returnData.data[0],'base64'),Buffer.concat([u32(data.rows.length),...data.proof.cash.map(u64)]));
  if(width===1) {
    // Both candidates pay exactly four and have integral movements. Only a
    // two-atom concession fully resolves the original two-atom impairment.
    assert.deepEqual(data.proof.cash,[0,4]);
    await inspect('refuse strictly lower recovery with identical wallet exits',{...data.proof,selected:1},6016);
  }
  if(width===4 && padding===0 && !cycle) {
    assert.deepEqual(data.proof.cash,[0,0,0,0,0,0,9,9]);
    await inspect('refuse unsafe standalone close',{...data.proof,selected:2},6016);
    await inspect('refuse safe inferior joint close',{...data.proof,selected:4},6016);
  }
  if(cycle) {
    const lower=[...data.proof.numerators];
    lower[columns-2]=lower[columns-1]=0; // Still a fixed point of the closed cashless subcycle.
    await inspect('refuse nongreatest cyclic rates',{...data.proof,numerators:lower},6016);
  }
}
try {
  await h.send('fund local signers and create mint',[
    ...[keeper,...owners].map(owner=>getTransferSolInstruction({source:operator,destination:owner.address,amount:50_000_000n})),
    getCreateAccountInstruction({payer:operator,newAccount:mint,lamports:await h.rent(82),space:82n,programAddress:TOKEN_PROGRAM_ADDRESS}),
    getInitializeMint2Instruction({mint:mint.address,decimals:6,mintAuthority:operator.address})],[mint]);
  await send('open custody','open_slot_custody',[paying(operator.address),ro(mint.address),rw(custody),rw(vault),ro(TOKEN_PROGRAM_ADDRESS),ro(system)]);
  const register=(list:number[],error?:number)=>send('register '+list.join(','),'register_indexed_book',[signer(operator.address),rw(custody)],
    [u32(list.length),...list.flatMap(i=>[key(owners[i].address),u16(modes[i])]),u32(ids.length),...ids.map(u16)],operator,error);
  const roster=owners.map((_,i)=>i);
  await register([0,0],6015); await register(roster); await register(roster,6014);
  for(const [m,id] of ids.entries()) await send('open market '+id,'open_trade_market',[paying(operator.address),ro(custody),rw(markets[m]),ro(system)],[u16(id)]);
  for(const [i,owner] of owners.entries()) {
    await h.send('mint test collateral '+i,[
      getCreateAccountInstruction({payer:operator,newAccount:wallets[i],lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
      getInitializeAccount3Instruction({account:wallets[i].address,mint:mint.address,owner:owner.address}),
      getMintToInstruction({mint:mint.address,token:wallets[i].address,mintAuthority:operator,amount:BigInt(deposits[i])})],[wallets[i]]);
    await send('open margin '+i,'open_trade_root',[paying(owner.address),ro(custody),rw(roots[i]),ro(system)],[u16(modes[i])],owner);
    await wallet(i,deposits[i]);
  }
  let stale:Buffer, proof:Certificate;
  if(joint) {
    for(const [market,debtor,winner] of [[0,3,4],[1,1,2]]) {
      await trade(0,market,1000,false,false,debtor,2);
      await trade(0,market,1148,true,true,winner,2);
      await trade(0,market,1148,false,false,winner);
    }
    await trade(0,2,2000,false,false,5);
    await trade(0,3,1000,false,false,6);
    stale=await bookHash();
    await publish(0,1150); await publish(1,1150);
    const empty=[0,0,0],owing=[-2,0,0],winning=[1,2,2];
    const rows=[[3992,[298,298,0,0]],[298,[0,-300,0,0]],[1000,[0,2,0,0]],
      [298,[-300,0,0,0]],[1000,[2,0,0,0]],[2000,[0,0,0,0]],[2000,[0,0,0,0]]];
    const positions=[[winning,winning,[1,0,0],[1,0,0]],[empty,owing,empty,empty],[empty,winning,empty,empty],
      [owing,empty,empty,empty],[winning,empty,empty,empty],[empty,empty,[-1,0,0],empty],[empty,empty,empty,[-1,0,0]]];
    proof=reference<Certificate>({rows,positions,fees:[3,3,1,1],venue:[...key(custody)]});
    assert.deepEqual([proof.totalPlans,proof.charges,proof.selected],[36,[2,2,0,0],5]);
    assert.deepEqual(proof.splits,[{market:13,members:[0,4],charges:[1,1],lots:[1,1]},
      {market:18,members:[0,2],charges:[1,1],lots:[1,1]}]);
  } else if(partial) {
    // The first owner closes both winning lots against a solvent maker and buys
    // one back. Only one atom of open gain per winner survives the final tick.
    await trade(0,1,1000,false,false,1,2);
    await trade(0,1,1149,true,true,2,2);
    await trade(0,1,1149,false,false,2,1);
    await trade(0,0,1100,false,false,3);
    await trade(0,2,2000,false,false,4);
    await trade(0,3,1000,false,false,5);
    stale=await bookHash();
    await publish(1,1150);
    const empty=[0,0,0];
    const rows=[[7891,[0,299,0,0]],[289,[0,-300,0,0]],[1000,[0,1,0,0]],
      [2000,[0,0,0,0]],[2000,[0,0,0,0]],[2000,[0,0,0,0]]];
    const positions=[[[1,0,0],[1,1,1],[1,0,0],[1,0,0]],[empty,[-2,0,0],empty,empty],
      [empty,[1,1,1],empty,empty],[[-1,0,0],empty,empty,empty],[empty,empty,[-1,0,0],empty],
      [empty,empty,empty,[-1,0,0]]];
    proof=reference<Certificate>({rows,positions,fees:[1,3,1,1],venue:[...key(custody)]});
    assert.deepEqual(proof.baselineLoss,['0','11','0','0']);
    assert.deepEqual([proof.totalPlans,proof.protectedPlans,proof.charges],[4,4,[0,2,0,0]]);
    assert.deepEqual(proof.splits,[{market:18,members:[0,2],charges:[1,1],lots:[1,1]}]);
  } else if(competing) {
    // In market 18 one trader and one isolated maker each retain a long lot.
    // Both can be paired with the two shorts held by a single defaulting maker.
    await trade(0,1,1060,false,false,2);
    await trade(0,1,1000,true,true,2);
    await trade(0,1,1000,false,false,1,2);
    await trade(0,1,1030,true,true,2);
    await trade(0,0,16000,false,false,3);
    await trade(0,2,15500,false,false,4);
    await trade(0,3,2000,false,false,5);
    stale=await bookHash();
    for(const [m,price] of [11000,1150,13500,1000].entries()) await publish(m,price);
    const rows=[[7884,[-5000,120,-2000,-1000]],[289,[0,-300,0,0]],[1000,[0,180,0,0]],
      [2000,[5000,0,0,0]],[2000,[0,0,2000,0]],[2000,[0,0,0,1000]]];
    // Signed lots, eligible unpaid gain and whole-atom gain per opposing lot.
    const empty=[0,0,0], positions=[
      [[1,0,0],[1,120,150],[1,0,0],[1,0,0]], [empty,[-2,0,0],empty,empty],
      [empty,[1,120,120],empty,empty], [[-1,5000,5000],empty,empty,empty],
      [empty,empty,[-1,2000,2000],empty], [empty,empty,empty,[-1,1000,1000]],
    ];
    proof=reference<Certificate>({rows,positions,fees:[4,4,4,1],venue:[...key(custody)]});
    assert.deepEqual([proof.totalPlans,proof.protectedPlans,proof.selected,proof.spent],[66,29,5,[0,1,0,0]]);
    assert.deepEqual(proof.splits,[{market:18,members:[0,2],charges:[4,6],lots:[1,1]}]);
  } else if(twoDestinations) {
    await trade(0,0,1000); await trade(0,0,1200,true);
    if(insured) await trade(1,0,1000); // Only the forced-close book has an open source gain.
    // Two flat creditors earn 135 and 315 against the insured maker.
    await trade(1,1,1000); await trade(1,1,1135,true); await trade(2,1,1000); await trade(2,1,1315,true);
    await trade(0,1,2000); await trade(0,2,2000);
    stale=await bookHash();
    if(residual) {
      // At these prices all debts are funded. Supply the correct all-par
      // baseline against the current digest, with full write access.
      const healthy=reference<Certificate>({rows:[[421,[200,0,0]],[2001,[0,135,0]],[2004,[0,315,0]],
        [396,[-200,0,0]],[1200,[0,-450,0]],[1200,[0,0,0]]],
        positions:[[[0,0],[1,0],[1,0]],[[0,0],[0,0],[0,0]],[[0,0],[0,0],[0,0]],
          [[0,0],[0,0],[0,0]],[[0,0],[-1,0],[0,0]],[[0,0],[0,0],[-1,0]]],fees:[2,5,1]});
      assert.deepEqual([healthy.numerators,healthy.baselineLoss],[[1,1,1,1],['0','0','0']]);
      await settleBook('refuse terminal settlement of solvent book',healthy,stale,complete.map(rw),6016);
    }
    await publish(0,1200);
    for(const [market,price] of [[1,1496],[2,1244]]) {
      // A solvent trader sells and buys back at the shocked mark. The isolated
      // maker realizes its old short and reopens at this same mark with zero
      // forced-close capacity. The distressed trader never signs another fill.
      await trade(2,market,price,false,true); await trade(2,market,price,true,false);
    }
    const rows=[[421,[200,-504,-756]],[2000,[200,135,0]],[2000,[0,315,0]],
      [396,[-400,0,0]],[1200,[0,54,0]],[1200,[0,0,756]]];
    const positions=[[[0,0],[1,0],[1,0]],[[1,200],[0,0],[0,0]],[[0,0],[0,0],[0,0]],
      [[-1,0],[0,0],[0,0]],[[0,0],[-1,0],[0,0]],[[0,0],[0,0],[-1,0]]];
    if(residual) {
      rows[1]=[2001,[0,135,0]]; rows[3]=[396,[-200,0,0]];
      positions[1][0]=[0,0]; positions[3][0]=[0,0];
    }
    proof=reference<Certificate>({rows,positions,fees:[residual?2:3,7,3]});
    assert.deepEqual([proof.charges,proof.spent,proof.repaired],[[residual?0:4,0,0],[0,1,0],insured]);
    if(residual) {
      assert.deepEqual([proof.totalPlans,proof.selected,proof.numerators],[1,0,[2520,2520,1247,1242]]);
      assert.deepEqual(proof.baselineLoss,['0','1273/5','1917/5']);
    }
  } else {
    await trade(0,1,1000); await trade(0,1,1050,true); await trade(1,0,1000); await trade(1,0,1050,true);
    await trade(0,0,1000); await trade(1,1,1000); await trade(0,2,2000); await trade(1,3,2000);
    stale=await bookHash();
    for(const [m,price] of [1500,1500,800,800].entries()) await publish(m,price);
    // Independent signed workload assumptions. PostgreSQL reconstructs these again from transaction history.
    const rows=[[1000,[500,50,-1200,0]],[1000,[50,500,0,-1200]],[548,[-550,0,0,0]],[548,[0,-550,0,0]],
      [300,[0,0,1200,0]],[300,[0,0,0,1200]]];
    const positions=[[[1,500],[0,0],[1,0],[0,0]],[[0,0],[1,500],[0,0],[1,0]],[[-1,0],[0,0],[0,0],[0,0]],
      [[0,0],[-1,0],[0,0],[0,0]],[[0,0],[0,0],[-1,1200],[0,0]],[[0,0],[0,0],[0,0],[-1,1200]]];
    proof=reference<Certificate>({rows,positions,fees:[3,3,1,1]});
  }
  const digest=await bookHash();
  const accounts=[...roots.map(rw),...markets.map((m,i)=>proof.spent[i]?rw(m):ro(m))];
  const settle=(label:string,p=proof,error?:number,metas=accounts,hash:Buffer=digest)=>settleBook(label,p,hash,metas,error);
  await settle('refuse stale signed state',proof,6017,accounts,stale);
  await settle('refuse missing market',proof,6015,accounts.slice(0,-1));
  await settle('refuse substituted member',proof,6015,[accounts[1],...accounts.slice(1)]);
  await settle('refuse incomplete rate proof',{...proof,numerators:proof.numerators.slice(0,-4)},6003);
  await settle('refuse forged rate',{...proof,numerators:proof.numerators.map((n,i)=>n-Number(i===outcome.alterRateAt))},6016);
  if(residual) {
    await settle('refuse nonexistent reduction',{...proof,selected:1},6016);
    await settle('refuse trailing rate pass',{...proof,numerators:[...proof.numerators,...proof.numerators]},6003);
    await settle('refuse erasing the uninsured shortfall',{...proof,numerators:[1,1,1,1]},6016);
  } else if(joint) {
    await settle('refuse disproportionate first market',{...proof,selected:4},6016);
    await settle('refuse disproportionate second market',{...proof,selected:2},6016);
    await settle('refuse zero plan across two distressed markets',{...proof,selected:0},6016);
  } else if(partial) {
    await settle('refuse abandoning two recoverable atoms',{...proof,selected:0},6016);
    await settle('refuse nonexistent higher-capacity split',{...proof,selected:2},6016);
  } else if(competing) {
    await settle('refuse 5 and 5 impairing foreign recovery',{...proof,selected:6},6016);
    await settle('refuse equally effective but less proportional 3 and 7',{...proof,selected:4},6016);
    await settle('refuse skipping both winners',{...proof,selected:0},6016);
  } else {
    await settle('refuse inferior allocation',{...proof,selected:insured?2:4},6016);
    await settle('refuse bypass of eligible reduction',{...proof,selected:0},6016);
  }
  if(twoDestinations) {
    await settle('refuse read-only insurance source',proof,6015,[...roots.map(rw),...markets.map(ro)]);
    const altered=[...proof.numerators], end=altered.length;
    // Keep total proposed cash constant and divert three atoms from the
    // uninsured market to the insured one. The frozen 2:3 split rules it out.
    assert.equal(altered[end-4],2520);
    altered[end-2]+=15; altered[end-1]-=10;
    await settle('refuse cross-market diversion',{...proof,numerators:altered},6016);
  }
  await settle('settle funded book'); await settle('refuse replay',proof,6014);
  await publish(0,1500,6014);
  assertSettlementReceipt((await h.read(custody))!,proof,ids);
  assert.deepEqual(proof.cash,outcome.cash);
  for(const [i,amount] of proof.cash.entries()) {
    const state=await root(i);
    assert.deepEqual([state.cash,state.slots.length],[BigInt(amount),0]);
  }
  const paid=proof.cash.findIndex(cash=>cash>0);
  await wallet(paid,proof.cash[paid]+1,true,6007); await wallet(paid,proof.cash[paid],true,6008,paid+1);
  for(const [i,amount] of proof.cash.entries()) if(amount) await wallet(i,amount,true);
  assert.deepEqual(await Promise.all(wallets.map(w=>balance(w.address))),proof.cash.map(BigInt));
  assert.equal(await balance(vault),BigInt(outcome.retained));
  if(!twoDestinations && !competing && !partial && !joint) { await probe(1,0); await probe(2,2); await probe(4,0); await probe(4,2); await probe(4,0,true); }
  const replay=new IndexedReplay(custody,keeper.address,mint.address,owners.map(o=>o.address),wallets.map(w=>w.address),ids,modes);
  const journal=await replayOrders(rpc,program,roots,vault,await balance(vault),expected,undefined,replay);
  assert.deepEqual(replay.result,proof); assert.deepEqual([journal.fills,journal.cash,journal.fees,journal.vault],[outcome.fills,'0',String(outcome.retained),String(outcome.retained)]);
  const measurements=checks.map(({label,signature,computeUnits,bytes,loadedAccounts,error})=>({label,signature,computeUnits,bytes,loadedAccounts,error}));
  writeFileSync(dir+'/indexed-default.json',JSON.stringify({proof,journal,measurements},null,2));
  console.log('Reconciled indexed default',journal,'wallets',proof.cash,'insurance',proof.spent,'repaired',proof.repaired);
} finally {await ws.close();}
