import {readFileSync,statSync} from 'node:fs';
import {address} from '@solana/kit';
import {Keypair} from '@solana/web3.js';
import {AccountRuntime} from './account-runtime.js';

const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value;};
const role=required('RIVALT_ACCOUNT_ROLE'),marketText=['orders','settlement','risk'].includes(role)?undefined:required('RIVALT_MARKET_INDEX');
if(!['maker','funding','orders','settlement','risk'].includes(role)||(marketText!==undefined&&!['0','1'].includes(marketText)))throw new Error('Unsupported market worker identity');
const receiver=role==='risk'&&process.env.RIVALT_RECEIVER_MARGIN?address(process.env.RIVALT_RECEIVER_MARGIN):undefined;
const makerText=role==='maker'?required('RIVALT_MAKER_ID'):undefined;
if(makerText!==undefined&&!['0','1'].includes(makerText))throw new Error('Unsupported market maker identity');
const marketIndex=Number(marketText) as 0|1,makerId=Number(makerText) as 0|1;
const cadence=process.env.RIVALT_FUNDING_INTERVAL_SECONDS??'2';if(!/^[2-5]$/.test(cadence))throw new Error('Funding cadence must be 2–5 seconds');
const signerPath=required('RIVALT_SIGNER_PATH'),stat=statSync(signerPath);
if(!stat.isFile()||(stat.mode&0o077)!==0)throw new Error('Worker signer must be a private local file');
const signer=await Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(signerPath,'utf8'))));
const runtime=new AccountRuntime(required('RIVALT_DATABASE_URL'),required('RIVALT_RUN_ID'),required('RIVALT_RPC_URL'));
let stopping=false,lastStatus='';for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopping=true;});
try{
  await runtime.open();
  console.log(JSON.stringify({role,marketIndex:marketText===undefined?undefined:marketIndex,makerId:role==='maker'?makerId:undefined,pid:process.pid,status:'started'}));
  while(!stopping){
    let outcome;
    try{outcome=role==='maker'?await runtime.maker(marketIndex,makerId,signer):role==='orders'?await runtime.orders(signer):role==='settlement'?await runtime.settle(signer):role==='risk'?await runtime.riskWork(signer,receiver):await runtime.funding(marketIndex,signer,BigInt(cadence));}
    catch{outcome={status:'unavailable',reason:'worker-input-or-execution-error'};}
    const status=JSON.stringify(outcome);if(status!==lastStatus){console.log(JSON.stringify({role,marketIndex:marketText===undefined?undefined:marketIndex,...outcome}));lastStatus=status;}
    await new Promise(resolve=>setTimeout(resolve,role==='risk'?1000:250));
  }
}finally{await runtime.close();}
