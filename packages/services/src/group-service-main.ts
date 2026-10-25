import {GroupRuntime} from './group-runtime.js';
import {groupServiceApi} from './group-service-api.js';
const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value;};
const runtime=new GroupRuntime(required('RIVALT_DATABASE_URL'),required('RIVALT_RUN_ID'),required('RIVALT_RPC_URL'));
const port=Number(process.env.RIVALT_GROUP_SERVICE_PORT??18091);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local group service port');
const app=groupServiceApi(runtime);
try{
  await runtime.open();await app.listen({host:'127.0.0.1',port});
  console.log(JSON.stringify({role:'group-execution-api',pid:process.pid,port,status:'started'}));
  await new Promise<void>(resolve=>{process.once('SIGTERM',()=>resolve());process.once('SIGINT',()=>resolve());});
}finally{await app.close();await runtime.close();}
