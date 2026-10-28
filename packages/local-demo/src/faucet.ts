import {DemoSendError} from './send-error.js';

export class FaucetUnavailable extends Error {
  constructor(message:string,readonly status:400|409){super(message);}
}

/** Session-local admission: preserve uncertain originals, but release definite failures. */
export class DemoFaucet {
  private readonly wallets=new Set<string>();
  private busy=false;

  /** Preparation builds the grant; the returned callback is its sole submission boundary. */
  async fund<Value>(owner:string,prepare:()=>Promise<()=>Promise<Value>>):Promise<Value>{
    if(this.wallets.has(owner))throw new FaucetUnavailable('This wallet already received or has unresolved test funding in this session',409);
    if(this.wallets.size>=16)throw new FaucetUnavailable('Demo wallet allowance exhausted; reset for another session',400);
    if(this.busy)throw new FaucetUnavailable('Faucet is busy; try again',409);
    this.busy=true;this.wallets.add(owner);
    let submissionStarted=false;
    try{
      const submit=await prepare();
      submissionStarted=true;
      return await submit();
    }catch(error){
      if(!submissionStarted||(error instanceof DemoSendError&&error.outcome!=='unknown'))this.wallets.delete(owner);
      throw error;
    }finally{this.busy=false;}
  }
}
