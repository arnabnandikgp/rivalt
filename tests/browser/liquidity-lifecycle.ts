/** Internal Wallet Standard signer against the real profile-4 deployment. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {writeFileSync,readFileSync,openSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright-core';
import {VersionedTransaction,type Keypair} from '@solana/web3.js';
import type * as sdk from '@rivalt/sdk';
import type {LiquidityIndexer} from '../../packages/indexer/src/liquidity-indexer.js';
import {accountApi} from '../../packages/indexer/src/account-api.js';
import {json} from '../../packages/indexer/src/events.js';

export async function liquidityBrowser(input:{directory:string;client:sdk.LiquidityUserClient;owner:Keypair;
  endpoint:string;indexer:LiquidityIndexer;normal():Promise<unknown>}) {
  const {directory,client,owner}=input,readApp=accountApi(input.indexer);
  const readEndpoint=await readApp.listen({host:'127.0.0.1',port:0});
  const publicPath=resolve(directory,'trader-public.json');writeFileSync(publicPath,json(client.config));
  let vite:ChildProcess|undefined;
  const browser=await chromium.launch({...(process.env.RIVALT_CHROME_PATH?{executablePath:process.env.RIVALT_CHROME_PATH}:{}),headless:true,
    args:['--disable-background-networking','--disable-component-update','--no-first-run']});
  const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'}),page=await context.newPage();
  page.setDefaultTimeout(20_000);
  const wires:string[]=[],outcomes:unknown[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  const receipts=()=>page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('rivalt:receipts:v4:'))
    .flatMap(([,value])=>JSON.parse(value))) as Promise<sdk.SignedIntent[]>;
  async function wait<Value>(read:()=>Promise<Value>,accept:(value:Value)=>boolean,label:string) {
    const deadline=Date.now()+30_000;let last:Value|undefined;
    while(Date.now()<deadline){last=await read();if(accept(last))return last;await delay(100);}
    throw new Error(`${label}: ${json(last)}`);
  }
  async function action(name:string) {
    const before=wires.length;await button(name).first().click();
    await wait(async()=>({review:await page.getByRole('region',{name:'Review transaction'}).isVisible(),alerts:await page.getByRole('alert').allTextContents()}),
      value=>value.review||value.alerts.length>0,`${name} review`);
    assert(await page.getByRole('region',{name:'Review transaction'}).isVisible(),`${name}: ${await page.getByRole('alert').allTextContents()}`);
    await button('Sign transaction').click();await wait(async()=>wires.length,value=>value===before+1,`${name} signature`);
    const wire=wires.at(-1)!,items=await wait(receipts,values=>values.some(value=>value.wire===wire&&['failed','finalized'].includes(value.status)),`${name} finality`);
    const receipt=items.find(value=>value.wire===wire)!;assert.equal(receipt.status,'finalized',json(receipt));
    const fetched=await client.rpc.call('getTransaction',[receipt.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(fetched.transaction[0],wire);assert.equal(fetched.meta.err,null);
    outcomes.push({label:receipt.label,signature:receipt.signature,fee:fetched.meta.fee,units:fetched.meta.computeUnitsConsumed,bytes:Buffer.from(wire,'base64').length});
    writeFileSync(`${directory}/browser-finalized-${outcomes.length}.json`,json(fetched));
    await button('Refresh').click();
    await wait(()=>page.getByRole('main').getAttribute('aria-busy'),value=>value==='false','refresh completed');
  }
  const select=async(label:string,value:string)=>{
    await page.getByLabel(label,{exact:true}).selectOption(value);
    if(label==='Side')await page.getByLabel(value==='0'?'Maximum all-in spend (test USD)':'Minimum all-in proceeds (test USD)',{exact:true}).waitFor();
    if(label==='Market')await wait(()=>page.getByLabel(/^Quantity \(/).inputValue(),quantity=>quantity===(value==='0'?'0.000005':'0.00005'),'market quantity updated');
    if(label==='Margin account')await wait(()=>page.getByLabel('Market',{exact:true}).isDisabled(),Boolean,'isolated account loaded');
    await wait(()=>button('Review atomic trade').isEnabled(),Boolean,'selected account ready');
  };
  try {
    const log=openSync(`${directory}/vite.log`,'w');
    vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','18093','--strictPort'],{
      cwd:resolve('apps/trader'),env:{...process.env,RIVALT_TRADER_CONFIG:publicPath,RIVALT_SERVICE_ORIGIN:input.endpoint,RIVALT_INDEXER_ORIGIN:readEndpoint},stdio:['ignore',log,log]});closeSync(log);
    await context.exposeBinding('rivaltSign',async(_,request:{index:number;wire:number[]})=>{
      assert.equal(request.index,0);const transaction=VersionedTransaction.deserialize(Uint8Array.from(request.wire));
      assert.equal(transaction.message.staticAccountKeys[0].address,owner.address);assert.equal(transaction.signatures.length,1);
      await transaction.sign([owner]);const wire=transaction.serialize();wires.push(Buffer.from(wire).toString('base64'));return [...wire];
    });
    const source=stripTypeScriptTypes(readFileSync('tests/browser/wallet.ts','utf8').replace('export function installWallet','function installWallet'));
    await context.addInitScript({content:source+'\ninstallWallet('+JSON.stringify([{address:owner.address,publicKey:[...owner.publicKey.toBytes()]}])+',[0,1]);'});
    await wait(()=>fetch('http://127.0.0.1:18093/rivalt-config.json').then(response=>response.status).catch(()=>0),status=>status===200,'owned browser server');
    await page.goto('http://127.0.0.1:18093');await button('Select Wallet').click();await page.getByRole('button',{name:/Rivalt Test Wallet/}).click();
    await wait(()=>button('Withdraw').isEnabled(),Boolean,'actual owner account discovery');
    await input.normal();await action('Review atomic trade');
    await select('Market','1');await input.normal();await action('Review atomic trade');
    await page.getByText('Protect existing position',{exact:true}).click();await action('Review TP/SL');await action('Cancel pair');
    await select('Side','1');await page.getByLabel('Minimum all-in proceeds (test USD)',{exact:true}).fill('0.000001');
    await page.getByLabel('Reduce only',{exact:true}).check();await action('Review atomic trade');await select('Market','0');await action('Review atomic trade');
    await page.getByLabel('Reduce only',{exact:true}).uncheck();await select('Side','0');
    await page.getByLabel('Maximum all-in spend (test USD)',{exact:true}).fill('1');
    await select('Margin account','1');await action('Review atomic trade');
    await select('Side','1');await page.getByLabel('Minimum all-in proceeds (test USD)',{exact:true}).fill('0.000001');
    await page.getByLabel('Reduce only',{exact:true}).check();await action('Review atomic trade');
    const publication=page.locator('section').filter({has:page.getByRole('heading',{name:'Funding publications',exact:true})});
    await wait(()=>publication.textContent(),value=>Boolean(value?.includes('Depth available at publication')),'actual finalized publisher UI');
    await page.screenshot({path:`${directory}/liquidity-live-ui.png`,fullPage:true});
    // RPC signing/exits must survive total loss of both HTTP service surfaces.
    await page.route('**/api/**',route=>route.abort());await page.route('**/read/**',route=>route.abort());
    await page.getByLabel('Collateral amount',{exact:true}).fill('0.000005');await action('Withdraw');await action('Deposit');
    await page.reload();await wait(receipts,values=>values.length===wires.length&&values.every(value=>value.status==='finalized'),'persisted original recovery');
    await wait(()=>page.getByTestId('account-cash').textContent(),value=>Boolean(value&&value!=='—'),'RPC balance recovery while APIs are blocked');
    assert.equal(await page.getByLabel('Margin account',{exact:true}).inputValue(),'1');
    assert.deepEqual(errors,[]);await page.screenshot({path:`${directory}/liquidity-ui.png`,fullPage:true});
    writeFileSync(`${directory}/browser-summary.json`,json({internalWallet:true,outcomes,errors,wireCount:wires.length}));return outcomes;
  }catch(error){await page.screenshot({path:`${directory}/browser-failure.png`,fullPage:true}).catch(()=>{});
    writeFileSync(`${directory}/browser-failure.json`,json({error:String(error),alerts:await page.getByRole('alert').allTextContents(),outcomes,errors}));throw error;
  }finally{await browser.close();await readApp.close();vite?.kill('SIGTERM');}
}
