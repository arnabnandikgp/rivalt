/** Real signed setup shared by successor acceptance. No financial bytes are injected. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS, getInitializeMint2Instruction, getInitializeAccount3Instruction, getMintToInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { addresses, fixtureKey, payerKey, LOADER } from './custody-cases.js';
import { groupPda, groupMarket } from './group-custody-cases.js';
import { ORACLE_FIXTURE } from './oracle-fixture.js';
import type { GroupTradingHarness } from './group-trading-cases.js';
import type { Keypair } from '@solana/web3.js';

const encoder = getAddressEncoder();
export const u16 = (value: number) => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; };
const discriminator = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0,8);

export async function groupFixture(h: GroupTradingHarness, namespace = 'p18c', makerDuration=3600n) {
  const payer = await payerKey(), deployment = await addresses();
  const owner = await fixtureKey(`${namespace}-trader`), mint = await fixtureKey(`${namespace}-mint`);
  const makerOwners = await Promise.all([0,1].map(index => fixtureKey(`${namespace}-maker-${index}`)));
  const primary = await fixtureKey(`${namespace}-primary`), guardAuthority = await fixtureKey(`${namespace}-guard`);
  const domain = createHash('sha256').update(`rivalt/${namespace}/two-markets`).digest();
  const group = await groupPda('group-v2',domain), registry = await groupPda('registry-v2',encoder.encode(group));
  const vault = await groupPda('vault-v2',encoder.encode(group));
  const guard = await groupPda('exit-v2',encoder.encode(group)), resolution = await groupPda('resolution-v2',encoder.encode(group));
  const common = {group,registry,vault,program:deployment.program,eventAuthority:deployment.eventAuthority};
  const markets = [await groupMarket(group,0),await groupMarket(group,1)];
  const safety = {...common,btc:markets[0],eth:markets[1],guard,resolution};
  const marketState = async (index: number) => sdk.getGroupMarketV2Decoder().decode((await h.read(markets[index]))!);
  const groupState = async () => sdk.getClearingGroupV2Decoder().decode((await h.read(group))!);
  const rootState = async (root:Address) => sdk.getMarginAccountV2Decoder().decode((await h.read(root))!);
  const stamp = async () => ({sequence:(await groupState()).sequence,observations:await Promise.all([0,1].map(async index=>(await marketState(index)).observationSequence))});
  const roots: Address[]=[];
  for (const signer of [owner,...makerOwners,primary,guardAuthority]) await h.send('setup rent funds',[
    getTransferSolInstruction({source:payer,destination:signer.address,amount:1_000_000_000n})]);
  await h.send('setup collateral mint',[getCreateAccountInstruction({payer,newAccount:mint,lamports:await h.rent(82),space:82n,programAddress:TOKEN_PROGRAM_ADDRESS}),
    getInitializeMint2Instruction({mint:mint.address,decimals:6,mintAuthority:payer.address})],[mint]);
  await h.send('setup clearing group',[await sdk.getInitializeGroupV2InstructionAsync({...common,authority:payer,programData:deployment.programData,quoteMint:mint.address,domain})]);
  for (const index of [0,1]) await h.send('setup market identity',[sdk.getInitializeGroupMarketV2Instruction({...common,authority:payer,market:markets[index],index})]);
  const operators: {owner:Keypair;portfolio:Address;token:Keypair;capital:Address[]}[]=[];
  for (const [index,signer] of [owner,...makerOwners].entries()) {
    const portfolio=await groupPda('portfolio-v2',encoder.encode(group),encoder.encode(signer.address),u16(0));
    const token=await fixtureKey(`${namespace}-token-${index}`);
    await h.send('setup operator tokens',[getCreateAccountInstruction({payer,newAccount:token,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
      getInitializeAccount3Instruction({account:token.address,mint:mint.address,owner:signer.address}),
      getMintToInstruction({mint:mint.address,token:token.address,mintAuthority:payer,amount:2_000_000_000n})],[token]);
    await h.send('setup portfolio',[await sdk.getCreatePortfolioV2InstructionAsync({...common,owner:signer,portfolio,index:0})],[signer]);
    const capital:Address[]=[];
    for (const marketIndex of [0,1]) {
      const margin=await groupPda('margin-v2',encoder.encode(portfolio),u16(marketIndex+1));
      await h.send('setup isolated root',[await sdk.getRegisterMarginV2InstructionAsync({...common,owner:signer,portfolio,margin,
        subaccountIndex:marketIndex+1,mode:1,isolatedMarketIndex:marketIndex,role:index===0?0:1})],[signer]);
      await h.send('fund isolated root',[await sdk.getDepositGroupV2InstructionAsync({...common,owner:signer,margin,
        quoteMint:mint.address,userToken:token.address,amount:index===0?1_000_000n:500_000_000n})],[signer]);
      roots.push(margin);capital.push(margin);
    }
    operators.push({owner:signer,portfolio,token,capital});
  }
  const cross=await groupPda('margin-v2',encoder.encode(operators[0].portfolio),u16(0));
  await h.send('setup dormant cross root',[await sdk.getRegisterMarginV2InstructionAsync({...common,owner,portfolio:operators[0].portfolio,
    margin:cross,subaccountIndex:0,mode:0,isolatedMarketIndex:255,role:0})],[owner]);roots.push(cross);
  type Maker = typeof common & {owner:Keypair;authority:Keypair;market:Address;capital:Address;config:Address;
    registration:Address;groupBinding:Address;pricingProgram:Address;programData:Address;api:typeof sdk.makerA|typeof sdk.makerB;makerId:number};
  const makers:Maker[][]=[];
  for (const marketIndex of [0,1]) {
    const pair:Maker[]=[];
    for (const makerId of [0,1]) {
      const api=makerId===0?sdk.makerA:sdk.makerB, signer=makerOwners[makerId];
      const pricingProgram=makerId===0?sdk.makerA.MAKER_A_PROGRAM_ADDRESS:sdk.makerB.MAKER_B_PROGRAM_ADDRESS;
      const capital=operators[makerId+1].capital[marketIndex], market=markets[marketIndex];
      const [config]=await getProgramDerivedAddress({programAddress:pricingProgram,seeds:[Buffer.from('maker-v2'),encoder.encode(capital)]});
      const [programData]=await getProgramDerivedAddress({programAddress:LOADER,seeds:[encoder.encode(pricingProgram)]});
      const registration=await groupPda('registration-v2',encoder.encode(market),Uint8Array.of(makerId));
      const groupBinding=await groupPda('binding-v2',encoder.encode(group),encoder.encode(capital));
      const accounts={...common,owner:signer,authority:payer,market,capital,config,registration,groupBinding,pricingProgram,programData};
      await h.send('setup maker config',[await api.getInitializeGroupConfigInstructionAsync({...accounts,duration:makerDuration})],[signer]);
      await h.send('admit funded maker',[await sdk.getRegisterGroupMakerV2InstructionAsync({...accounts,makerId,inventoryLimit:100_000n})],[signer]);
      pair.push({...accounts,api,makerId});
    }
    makers.push(pair);
  }
  const feeds:{feed:Address;signer:Keypair;index:number}[]=[];
  for(let index=0;index<6;index++) {
    const signer=[0,1,4].includes(index)?primary:guardAuthority,id=Buffer.alloc(32,index+1);
    const [feed]=await getProgramDerivedAddress({programAddress:ORACLE_FIXTURE,seeds:[Buffer.from('feed'),encoder.encode(signer.address),id]});
    await h.send('setup signed source',[{programAddress:ORACLE_FIXTURE,accounts:[{address:signer.address,role:AccountRole.WRITABLE_SIGNER},
      {address:feed,role:AccountRole.WRITABLE},{address:address('11111111111111111111111111111111'),role:AccountRole.READONLY}],data:Buffer.concat([discriminator('initialize'),id])}],[signer]);
    feeds.push({feed,signer,index});
  }
  const prices=[60_000_000_000n,1_000_000n,60_000_000_000n,1_000_000n,3_000_000_000n,3_000_000_000n];
  async function publish(index:number,change:{price?:bigint;published?:bigint;level?:number}={}) {
    const source=feeds[index],data=Buffer.alloc(69);discriminator('publish').copy(data);data.set(encoder.encode(ORACLE_FIXTURE),8);data[40]=change.level??2;
    if(change.price!==undefined)prices[index]=change.price;
    data.writeBigInt64LE(prices[index],41);data.writeBigUInt64LE(0n,49);data.writeInt32LE(-6,57);data.writeBigInt64LE(change.published??await h.now(),61);
    await h.send('publish signed source',[{programAddress:ORACLE_FIXTURE,accounts:[{address:source.signer.address,role:AccountRole.READONLY_SIGNER},
      {address:source.feed,role:AccountRole.WRITABLE}],data}],[source.signer]);
  }
  const sampleAccounts=(index:number)=>{
    const [first,second]=makers[index];
    return {...common,market:markets[index],primaryAsset:feeds[index===0?0:4].feed,primaryCollateral:feeds[1].feed,
      guardAsset:feeds[index===0?2:5].feed,guardCollateral:feeds[3].feed,
      firstCapital:first.capital,firstRegistration:first.registration,firstProgram:first.pricingProgram,firstProgramData:first.programData,firstConfig:first.config,
      secondCapital:second.capital,secondRegistration:second.registration,secondProgram:second.pricingProgram,secondProgramData:second.programData,secondConfig:second.config};
  };
  const sources={primaryBtc:feeds[0].feed,primaryCollateral:feeds[1].feed,guardBtc:feeds[2].feed,guardCollateral:feeds[3].feed,primaryEth:feeds[4].feed,guardEth:feeds[5].feed};
  for(const index of [0,1])await h.send('bind source identities',[await sdk.getInitializeGroupOracleV2Instruction({...common,market:markets[index],authority:payer,primary:primary.address,guard:guardAuthority.address})]);
  async function qualify(rounds=4) {
    for(let round=0;round<rounds;round++) {
      await h.advance(2n);
      for(let index=0;index<6;index++)await publish(index);
      for(const index of [0,1])await h.send('qualify market sources',[await sdk.getSampleGroupOracleV2Instruction(sampleAccounts(index))]);
    }
    for(const index of [0,1])assert.equal((await marketState(index)).oracle.status,2);
  }
  return {payer,owner,mint,domain,common,safety,group,registry,vault,guard,resolution,markets,roots,cross,operators,makers,feeds,
    sources,sampleAccounts,publish,qualify,marketState,groupState,rootState,stamp};
}
