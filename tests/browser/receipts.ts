/** Real React/Chrome scheduling check; no wallet, RPC, PG or financial effects. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

const require=createRequire(new URL('../../apps/trader/package.json',import.meta.url));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const browser=await chromium.launch({executablePath:process.env.RIVALT_CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
  args:['--disable-background-networking','--disable-component-update','--no-first-run']});
try{
  for(const restoreBug of [true,false]){
    const server=await createServer({root:resolve('apps/trader'),configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0},
      esbuild:{jsx:'automatic'},plugins:[{name:'receipt-scheduler-regression',
        transform(source:string,id:string){
          if(restoreBug&&id.endsWith('/useReceiptRecords.ts'))return source.replace('const recordsRef = useRef(records);','const recordsRef = useRef(records); recordsRef.current = records;');
        },
        configureServer(server:any){server.middlewares.use('/receipt-check',(_request:any,response:any)=>{
          response.setHeader('Content-Type','text/html');response.end('<div id="root"></div><script type="module" src="/test/receipts.fixture.tsx"></script>');
        });},
      }]});
    const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    try{
      await server.listen();const endpoint=server.httpServer.address();assert(endpoint&&typeof endpoint!=='string');
      await page.goto(`http://127.0.0.1:${endpoint.port}/receipt-check`);
      await page.waitForFunction(()=>Boolean((window as any).receipts));
      await page.evaluate(()=>{(window as any).receipts.seed();(window as any).receipts.begin();});
      await page.waitForFunction(()=>(window as any).suspendedReceiptRender===true);
      const result=await page.evaluate(()=>(window as any).receipts.preemptAndPoll());
      if(restoreBug){assert.deepEqual(result.afterPreempt,['prior']);assert.equal(result.saved.length,1);}
      else{
        assert.deepEqual(result.afterPreempt,['prior','new']);
        assert.deepEqual(result.saved.map((receipt:any)=>[receipt.id,receipt.status,receipt.wire]),[
          ['prior','finalized','prior-bytes'],['new','pending','immutable-new-bytes']]);
        assert.deepEqual(result.latest,result.saved);
        const reload=await page.evaluate(()=>(window as any).receipts.reload());assert.equal(reload.cleared,0);assert.deepEqual(reload.latest,result.saved);
        assert.equal(await page.getByTestId('receipts').textContent(),'prior,new:1');
      }
      assert.deepEqual(errors,[]);console.log(JSON.stringify({stage:'receipt-scheduler-pass',restoreBug,retained:result.saved.length}));
    }finally{await page.close();await server.close();}
  }
}finally{await browser.close();}
