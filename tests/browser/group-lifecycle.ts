/** P21B real Wallet Standard/browser checkpoint; not the concurrent workload. */
import assert from 'node:assert/strict';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {writeFileSync,readFileSync,openSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright-core';
import {VersionedTransaction} from '@solana/web3.js';
import {getCreateAccountInstruction,getTransferSolInstruction} from '@solana-program/system';
import {TOKEN_PROGRAM_ADDRESS,getInitializeAccount3Instruction,getMintToInstruction} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {GroupIndexer,type GroupConfig} from '../../packages/indexer/src/group-indexer.js';
import {groupApi} from '../../packages/indexer/src/group-api.js';
import {GroupRuntime} from '../../packages/services/src/group-runtime.js';
import {groupServiceApi} from '../../packages/services/src/group-service-api.js';
import {json} from '../../packages/indexer/src/events.js';
import {groupRuntimeHarness} from '../rpc-contract/group-runtime-harness.js';
import {groupSafetyCases} from '../rpc-contract/group-safety-cases.js';
import {fixtureKey} from '../rpc-contract/custody-cases.js';

const directory=process.env.RIVALT_RUN_DIR!,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()),startedDirty=dirty();
execFileSync('python3',['ops/check-ports.py','18093','18094','18095']);
const transport=await groupRuntimeHarness(process.env.RIVALT_RPC_URL!,directory),h=transport.harness;
const setup=await groupSafetyCases(h,async()=>{},{namespace:'p21-browser',setupOnly:true}),fixture=setup.fixture;
await setup.certificate();await transport.send('activate qualified browser group',[sdk.getActivateCrossGroupV2Instruction({...fixture.safety,authority:fixture.payer})]);
const owner=await fixtureKey('p21-browser-owner'),other=await fixtureKey('p21-browser-other'),token=await fixtureKey('p21-browser-token');
await transport.send('browser test SOL and owned test collateral',[getTransferSolInstruction({source:fixture.payer,destination:owner.address,amount:1_000_000_000n}),
  getTransferSolInstruction({source:fixture.payer,destination:other.address,amount:50_000_000n}),
  getCreateAccountInstruction({payer:fixture.payer,newAccount:token,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
  getInitializeAccount3Instruction({account:token.address,mint:fixture.mint.address,owner:owner.address}),
  getMintToInstruction({mint:fixture.mint.address,token:token.address,mintAuthority:fixture.payer,amount:10_000_000n})],[token]);
await transport.finalize();
const anchor=transport.checks.find(check=>check.label==='setup clearing group')!.signature;
const config:GroupConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
  runId:'p21-browser',group:fixture.group,anchor,profile:'cross-safety-qualification'};
const indexer=new GroupIndexer(config),runtime=new GroupRuntime(config.databaseUrl,config.runId,config.rpcUrl);
let replay:GroupIndexer|undefined,vite:ChildProcess|undefined,readApp:ReturnType<typeof groupApi>|undefined,executionApp:ReturnType<typeof groupServiceApi>|undefined;
let stopping=false,indexing:Promise<void>|undefined,executing:Promise<void>|undefined,making:Promise<void>|undefined;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
  args:['--disable-background-networking','--disable-component-update','--no-first-run']});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
