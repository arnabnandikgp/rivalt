import * as sdk from '@rivalt/sdk';
import {accountTradingSetup,type AccountTradingHarness} from './account-trading-setup.js';

/** Fresh signed provisioning only. No financial root or successful event is
 * injected, and no prior acceptance output is a runtime configuration source. */
export async function accountServiceSetup(h:AccountTradingHarness,namespace:string,makerDuration?:bigint) {
  const setup=await accountTradingSetup(h,{qualifyPrimitives:false,domainLabel:`rivalt/p27/${namespace}`,makerDuration});
  const [resolution]=await sdk.deriveVenueComponent(setup.venue,'resolution');
  const [work]=await sdk.deriveVenueComponent(setup.venue,'resolution-work');
  const common={...setup.common,btc:setup.markets[0],eth:setup.markets[1],resolution,work,payer:setup.payer};
  await h.send('precreate complete safety header/work',[sdk.getInitializeAccountResolutionInstruction(common)]);
  for(let pageIndex=0;pageIndex<32;pageIndex++) {
    const [page]=await sdk.findResolutionPagePda(setup.venue,pageIndex);
    await h.send('precreate complete safety page',[sdk.getInitializeAccountResolutionPageInstruction({...common,pageIndex,page})]);
  }
  const qualify=async()=>{
    for(let round=0;round<4;round++) {
      await h.advance(2n);for(let feed=0;feed<6;feed++)await setup.publish(feed);
      for(const index of [0,1])await h.send('fresh qualified local market sample',[sdk.getSampleAccountOracleInstruction(setup.sampleAccounts(index))]);
    }
  };
  await qualify();await h.send('activate qualified local account venue',[sdk.getActivateAccountsInstruction({...common,authority:setup.payer})]);
  return {...setup,qualify};
}
