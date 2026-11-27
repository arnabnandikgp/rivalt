// Both listings have the same low byte. Their quote accounts and immutable
// capital bindings must still refer to the complete listing address.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getAddressEncoder,getProgramDerivedAddress,type Address,type Instruction} from '@solana/kit';
import {getMintToInstruction,getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {registerFinancialTestMargin} from './account-membership-setup.js';
import {symmetricPayoutShape,type CanonicalHarness} from './canonical-maker-cases.js';
import {appendCoverage} from './coverage-provisioning.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import type {ExpectedInstructionError} from './instruction-errors.js';
import {initializeFixtureFeed} from './oracle-fixture.js';

export async function qualifyListedMaker(h:CanonicalHarness,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,
  listing:Address,members:Map<Address,Address>) {
  const {payer,venue,common,primary,traderOwner:owner,traderToken:token,mint}=setup;
  const {guard,root}=executionTestHelpers(h,setup);
  const [portfolio]=await sdk.deriveAccountPortfolio(venue,owner.address,0);
  const [capital]=await sdk.deriveMarginAccount(portfolio,1);
  const [capitalBinding]=await sdk.deriveCapitalBinding(capital);
  await registerFinancialTestMargin(h,common,payer,{owner,portfolio,margin:capital,subaccountIndex:1,
    role:1,mode:1,isolatedMarketIndex:sdk.LISTED_CAPITAL_TAG});
  const tokenAmount=async(key:Address)=>getTokenDecoder().decode((await h.read(key))!).amount;
  const vaultBefore=await tokenAmount(setup.vault),walletBefore=await tokenAmount(token.address);
  const amount=1_234_567n;
  await h.send('mint listed maker test collateral',[getMintToInstruction({mint:mint.address,token:token.address,mintAuthority:payer,amount})]);
  const secondId=258,secondSymbol=sdk.listingSymbol('AVAX'),{feed,feedId}=await sdk.listingOracle('AVAX',primary.address);
  const [second]=await sdk.findListingPda({venue,marketId:secondId});
  await h.send('initialize second listing source',[initializeFixtureFeed(feed,primary.address,feedId)],[primary]);
  await h.send('register independent listed market 258',[await sdk.getRegisterMarketListingInstructionAsync({
    ...common,authority:payer,marketId:secondId,symbol:secondSymbol,lotsPerUnit:100_000n,oracleFeed:feed,oraclePublisher:primary.address})]);
  const encoder=getAddressEncoder();
  const operator=setup.instances[0],other=setup.instances[2];
  const configFor=async(program:Address)=>{
    const derive=async(prefix:string,key:Address)=>(await getProgramDerivedAddress({programAddress:program,
      seeds:[Buffer.from(prefix),encoder.encode(key)]}))[0];
    const config=await derive('curve-v4',capital);
    return {config,price:await derive('price-v4',config)};
  };
  const a=await configFor(operator.pricingProgram),b=await configFor(other.pricingProgram);
  const registrationFor=async(key:Address)=>(await getProgramDerivedAddress({programAddress:common.program,
    seeds:[Buffer.from('maker-v4'),encoder.encode(key),Uint8Array.of(0)]}))[0];
  const registration=await registrationFor(listing),secondRegistration=await registrationFor(second);
  const watch=[listing,second,capital,capitalBinding,registration,secondRegistration,a.config,a.price,b.config,b.price,setup.vault,token.address,
    ...setup.instances.map(maker=>maker.capital)];
  const image=()=>Promise.all(watch.map(h.read));
  async function reject(label:string,ix:Instruction,error:ExpectedInstructionError) {
    const before=await image();
    await h.send(label,[ix],[owner],error);
    assert.deepEqual(await image(),before,label);
  }
  const terms={venue,owner,capital,instance:0,shape:symmetricPayoutShape,updater:setup.updater.address,expiry:1_000_000n};
  await reject('listed maker cannot initialize a BTC curve',await operator.module.getInitializeCurveInstructionAsync({
    ...terms,...operator.makerCommon,...a,market:setup.markets[0]}),sdk.makerA.MAKER_A_ERROR__BINDING);
  const curve=await operator.module.getInitializeListedCurveInstructionAsync({...terms,...operator.makerCommon,...a,listing});
  await h.send('initialize SOL maker curve',[curve],[owner]);
  const deps={...common,...a,owner,authority:payer,capital,capitalBinding,registration,instance:0,
    listing,pricingProgram:operator.pricingProgram,programData:operator.controlCommon.programData};
  const admit=await sdk.getAdmitListedMakerInstructionAsync(deps);
  await reject('unfunded listed maker refuses admission',admit,sdk.CLEARING_ERROR__MAKER_CAPITAL);
  await h.send('deposit dedicated listed maker capital',[await sdk.getDepositAccountInstructionAsync({...common,
    owner,margin:capital,quoteMint:mint.address,userToken:token.address,amount})],[owner]);
  assert.equal((await root(capital)).cash,amount);
  assert.equal(await tokenAmount(setup.vault),vaultBefore+amount);
  assert.equal(await tokenAmount(token.address),walletBefore);
  await reject('first curve cannot serve listing 258',await sdk.getAdmitListedMakerInstructionAsync({...deps,listing:second,
    registration:secondRegistration}),sdk.CLEARING_ERROR__MAKER_BINDING);
  await h.send('admit funded SOL maker',[admit],[owner]);
  const record=sdk.getMakerRegistrationDecoder().decode((await h.read(registration))!);
  assert.deepEqual([record.market,record.capital,record.owner,record.config,record.price,record.authorityEpoch,record.depthEpoch],
    [listing,capital,owner.address,a.config,a.price,1n,1n]);
  assert.equal(Buffer.from(record.approvedHash).toString('hex'),createHash('sha256').update((await h.read(deps.programData))!).digest('hex'));
  assert.equal(sdk.getCapitalBindingDecoder().decode((await h.read(capitalBinding))!).registration,registration);
  const otherCurve=await other.module.getInitializeListedCurveInstructionAsync({...terms,...other.makerCommon,...b,listing:second});
  await h.send('publish alternative curve for listing 258',[otherCurve],[owner]);
  await reject('capital already bound to SOL cannot back listing 258',await sdk.getAdmitListedMakerInstructionAsync({
    ...deps,...b,listing:second,registration:secondRegistration,pricingProgram:other.pricingProgram,programData:other.controlCommon.programData}),0);
  const publish=operator.module.getRepriceInstruction({...operator.makerCommon,...a,actor:setup.updater,expectedControl:1n,expectedSequence:0n,anchor:150n});
  await h.send('updater reprices inactive SOL curve',[publish],[setup.updater]);
  assert.equal(operator.module.getMakerPriceDecoder().decode((await h.read(a.price))!).state.anchor,150n);
  assert.equal((await root(capital)).cash,amount);
  const exit=sdk.getWithdrawFundedAccountInstruction({...common,owner,margin:capital,userToken:token.address,
    quoteMint:mint.address,guard:await guard(capital),amount});
  await h.send('listed maker withdraws full cash to wallet',[appendCoverage(exit,[members.get(capital)!])],[owner]);
  assert.equal((await root(capital)).cash,0n);
  assert.equal(await tokenAmount(setup.vault),vaultBefore);
  assert.equal(await tokenAmount(token.address),walletBefore+amount);
  return {capital,capitalBinding,registration,listing:second,amount,curve,admit,otherCurve};
}
