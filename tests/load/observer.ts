import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync,writeFileSync,appendFileSync,openSync,closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { chromium } from 'playwright-core';
import * as sdk from '@rivalt/sdk';
import { json } from '../../packages/indexer/src/events.js';
import { distribution } from './metrics.js';
import { wait,type environment } from './environment.js';

/** Observe the production-built UI. Wallet has public identity only; signing is disabled. */
export async function observer(e:Awaited<ReturnType<typeof environment>>){
  const config=sdk.userConfig({version:1,chain:'solana:localnet',rpcUrl:e.url,wsUrl:e.wsUrl,genesis:await e.rpc.call('getGenesisHash'),anchor:e.config.anchor,market:e.a.market,mint:e.setup.mint.address,domain:sdk.hex((await e.runtime.snapshot()).m.domain)});
  const configPath=resolve(e.dir,'trader-public.json');writeFileSync(configPath,json(config));
  const fd=openSync(`${e.dir}/ui-preview.log`,'w'),preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','18084','--strictPort'],{cwd:resolve('apps/trader'),env:{...process.env,RIVALT_TRADER_CONFIG:configPath,RIVALT_INDEXER_ORIGIN:'http://127.0.0.1:18083',RIVALT_SERVICE_ORIGIN:'http://127.0.0.1:18081'},stdio:['ignore',fd,fd]});closeSync(fd);
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await wait(async()=>{const r=await fetch('http://127.0.0.1:18084');return r.ok;},Boolean,'production preview');
    browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
    const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
    await context.exposeBinding('rivaltSign',()=>{throw new Error('Read-only observer cannot sign');});
    const source=stripTypeScriptTypes(readFileSync('tests/browser/wallet.ts','utf8').replace('export function installWallet','function installWallet'));
    await context.addInitScript({content:source+'\ninstallWallet('+JSON.stringify(e.actors.map(x=>({address:x.owner.address,publicKey:[...x.owner.publicKey.toBytes()]})))+');'});
    const page=await context.newPage();page.setDefaultTimeout(5000);const errors:string[]=[];
    page.on('pageerror',err=>{errors.push(err.message);appendFileSync(`${e.dir}/ui-errors.jsonl`,json({at:Date.now(),message:err.message})+'\n');});
    await page.goto('http://127.0.0.1:18084');await page.getByRole('button',{name:'Select Wallet',exact:true}).click();await page.getByRole('button',{name:/Rivalt Test Wallet/}).click();
    await wait(()=>page.getByTestId('source-mode').textContent(),x=>x==='Normal','observer connected');
    await page.getByText('Finalized fills & maker legs',{exact:true}).click();await page.screenshot({path:`${e.dir}/ui-start.png`});
    const rows:any[]=[],active=new Map<string,any>();let apiUnavailable=0,polls=0,uiUnavailable=0;
    return {
      track(signature:string,sequence:string,fault:boolean){const row={signature,sequence,fault,finalizedObservedAt:Date.now()};rows.push(row);active.set(signature,row);},
      async poll(){
        polls++;let seen=new Set<string>();
        try{const r=await fetch('http://127.0.0.1:18083/v1/trades?latest=true&limit=30',{signal:AbortSignal.timeout(2000)});if(!r.ok)apiUnavailable++;else seen=new Set(((await r.json()) as any).items.map((x:any)=>x.signature));}catch{apiUnavailable++;}
        let text:string[]=[];try{text=await page.locator('td').allTextContents();}catch{uiUnavailable++;}
        const at=Date.now();for(const [signature,row] of active){
          if(seen.has(signature))row.apiObservedAt??=at;
          if(text.some(x=>x.trim().startsWith(row.sequence+' · ')))row.uiObservedAt??=at;
          if(row.apiObservedAt&&row.uiObservedAt||at-row.finalizedObservedAt>=30_000){row.censored=!row.apiObservedAt||!row.uiObservedAt;appendFileSync(`${e.dir}/visibility.jsonl`,json(row)+'\n');active.delete(signature);}
        }
      },
      async close(){
        for(const row of active.values()){row.censored=true;appendFileSync(`${e.dir}/visibility.jsonl`,json(row)+'\n');}active.clear();
        await page.screenshot({path:`${e.dir}/ui-end.png`});await browser!.close();preview.kill('SIGTERM');
        const lag=(field:string,pop:any[])=>distribution(pop.flatMap(r=>r[field]===undefined?[]:[Math.max(0,r[field]-r.finalizedObservedAt)]));
        const summary={browserVersion:browser!.version(),polls,apiUnavailable,uiUnavailable,errors,tracked:rows.length,censored:rows.filter(r=>r.censored).length,
          api:lag('apiObservedAt',rows),ui:lag('uiObservedAt',rows),normalApi:lag('apiObservedAt',rows.filter(r=>!r.fault)),normalUi:lag('uiObservedAt',rows.filter(r=>!r.fault)),definition:'First poll observations after finalized RPC evidence, upper bounds; censored fills retained; public-identity wallet observer cannot sign'};
        writeFileSync(`${e.dir}/visibility.json`,json(summary));assert.equal(errors.length,0,'UI page errors');return summary;
      }
    };
  }catch(error){await browser?.close();preview.kill('SIGTERM');throw error;}
}
