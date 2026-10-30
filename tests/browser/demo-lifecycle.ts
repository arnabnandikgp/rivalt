/** P28A acceptance uses the actual local demo wallet, not an injected signer. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {RUNTIME} from '../../packages/local-demo/src/config.js';
const directory=resolve(process.env.RIVALT_DEMO_EVIDENCE??`.local/demo-checks/${Date.now()}`);mkdirSync(directory,{recursive:true});
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const config=JSON.parse(readFileSync(`${RUNTIME}/deployment.json`,'utf8'));
const client=new sdk.AccountUserClient(config),outcomes:unknown[]=[],errors:string[]=[];
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
  args:['--disable-background-networking','--disable-component-update','--no-first-run']});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
page.setDefaultTimeout(25000);page.on('pageerror',error=>errors.push(error.message));
let decline=false;page.on('dialog',dialog=>{if(decline){decline=false;void dialog.dismiss();}else void dialog.accept();});
const button=(name:string)=>page.getByRole('button',{name,exact:true});
const receipts=()=>page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('rivalt:receipts:v3:')).flatMap(([,value])=>JSON.parse(value))) as Promise<sdk.SignedIntent[]>;
async function wait<Value>(read:()=>Promise<Value>,accept:(value:Value)=>boolean,label:string){
  for(let attempt=0;attempt<160;attempt++){const value=await read();if(accept(value))return value;await delay(200);}throw new Error(label);
}
async function action(name:string){
  const before=new Set((await receipts()).map(item=>item.signature));
  await button(name).first().click();await page.getByRole('region',{name:'Review transaction'}).waitFor();
  await button('Sign transaction').click();
  const saved=await wait(receipts,items=>items.length===before.size+1&&items.some(item=>!before.has(item.signature)&&['finalized','failed'].includes(item.status)),`${name} finality`);
  const receipt=saved.find(item=>!before.has(item.signature))!;assert.equal(receipt.status,'finalized',JSON.stringify(receipt.error));
  const history=await client.rpc.call('getTransaction',[receipt.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  assert.equal(history.transaction[0],receipt.wire);assert.equal(history.meta.err,null);
  outcomes.push({label:receipt.label,signature:receipt.signature,wire:receipt.wire,fee:history.meta.fee});
  writeFileSync(`${directory}/wallet-transactions.json`,JSON.stringify(outcomes,null,2));
  await button('Refresh').click();await delay(500);return receipt;
}
const select=async(label:string,value:string)=>{await page.getByLabel(label,{exact:true}).selectOption(value);await delay(500);};
try{
  const denied=await fetch('http://127.0.0.1:18094/faucet',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:'{}'});
  assert.equal(denied.status,403);
  assert.equal((await fetch('http://127.0.0.1:18094/stop',{method:'POST'})).status,404);
  await page.goto('http://127.0.0.1:18083');await button('Select Wallet').click();await page.getByRole('button',{name:/Rivalt Local Demo/}).click();
  await button('Get test funds').click();await page.getByText('Sent 1 local SOL and 1,000 test USD. Wait for finalized balances, then create your portfolio.',{exact:true}).waitFor();
  await delay(2000);await action('Create portfolio');const registration=await action('Register account');
  const owner=registration.owner,[portfolio]=await sdk.deriveAccountPortfolio(config.venue,owner,0),[cross]=await sdk.deriveMarginAccount(portfolio,0),[isolated]=await sdk.deriveMarginAccount(portfolio,1);
  await page.getByLabel('Collateral amount',{exact:true}).fill('10');await action('Deposit');
  assert.equal((await client.snapshot([cross])).roots[cross].cash,10_000_000n);
  // Declining the actual demo wallet confirmation creates no saved original.
  const originals=(await receipts()).length;await button('Deposit').click();await page.getByRole('region',{name:'Review transaction'}).waitFor();decline=true;await button('Sign transaction').click();
  await page.getByText('Signature declined or wallet unavailable. Nothing was sent.',{exact:true}).waitFor();assert.equal((await receipts()).length,originals);
  await select('Margin account','1');await select('Market','1');await action('Register account');
  await page.getByLabel('Collateral amount',{exact:true}).fill('10');await action('Deposit');
  await page.getByLabel('Collateral amount',{exact:true}).fill('0.5');await select('Allocate to account',cross);await action('Allocate collateral');
  const allocated=await client.snapshot([cross,isolated]);assert.equal(allocated.roots[cross].cash,10_500_000n);assert.equal(allocated.roots[isolated].cash,9_500_000n);
  assert.equal(allocated.roots[isolated].isolatedMarketIndex,1);
  await select('Margin account','0');await select('Market','0');await action('Review atomic trade');
  await select('Market','1');await action('Review atomic trade');
  const opened=(await client.snapshot([cross])).roots[cross];assert.deepEqual(opened.positions.map(position=>position.lots),[5n,5n]);
  await page.getByText('Protect existing position',{exact:true}).click();await action('Review TP/SL');
  assert.equal((await client.snapshot([cross])).roots[cross].book.orders.filter(entry=>[1,2].includes(entry.order.state)).length,2);
  await action('Cancel pair');
  await select('Side','1');await page.getByLabel('Minimum all-in proceeds (test USD)',{exact:true}).fill('0.000001');await page.getByLabel('Reduce only',{exact:true}).check();
  await action('Review atomic trade');await select('Market','0');await action('Review atomic trade');
  assert((await client.snapshot([cross])).roots[cross].positions.every(position=>position.lots===0n));
  const tokensBefore=await client.walletTokens(owner),token=address(await page.getByLabel('Wallet collateral account',{exact:true}).inputValue());
  await page.getByLabel('Collateral amount',{exact:true}).fill('1');await action('Withdraw');
  assert.equal((await client.walletTokens(owner)).find(item=>item.address===token)!.amount-tokensBefore.find(item=>item.address===token)!.amount,1_000_000n);
  const finalOriginals=(await receipts()).length;
  await page.reload();await wait(receipts,items=>items.length===finalOriginals&&items.every(item=>item.status==='finalized'),'saved originals after reload');
  await wait(()=>page.getByTestId('account-cash').textContent(),value=>!!value&&value!=='—','same-tab wallet and selected account after reload');
  assert.equal(await page.getByLabel('Margin account',{exact:true}).inputValue(),'0');
  const fills=page.locator('section').filter({has:page.getByRole('heading',{name:'Recent finalized fills',exact:true})});
  await wait(()=>fills.locator('tbody tr').count(),count=>count>=4,'indexed finalized fills after reload');
  assert.equal(errors.length,0,errors.join('\n'));await page.screenshot({path:`${directory}/demo-ui.png`,fullPage:true});
  const summary={status:'pass',revision,trackedDirty:false,build:JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json','utf8')),
    walletOriginals:outcomes.length,owner,portfolio,cross,isolated,errors,
    checks:['local-origin faucet denial','unauthorized stop denial','fresh browser-generated wallet and real faucet','portfolio and both account modes',
      'deposits and explicit sibling allocation','actual wallet decline','BTC and ETH fills','TP/SL and cancellation','reduce-only closes','token-reconciled funded withdrawal','reload and saved originals','reconciled indexed fill display']};
  writeFileSync(`${directory}/summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}catch(error){
  await page.screenshot({path:`${directory}/failure.png`,fullPage:true}).catch(()=>{});
  writeFileSync(`${directory}/failure.json`,JSON.stringify({error:String(error),errors,alerts:await page.getByRole('alert').allTextContents(),outcomes},null,2));throw error;
}finally{await browser.close();}
