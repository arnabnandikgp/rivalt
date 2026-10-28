/** RPC fault fixtures exercise real signing/transport/admission; they are not chain acceptance. */
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {getBase58Decoder} from '@solana/kit';
import {VersionedTransaction} from '@solana/web3.js';
import {getTransferSolInstruction} from '@solana-program/system';
import {demoTransport} from './transport.js';
import {DemoFaucet} from './faucet.js';

vi.mock('../../../tests/rpc-contract/custody-cases.js',()=>({payerKey:async()=>{
  const {Keypair}=await import('@solana/web3.js');return Keypair.generate();
}}));
const directories:string[]=[];
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});

const scenarios=[
  ['blockhash','not-submitted'],['simulation','not-submitted'],['preflight','rejected'],['finalized-failure','rejected'],
  ['confirmed-failure','unknown'],['ack-loss','unknown'],['http-error','unknown'],['rpc-error','unknown'],
  ['wrong-ack','unknown'],['wrong-history','unknown'],['history-timeout','unknown'],
] as const;

it.each(scenarios)('classifies %s and enforces the faucet retry boundary',async(fault,outcome)=>{
  const directory=mkdtempSync(join(tmpdir(),'rivalt-demo-fault-'));directories.push(directory);
  let activeFault:string=fault,blockhashNumber=0,sends=0,signature='';
  const historyCommitments:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:RequestInit)=>{
    const {id,method,params}=JSON.parse(String(init.body));
    const response=(value:object,status=200)=>new Response(JSON.stringify({jsonrpc:'2.0',id,...value}),{status});
    if(method==='getLatestBlockhash'){
      if(activeFault==='blockhash')throw new Error('Blockhash unavailable');
      return response({result:{context:{slot:1},value:{blockhash:getBase58Decoder().decode(new Uint8Array(32).fill(++blockhashNumber)),lastValidBlockHeight:1000}}});
    }
    if(method==='simulateTransaction')return response({result:{value:{err:activeFault==='simulation'?{InstructionError:[0,'InvalidArgument']}:null}}});
    if(method==='sendTransaction'){
      sends++;
      const transaction=VersionedTransaction.deserialize(Buffer.from(params[0],'base64'));
      signature=getBase58Decoder().decode(transaction.signatures[0]);
      // The exact original must be retained before the request is dispatched.
      const saved=JSON.parse(readFileSync(directory+'/originals.ndjson','utf8').trim().split('\n').at(-1)!);
      expect(saved.signature).toBe(signature);expect(saved.wire).toBe(params[0]);
      if(activeFault==='ack-loss')throw new TypeError('Connection lost after submission');
      if(activeFault==='http-error')return response({error:{code:-32002,data:{err:'failure'}}},503);
      if(activeFault==='rpc-error')return response({error:{code:-32005,message:'Node unhealthy'}});
      if(activeFault==='preflight')return response({error:{code:-32002,data:{err:{InstructionError:[0,'InvalidArgument']}}}});
      return response({result:activeFault==='wrong-ack'?'different-signature':signature});
    }
    if(method==='getTransaction'){
      historyCommitments.push(params[1].commitment);
      if(activeFault==='history-timeout'){
        vi.spyOn(Date,'now').mockReturnValue(Date.now()+31000);return response({result:null});
      }
      return response({result:{transaction:{signatures:[activeFault==='wrong-history'?'different-signature':signature]},
        meta:{err:['finalized-failure','confirmed-failure'].includes(activeFault)?{InstructionError:[0,'InvalidArgument']}:null}}});
    }
    throw new Error(`Unexpected RPC method: ${method}`);
  }));
  const transport=await demoTransport('http://127.0.0.1:18931',directory+'/originals.ndjson');
  const instruction=getTransferSolInstruction({source:transport.payer,destination:transport.payer.address,amount:1n});
  const faucet=new DemoFaucet();
  const prepare=async()=>()=>transport.send('faucet regression',[instruction],[],fault==='confirmed-failure'?'confirmed':'finalized');
  await expect(faucet.fund('wallet',prepare)).rejects.toMatchObject({outcome});
  const previousSends=sends;activeFault='none';vi.restoreAllMocks();
  if(outcome==='unknown'){
    await expect(faucet.fund('wallet',prepare)).rejects.toMatchObject({status:409});
    expect(sends).toBe(previousSends);
    // An uncertain original reserves only its wallet, not the global busy lock.
    await expect(faucet.fund('another-wallet',prepare)).resolves.toMatchObject({meta:{err:null}});
  }else{
    await expect(faucet.fund('wallet',prepare)).resolves.toMatchObject({meta:{err:null}});
    expect(sends).toBe(previousSends+1);
  }
  const successfulSends=sends;
  await expect(faucet.fund(outcome==='unknown'?'another-wallet':'wallet',prepare)).rejects.toMatchObject({status:409});
  expect(sends).toBe(successfulSends);
  if(fault!=='confirmed-failure')expect(historyCommitments.every(value=>value==='finalized')).toBe(true);
});