page.setDefaultTimeout(12_000);
const errors:string[]=[],walletWires:string[]=[],checks:string[]=[],outcomes:any[]=[],unsignedRefusals:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
async function wait<T>(read:()=>Promise<T>,accept:(value:T)=>boolean,label:string,milliseconds=20_000){
  const deadline=Date.now()+milliseconds;let last:unknown;
  while(Date.now()<deadline){try{const value=await read();last=value;if(accept(value))return value;}catch(error){last=error;}await delay(100);}
  throw new Error(`${label}: ${last instanceof Error?last.message:JSON.stringify(last)}`);
}
const record=(check:string)=>{checks.push(check);console.log(json({stage:'group-browser-check',check}));};
const receipts=()=>page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('rivalt:receipts:v2:')).flatMap(([,value])=>JSON.parse(value))) as Promise<sdk.SignedIntent[]>;
const button=(name:string)=>{
  const locator=page.getByRole('button',{name,exact:true});
  return name==='Cancel pair'?locator.first():locator;
};
const review=()=>page.getByRole('region',{name:'Review transaction'});
async function action(name:string){
  const before=walletWires.length;
  await button(name).click();
  await wait(async()=>({visible:await review().isVisible(),alerts:await page.getByRole('alert').allTextContents()}),value=>value.visible||value.alerts.length>0,`${name} preview`);
  assert(await review().isVisible(),`${name}: ${await page.getByRole('alert').allTextContents()}`);
  await button('Sign transaction').click();
  await wait(async()=>walletWires.length,count=>count===before+1,`${name} wallet signature`);
  const wire=walletWires.at(-1)!;
  const original=await wait(receipts,values=>values.some(value=>value.wire===wire&&['finalized','failed'].includes(value.status)),`${name} original finality`);
  const receipt=original.find(value=>value.wire===wire)!;assert.equal(receipt.status,'finalized',`${name}: ${receipt.error}`);
  const transaction=await transport.rpc.call('getTransaction',[receipt.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  assert.equal(transaction.transaction[0],wire);assert.equal(transaction.meta.err,null);
  outcomes.push({label:receipt.label,signature:receipt.signature,fee:transaction.meta.fee,units:transaction.meta.computeUnitsConsumed,bytes:Buffer.from(wire,'base64').length});
  writeFileSync(`${directory}/wallet-finalized-${outcomes.length}.json`,json(transaction));
  await button('Refresh').click();await delay(150);
}
try{
  await indexer.open();await indexer.cycle();await runtime.open();const {binding}=await indexer.store.snapshot();
  const publicConfig:sdk.GroupUserConfig={version:2,chain:'solana:localnet',profile:'cross-safety-qualification',rpcUrl:config.rpcUrl,wsUrl:config.wsUrl,
    genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,group:fixture.group,mint:fixture.mint.address,domain:binding.domain};
  const client=new sdk.GroupUserClient(publicConfig),configPath=resolve(directory,'trader-public.json');writeFileSync(configPath,json(publicConfig));
  readApp=groupApi(indexer);executionApp=groupServiceApi(runtime);await readApp.listen({host:'127.0.0.1',port:18094});await executionApp.listen({host:'127.0.0.1',port:18095});
  indexing=(async()=>{while(!stopping){try{await indexer.cycle();}catch{/* Moving chain snapshots retry; never fabricate a healthy checkpoint. */}await delay(350);}})();
  executing=(async()=>{while(!stopping){await runtime.execute();await delay(150);}})();
  making=(async()=>{while(!stopping){
    for(const marketIndex of [0,1] as const)for(const makerId of [0,1] as const){
      try{await runtime.maker(marketIndex,makerId,fixture.operators[makerId+1].owner);}catch{/* A changing unsigned snapshot retries; originals stay in the queue. */}
    }
    await delay(500);
  }})();
  const log=openSync(`${directory}/vite.log`,'w');vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','18093','--strictPort'],{
    cwd:resolve('apps/trader'),env:{...process.env,RIVALT_TRADER_CONFIG:configPath,RIVALT_SERVICE_ORIGIN:'http://127.0.0.1:18095',RIVALT_INDEXER_ORIGIN:'http://127.0.0.1:18094'},stdio:['ignore',log,log]});closeSync(log);
  const keys=[owner,other];
  await context.exposeBinding('rivaltSign',async(_,input:{index:number;wire:number[]})=>{
    const key=keys[input.index];assert(key);const transaction=VersionedTransaction.deserialize(Uint8Array.from(input.wire));
    assert.equal(transaction.message.staticAccountKeys[0].address,key.address);assert.equal(transaction.signatures.length,1);
    await transaction.sign([key]);walletWires.push(Buffer.from(transaction.serialize()).toString('base64'));return [...transaction.serialize()];
  });
  const walletSource=stripTypeScriptTypes(readFileSync('tests/browser/wallet.ts','utf8').replace('export function installWallet','function installWallet'));
  await context.addInitScript({content:walletSource+'\ninstallWallet('+JSON.stringify(keys.map(key=>({address:key.address,publicKey:[...key.publicKey.toBytes()]})))+');'});
  await wait(()=>fetch('http://127.0.0.1:18093/rivalt-config.json').then(response=>response.status),status=>status===200,'owned browser server');
  await page.goto('http://127.0.0.1:18093');await button('Select Wallet').click();await page.getByRole('button',{name:/Rivalt Test Wallet/}).click();
  await action('Create portfolio');await action('Register account');
  const [portfolio]=await sdk.findGroupPortfolioPda({group:fixture.group,owner:owner.address,index:0});
  const [cross]=await sdk.findMarginPda({portfolio,subaccountIndex:0}),[isolated]=await sdk.findMarginPda({portfolio,subaccountIndex:2});
  assert.equal((await client.ownerPortfolio(owner.address)).account?.children,1);record('empty portfolio discovery and immutable cross registration through the wallet');
  await action('Deposit');assert.equal((await client.snapshot()).roots[cross].cash,1_000_000n);
  const beforeRejection=walletWires.length;await button('Deposit').click();await review().waitFor();await page.evaluate(()=>(window as any).rivaltWallet.reject());await button('Sign transaction').click();
  await page.getByText('Signature declined or wallet unavailable. Nothing was sent.',{exact:true}).waitFor();assert.equal(walletWires.length,beforeRejection);record('declined wallet signature sends nothing');
  await button('Deposit').click();await review().waitFor();await page.evaluate(()=>(window as any).rivaltWallet.switch(1));
  await wait(()=>review().isVisible(),visible=>!visible,'wallet switch clears review');assert.equal(walletWires.length,beforeRejection);
  await page.evaluate(()=>(window as any).rivaltWallet.switch(0));await wait(()=>button('Deposit').isEnabled(),Boolean,'original wallet restored');
  await button('Deposit').click();await review().waitFor();await page.getByLabel('Margin account',{exact:true}).selectOption('2');
  await wait(()=>review().isVisible(),visible=>!visible,'account switch clears review');assert.equal(walletWires.length,beforeRejection);record('wallet and account switches invalidate unsigned reviews');
  await action('Register account');await action('Deposit');assert.equal((await client.snapshot()).roots[isolated].cash,1_000_000n);
  record('isolated ETH registration/deposit uses a separate funded balance');
  await page.getByLabel('Margin account',{exact:true}).selectOption('0');
  async function trade(marketIndex:0|1,side:0|1){
    await page.getByLabel('Market',{exact:true}).selectOption(String(marketIndex));await page.getByLabel('Side',{exact:true}).selectOption(String(side));
    await page.getByLabel(side===0?'Maximum all-in spend (test USD)':'Minimum all-in proceeds (test USD)',{exact:true}).fill(side===0?'1':'0.000001');
    await fixture.qualify();await action('Review atomic trade');
  }
  await trade(0,0);await trade(1,0);
  let state=await client.snapshot();assert.deepEqual(state.roots[cross].positions.map(position=>position.lots),[5n,5n]);assert.equal(state.roots[isolated].cash,1_000_000n);
  record('cross BTC/ETH fills share one cash balance and leave isolated sibling untouched');
  await page.getByLabel('Market',{exact:true}).selectOption('0');await page.getByText('Protect existing position',{exact:true}).click();await fixture.qualify();await action('Review TP/SL');
  state=await client.snapshot();assert.equal(state.roots[cross].book.orders.filter(entry=>[1,2].includes(entry.order.state)&&entry.order.groupId>0n).length,2);
  await action('Cancel pair');record('existing-position TP/SL shares its allowance and cancels through direct RPC');
  await trade(0,1);await trade(1,1);assert((await client.snapshot()).roots[cross].positions.every(position=>position.lots===0n));
  await page.getByLabel('Margin account',{exact:true}).selectOption('2');await page.getByLabel('Side',{exact:true}).selectOption('0');await page.getByLabel('Maximum all-in spend (test USD)',{exact:true}).fill('1');
  await fixture.qualify();await action('Review atomic trade');await page.getByLabel('Side',{exact:true}).selectOption('1');await page.getByLabel('Minimum all-in proceeds (test USD)',{exact:true}).fill('0.000001');
  await fixture.qualify();await action('Review atomic trade');assert((await client.snapshot()).roots[isolated].positions.every(position=>position.lots===0n));
  record('both account modes open and close via immutable service ingress and original RPC receipts');
  await page.getByLabel('Margin account',{exact:true}).selectOption('0');
  await page.getByLabel('Collateral amount',{exact:true}).fill('0.000007');await page.getByLabel('Allocate to account',{exact:true}).selectOption(isolated);
  const beforeAllocation=await client.snapshot();
  for(let attempt=0;;attempt++){
    assert(attempt<4);await action('Allocate collateral');state=await client.snapshot();if(state.roots[cross].cash!==beforeAllocation.roots[cross].cash)break;
  }
  assert.equal(state.roots[cross].cash,beforeAllocation.roots[cross].cash-7n);assert.equal(state.roots[isolated].cash,beforeAllocation.roots[isolated].cash+7n);
  record('explicit allocation debits donor once after a separate complete-group proof');
  // Place an untriggered BTC stop for actual stale cancellation; no synthetic fill.
  await page.getByLabel('Market',{exact:true}).selectOption('0');
  await page.getByText('Persistent limit / stop-limit',{exact:true}).click();await page.getByLabel('Side',{exact:true}).selectOption('0');
  await page.getByLabel('Trigger',{exact:true}).selectOption('1');await page.getByLabel('Trigger price',{exact:true}).fill('100000');
  await fixture.qualify();await action('Review persistent order');
  const placed=(await client.snapshot()).roots[cross].book.orders.find(entry=>[1,2].includes(entry.order.state))!.order;
  assert.equal(placed.generation,0n);
  await page.getByLabel('Order to replace',{exact:true}).selectOption(String(placed.id));
  await page.getByLabel('Limit price (test USD per unit)',{exact:true}).fill('59000');
  await fixture.qualify();await action('Review replacement');
  const replaced=(await client.snapshot()).roots[cross].book.orders.find(entry=>entry.order.id===placed.id)!.order;
  assert.equal(replaced.version,placed.version+1n);assert.equal(replaced.generation,0n);assert.equal(replaced.limit,59000n);
  assert.equal(replaced.filled,placed.filled);assert.equal(replaced.feeCharged,placed.feeCharged);
  record('post-close persistent order uses zero generation and replacement preserves fee/fill prefixes');
  const beforeStale=(await client.snapshot()).roots[cross];await h.advance(21n);await button('Refresh').click();
  const beforeUnsafe=walletWires.length;await button('Review atomic trade').click();
  await wait(()=>page.getByRole('alert').allTextContents(),alerts=>alerts.length>0,'stale route refusal');assert(!await review().isVisible());assert.equal(walletWires.length,beforeUnsafe);
  unsignedRefusals.push(...await page.getByRole('alert').allTextContents());
  await readApp.close();readApp=undefined;await executionApp.close();executionApp=undefined;
  await action('Cancel order');assert.equal((await client.snapshot()).roots[cross].cash,beforeStale.cash);
  record('stale route refused without signing; API-stopped stale cancellation remains available');
  await page.getByLabel('Collateral amount',{exact:true}).fill('0.000001');
  const beforeExit=await client.snapshot(),initialToken=(await client.walletTokens(owner.address)).find(value=>value.address===token.address)!.amount;
  for(const [selection,margin] of [[0,cross],[2,isolated]] as const){
    await page.getByLabel('Margin account',{exact:true}).selectOption(String(selection));
    for(let attempt=0;;attempt++){
      assert(attempt<4);await action('Withdraw');state=await client.snapshot();if(state.roots[margin].cash===beforeExit.roots[margin].cash-1n)break;
    }
  }
  assert.equal(state.actualVault,beforeExit.actualVault-2n);assert.equal((await client.walletTokens(owner.address))[0].amount,initialToken+2n);
  record('both flat accounts withdraw actual funded tokens with prices stale and both APIs stopped');
  await page.reload();await wait(()=>page.getByTestId('group-cash').textContent(),value=>value!==null&&value!=='—','reload direct account view');
  assert.equal((await receipts()).length,walletWires.length);record('reload retains every original wallet signature');
  await page.screenshot({path:`${directory}/desktop.png`,fullPage:true});await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:`${directory}/mobile-viewport.png`});
  await page.screenshot({path:`${directory}/mobile.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile page does not overflow');
  stopping=true;await indexing;await executing;await making;
  await wait(async()=>{await runtime.execute();return runtime.queue.pending();},pending=>pending.length===0,'all service originals drain');
  await transport.finalize();await indexer.cycle();const final=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  await indexer.store.pool.query('CREATE DATABASE rivalt_p21_browser_replay');const replayUrl=new URL(config.databaseUrl);replayUrl.pathname='/rivalt_p21_browser_replay';
  replay=new GroupIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p21-browser-replay'});await replay.open();await replay.cycle();assert.deepEqual((await replay.store.snapshot()).state,final.state);await replay.reconcile();
  assert.deepEqual(errors,[]);assert(outcomes.every(outcome=>outcome.bytes<=1232));
  const captures:Record<string,string|null>={};for(const key of [fixture.group,fixture.registry,fixture.vault,fixture.resolution,...fixture.markets,...fixture.roots,cross,isolated,token.address])captures[key]=(await h.read(key))?.toString('base64')??null;
  writeFileSync(`${directory}/final-accounts.json`,json(captures));
  const finishedRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  writeFileSync(`${directory}/summary.json`,json({revision,finishedRevision,trackedDirty:startedDirty||dirty()||revision!==finishedRevision,
    scope:'P21B wallet/browser checkpoint; continuous mixed-market workload and final qualification still pending',binding,checks,outcomes,unsignedRefusals,
    keys:{group:fixture.group,registry:fixture.registry,vault:fixture.vault,resolution:fixture.resolution,markets:fixture.markets,roots:[...fixture.roots,cross,isolated],cross,isolated,token:token.address},
    reconciliation,freshReplay:true,ws:indexer.metrics.notifications,fixtureOutcomes:transport.checks.map(({history,...check})=>check)}));
  const audit=execFileSync('python3',['tests/financial/group-browser-reference.py',directory],{encoding:'utf8'});
  writeFileSync(`${directory}/independent-audit.json`,audit);console.log(audit.trim());
  console.log(json({stage:'group-browser-pass',checks:checks.length,walletTransactions:outcomes.length,reconciliation}));
}catch(error){
  writeFileSync(`${directory}/browser-failure.json`,json({error:String(error),checks,outcomes,unsignedRefusals,errors,walletWires}));
  await page.screenshot({path:`${directory}/failure.png`,fullPage:true}).catch(()=>{});throw error;
}finally{
  stopping=true;await Promise.allSettled([indexing,executing,making]);await browser.close();await readApp?.close();await executionApp?.close();
  vite?.kill('SIGTERM');await replay?.close();await indexer.close();await runtime.close();
}
