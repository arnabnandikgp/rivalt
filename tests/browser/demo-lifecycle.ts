/** P28A acceptance uses the actual local demo wallet, not an injected signer. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {address,type Address} from '@solana/kit';
import {VersionedTransaction} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {RUNTIME,ARTIFACT_DIRECTORY} from '../../packages/local-demo/src/config.js';
const directory=resolve(process.env.RIVALT_DEMO_EVIDENCE??`.local/demo-checks/${Date.now()}`);mkdirSync(directory,{recursive:true});
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const config=JSON.parse(readFileSync(`${RUNTIME}/deployment.json`,'utf8'));
const client=new sdk.AccountUserClient(config),outcomes:{label:string;signature:string;wire:string;fee:number;status:string;error:unknown;reviewAttempt:number}[]=[],errors:string[]=[],preparations:unknown[]=[];
const sourceObservations:unknown[]=[];
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
  args:['--disable-background-networking','--disable-component-update','--no-first-run']});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
page.setDefaultTimeout(25000);page.on('pageerror',error=>errors.push(error.message));
const consoleErrors:string[]=[];
page.on('console',message=>{if(message.type()==='error'&&consoleErrors.length<100)consoleErrors.push(message.text().slice(0,8000));});
let decline=false;page.on('dialog',dialog=>{if(decline){decline=false;void dialog.dismiss();}else void dialog.accept();});
const button=(name:string)=>page.getByRole('button',{name,exact:true});
const receipts=()=>page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('rivalt:receipts:v4:')).flatMap(([,value])=>JSON.parse(value))) as Promise<sdk.SignedIntent[]>;
async function wait<Value>(read:()=>Promise<Value>,accept:(value:Value)=>boolean,label:string,timeoutMs=32_000){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){const value=await read();if(accept(value))return value;await delay(200);}throw new Error(label);
}
async function action(name:string,sourceMargin?:Address,reviewAttempt=1):Promise<sdk.SignedIntent>{
  const before=new Set((await receipts()).map(item=>item.signature));
  const reducing=name==='Review atomic trade'&&await page.getByLabel('Reduce only',{exact:true}).isChecked();
  // Wait for actual live source recovery. Only explicitly refused, unsigned
  // preparations may retry; a signed or ambiguous original never enters this loop.
  for(let attempt=1;attempt<=3;attempt++){
    if(name==='Review atomic trade')await wait(async()=>{
      assert(sourceMargin,'Trade preparation needs its actual margin account');
      const snapshot=await client.snapshot([sourceMargin],'confirmed');
      const modes=snapshot.marketStates.map(market=>sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot));
      sourceObservations.push({reducing,now:snapshot.now,slot:snapshot.slot,modes,markets:snapshot.marketStates.map(market=>({
        validUntil:market.validUntil,status:market.oracle.status,sampledAt:market.oracle.sampledAt,
        lastQualified:market.oracle.lastQualified,sourceDeadline:market.oracle.sourceDeadline}))});
      writeFileSync(`${directory}/source-observations.json`,JSON.stringify(sourceObservations,(_,value)=>typeof value==='bigint'?value.toString():value,2));
      return modes;
    },modes=>modes.every(mode=>mode==='Normal'||reducing&&mode==='Degraded'),
      reducing?'credible sources before reduce-only close':'live Normal sources before opening trade',60_000);
    await button(name).first().click();
    const prepared=await wait(async()=>({review:await page.getByRole('region',{name:'Review transaction'}).isVisible(),
      alerts:await page.getByRole('alert').allTextContents()}),value=>value.review||value.alerts.length>0,`${name} review`);
    preparations.push({name,attempt,...prepared});writeFileSync(`${directory}/preparations.json`,JSON.stringify(preparations,null,2));
    if(prepared.review)break;
    assert.deepEqual(new Set((await receipts()).map(item=>item.signature)),before,'Refused preparation must not sign');
    const sourceRefusal=prepared.alerts.length===1&&(prepared.alerts[0]==='Required liquidity market source unavailable.'
      ||/^Quote unavailable: (BTC|ETH) source is (Degraded|NoCredibleBounds)\.$/.test(prepared.alerts[0]));
    assert(name==='Review atomic trade'&&sourceRefusal&&attempt<3,`${name}: ${prepared.alerts}`);
    await button('Refresh').click();
    await wait(()=>page.getByRole('main').getAttribute('aria-busy'),value=>value==='false','unsigned preparation refresh');
  }
  assert(await page.getByRole('region',{name:'Review transaction'}).isVisible(),`${name}: missing review`);
  await button('Sign transaction').click();
  const saved=await wait(receipts,items=>items.length===before.size+1&&items.some(item=>!before.has(item.signature)&&['finalized','failed'].includes(item.status)),`${name} finality`);
  const receipt=saved.find(item=>!before.has(item.signature))!;
  const history=await client.rpc.call('getTransaction',[receipt.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
  assert.equal(history.transaction[0],receipt.wire);
  outcomes.push({label:receipt.label,signature:receipt.signature,wire:receipt.wire,fee:history.meta.fee,
    status:receipt.status,error:history.meta.err,reviewAttempt});
  writeFileSync(`${directory}/wallet-transactions.json`,JSON.stringify(outcomes,null,2));
  writeFileSync(`${directory}/wallet-finalized-${outcomes.length}.json`,JSON.stringify(history,null,2));
  if(receipt.status==='failed'){
    // A live settlement worker can advance the account between review and send.
    // Model a new user review only AFTER independent finalized failure proof;
    // retain its original, fee and rejection. Unknown outcomes never retry here.
    assert.equal(name,'Review atomic trade',JSON.stringify(receipt.error));
    const code=history.meta.err?.InstructionError?.[1]?.Custom;
    assert.deepEqual(history.meta.err,{InstructionError:[3,{Custom:code}]});
    assert(code===6122||code===6117||code===6115,JSON.stringify(history.meta.err));
    if(code===6117||code===6115){
      // Quote lifetime can reject before the route-intent check. Both errors
      // are broad: require independently proven signed route expiry, never
      // infer a transient failure from the error number alone.
      const transaction=VersionedTransaction.deserialize(Buffer.from(receipt.wire,'base64'));
      const instruction=transaction.message.compiledInstructions[3];
      assert.equal(transaction.message.staticAccountKeys[instruction.programIdIndex].address,sdk.CLEARING_PROGRAM_ADDRESS);
      const intent=sdk.getExecuteLiquidityRouteInstructionDataDecoder().decode(instruction.data);
      assert(BigInt(history.slot)>=intent.expirySlot,'Finalized route must have landed after its signed expiry');
    }
    assert(reviewAttempt<3,'Bounded fresh review after finalized version conflict or proven expiry');
    await button('Refresh').click();
    await wait(()=>page.getByRole('main').getAttribute('aria-busy'),value=>value==='false','finalized rejection refresh');
    return action(name,sourceMargin,reviewAttempt+1);
  }
  assert.equal(receipt.status,'finalized');assert.equal(history.meta.err,null);
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
  await page.getByLabel('Collateral amount',{exact:true}).fill('10');await action('Activate and deposit');
  assert.equal((await client.snapshot([cross])).roots[cross].cash,10_000_000n);
  // Declining the actual demo wallet confirmation creates no saved original.
  const originals=(await receipts()).length;await button('Deposit').click();await page.getByRole('region',{name:'Review transaction'}).waitFor();decline=true;await button('Sign transaction').click();
  await page.getByText('Signature declined or wallet unavailable. Nothing was sent.',{exact:true}).waitFor();assert.equal((await receipts()).length,originals);
  await select('Margin account','1');await select('Market','1');await action('Register account');
  await page.getByLabel('Collateral amount',{exact:true}).fill('10');await action('Activate and deposit');
  await page.getByLabel('Collateral amount',{exact:true}).fill('0.5');await select('Allocate to account',cross);await action('Allocate collateral');
  const allocated=await client.snapshot([cross,isolated]);assert.equal(allocated.roots[cross].cash,10_500_000n);assert.equal(allocated.roots[isolated].cash,9_500_000n);
  assert.equal(allocated.roots[isolated].isolatedMarketIndex,1);
  await select('Margin account','0');await select('Market','0');await action('Review atomic trade',cross);
  await select('Market','1');await action('Review atomic trade',cross);
  const opened=(await client.snapshot([cross])).roots[cross];assert.deepEqual(opened.positions.map(position=>position.lots),[5n,5n]);
  await page.getByText('Protect existing position',{exact:true}).click();await action('Review TP/SL');
  assert.equal((await client.snapshot([cross])).roots[cross].book.orders.filter(entry=>[1,2].includes(entry.order.state)).length,2);
  await action('Cancel pair');
  await select('Side','1');await page.getByLabel('Minimum all-in proceeds (test USD)',{exact:true}).fill('0.000001');await page.getByLabel('Reduce only',{exact:true}).check();
  await action('Review atomic trade',cross);await select('Market','0');await action('Review atomic trade',cross);
  assert((await client.snapshot([cross])).roots[cross].positions.every(position=>position.lots===0n));
  const tokensBefore=await client.walletTokens(owner),token=address(await page.getByLabel('Wallet collateral account',{exact:true}).inputValue());
  await page.getByLabel('Collateral amount',{exact:true}).fill('1');await action('Withdraw');
  assert.equal((await client.walletTokens(owner)).find(item=>item.address===token)!.amount-tokensBefore.find(item=>item.address===token)!.amount,1_000_000n);
  const finalOriginals=(await receipts()).length;
  await page.reload();await wait(receipts,items=>items.length===finalOriginals&&items.every(item=>['finalized','failed'].includes(item.status)),'saved successful/rejected originals after reload');
  await wait(()=>page.getByTestId('account-cash').textContent(),value=>!!value&&value!=='—','same-tab wallet and selected account after reload');
  assert.equal(await page.getByLabel('Margin account',{exact:true}).inputValue(),'0');
  const fills=page.locator('section').filter({has:page.getByRole('heading',{name:'Recent finalized fills',exact:true})});
  await wait(()=>fills.locator('tbody tr').count(),count=>count>=4,'indexed finalized fills after reload');
  assert.equal(errors.length,0,errors.join('\n'));await page.screenshot({path:`${directory}/demo-ui.png`,fullPage:true});
  const summary={status:'pass',revision,trackedDirty:false,build:JSON.parse(readFileSync(`${ARTIFACT_DIRECTORY}/build-manifest.json`,'utf8')),
    walletOriginals:outcomes.length,successfulOriginals:outcomes.filter(item=>item.status==='finalized').length,
    rejectedOriginals:outcomes.filter(item=>item.status==='failed').length,owner,portfolio,cross,isolated,errors,preparations,
    checks:['local-origin faucet denial','unauthorized stop denial','fresh browser-generated wallet and real faucet','portfolio and both account modes',
      'deposits and explicit sibling allocation','actual wallet decline','BTC and ETH fills','TP/SL and cancellation','reduce-only closes','token-reconciled funded withdrawal','reload and saved originals','reconciled indexed fill display']};
  writeFileSync(`${directory}/summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}catch(error){
  await page.screenshot({path:`${directory}/failure.png`,fullPage:true}).catch(()=>{});
  writeFileSync(`${directory}/failure.json`,JSON.stringify({error:String(error),errors,consoleErrors,alerts:await page.getByRole('alert').allTextContents(),outcomes},null,2));throw error;
}finally{await browser.close();}
