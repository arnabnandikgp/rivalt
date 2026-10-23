/** Bounded interactive local session. No load loop, injected outages or acceptance claim. */
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, openSync, closeSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { VersionedTransaction } from '@solana/web3.js';
import { getMintToInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { json } from '../../packages/indexer/src/events.js';
import { environment, wait } from './environment.js';

const args=process.argv.slice(2),minutes=args.length===0?60:Number(args[1]);
assert(args.length===0||args.length===2&&args[0]==='--minutes','Use --minutes 1..120');
assert(Number.isInteger(minutes)&&minutes>=1&&minutes<=120,'Use --minutes 1..120');
const origin='http://127.0.0.1:18084',pointer=resolve('.local/trader-demo.json');
let e:Awaited<ReturnType<typeof environment>>|undefined,browser:Browser|undefined,preview:ChildProcess|undefined,timer:NodeJS.Timeout|undefined;
let finish!:(reason:string)=>void;const done=new Promise<string>(r=>{finish=r;});
process.once('SIGINT',()=>finish('SIGINT'));process.once('SIGTERM',()=>finish('SIGTERM'));
try{
  e=await environment();const venue=e;
  // Additional actual test tokens let the user try deposits as well as the prefunded account.
  await e.send('manual demo test collateral',[getMintToInstruction({mint:e.setup.mint.address,token:e.actors[0].token.address,mintAuthority:e.payer,amount:50_000_000n})]);
  const config=sdk.userConfig({version:1,chain:'solana:localnet',rpcUrl:e.url,wsUrl:e.wsUrl,genesis:await e.rpc.call('getGenesisHash'),anchor:e.config.anchor,market:e.a.market,mint:e.setup.mint.address,domain:sdk.hex((await e.runtime.snapshot()).m.domain)});
  const configPath=resolve(e.dir,'trader-public.json');writeFileSync(configPath,json(config));
  const fd=openSync(`${e.dir}/ui-preview.log`,'w');
  preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','18084','--strictPort'],{cwd:resolve('apps/trader'),env:{...process.env,RIVALT_TRADER_CONFIG:configPath,RIVALT_INDEXER_ORIGIN:'http://127.0.0.1:18083',RIVALT_SERVICE_ORIGIN:'http://127.0.0.1:18081'},stdio:['ignore',fd,fd]});closeSync(fd);
  preview.once('exit',()=>finish('preview exited'));
  await wait(async()=>{const r=await fetch(origin,{signal:AbortSignal.timeout(2000)});return r.ok;},Boolean,'manual UI preview');
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
  browser.once('disconnected',()=>finish('browser closed'));
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.exposeBinding('rivaltSign',async(source,input:{index:number;wire:number[]})=>{
    assert.equal(source.frame,source.page.mainFrame(),'Only the main demo frame may sign');
    assert.equal(new URL(source.frame.url()).origin,origin,'Only the local demo origin may sign');
    assert(Number.isInteger(input.index)&&input.index>=0&&input.index<venue.actors.length);
    const key=venue.actors[input.index].owner,transaction=VersionedTransaction.deserialize(Uint8Array.from(input.wire));
    assert.equal(transaction.message.staticAccountKeys[0].address,key.address);
    assert.equal(transaction.signatures.length,1);
    await transaction.sign([key]);
    appendFileSync(`${venue.dir}/manual-signatures.jsonl`,json({at:new Date().toISOString(),signature:Buffer.from(transaction.signatures[0]).toString('base64'),owner:key.address})+'\n');
    return [...transaction.serialize()];
  });
  const source=stripTypeScriptTypes(readFileSync('tests/browser/wallet.ts','utf8').replace('export function installWallet','function installWallet'));
  await context.addInitScript({content:source+'\ninstallWallet('+JSON.stringify(e.actors.map(x=>({address:x.owner.address,publicKey:[...x.owner.publicKey.toBytes()]})))+');'});
  const page=await context.newPage();page.once('close',()=>finish('demo tab closed'));
  page.on('pageerror',error=>appendFileSync(`${venue.dir}/ui-errors.jsonl`,json({at:new Date().toISOString(),error:error.message})+'\n'));
  await page.goto(origin);await page.getByRole('button',{name:'Select Wallet',exact:true}).click();await page.getByRole('button',{name:/Rivalt Test Wallet/}).click();
  await wait(()=>page.getByTestId('source-mode').textContent(),v=>v==='Normal','manual UI normal source');
  await page.screenshot({path:`${e.dir}/manual-ui.png`,fullPage:true});
  const status={state:'ready',url:origin,run:e.dir,pid:process.pid,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedUtc:new Date().toISOString(),expiresUtc:new Date(Date.now()+minutes*60000).toISOString(),minutes,wallet:'Rivalt Test Wallet in the opened Chrome window only',note:'Synthetic local funds. No automated trade loop, outage injection or acceptance claim. Close the demo tab or press Ctrl-C to stop.'};
  writeFileSync(pointer,json(status));console.log(json(status));
  timer=setTimeout(()=>finish('session time limit'),minutes*60000);
  console.log('Manual demo stopped: '+await done);
}finally{
  if(timer)clearTimeout(timer);
  await browser?.close();preview?.kill('SIGTERM');await e?.close();
  writeFileSync(pointer,json({state:'stopped',url:origin,run:process.env.RIVALT_RUN_DIR,stoppedUtc:new Date().toISOString()}));
}
