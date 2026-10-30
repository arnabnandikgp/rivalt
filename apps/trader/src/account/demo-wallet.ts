import {Keypair,VersionedTransaction} from '@solana/web3.js';
import {AccountUserClient,CLEARING_PROGRAM_ADDRESS,type AccountUserConfig} from '@rivalt/sdk';

export function requireLocalDemo(config:AccountUserConfig,origin:string){
  const page=new URL(origin);
  if(page.origin!=='http://127.0.0.1:18083'||config.chain!=='solana:localnet'||
    !(config.version===4&&config.profile==='liquidity-execution-qualification')||
    new URL(config.rpcUrl).hostname!=='127.0.0.1'||new URL(config.wsUrl).hostname!=='127.0.0.1')
    throw new Error('Demo wallet is restricted to the explicit loopback test deployment.');
}
/** Standalone local demo wallet. Keys are created in this browser tab; no key is
 * imported from the operator, supplied by an API, logged or sent to a server. */
export async function installDemoWallet(config:AccountUserConfig){
  requireLocalDemo(config,location.origin);
  const storageKey=`rivalt:demo-wallet:${config.genesis}:${config.anchor}`;
  const saved=sessionStorage.getItem(storageKey);
  const key=saved?await Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved))):await Keypair.generate();
  if(!saved)sessionStorage.setItem(storageKey,JSON.stringify([...key.secretKey]));
  const client=new AccountUserClient(config);
  const account=Object.freeze({address:key.address,publicKey:key.publicKey.toBytes(),chains:['solana:localnet'],features:['solana:signTransaction']});
  const listeners=new Set<(event:unknown)=>void>();let connected=false;
  const emit=()=>listeners.forEach(listener=>listener({accounts:connected?[account]:[]}));
  const wallet={version:'1.0.0',name:'Rivalt Local Demo',
    icon:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzM0NWYyNiIvPjx0ZXh0IHg9IjkiIHk9IjI0IiBmaWxsPSJ3aGl0ZSIgZm9udC1zaXplPSIyNCI+UjwvdGV4dD48L3N2Zz4=',
    chains:['solana:localnet'],get accounts(){return connected?[account]:[];},
    features:{
      'standard:connect':{version:'1.0.0',connect:async()=>{connected=true;emit();return {accounts:[account]};}},
      'standard:disconnect':{version:'1.0.0',disconnect:async()=>{connected=false;emit();}},
      'standard:events':{version:'1.0.0',on:(event:string,listener:(event:unknown)=>void)=>{if(event==='change')listeners.add(listener);return()=>listeners.delete(listener);}},
      'solana:signTransaction':{version:'1.0.0',supportedTransactionVersions:config.version===4?[0,1]:[0],signTransaction:async(...inputs:any[])=>{
        if(!connected)throw new Error('Connect the local demo wallet first.');
        // Authenticate the real configured genesis, initialization and qualified
        // program bytes again before every signature, including after a reset.
        await client.environment();
        const transactions=inputs.map(input=>{
          if(input.account.address!==account.address||input.chain!=='solana:localnet')throw new Error('Wrong demo account or chain.');
          const transaction=VersionedTransaction.deserialize(input.transaction),message=transaction.message;
          if(!(message.version===0||config.version===4&&message.version===1)||message.version===0&&message.addressTableLookups.length||message.header.numRequiredSignatures!==1||message.staticAccountKeys[0].address!==key.address||
            !message.staticAccountKeys.some(key=>key.address===config.venue)||message.compiledInstructions.some(instruction=>
              ![CLEARING_PROGRAM_ADDRESS,'ComputeBudget111111111111111111111111111111'].includes(message.staticAccountKeys[instruction.programIdIndex].address)))
            throw new Error('Only reviewed local Rivalt transactions are supported.');
          return transaction;
        });
        if(!window.confirm('Sign this local Rivalt test transaction? Review the action and amounts in Rivalt. These funds have no monetary value.'))throw new Error('Signature declined.');
        return Promise.all(transactions.map(async transaction=>{await transaction.sign([key]);return {signedTransaction:transaction.serialize()};}));
      }},
    }};
  const register=({register}:any)=>register(wallet);
  window.addEventListener('wallet-standard:app-ready',(event:any)=>register(event.detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet',{detail:register}));
}
