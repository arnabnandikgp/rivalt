// Exercise the one-time directory seal on three separately funded capitals.
import assert from 'node:assert/strict';
import {AccountRole,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {registerFinancialTestMargin} from './account-membership-setup.js';
import {symmetricPayoutShape,type CanonicalHarness} from './canonical-maker-cases.js';
import type {ExpectedInstructionError} from './instruction-errors.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';

export async function qualifyListedDirectory(h:CanonicalHarness,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,
  listing:Address,otherListing:Address,firstCapital:Address,depth?:bigint) {
  const {venue,common,payer,traderOwner:owner,traderToken,mint}=setup;
  const {withCheckpoints}=executionTestHelpers(h,setup);
  const registrations=(await sdk.registeredMakerPdas(listing,3)).map(([address])=>address);
  const [portfolio]=await sdk.deriveAccountPortfolio(venue,owner.address,0);
  const [registry]=await sdk.findLiquidityRegistryPda({market:listing});
  const capitals=[firstCapital];
  const deposit=async(capital:Address)=>h.send('fund SOL directory member',await withCheckpoints(
    await sdk.getDepositAccountInstructionAsync({...common,owner,margin:capital,quoteMint:mint.address,
      userToken:traderToken.address,amount:100_000n})),[owner]);
  const seal=async(keys=registrations,authority=payer):Promise<Instruction>=>{
    const instruction=await sdk.getSealListedLiquidityInstructionAsync({...common,authority,listing,registry});
    return {...instruction,accounts:[...instruction.accounts,...keys.map(address=>({address,role:AccountRole.READONLY}))]};
  };
  const image=()=>Promise.all([listing,registry,otherListing,...registrations,...capitals,setup.vault,traderToken.address].map(h.read));
  const refuse=async(label:string,ix:Instruction,error:ExpectedInstructionError)=>{
    const before=await image();
    await h.send(label,[ix],ix.accounts?.some(meta=>meta.address===owner.address)?[owner]:[],error);
    assert.deepEqual(await image(),before,label);
  };
  await deposit(firstCapital);
  await refuse('one maker cannot seal SOL',await seal(),sdk.CLEARING_ERROR__MAKER_BINDING);
  for(const instance of [1,2]) {
    const operator=setup.instances[instance],subaccountIndex=instance+1;
    const [capital]=await sdk.deriveMarginAccount(portfolio,subaccountIndex);
    const [capitalBinding]=await sdk.deriveCapitalBinding(capital);
    await registerFinancialTestMargin(h,common,payer,{owner,portfolio,margin:capital,subaccountIndex,
      role:1,mode:1,isolatedMarketIndex:sdk.LISTED_CAPITAL_TAG});
    await deposit(capital);
    const [config]=await operator.module.findCurveConfigPda({capital});
    const [price]=await operator.module.findCurvePricePda({config});
    const shape=depth?{...symmetricPayoutShape,longCap:depth,shortCap:depth,
      asks:symmetricPayoutShape.asks.map((r,i)=>i===0?{...r,endLots:depth}:r),
      bids:symmetricPayoutShape.bids.map((r,i)=>i===0?{...r,endLots:depth}:r)}:symmetricPayoutShape;
    const curve=await operator.module.getInitializeListedCurveInstructionAsync({...operator.makerCommon,
      venue,owner,listing,capital,config,price,instance,shape,updater:setup.updater.address,expiry:1_000_000n});
    await h.send('initialize SOL directory curve '+instance,[curve],[owner]);
    const admit=await sdk.getAdmitListedMakerInstructionAsync({...common,authority:payer,owner,listing,capital,capitalBinding,
      registration:registrations[instance],instance,config,price,pricingProgram:operator.pricingProgram,
      programData:operator.controlCommon.programData});
    await h.send('admit SOL directory maker '+instance,[admit],[owner]);
    capitals.push(capital);
  }
  await refuse('reject incomplete SOL directory',await seal(registrations.slice(1)),sdk.CLEARING_ERROR__MAKER_BINDING);
  await refuse('reject reordered SOL directory',await seal([...registrations].reverse()),sdk.CLEARING_ERROR__MAKER_BINDING);
  const [[foreign]]=await sdk.registeredMakerPdas(otherListing,3);
  await refuse('reject another listing in SOL directory',await seal([foreign,...registrations.slice(1)]),sdk.CLEARING_ERROR__MAKER_BINDING);
  await refuse('owner cannot seal venue liquidity',await seal(registrations,owner),2001);
  const financialKeys=[...capitals,...registrations,setup.vault,traderToken.address,...setup.markets];
  const before=await Promise.all(financialKeys.map(h.read));
  const instruction=await seal();
  await h.send('seal SOL maker directory',[instruction]);
  assert.deepEqual(await Promise.all(financialKeys.map(h.read)),before);
  const parsed=sdk.getLiquidityRegistryDecoder().decode((await h.read(registry))!);
  assert.deepEqual([parsed.market,parsed.venue,parsed.revision,parsed.sealed,parsed.count,parsed.registrations],
    [listing,venue,1n,true,3,registrations]);
  assert.equal(sdk.getMarketListingDecoder().decode((await h.read(listing))!).status,1);
  await refuse('reject repeated SOL directory seal',instruction,0);
  return {registry,registrations,capitals,instruction};
}
