import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,openSync,closeSync,rmSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {CONTROL,DEMO_ROOT,RUNTIME,CONTAINER,PORTS} from './config.js';

const action=process.argv[2]??'status';
async function status(){try{const response=await fetch(CONTROL+'/status',{signal:AbortSignal.timeout(1000)});return response.ok?await response.json():null;}catch{return null;}}
async function stop(){
  const current=await status();if(!current){console.log('Demo is stopped.');return;}
  const owner=JSON.parse(readFileSync(RUNTIME+'/owner.json','utf8'));
  assert(current.session===owner.session,'Foreign control process; refusing to stop');
  const response=await fetch(CONTROL+'/stop',{method:'POST',headers:{authorization:`Bearer ${owner.token}`}});
  assert(response.ok,'Owned demo stop rejected');
  for(let attempt=0;attempt<150;attempt++){if(!await status()){console.log('Stopped owned demo processes and PostgreSQL.');return;}await delay(200);}
  throw new Error('Shutdown still pending; inspect the demo supervisor log.');
}
if(action==='status')console.log(await status()??{state:'stopped',next:'bash ops/demo.sh start (or reset for an ended session)'});
else if(action==='stop')await stop();
else if(action==='start'||action==='reset'){
  if(action==='reset'){
    await stop();
    execFileSync('python3',['ops/check-ports.py',...PORTS.map(String)],{stdio:'inherit'});
    if(existsSync(RUNTIME)){
      const marker=JSON.parse(readFileSync(RUNTIME+'/owner.json','utf8'));
      assert(marker.kind==='rivalt-local-demo-v1','Unknown directory: refusing reset');
      // Delete only this launcher's disposable DB/config; sessions/evidence and
      // every other .local directory remain untouched.
      try{execFileSync('container',['delete',CONTAINER],{stdio:'pipe'});}catch{}
      rmSync(RUNTIME,{recursive:true});
    }
  }else if(await status()){console.log(await status());process.exit(0);}
  if(existsSync(RUNTIME))throw new Error('The previous local chain ended. Use bash ops/demo.sh reset to create a fresh test venue; old wallet receipts stay labelled with the old deployment.');
  execFileSync('python3',['ops/check-ports.py',...PORTS.map(String)],{stdio:'inherit'});
  assert(execFileSync('surfpool',['--version'],{encoding:'utf8'}).trim()==='surfpool 1.6.1','Pinned Surfpool required');
  execFileSync('container',['system','start'],{stdio:'inherit'});
  for(const program of ['clearing','maker_a','maker_b','oracle_fixture'])assert(existsSync(`.local/account-safety/${program}.so`),'Build qualified artifacts with bash ops/build-account-safety.sh');
  mkdirSync(DEMO_ROOT,{recursive:true,mode:0o700});
  const log=openSync(DEMO_ROOT+'/supervisor.log','w',0o600);
  const child=spawn(process.execPath,['--import','tsx','packages/local-demo/src/session.ts'],{cwd:process.cwd(),env:process.env,detached:true,stdio:['ignore',log,log]});
  closeSync(log);child.unref();
  console.log('Starting fresh local venue. Progress: bash ops/demo.sh status');
  for(let attempt=0;attempt<900;attempt++){
    const current=await status();
    if(existsSync(RUNTIME+'/ended.json'))throw new Error(JSON.parse(readFileSync(RUNTIME+'/ended.json','utf8')).stage);
    if(current?.state==='ready'){console.log(current);process.exit(0);}
    if(current?.state==='failed')throw new Error(current.error);
    await delay(200);
  }
  throw new Error('Startup did not become ready; inspect .local/interactive-demo/supervisor.log');
}else throw new Error('Usage: bash ops/demo.sh start | status | stop | reset');
