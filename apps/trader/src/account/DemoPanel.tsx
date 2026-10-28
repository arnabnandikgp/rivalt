import {useState} from 'react';
import type {AccountController} from './useAccountController.js';
export function DemoPanel({controller}:{controller:AccountController}){
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function fund(){
    setBusy(true);setMessage('Funding your local test wallet…');
    try{
      const response=await fetch('/demo/faucet',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({owner:controller.venue.owner,genesis:controller.config.genesis})});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      setMessage('Sent 1 local SOL and 1,000 test USD. Wait for finalized balances, then create your portfolio.');
      await controller.venue.refresh();
    }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
  }
  return <section className="panel" aria-label="Local demo guide">
    <h2>Try Rivalt locally</h2>
    <p>Synthetic BTC/ETH prices · internal makers · valueless test funds. This session runs for up to 60 minutes. Reset creates a new venue.</p>
    <p>Choose <strong>Rivalt Local Demo</strong> in Select Wallet, get test funds, then create a portfolio and register an account. The demo wallet stays in this browser tab across reloads; closing the tab loses its key.</p>
    <button disabled={busy||!controller.venue.owner} onClick={()=>void fund()}>Get test funds</button>
    {message&&<p role="status">{message}</p>}
    <p className="caption">Start with a 10 test USD deposit and the default small trade. Your wallet asks for confirmation after each transaction review. Unpaid profit stays separate from funded cash.</p>
  </section>;
}
