/** P28 Wallet Standard qualification against the live schema-3 stack. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {writeFileSync,readFileSync,openSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright-core';
import {VersionedTransaction} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {accountApi} from '../../packages/indexer/src/account-api.js';
import {json} from '../../packages/indexer/src/events.js';
import type {AccountQualificationEnvironment, BrowserAccounts} from './account-environment.js';

export async function accountBrowser(environment:AccountQualificationEnvironment):Promise<BrowserAccounts> {
  const {directory,setup,transport,client,endpoint}=environment;
  const readApp=accountApi(environment.indexer());
  const readEndpoint=await readApp.listen({host:'127.0.0.1',port:0});
  const configPath=resolve(directory,'trader-public.json');writeFileSync(configPath,json(client.config));
  let vite:ChildProcess|undefined;
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
    args:['--disable-background-networking','--disable-component-update','--no-first-run']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors:string[]=[],walletWires:string[]=[],checks:string[]=[],outcomes:unknown[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  async function wait<Value>(read:()=>Promise<Value>,accept:(value:Value)=>boolean,label:string,milliseconds=25_000) {
    const deadline=Date.now()+milliseconds;let last:Value|undefined;
    while(Date.now()<deadline){last=await read();if(accept(last))return last;await delay(100);}
    throw new Error(`${label}: ${json(last)}`);
  }
  const record=(check:string)=>{checks.push(check);console.log(json({stage:'account-browser-check',check}));};
  const receipts=()=>page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('rivalt:receipts:v3:')).flatMap(([,value])=>JSON.parse(value))) as Promise<sdk.SignedIntent[]>;
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  const review=()=>page.getByRole('region',{name:'Review transaction'});
  async function action(name:string) {
    const before=walletWires.length;await button(name).first().click();
    await wait(async()=>({visible:await review().isVisible(),alerts:await page.getByRole('alert').allTextContents()}),value=>value.visible||value.alerts.length>0,`${name} preview`);
    assert(await review().isVisible(),`${name}: ${await page.getByRole('alert').allTextContents()}`);
    await button('Sign transaction').click();await wait(async()=>walletWires.length,count=>count===before+1,`${name} wallet signature`);
    const wire=walletWires.at(-1)!;
    const items=await wait(receipts,items=>items.some(item=>item.wire===wire&&['failed','finalized'].includes(item.status)),`${name} original finality`);
    const receipt=items.find(item=>item.wire===wire)!;assert.equal(receipt.status,'finalized',`${name}: ${receipt.error}`);
    const transaction=await transport.rpc.call('getTransaction',[receipt.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(transaction.transaction[0],wire);assert.equal(transaction.meta.err,null);
    outcomes.push({label:receipt.label,signature:receipt.signature,fee:transaction.meta.fee,units:transaction.meta.computeUnitsConsumed,bytes:Buffer.from(wire,'base64').length});
    writeFileSync(`${directory}/browser-finalized-${outcomes.length}.json`,json(transaction));
    await button('Refresh').click();await delay(200);
  }
  const select=async(label:string,value:string)=>{await page.getByLabel(label,{exact:true}).selectOption(value);await delay(250);};
  try {
    const log=openSync(`${directory}/vite.log`,'w');
    vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','18093','--strictPort'],{
      cwd:resolve('apps/trader'),env:{...process.env,RIVALT_TRADER_CONFIG:configPath,RIVALT_SERVICE_ORIGIN:endpoint,RIVALT_INDEXER_ORIGIN:readEndpoint},stdio:['ignore',log,log]});closeSync(log);
    const keys=[setup.owner,setup.operators[1].owner];
    await context.exposeBinding('rivaltSign',async(_,input:{index:number;wire:number[]})=>{
      const key=keys[input.index];assert(key);const transaction=VersionedTransaction.deserialize(Uint8Array.from(input.wire));
      assert.equal(transaction.message.staticAccountKeys[0].address,key.address);assert.equal(transaction.signatures.length,1);
      await transaction.sign([key]);walletWires.push(Buffer.from(transaction.serialize()).toString('base64'));return [...transaction.serialize()];
    });
    const walletSource=stripTypeScriptTypes(readFileSync('tests/browser/wallet.ts','utf8').replace('export function installWallet','function installWallet'));
    await context.addInitScript({content:walletSource+'\ninstallWallet('+JSON.stringify(keys.map(key=>({address:key.address,publicKey:[...key.publicKey.toBytes()]})))+');'});
    await wait(()=>fetch('http://127.0.0.1:18093/rivalt-config.json').then(response=>response.status).catch(()=>0),code=>code===200,'owned trader server');
    await page.goto('http://127.0.0.1:18093');await button('Select Wallet').click();await page.getByRole('button',{name:/Rivalt Test Wallet/}).click();
    await select('Portfolio','1');await action('Create portfolio');await action('Register account');
    const [portfolio]=await sdk.deriveAccountPortfolio(setup.venue,setup.owner.address,1),[cross]=await sdk.findMarginV3Pda(portfolio,0),[isolated]=await sdk.findMarginV3Pda(portfolio,1);
    setup.roots.push(cross);await action('Deposit');assert.equal((await client.snapshot([cross])).roots[cross].cash,1_000_000n);
    await wait(()=>page.getByTestId('account-cash').textContent(),value=>value==='1','exact finalized funded cash display');
    record('portfolio one discovery, immutable cross registration and actual deposit');
    const prior=walletWires.length;await button('Deposit').click();await review().waitFor();await page.evaluate(()=>(window as any).rivaltWallet.reject());await button('Sign transaction').click();
    await page.getByText('Signature declined or wallet unavailable. Nothing was sent.',{exact:true}).waitFor();assert.equal(walletWires.length,prior);
    await button('Deposit').click();await review().waitFor();await page.evaluate(()=>(window as any).rivaltWallet.switch(1));
    await wait(()=>review().isVisible(),visible=>!visible,'wallet switch invalidates review');assert.equal(walletWires.length,prior);
    await page.evaluate(()=>(window as any).rivaltWallet.switch(0));await wait(()=>button('Deposit').isEnabled(),Boolean,'original owner restored');
    await button('Deposit').click();await review().waitFor();await select('Market','1');assert(!await review().isVisible());
    record('wallet decline, wallet switch and selected-market change invalidate unsigned review');
    await select('Margin account','1');await action('Register account');setup.roots.push(isolated);await action('Deposit');
    assert.equal((await client.snapshot([isolated])).roots[isolated].isolatedMarketIndex,1);
    await page.getByLabel('Collateral amount',{exact:true}).fill('0.000017');await select('Allocate to account',cross);await action('Allocate collateral');
    assert.equal((await client.snapshot([isolated])).roots[isolated].cash,999_983n);record('isolated ETH registration and explicit atomic cash allocation');
    await select('Margin account','0');await select('Market','0');await environment.normal();
    await action('Review atomic trade');assert.equal((await client.snapshot([cross])).roots[cross].positions[0].lots,5n);
    await select('Market','1');await action('Review atomic trade');assert.equal((await client.snapshot([cross])).roots[cross].positions[1].lots,5n);
    await wait(()=>page.getByTestId('group-position-1').textContent(),value=>value==='0.00005','exact ETH position display');
    await wait(()=>page.locator('section').filter({has:page.getByRole('heading',{name:'Recent finalized fills',exact:true})}).locator('tbody tr').count(),count=>count>=2,'latest authenticated fill history');
    record('one cross account trades BTC and ETH using authenticated direct SDK routes');
    await page.getByText('Protect existing position',{exact:true}).click();await action('Review TP/SL');
    let current=(await client.snapshot([cross])).roots[cross];assert.equal(current.book.orders.filter(entry=>[1,2].includes(entry.order.state)).length,2);
    await action('Cancel pair');record('existing-position TP/SL shared allowance and direct pair cancellation');
    await page.getByText('Account authority',{exact:true}).click();await page.getByLabel('Delegate public address',{exact:true}).fill(setup.operators[1].owner.address);
    await action('Review delegate');await action('Revoke delegate');record('explicit account delegate and revocation');
    // Close only held quantities; preserve any unpaid closed claims.
    await select('Side','1');await page.getByLabel('Minimum all-in proceeds (test USD)',{exact:true}).fill('0.000001');await page.getByLabel('Reduce only',{exact:true}).check();
    await action('Review atomic trade');await select('Market','0');await action('Review atomic trade');
    await page.getByLabel('Reduce only',{exact:true}).uncheck();await select('Side','0');
    await page.getByText('Persistent limit / stop-limit',{exact:true}).click();await page.getByLabel('Limit price (test USD per unit)',{exact:true}).fill('10000');
    await action('Review persistent order');
    await page.route('**/api/**',route=>route.abort());await page.route('**/read/**',route=>route.abort());
    await action('Cancel order');await page.getByLabel('Collateral amount',{exact:true}).fill('0.000005');await action('Withdraw');
    await page.reload();await wait(async()=>await receipts(),items=>items.length===walletWires.length&&items.every(item=>item.status==='finalized'),'saved original recovery after reload');
    assert.equal(await page.getByLabel('Portfolio',{exact:true}).inputValue(),'1');
    await wait(()=>page.getByTestId('account-cash').textContent(),value=>Boolean(value&&value!=='—'),'RPC account display restored with API blocked');
    record('API-independent cancellation/atomic withdrawal, retained selection and persisted original receipts');
    assert.equal(errors.length,0,errors.join('\n'));
    await page.screenshot({path:`${directory}/account-ui.png`,fullPage:true});
    writeFileSync(`${directory}/browser-summary.json`,json({checks,outcomes,errors,wireCount:walletWires.length,accounts:{cross,isolated}}));
    return {cross,isolated};
  } catch(error) {
    await page.screenshot({path:`${directory}/browser-failure.png`,fullPage:true}).catch(()=>{});
    writeFileSync(`${directory}/browser-failure.json`,json({error:String(error),alerts:await page.getByRole('alert').allTextContents(),checks,outcomes,errors}));throw error;
  } finally {await browser.close();await readApp.close();vite?.kill('SIGTERM');}
}
