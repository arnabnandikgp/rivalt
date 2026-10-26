import {GroupExecution} from './group-execution.js';
import {ExecutorWake} from './executor-wake.js';

const required=(key:string)=>{const value=process.env[key];if(!value)throw new Error(`Missing ${key}`);return value;};
const execution=new GroupExecution(required('RIVALT_DATABASE_URL'),required('RIVALT_RUN_ID'),required('RIVALT_RPC_URL'));
const wake=new ExecutorWake(execution.store.pool,execution.runId);
let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopping=true;});
try {
  await execution.open();
  console.log(JSON.stringify({role:'group-executor',pid:process.pid,status:'started'}));
  while(!stopping){
    const observed=wake.version;
    await wake.connect().catch(()=>{});
    try {await execution.execute();} catch {console.error('Group executor unavailable; original signed attempts retained');}
    await wake.wait(observed);
  }
} finally {await wake.close();await execution.close();}
