/** Only non-submission or proven rejection permits a new faucet grant. */
export class DemoSendError extends Error {
  constructor(message:string,readonly outcome:'not-submitted'|'rejected'|'unknown',options?:ErrorOptions){
    super(message,options);
  }
}
