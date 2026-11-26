// Cold certificate-free credit, with signed membership changes, adverse prices and competing fills.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {AccountRole, type Address, type Instruction} from '@solana/kit';
import {getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {registerFinancialTestMargin} from './account-membership-setup.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {coverageProvisioning,appendCoverage} from './coverage-provisioning.js';
import {routerBuild} from './execution-router-build.js';
import {fixtureKey,payerKey} from './harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {auditCoverage} from './shadow-coverage.js';

const dir=process.env.RIVALT_RUN_DIR!, build=routerBuild();
const streamed = build.artifactSet === sdk.STREAMED_CREDIT_ARTIFACT_SET;
const grouped = build.artifactSet === sdk.GROUPED_CREDIT_ARTIFACT_SET;
assert(grouped || streamed || build.artifactSet === sdk.DIRECT_CREDIT_ARTIFACT_SET);
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const fillPayer=await fixtureKey('p32-scale-trader-1'), payer=await payerKey();
// Both original transactions reach this point after simulation and WS subscription.
let rendezvous: {wait:Promise<void>;release:()=>void;arrived:number}|undefined;
const {rpc,ws,h:transport,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!,dir,{deferFinality:true,payerFor: label=>label.startsWith('traffic fill')?fillPayer:undefined,
    async beforeBroadcast(label) {
      if (!rendezvous || !label.startsWith('traffic ')) return;
      const gate=rendezvous;
      if (++gate.arrived===2) gate.release();
      await gate.wait;
    }});
const {h,lanes,members}=coverageProvisioning(transport,payer);
try {
  const setup=await liquidityExecutionSetup(h,rpc,{traderCount:2,independentTraders:true,traderDeposits:[150_000n,1_000_000n],
    marketCheckpoints:true,marginLayout:'ledger-lanes',shape:symmetricPayoutShape,verifyRejections:false});
  const {root,guard,route,withCheckpoints}=executionTestHelpers(h,setup);
  const {venue,registry,markets,ledgers}=setup, [debtor,activeTrader]=setup.roots;
  const owner=setup.traderOwner, maker=setup.instances[3], recipient=maker.capital, scale=1_000_000_000n;
  const common={...setup.common,btc:markets[0],eth:markets[1]};
  const [certificate]=await sdk.deriveSettlementCertificate(venue,1);
  assert.equal(await h.read(certificate),null);
  assert.equal(setup.traderOwners[1].address,fillPayer.address);
  const active=[...setup.roots,...setup.instances.map(item=>item.capital)];
  const [portfolio]=await sdk.deriveAccountPortfolio(venue,owner.address,0);
  const [child]=await sdk.deriveMarginAccount(portfolio,1);
  const initialMakerCash=(await root(recipient)).cash;
  const tokens=async()=>getTokenDecoder().decode((await h.read(maker.token.address))!).amount;
  const initialTokens=await tokens();
  const pool=async()=>sdk.getMarketLedgerDecoder().decode((await h.read(ledgers[1]))!).settlement;
  const credit=async(amount:bigint,account=recipient,marketIndex:0|1=1)=>sdk.directClosedProfitCredit({
    artifactSet:build.artifactSet,actor:payer,margin:await root(account),marketIndex,amount});
  async function financial(ix:Instruction,roots:Address[],checkpoints=true) {
    const prefix=checkpoints?(await withCheckpoints(ix)).slice(0,-1):[];
    return [...prefix,appendCoverage(ix,roots.map(key=>members.get(key)!))];
  }
  async function trade(account:Address,marketIndex:0|1,side:0|1,instance:number,size:bigint,serial=false) {
    const actor=account===debtor?owner:fillPayer, provider=setup.instances[instance];
    const fill=await route({trader:account,actor,marketIndex,side,makers:[provider],lots:[size],marketLane:!serial,minimalMarkets:true});
    return financial(fill,[account,provider.capital],serial);
  }
  async function collect(account:Address,marketIndex:0|1,amount:bigint) {
    const ix=sdk.getCollectAccountLossInstruction({...common,actor:payer,margin:account,marketIndex,amount});
    await h.send('collect '+amount+' loss atoms for market '+marketIndex,await financial(ix,[account]));
  }
  const failures:string[]=[];
  async function refuse(label:string,ixs:Instruction[],error:number) {
    const watched=[...new Set([...active,...markets,...ledgers,...lanes,registry,setup.vault,maker.token.address])];
    const before=await Promise.all(watched.map(h.read));
    await h.send(label,ixs,[],error);
    assert.deepEqual(await Promise.all(watched.map(h.read)),before,label+' changed financial state');
    failures.push(label);
  }
  function replaceLast(ixs:Instruction[],accounts:NonNullable<Instruction['accounts']>) {
    return [...ixs.slice(0,-1),{...ixs.at(-1)!,accounts}];
  }
  async function audit(roots:Address[]) {
    await flush();
    return auditCoverage(rpc,venue,registry,lanes,roots,true,streamed || grouped ? 125 : 16,grouped);
  }
  async function leave() {
    const state=await sdk.readMarginMembership(rpc,venue,owner.address,child,true,setup.identity.marginLayout);
    const ix=sdk.getDeactivateMarginInstruction({...setup.common,...state,owner});
    await h.send('empty member leaves before recovery credit',[appendCoverage({...ix,accounts:[...ix.accounts,...state.remaining]},[members.get(child)!])],[owner]);
  }

  await h.send('open ten ETH lots',await trade(debtor,1,0,3,10n),[owner]);
  await h.send('close ten ETH lots',await trade(debtor,1,1,3,10n),[owner]);
  await h.send('open cross debtor BTC long',await trade(debtor,0,0,0,10n,true),[owner]);
  assert.equal((await root(recipient)).positions[1].virtualScaled,40n*scale);
  await collect(debtor,1,10n);
  assert.equal(await pool(),10n);
  await registerFinancialTestMargin(h,setup.common,payer,{owner,portfolio,margin:child,subaccountIndex:1,mode:1,isolatedMarketIndex:0,role:0});
  const joined=await audit([...active,child]);
  await setup.sample();
  await refuse('request exceeds funded pool',await credit(11n),sdk.CLEARING_ERROR__AMOUNT);
  const cold=await credit(1n), metas=cold.at(-1)!.accounts!, suffix=metas.slice(-8);
  await refuse('credit requires its market checkpoints',[cold.at(-1)!],sdk.CLEARING_ERROR__MARKET_CHECKPOINT);
  assert.deepEqual(suffix.map(meta=>meta.address),lanes);
  assert.deepEqual(suffix.filter(meta=>meta.role===AccountRole.WRITABLE).map(meta=>meta.address),[members.get(recipient)]);
  await refuse('omit one coverage lane',replaceLast(cold,metas.slice(0,-1)),sdk.CLEARING_ERROR__EXIT_COHORT);
  await refuse('substitute another genuine lane',replaceLast(cold,[...metas.slice(0,-1),suffix[0]]),sdk.CLEARING_ERROR__EXIT_COHORT);
  await refuse('recipient lane is read-only',replaceLast(cold,metas.map(meta=>meta.address===members.get(recipient)?
    {...meta,role:AccountRole.READONLY}:meta)),sdk.CLEARING_ERROR__EXIT_COHORT);
  await h.send('cold direct ETH credit after member joins',cold);
  assert.equal(await pool(),9n);
  assert.equal((await root(recipient)).cash,initialMakerCash+1n);
  assert.equal((await root(recipient)).positions[1].virtualScaled,39n*scale);
  assert.equal(await h.read(certificate),null);

  async function move(price:bigint) {
    const keys=[debtor,...lanes], before=await Promise.all(keys.map(h.read));
    setup.sourcePrices.btc=price;
    await setup.qualify();
    assert.deepEqual(await Promise.all(keys.map(h.read)),before);
  }
  await move(40_000_000_000n);
  const idleLoss = 'idle BTC loss blocks funded ETH claim';
  await refuse(idleLoss,await credit(1n),sdk.CLEARING_ERROR__EXIT_COHORT);
  await flush();
  const refusal = checks.find(check=>check.label===idleLoss)!;
  const refused = await rpc.call('getTransaction',[refusal.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
  assert(refused.meta.logMessages.some((line:string)=>/^Program log: coverage target=1 members=9 exact=[1-9]\d* covered=0$/.test(line)));
  assert.equal(await pool(),9n);
  await leave();
  const departed=await audit(active);
  await move(61_000_000_000n);
  await collect(setup.instances[0].capital,0,1n);
  await refuse('open BTC profit cannot use funded BTC pool',await credit(1n,debtor,0),sdk.CLEARING_ERROR__AMOUNT);
  const lastBtc=await setup.marketState(0);
  for(let rounds=0;await setup.slot()<lastBtc.validUntil && await setup.now()<lastBtc.oracle.sourceDeadline;rounds++) {
    assert(rounds<25);await setup.sample([1]);
  }
  await refuse('stale BTC blocks funded ETH claim',await credit(1n),sdk.CLEARING_ERROR__ORACLE_POLICY);
  await move(60_000_000_000n);
  await h.send('recovered direct ETH credit after member leaves',await credit(1n));
  assert.equal(await pool(),8n);
  await collect(debtor,1,30n);
  assert.equal(await pool(),38n);

  // Matched controls use the same two issuers, size, alternating direction and funded claim.
  const pairs: {mode:string;fill:string;credit:string}[]=[];
  for (const mode of ['sequential','simultaneous']) {
    for(let round=0;round<4;round++) {
      await setup.sample();
      const [fill,claim]=await Promise.all([trade(activeTrader,0,round%2 as 0|1,1,1n),credit(1n)]);
      const labels={mode,fill:'traffic fill '+mode+' '+round,credit:'traffic credit '+mode+' '+round};
      const cash=(await root(recipient)).cash, balance=await pool();
      const sendFill=()=>h.send(labels.fill,fill,[fillPayer]);
      const sendCredit=()=>h.send(labels.credit,claim);
      if(mode==='sequential') {await sendFill();await sendCredit();}
      else {
        let release!:()=>void;
        const wait=new Promise<void>(resolve=>{release=resolve;});
        rendezvous={wait,release,arrived:0};
        let timedOut=false;
        const timeout=setTimeout(()=>{timedOut=true;release();},10_000);
        try {
          await Promise.all([sendFill(),sendCredit()]);
          assert.equal(timedOut,false);
          assert.equal(rendezvous.arrived,2);
        } finally {clearTimeout(timeout);rendezvous=undefined;}
      }
      assert.equal((await root(recipient)).cash,cash+1n);
      assert.equal(await pool(),balance-1n);
      pairs.push(labels);
    }
  }
  assert.equal(await pool(),30n);
  await h.send('credit remaining thirty atoms',await credit(30n));
  assert.equal(await pool(),0n);
  assert.equal((await root(recipient)).cash,initialMakerCash+40n);
  assert.equal((await root(recipient)).positions[1].virtualScaled,0n);
  const withdraw=sdk.getWithdrawFundedAccountInstruction({...common,owner:maker.owner,margin:recipient,
    userToken:maker.token.address,quoteMint:setup.mint.address,guard:await guard(recipient),amount:40n});
  await h.send('maker withdraws forty credited atoms to its token account',await financial(withdraw,[recipient]),[maker.owner]);
  assert.equal(await tokens(),initialTokens+40n);assert.equal((await root(recipient)).cash,initialMakerCash);
  assert.equal(await h.read(certificate),null);
  const final=await audit(active);
  const receipt=async(label:string)=>{
    const row=checks.find(item=>item.label===label)!;
    const tx=await rpc.call('getTransaction',[row.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    const {accountKeys,header}=tx.transaction.message;
    // This workload uses static keys. Reject an unmeasured address-table lock.
    assert.equal((tx.meta.loadedAddresses?.readonly.length??0)+(tx.meta.loadedAddresses?.writable.length??0),0);
    const locks=new Map<string,boolean>(accountKeys.map((key:string,index:number)=>[key,index<header.numRequiredSignatures?
      index<header.numRequiredSignatures-header.numReadonlySignedAccounts:index<accountKeys.length-header.numReadonlyUnsignedAccounts]));
    return {row,slot:tx.slot,payer:accountKeys[0],locks};
  };
  const traffic=[];
  for(const pair of pairs) {
    const [fill,claim]=await Promise.all([receipt(pair.fill),receipt(pair.credit)]);
    assert.notEqual(fill.payer,claim.payer);
    const conflicts=[...fill.locks].filter(([key,write])=>claim.locks.has(key)&&(write||claim.locks.get(key))).map(([key])=>key);
    const laneConflicts=lanes.filter(key=>conflicts.includes(key));
    assert(laneConflicts.includes(members.get(activeTrader)!) && laneConflicts.includes(members.get(setup.instances[1].capital)!));
    traffic.push({mode:pair.mode,fill:fill.row,credit:claim.row,slots:[fill.slot,claim.slot],conflicts,laneConflicts});
  }
  const coldReceipt=(await receipt('cold direct ETH credit after member joins')).row;
  const journal=await openSettlementJournal(rpc,setup,checks.map(row=>String(row.signature)),build);
  const replay=await journal.finish();
  writeFileSync(dir+'/direct-credit.json',json({revision,program:build.revision,joined,departed,final,failures,coldReceipt,
    creditAtoms:40,withdrawnAtoms:40,events:replay.events,traffic}));
  console.log('Direct credit and SPL withdrawal verified;',replay.events,'replayed events.');
} finally {await ws.close();}
