import {AccountRuntime} from './account-runtime.js';
import {accountServiceApi} from './account-service-api.js';
import {accountExecutionProfile} from './account-profile.js';
const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value;};
const runtime=new AccountRuntime(required('RIVALT_DATABASE_URL'),required('RIVALT_RUN_ID'),required('RIVALT_RPC_URL'),accountExecutionProfile());
const port=Number(process.env.RIVALT_ACCOUNT_SERVICE_PORT??18093);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local account service port');
const app=accountServiceApi(runtime);
try{
  await runtime.open();await app.listen({host:'127.0.0.1',port});
  console.log(JSON.stringify({role:'account-execution-api',pid:process.pid,port,status:'started'}));
  await new Promise<void>(resolve=>{process.once('SIGTERM',()=>resolve());process.once('SIGINT',()=>resolve());});
}finally{await app.close();await runtime.close();}
