import assert from 'node:assert/strict';
import {address,getAddressEncoder,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {fixtureKey} from './custody-cases.js';
import {accountPda} from './account-custody-cases.js';
import {accountTradingSetup,type AccountTradingHarness} from './account-trading-setup.js';

export async function accountTradingCases(h:AccountTradingHarness) {
  const setup=await accountTradingSetup(h);
  const {common,markets,ledgers,makers,cross,owner,payer,operators,domain,marketState,reject}=setup;
  const rootState=async(root:Address)=>sdk.getMarginAccountDecoder().decode((await h.read(root))!);
  const guard=async(root:Address)=>{
    const state=await rootState(root),safety=sdk.getVenueSafetyDecoder().decode((await h.read(common.safety))!);
    return {safetyEpoch:safety.epoch,venueTermsEpoch:1n,nonce:state.nonce,stateVersion:state.stateVersion};
  };
  const routeAccounts=(marketIndex:number,trader:Address,two=false)=>{
    const [first,second]=makers[marketIndex];
    return {...common,actor:owner,market:markets[marketIndex],otherMarket:markets[1-marketIndex],
      ledger:ledgers[marketIndex],otherLedger:ledgers[1-marketIndex],trader,
      firstCapital:first.capital,firstRegistration:first.registration,firstProgram:first.pricingProgram,
      firstProgramData:first.programData,firstConfig:first.config,
      secondCapital:two?second.capital:undefined,secondRegistration:two?second.registration:undefined,
      secondProgram:two?second.pricingProgram:undefined,secondProgramData:two?second.programData:undefined,
      secondConfig:two?second.config:undefined};
  };
  async function route(marketIndex:number,trader:Address,side=0,lots=1n,two=false,reduceOnly=false) {
    const market=await marketState(marketIndex),root=await rootState(trader),slot=await h.slot();
    const registrations=await Promise.all(makers[marketIndex].slice(0,two?2:1).map(async maker=>
      sdk.getFixedMakerRegistrationDecoder().decode((await h.read(maker.registration))!)));
    return sdk.getExecuteAccountRouteInstruction({...routeAccounts(marketIndex,trader,two),guard:await guard(trader),
      domain,termsEpoch:market.termsEpoch,configEpoch:market.configEpoch,startSlot:slot,expirySlot:slot+100n,
      side,lots,allInLimit:side===0?lots*market.referencePrice*11n/10n:lots*market.referencePrice*9n/10n,
      maxFee:1_000n,reduceOnly,generation:reduceOnly?root.positions[marketIndex].generation:null,
      legs:registrations.map((registration,index)=>({lots:two?(index===0?1n:lots-1n):lots,
        quoteEpoch:registration.quoteEpoch,authorityEpoch:registration.authorityEpoch,expectedConsumed:side===0?registration.buyConsumed:registration.sellConsumed}))});
  }
  async function fresh(rounds=1) {
    for(let round=0;round<rounds;round++) {
      await h.advance(2n);
      for(let index=0;index<6;index++)await setup.publish(index);
      for(const index of [0,1])await h.send('authenticated ongoing source sampling',[sdk.getSampleAccountOracleInstruction(setup.sampleAccounts(index))]);
    }
  }
  const encode=getAddressEncoder(),indexOne=Uint8Array.of(1,0),indexZero=Uint8Array.of(0,0);
  const stressPortfolio=await accountPda('portfolio-v3',encode.encode(common.venue),encode.encode(owner.address),indexOne);
  const stressRoot=await accountPda('margin-v3',encode.encode(stressPortfolio),indexZero);
  await h.send('maximum-book owner portfolio',[await sdk.getCreatePortfolioInstructionAsync({...common,owner,portfolio:stressPortfolio,index:1})],[owner]);
  await h.send('maximum-book cross root',[await sdk.getRegisterMarginInstructionAsync({...common,owner,portfolio:stressPortfolio,margin:stressRoot,
    subaccountIndex:0,mode:0,isolatedMarketIndex:255,role:0})],[owner]);setup.roots.push(stressRoot);
  await h.send('maximum-book actual funding',[sdk.getDepositAccountInstruction({...common,owner,margin:stressRoot,
    quoteMint:setup.mint.address,userToken:operators[0].token.address,amount:1_000_000n})],[owner]);
  await h.send('allocate actual cash to cross account before qualification',[sdk.getTransferAccountCustodyInstruction({
    ...common,owner,donor:operators[0].capital[0],recipient:cross,amount:100_000n})],[owner]);
  await reject('ordinary custody mode rejects candidate trade',[await route(0,cross)],[owner],6108);
  await h.send('explicit candidate-only qualification',[sdk.getQualifyAccountTradingInstruction({...common,authority:payer,btc:markets[0],eth:markets[1]})]);
  await reject('qualification cannot be replayed',[sdk.getQualifyAccountTradingInstruction({...common,authority:payer,btc:markets[0],eth:markets[1]})],[],6108);
  await reject('activation reset requires new source recovery',[await route(0,cross)],[owner],6124);
  await fresh(4);

  // These snapshots are used by a separate Python raw-byte auditor, not SDK math.
  const financialSteps:{label:string;before:Record<string,string>;after:Record<string,string>}[]=[];
  const financialKeys=[common.custody,common.vault,...markets,...ledgers,...setup.roots];
  const raw=async()=>Object.fromEntries(await Promise.all(financialKeys.map(async key=>[key,(await h.read(key))!.toString('base64')])));
  async function record(label:string,ix:Instruction,signers=[owner]) {
    const before=await raw();await h.send(label,[ix],signers);financialSteps.push({label,before,after:await raw()});
  }
  await record('one-maker isolated BTC fill with attributed fee',await route(0,operators[0].capital[0]));
  let btcLedger=sdk.getMarketLedgerDecoder().decode((await h.read(ledgers[0]))!);
  assert.deepEqual([btcLedger.insurance,btcLedger.fees,btcLedger.insuranceFeeRemainder],[3n,10n,1]);
  await record('cross ETH fill keeps maker BTC capital separate',await route(1,cross));
  const ethBefore=(await rootState(cross)).positions[1];
  const prepared=await route(0,cross);
  await fresh();
  await record('prepared cross BTC intent survives ordinary sampling',prepared);
  assert.equal((await rootState(cross)).positions[1].lots,ethBefore.lots);
  assert.equal((await rootState(cross)).positions[1].fundingCheckpointScaled,(await marketState(1)).fundingIndexScaled);
  await reject('root nonce and version reject route replay',[prepared],[owner],6122);
  await record('two-maker atomic route',await route(0,cross,0,2n,true));
  const selectedConsumption=await route(0,cross);
  await record('independent root consumes selected maker liquidity',await route(0,stressRoot));
  await reject('selected maker consumption changed despite unchanged trader guard',[selectedConsumption],[owner],6112);
  await record('independent root closes temporary exposure',await route(0,stressRoot,1,1n,false,true));
  const bad=await route(0,cross,0,2n,true);
  const aliased={...bad,accounts:bad.accounts!.map(account=>account.address===makers[0][1].capital?{...account,address:makers[0][0].capital}:account)};
  await reject('second maker alias rolls back first leg and carry',[aliased],[owner],2040);
  // Whole transaction rollback after a valid financial instruction, including fee carry/events.
  await reject('valid route followed by invalid activation rolls back all writes',[bad,sdk.getQualifyAccountTradingInstruction({...common,authority:payer,btc:markets[0],eth:markets[1]})],[owner],6108);

  const manage=async(marketIndex:number,operation:sdk.GroupOrderActionArgs,account=cross)=>sdk.getManageAccountOrderInstruction({
    ...common,actor:owner,btc:markets[0],eth:markets[1],margin:account,guard:await guard(account),marketIndex,operation});
  const terms=async(marketIndex:number,lots=2n)=>({side:0,lots,limit:marketIndex===0?66_000n:33_000n,feeBudget:1_000n,
    startSlot:await h.slot(),expirySlot:(await h.slot())+2000n,trigger:0,threshold:0n,reduceOnly:false,generation:0n});
  await record('reserve cross ETH order against whole account',await manage(1,{__kind:'Place',expectedId:1n,terms:await terms(1)}));
  assert((await rootState(cross)).reserved>0n);
  const delegate=await fixtureKey('p24-delegate');
  await record('owner grants root-local trading delegate',sdk.getSetAccountDelegateInstruction({...common,owner,margin:cross,
    guard:await guard(cross),delegate:delegate.address,expirySlot:(await h.slot())+2000n}));
  const delegated=sdk.getManageAccountOrderInstruction({...common,actor:delegate,btc:markets[0],eth:markets[1],margin:cross,
    guard:await guard(cross),marketIndex:0,operation:{__kind:'Place',expectedId:2n,terms:await terms(0,1n)}});
  await record('delegate creates durable order without cash authority',delegated,[delegate]);
  await record('revocation invalidates only delegated authority',sdk.getSetAccountDelegateInstruction({...common,owner,margin:cross,
    guard:await guard(cross),delegate:address('11111111111111111111111111111111'),expirySlot:0n}));
  const revoked=await rootState(cross);
  assert.equal(revoked.book.orders[0].order.state,1);
  assert.equal(revoked.book.orders[1].order.state,6);
  await record('owner cancels remaining ordinary order',await manage(1,{__kind:'Cancel',id:1n,version:1n,protectionGroup:false}));
  assert.equal((await rootState(cross)).reserved,0n);
  // Maximum supported live book on every touched route root, not only the trader.
  const stressed=[{margin:stressRoot,signer:owner},...makers[0].map(maker=>({margin:maker.capital,signer:maker.owner}))];
  for(const {margin,signer} of stressed) {
    for(let index=1;index<=4;index++) await record('maximum-book place current reserve',sdk.getManageAccountOrderInstruction({
      ...common,actor:signer,btc:markets[0],eth:markets[1],margin,guard:await guard(margin),marketIndex:0,
      operation:{__kind:'Place',expectedId:BigInt(index),terms:{...await terms(0,index===1?4n:1n),expirySlot:(await h.slot())+2000n}}}),[signer]);
  }
  await record('maximum three-root book two-maker route',await route(0,stressRoot,0,2n,true));
  for(const [lots,two] of [[2n,true],[1n,false]] as const) {
    const stored=(await rootState(stressRoot)).book.orders[0].order;
    const registrations=await Promise.all(makers[0].slice(0,two?2:1).map(async maker=>
      sdk.getFixedMakerRegistrationDecoder().decode((await h.read(maker.registration))!)));
    const execution=sdk.getExecuteAccountOrderInstruction({...routeAccounts(0,stressRoot,two),actor:payer,
      guard:await guard(stressRoot),id:stored.id,version:stored.version,filled:stored.filled,
      startSlot:await h.slot(),expirySlot:(await h.slot())+100n,lots,
      legs:registrations.map((registration,index)=>({lots:two?(index===0?1n:lots-1n):lots,
        quoteEpoch:registration.quoteEpoch,authorityEpoch:registration.authorityEpoch,expectedConsumed:registration.buyConsumed}))});
    await record(two?'maximum-book permissionless two-maker partial fill':'cumulative order-fee continuation',execution,[]);
    await reject('stale stored fill prefix cannot replay',[execution],[],6122);
  }

  for(const {margin,signer} of stressed) for(let index=1;index<=4;index++) await record('maximum-book release owner authority',
    sdk.getManageAccountOrderInstruction({...common,actor:signer,btc:markets[0],eth:markets[1],margin,guard:await guard(margin),marketIndex:0,
      operation:{__kind:'Cancel',id:BigInt(index),version:1n,protectionGroup:false}}),[signer]);
  await record('maximum-book account closes after releasing reservations',await route(0,stressRoot,1,5n,true,true));
  const position=(await rootState(cross)).positions[0];
  const protective={side:1,lots:position.lots,limit:50_000n,feeBudget:1_000n,startSlot:await h.slot(),expirySlot:(await h.slot())+2000n,
    trigger:1,threshold:65_000n,reduceOnly:true,generation:position.generation};
  await record('existing-position TP SL share one allowance',await manage(0,{__kind:'Protect',expectedId:3n,
    takeProfit:protective,stopLoss:{...protective,trigger:2,threshold:55_000n}}));
  assert.equal((await rootState(cross)).book.protections[0].protection.remaining,position.lots);
  await record('partial close conserves protection generation',await route(0,cross,1,1n,false,true));
  assert.equal((await rootState(cross)).positions[0].lots,position.lots-1n);
  await h.advance(2n);
  for(const source of [0,2])await setup.publish(source,{price:54_000_000_000n});
  await h.send('authenticated price crosses existing-position stop',[sdk.getSampleAccountOracleInstruction(setup.sampleAccounts(0))]);
  const stop=(await rootState(cross)).book.orders.find(entry=>entry.order.id===4n)!.order;
  const stopMaker=sdk.getFixedMakerRegistrationDecoder().decode((await h.read(makers[0][0].registration))!);
  await record('permissionless triggered SL reduces shared protective allowance',sdk.getExecuteAccountOrderInstruction({
    ...routeAccounts(0,cross),actor:payer,guard:await guard(cross),id:stop.id,version:stop.version,filled:stop.filled,
    startSlot:await h.slot(),expirySlot:(await h.slot())+100n,lots:1n,
    legs:[{lots:1n,quoteEpoch:stopMaker.quoteEpoch,authorityEpoch:stopMaker.authorityEpoch,expectedConsumed:stopMaker.sellConsumed}]}),[]);
  assert.equal((await rootState(cross)).positions[0].lots,position.lots-2n);
  await record('cancel protection without source freshness',await manage(0,{__kind:'Cancel',id:1n,version:1n,protectionGroup:true}));
  // The book/authority scenario deliberately does not run a background sampler.
  // A real wall-clock gap requires the full unchanged recovery before we test
  // that stale ETH does not constrain an otherwise healthy isolated BTC root.
  await fresh(4);
  assert.equal((await marketState(0)).oracle.status,2);
  await setup.publish(4,{published:(await h.now())-21n});
  await h.advance(2n);
  await h.send('ETH stale-source state is explicit',[sdk.getSampleAccountOracleInstruction(setup.sampleAccounts(1))]);
  assert.equal((await marketState(1)).oracle.status,0);
  await h.send('BTC remains independently sampled while ETH is stale',[sdk.getSampleAccountOracleInstruction(setup.sampleAccounts(0))]);
  await reject('cross BTC action cannot omit exposed stale ETH',[await route(0,cross)],[owner],6124);
  await record('isolated BTC action survives unrelated stale ETH',await route(0,operators[0].capital[0]));
  await fresh(4);
  await record('cross ETH reduce-only close',await route(1,cross,1,1n,false,true));
  const btcPosition=(await rootState(cross)).positions[0];
  await record('cross BTC reduce-only full close',await route(0,cross,1,btcPosition.lots,false,true));
  await record('isolated BTC full close',await route(0,operators[0].capital[0],1,2n,false,true));
  assert((await rootState(cross)).positions.every(position=>position.lots===0n));
  assert((await rootState(cross)).positions.some(position=>position.virtualScaled!==0n),'flat claims are preserved');
  // P25 owns real settlement/exits. The custody-only escape stays closed.
  await reject('active root cannot escape through custody withdrawal',[sdk.getWithdrawAccountCustodyInstruction({...common,
    owner,margin:cross,quoteMint:setup.mint.address,userToken:operators[0].token.address,amount:1n})],[owner],6108);
  await record('owner places order before operational pause',await manage(0,{__kind:'Place',expectedId:5n,terms:await terms(0,1n)}));
  const beforePause=await route(0,cross);
  await h.send('authority pauses qualified candidate',[sdk.getPauseVenueInstruction({...common,authority:payer,paused:true})]);
  await reject('paused candidate rejects freshly guarded trading',[await route(0,cross)],[owner],6101);
  await record('owner can cancel authority during pause',await manage(0,{__kind:'Cancel',id:5n,version:1n,protectionGroup:false}));
  await h.send('authority resumes same safety epoch boundary',[sdk.getPauseVenueInstruction({...common,authority:payer,paused:false})]);
  await reject('pre-pause signed intent cannot survive safety epoch',[beforePause],[owner],6122);
  return {...setup,financialSteps,rawAccounts:await raw(),route,routeAccounts,guard,fresh,rootState};
}
