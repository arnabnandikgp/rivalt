import assert from 'node:assert/strict';
import {AccountRole,getAddressEncoder,type Address,type Instruction} from '@solana/kit';
import {getCreateAccountInstruction} from '@solana-program/system';
import {TOKEN_PROGRAM_ADDRESS,getInitializeAccount3Instruction,getTokenDecoder,getTransferCheckedInstruction} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {fixtureKey} from './custody-cases.js';
import {accountPda} from './account-custody-cases.js';
import {accountTradingSetup,type AccountTradingHarness} from './account-trading-setup.js';

export async function accountCashCases(h:AccountTradingHarness) {
  const setup=await accountTradingSetup(h,{qualifyPrimitives:false,domainLabel:'rivalt/p25/cash-and-market-claims'});
  const {markets,ledgers,makers,cross,owner,payer,operators,domain,marketState}=setup;
  const common={...setup.common,btc:markets[0],eth:markets[1]};
  const rootState=async(root:Address)=>sdk.getMarginAccountDecoder().decode((await h.read(root))!);
  const guard=async(root:Address)=>{
    const state=await rootState(root),safety=sdk.getVenueSafetyDecoder().decode((await h.read(common.safety))!);
    return {safetyEpoch:safety.epoch,venueTermsEpoch:1n,nonce:state.nonce,stateVersion:state.stateVersion};
  };
  const prices=[60_000_000_000n,1_000_000n,60_000_000_000n,1_000_000n,3_000_000_000n,3_000_000_000n];
  async function fresh(rounds=1) {
    for(let round=0;round<rounds;round++) {
      await h.advance(2n);
      for(let index=0;index<6;index++)await setup.publish(index,{price:prices[index]});
      for(const index of [0,1])await h.send('P25 actual source sampling',[sdk.getSampleAccountOracleInstruction(setup.sampleAccounts(index))]);
    }
  }
  const feeToken=await fixtureKey('p25-fee-token');
  await h.send('fee authority token destination',[getCreateAccountInstruction({payer,newAccount:feeToken,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
    getInitializeAccount3Instruction({account:feeToken.address,mint:setup.mint.address,owner:payer.address})],[feeToken]);
  const certificates=await Promise.all([0,1].map(index=>accountPda('settlement-v3',getAddressEncoder().encode(common.venue),Uint8Array.of(index))));
  const userTokens=[...operators.map(operator=>operator.token.address),feeToken.address];
  const financialKeys=()=>[common.custody,common.safety,common.vault,setup.mint.address,...userTokens,...markets,...ledgers,...setup.roots,
    ...makers.flat().map(maker=>maker.registration),...certificates];
  const raw=async()=>Object.fromEntries((await Promise.all(financialKeys().map(async key=>[key,(await h.read(key))?.toString('base64')??null] as const))).filter((entry):entry is readonly [Address,string]=>entry[1]!==null));
  const financialSteps:{label:string;instructions:{data:string;accounts:string[]}[];before:Record<string,string>;after:Record<string,string>}[]=[];
  async function record(label:string,instructions:Instruction|Instruction[],signers=[owner]) {
    const before=await raw();await h.send(label,Array.isArray(instructions)?instructions:[instructions],signers);
    financialSteps.push({label,instructions:(Array.isArray(instructions)?instructions:[instructions]).map(instruction=>({
      data:Buffer.from(instruction.data??[]).toString('base64'),accounts:instruction.accounts!.map(account=>account.address)})),before,after:await raw()});
  }
  async function reject(label:string,instructions:Instruction|Instruction[],signers:typeof owner[],error:number) {
    const before=await raw();await h.send(label,Array.isArray(instructions)?instructions:[instructions],signers,error);
    assert.deepEqual(await raw(),before,`${label}: financial/certificate/token rollback`);
  }
  const cashAccounts=(margin:Address=cross)=>({...common,owner,margin,quoteMint:setup.mint.address,userToken:operators[0].token.address});
  const withdraw=async(amount:bigint,margin:Address=cross)=>sdk.getWithdrawFundedAccountInstruction({...cashAccounts(margin),guard:await guard(margin),amount});
  const transfer=async(amount:bigint)=>sdk.getTransferFundedAccountInstruction({...common,owner,donor:cross,recipient:operators[0].capital[0],guard:await guard(cross),amount});
  async function route(index:number,side=0,lots=1n,trader:Address=cross) {
    const maker=makers[index][0],market=await marketState(index),state=await rootState(trader);
    const registration=sdk.getFixedMakerRegistrationDecoder().decode((await h.read(maker.registration))!);
    const slot=await h.slot();
    return sdk.getExecuteAccountRouteInstruction({...common,actor:owner,market:markets[index],otherMarket:markets[1-index],
      ledger:ledgers[index],otherLedger:ledgers[1-index],trader,firstCapital:maker.capital,firstRegistration:maker.registration,
      firstProgram:maker.pricingProgram,firstProgramData:maker.programData,firstConfig:maker.config,
      secondCapital:undefined,secondRegistration:undefined,secondProgram:undefined,secondProgramData:undefined,secondConfig:undefined,
      guard:await guard(trader),domain,termsEpoch:market.termsEpoch,configEpoch:market.configEpoch,startSlot:slot,expirySlot:slot+100n,
      side,lots,allInLimit:side===0?lots*market.referencePrice*11n/10n:lots*market.referencePrice*9n/10n,maxFee:1000n,
      reduceOnly:side===1,generation:side===1?state.positions[index].generation:null,
      legs:[{lots,quoteEpoch:registration.quoteEpoch,authorityEpoch:registration.authorityEpoch,
        expectedConsumed:side===0?registration.buyConsumed:registration.sellConsumed}]});
  }
  await reject('cash candidate cannot activate trading implicitly',await withdraw(1n),[owner],6108);
  await h.send('P25 isolated candidate qualification',[sdk.getQualifyAccountTradingInstruction({...common,authority:payer})]);
  await record('source-independent active deposit',sdk.getDepositAccountInstruction({...cashAccounts(),amount:200_000n}));
  await record('flat cash exit before any recovered price',await withdraw(100n));
  for(const index of [0,1])await h.send('initialize scoped market certificate',[await sdk.getInitializeMarketBackingInstructionAsync({
    ...common,payer,certificate:certificates[index],marketIndex:index})]);
  await fresh(4);
  await record('open funded cross BTC',await route(0));
  await record('open funded cross ETH',await route(1));
  const prepared=await withdraw(100n);
  await fresh();
  await record('unrelated account deposit changes history',sdk.getDepositAccountInstruction({...cashAccounts(operators[0].capital[1]),amount:17n}));
  await record('prepared atomic funded exit survives sampling and unrelated cash',prepared);
  await reject('funded exit exact root guard rejects replay',prepared,[owner],6122);
  await reject('exit cannot withdraw positive unpaid credit or reserved IM',await withdraw((await rootState(cross)).cash),[owner],6100);
  await record('whole-account donor transfer preserves vault',await transfer(100n));
  const rollback=await withdraw(1n);
  await reject('valid token exit followed by stale replay rolls back',[rollback,rollback],[owner],6122);
  const foreign=sdk.getWithdrawFundedAccountInstruction({...cashAccounts(),owner:operators[1].owner,guard:await guard(cross),amount:1n});
  await reject('foreign owner cannot withdraw root cash',foreign,[operators[1].owner],2001);

  await reject('foreign destination cannot receive withdrawal',sdk.getWithdrawFundedAccountInstruction({
    ...cashAccounts(),userToken:operators[1].token.address,guard:await guard(cross),amount:1n}),[owner],2015);
  await reject('same root cannot transfer to itself',sdk.getTransferFundedAccountInstruction({
    ...common,owner,donor:cross,recipient:cross,guard:await guard(cross),amount:1n}),[owner],2040);
  await reject('transfer cannot fund foreign owner root',sdk.getTransferFundedAccountInstruction({
    ...common,owner,donor:cross,recipient:operators[1].capital[0],guard:await guard(cross),amount:1n}),[owner],2001);
  const delegate=await fixtureKey('p25-cash-delegate');
  await record('owner grants trading delegate without cash authority',sdk.getSetAccountDelegateInstruction({
    ...common,owner,margin:cross,guard:await guard(cross),delegate:delegate.address,expirySlot:(await h.slot())+2000n}));
  await reject('trading delegate cannot withdraw',sdk.getWithdrawFundedAccountInstruction({
    ...cashAccounts(),owner:delegate,guard:await guard(cross),amount:1n}),[delegate],2001);
  const manage=async(operation:sdk.GroupOrderActionArgs)=>sdk.getManageAccountOrderInstruction({
    ...common,actor:owner,margin:cross,guard:await guard(cross),marketIndex:0,operation});
  await fresh();
  const slot=await h.slot();
  await record('place cash-reserving order',await manage({__kind:'Place',expectedId:1n,terms:{
    side:0,lots:4n,limit:66_000n,feeBudget:1000n,startSlot:slot,expirySlot:slot+2000n,
    trigger:0,threshold:0n,reduceOnly:false,generation:0n}}));
  await reject('cash exit respects durable order reservation',await withdraw((await rootState(cross)).cash-20_000n),[owner],6100);
  await record('owner cancels cash reservation',await manage({__kind:'Cancel',id:1n,version:1n,protectionGroup:false}));
  for(const margin of [cross,operators[0].capital[0]])for(let offset=0;offset<4;offset++) {
    const expectedId=(await rootState(margin)).book.lastOrderId+1n;
    await record('fill cash-action book capacity',sdk.getManageAccountOrderInstruction({
      ...common,actor:owner,margin,guard:await guard(margin),marketIndex:0,operation:{__kind:'Place',expectedId,terms:{
        side:0,lots:1n,limit:66_000n,feeBudget:1000n,startSlot:await h.slot(),expirySlot:(await h.slot())+2000n,
        trigger:0,threshold:0n,reduceOnly:false,generation:0n}}}));
  }
  await record('maximum-book funded exit',await withdraw(1n));
  await record('maximum two-root book cash transfer',await transfer(1n));
  for(const margin of [cross,operators[0].capital[0]])for(const entry of (await rootState(margin)).book.orders) {
    await record('release cash-action book capacity',sdk.getManageAccountOrderInstruction({
      ...common,actor:owner,margin,guard:await guard(margin),marketIndex:0,
      operation:{__kind:'Cancel',id:entry.order.id,version:entry.order.version,protectionGroup:false}}));
  }
  await h.advance(22n);
  await reject('exposed cash exit rejects stale sources',await withdraw(1n),[owner],6124);
  await fresh(4);
  const position=(await rootState(cross)).positions[0];
  const protection={side:1,lots:1n,limit:50_000n,feeBudget:1000n,startSlot:await h.slot(),expirySlot:(await h.slot())+2000n,
    trigger:1,threshold:65_000n,reduceOnly:true,generation:position.generation};
  await record('protect existing position before funded exit',await manage({__kind:'Protect',expectedId:(await rootState(cross)).book.lastOrderId+1n,
    takeProfit:protection,stopLoss:{...protection,trigger:2,threshold:55_000n}}));
  await record('funded exit preserves shared TP SL allowance',await withdraw(1n));
  assert.equal((await rootState(cross)).book.protections[0].protection.remaining,1n);
  await record('cancel shared protection before flat settlement',await manage({__kind:'Cancel',id:1n,version:1n,protectionGroup:true}));
  prices[0]=prices[2]=60_100_000_000n;
  prices[4]=prices[5]=2_990_000_000n;
  await fresh();
  await record('close profitable BTC claim',await route(0,1));
  await record('close losing ETH claim',await route(1,1));
  const flat=await rootState(cross);
  assert(flat.positions.every(position=>position.lots===0n));
  assert(flat.positions[0].virtualScaled>0n && flat.positions[1].virtualScaled<0n);
  const claims=(index:number,margin:Address)=>({...common,actor:payer,margin,registry:common.registry,
    certificate:undefined,marketIndex:index});
  const net=async(amount:bigint)=>sdk.getNetAccountClaimsInstruction({...common,owner,margin:cross,registry:common.registry,
    certificate:certificates[0],guard:await guard(cross),sourceMarket:0,amount});
  await reject('unscanned certificate cannot authorize netting',await net(1n),[owner],6121);
  await scan(0);
  await reject('valid certificate cannot authorize unfunded netting',await net(1n),[owner],6106);
  const btcDebtor=await rootState(makers[0][0].capital);
  const collectable=-btcDebtor.positions[0].virtualScaled/1_000_000_000n;
  assert(collectable>0n);
  await record('whole BTC loss collection funds only BTC P',sdk.getCollectAccountLossInstruction({...claims(0,makers[0][0].capital),amount:collectable}),[]);
  async function page(index:number,start:number,count=2,keys?:Address[]) {
    const registry=sdk.getVenueRegistryDecoder().decode((await h.read(common.registry))!);
    const instruction=sdk.getCheckMarketBackingInstruction({...common,ledger:ledgers[index],certificate:certificates[index],start});
    return {...instruction,accounts:[...instruction.accounts,
      ...(keys??registry.members.slice(start,start+count)).map(address=>({address,role:AccountRole.READONLY}))]};
  }
  async function scan(index:number,pageSize=2) {
    const registry=sdk.getVenueRegistryDecoder().decode((await h.read(common.registry))!);
    for(let start=0;start<registry.count;start+=pageSize)
      await h.send('canonical market backing page',[await page(index,start,pageSize)]);
    assert.equal(sdk.getSettlementCertificateDecoder().decode((await h.read(certificates[index]))!).complete,true);
  }
  await reject('certificate cannot skip first member',await page(0,1),[],6121);
  await reject('certificate cannot omit every member',await page(0,0,0),[],6121);
  await reject('certificate rejects oversized page',await page(0,0,3),[],6121);
  await reject('certificate rejects reordered canonical members',await page(0,0,2,[setup.roots[1],setup.roots[0]]),[],6121);
  const writablePage=await page(0,0);
  await reject('certificate rejects writable cohort member',{...writablePage,accounts:writablePage.accounts.map(account=>
    account.address===setup.roots[0]?{...account,role:AccountRole.WRITABLE}:account)},[],6121);
  await h.send('begin canonical certificate',[await page(0,0)]);
  await reject('certificate rejects repeated page',await page(0,0),[],6121);
  await record('selected claim cash invalidates incomplete certificate',sdk.getDepositAccountInstruction({
    ...cashAccounts(),amount:1n}));
  await reject('certificate rejects continuation after relevant cash',await page(0,2),[],6121);
  await scan(0);
  await reject('permissionless restart cannot erase valid certificate',await page(0,0),[],6121);
  const completed=await h.read(certificates[0]);
  await fresh();
  await record('unrelated ETH-only cash preserves BTC certificate',sdk.getDepositAccountInstruction({
    ...cashAccounts(operators[0].capital[1]),amount:3n}));
  assert.deepEqual(await h.read(certificates[0]),completed);
  const netAmount=flat.positions[0].virtualScaled/1_000_000_000n;
  const cashBeforeNet=(await rootState(cross)).cash;
  await record('funded flat netting shifts P and preserves account cash',await net(netAmount));
  const netted=await rootState(cross);
  assert.equal(netted.cash,cashBeforeNet);
  assert(netted.positions[0].virtualScaled>=0n && netted.positions[0].virtualScaled<1_000_000_000n);
  await reject('consumed certificate cannot pay again',sdk.getPayAccountGainInstruction({...claims(0,cross),certificate:certificates[0],amount:1n}),[],6121);
  const remaining=-netted.positions[1].virtualScaled/1_000_000_000n;
  await record('remaining ETH debt collection preserves its fraction',sdk.getCollectAccountLossInstruction({...claims(1,cross),amount:remaining}),[]);
  await scan(1);
  const ethPool=sdk.getMarketLedgerDecoder().decode((await h.read(ledgers[1]))!).settlement;
  await record('ETH funded gain pays its own maker creditor',sdk.getPayAccountGainInstruction({
    ...claims(1,makers[1][0].capital),certificate:certificates[1],amount:ethPool}),[]);

  const feeAccounts={...common,feeAuthority:payer,quoteMint:setup.mint.address,userToken:undefined};
  const btcLedger=sdk.getMarketLedgerDecoder().decode((await h.read(ledgers[0]))!);
  assert(btcLedger.fees>3n);
  await reject('foreign signer cannot allocate protocol fees',sdk.getAllocateMarketFeesInstruction({
    ...feeAccounts,feeAuthority:owner,marketIndex:0,amount:1n}),[owner],6102);
  await reject('protocol fee withdrawal requires fee-owned destination',sdk.getWithdrawMarketFeesInstruction({
    ...feeAccounts,userToken:operators[0].token.address,marketIndex:0,amount:1n}),[],2015);
  await reject('protocol fee withdrawal requires actual token destination',sdk.getWithdrawMarketFeesInstruction({
    ...feeAccounts,marketIndex:0,amount:1n}),[],6103);
  await record('fee authority explicitly allocates T to market I',sdk.getAllocateMarketFeesInstruction({...feeAccounts,marketIndex:0,amount:2n}),[]);
  await record('fee authority withdraws only retained funded T',sdk.getWithdrawMarketFeesInstruction({...feeAccounts,userToken:feeToken.address,marketIndex:0,amount:1n}),[]);
  assert.equal(getTokenDecoder().decode((await h.read(feeToken.address))!).amount,1n);
  await reject('fee authority cannot spend reserve as retained fee',sdk.getWithdrawMarketFeesInstruction({
    ...feeAccounts,userToken:feeToken.address,marketIndex:0,amount:btcLedger.fees}),[],6100);
  await record('flat funded cash exit retains residual unpaid fractions',await withdraw(1n));
  // Actual active reserve flows remain distinct from C and P.
  await record('active donor funds selected insurance',sdk.getSeedMarketInsuranceInstruction({
    ...common,reserveAuthority:payer,donor:owner,donorToken:operators[0].token.address,
    quoteMint:setup.mint.address,marketIndex:1,amount:7n}));
  await record('unsolicited transfer stays unallocated',getTransferCheckedInstruction({
    source:operators[0].token.address,mint:setup.mint.address,destination:common.vault,authority:owner,amount:5n,decimals:6}));
  await record('reserve authority classifies actual surplus',sdk.getClassifyMarketSurplusInstruction({
    ...common,reserveAuthority:payer,marketIndex:0,amount:5n}),[]);
  await reject('classification cannot manufacture reserve',sdk.getClassifyMarketSurplusInstruction({
    ...common,reserveAuthority:payer,marketIndex:0,amount:1n}),[],6106);

  // Grow actual active identities to the supported maximum. No injected roots.
  // Flat claims intentionally need no sampling throughout these complete scans.
  const u16=(value:number)=>{const bytes=Buffer.alloc(2);bytes.writeUInt16LE(value);return bytes;};
  for(const operator of operators)for(let portfolioIndex=0;portfolioIndex<4 && setup.roots.length<64;portfolioIndex++) {
    const portfolio=await accountPda('portfolio-v3',getAddressEncoder().encode(common.venue),getAddressEncoder().encode(operator.owner.address),u16(portfolioIndex));
    if(portfolioIndex!==0)await h.send('active owner creates portfolio',[await sdk.getCreatePortfolioInstructionAsync({
      ...common,owner:operator.owner,portfolio,index:portfolioIndex})],[operator.owner]);
    for(let child=0;child<9 && setup.roots.length<64;child++) {
      const margin=await accountPda('margin-v3',getAddressEncoder().encode(portfolio),u16(child));
      if(setup.roots.includes(margin))continue;
      await h.send('active owner registers stable margin root',[await sdk.getRegisterMarginInstructionAsync({
        ...common,owner:operator.owner,portfolio,margin,subaccountIndex:child,mode:child===0?0:1,
        isolatedMarketIndex:child===0?255:(child-1)%2,role:0})],[operator.owner]);
      setup.roots.push(margin);
    }
  }
  assert.equal(setup.roots.length,64);
  await scan(0,2);
  await scan(1,1);
  await record('funded cash exits with complete 64-member registry',await withdraw(1n));
  // Produce real bad debt with signed trades and authenticated price changes.
  // An unrelated market's debtor cannot veto a BTC-only backing certificate.
  await fresh(4);
  const isolatedEth=operators[0].capital[1];
  await record('isolate ETH risk with bounded funded cash',await withdraw((await rootState(isolatedEth)).cash-4_000n,isolatedEth));
  await record('open independent ETH-only debtor',await route(1,0,1n,isolatedEth));
  prices[4]=prices[5]=2_000_000_000n;
  await fresh();
  await reject('underfunded isolated debtor cannot be normally collected',sdk.getCollectAccountLossInstruction({
    ...claims(1,isolatedEth),amount:1n}),[],6121);
  await scan(0);
  await record('flat donor funds unhealthy recipient without fresh recipient price',sdk.getTransferFundedAccountInstruction({
    ...common,owner,donor:cross,recipient:isolatedEth,guard:await guard(cross),amount:100n}));
  await record('actual deposit repairs isolated ETH debt',sdk.getDepositAccountInstruction({...cashAccounts(isolatedEth),amount:20_000n}));
  await fresh(4);
  await record('close repaired ETH-only debtor',await route(1,1,1n,isolatedEth));

  // A shared debtor is checked against both gross claims, with no preferred
  // market collector and no positive receivable credit.
  await record('bound shared debtor funded cash',await withdraw((await rootState(cross)).cash-10_000n));
  await record('open shared debtor BTC',await route(0));
  await record('open shared debtor ETH',await route(1));
  prices[0]=prices[2]=50_000_000_000n;
  prices[4]=prices[5]=1_000_000_000n;
  await fresh();
  for(const marketIndex of [0,1])await reject('underfunded shared debtor cannot choose collection market',
    sdk.getCollectAccountLossInstruction({...claims(marketIndex,cross),amount:1n}),[],6121);
  for(const start of [0,2,4])await h.send('backing page before shared debtor',[await page(0,start)]);
  await reject('selected BTC scan rejects whole shared debtor insolvency',await page(0,6),[],6121);
  await record('actual deposit repairs shared gross debt',sdk.getDepositAccountInstruction({...cashAccounts(),amount:30_000n}));
  await fresh(4);
  await record('close repaired shared BTC debtor',await route(0,1));
  await record('close repaired shared ETH debtor',await route(1,1));
  await scan(0);
  await scan(1);
  return {...setup,common,certificates,userTokens,feeToken,financialSteps,rawAccounts:await raw(),
    rootState,guard,route,fresh,withdraw,scan,reject,record,raw};
}
