import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS, getInitializeMint2Instruction, getInitializeAccount3Instruction, getMintToInstruction, getTokenDecoder } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { addresses, fixtureKey, payerKey, LOADER, type Harness } from './custody-cases.js';
import { groupPda, groupMarket } from './group-custody-cases.js';
import { ORACLE_FIXTURE } from './oracle-fixture.js';
import type { Keypair } from '@solana/web3.js';

export type GroupTradingHarness = Harness & {
  now(): Promise<bigint>;
  slot(): Promise<bigint>;
  advance(seconds: bigint, slots?: bigint): Promise<void>;
  quote(label: string, instruction: Instruction): Promise<Uint8Array>;
};
const encoder = getAddressEncoder();
const u16 = (value: number) => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; };
const discriminator = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0,8);

export async function groupTradingCases(h: GroupTradingHarness) {
  const payer = await payerKey(), deployment = await addresses();
  const owner = await fixtureKey('p18b-trader'), mint = await fixtureKey('p18b-mint');
  const makerOwners = await Promise.all([0,1].map(index => fixtureKey(`p18b-maker-${index}`)));
  const primary = await fixtureKey('p18b-primary'), guard = await fixtureKey('p18b-guard');
  const domain = createHash('sha256').update('rivalt/p18b/two-isolated-markets').digest();
  const group = await groupPda('group-v2',domain), registry = await groupPda('registry-v2',encoder.encode(group));
  const vault = await groupPda('vault-v2',encoder.encode(group));
  const common = {group,registry,vault,program:deployment.program,eventAuthority:deployment.eventAuthority};
  const markets = [await groupMarket(group,0),await groupMarket(group,1)];
  const marketState = async (index: number) => sdk.getGroupMarketV2Decoder().decode((await h.read(markets[index]))!);
  const roots: Address[] = [];
  const snapshot = async () => Promise.all([group,vault,...markets,...roots].map(h.read));
  const reject = async (label: string, instructions: Instruction[], signers: Keypair[], error: number) => {
    const before = await snapshot(); await h.send(label,instructions,signers,error);
    assert.deepEqual(await snapshot(),before,`${label}: financial bytes changed`);
  };
  for (const signer of [owner,...makerOwners,primary,guard]) await h.send('setup owner rent funds',[
    getTransferSolInstruction({source:payer,destination:signer.address,amount:1_000_000_000n})]);
  await h.send('setup six decimal collateral',[getCreateAccountInstruction({payer,newAccount:mint,lamports:await h.rent(82),space:82n,programAddress:TOKEN_PROGRAM_ADDRESS}),
    getInitializeMint2Instruction({mint:mint.address,decimals:6,mintAuthority:payer.address})],[mint]);
  await h.send('setup fresh clearing group',[await sdk.getInitializeGroupV2InstructionAsync({...common,authority:payer,
    programData:deployment.programData,quoteMint:mint.address,domain})]);
  for (const index of [0,1]) await h.send('setup market identity',[sdk.getInitializeGroupMarketV2Instruction({...common,authority:payer,market:markets[index],index})]);
  const operators: {owner:Keypair;portfolio:Address;token:Keypair;capital:Address[]}[] = [];
  for (const [index,signer] of [owner,...makerOwners].entries()) {
    const portfolio = await groupPda('portfolio-v2',encoder.encode(group),encoder.encode(signer.address),u16(0));
    const token = await fixtureKey(`p18b-token-${index}`);
    await h.send('setup owner token account',[getCreateAccountInstruction({payer,newAccount:token,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
      getInitializeAccount3Instruction({account:token.address,mint:mint.address,owner:signer.address}),
      getMintToInstruction({mint:mint.address,token:token.address,mintAuthority:payer,amount:1_000_000_000n})],[token]);
    await h.send('setup owner portfolio',[await sdk.getCreatePortfolioV2InstructionAsync({...common,owner:signer,portfolio,index:0})],[signer]);
    const capital: Address[] = [];
    for (const marketIndex of [0,1]) {
      const margin = await groupPda('margin-v2',encoder.encode(portfolio),u16(marketIndex+1));
      await h.send('setup isolated market root',[await sdk.getRegisterMarginV2InstructionAsync({...common,owner:signer,portfolio,margin,
        subaccountIndex:marketIndex+1,mode:1,isolatedMarketIndex:marketIndex,role:index===0?0:1})],[signer]);
      await h.send('fund actual isolated capital',[await sdk.getDepositGroupV2InstructionAsync({...common,owner:signer,margin,
        quoteMint:mint.address,userToken:token.address,amount:index===0?1_000_000n:500_000_000n})],[signer]);
      roots.push(margin); capital.push(margin);
    }
    operators.push({owner:signer,portfolio,token,capital});
  }
  const cross = await groupPda('margin-v2',encoder.encode(operators[0].portfolio),u16(0));
  await h.send('setup disabled cross identity',[await sdk.getRegisterMarginV2InstructionAsync({...common,owner,portfolio:operators[0].portfolio,
    margin:cross,subaccountIndex:0,mode:0,isolatedMarketIndex:255,role:0})],[owner]); roots.push(cross);
  type Maker = typeof common & {owner:Keypair;authority:Keypair;market:Address;capital:Address;config:Address;
    registration:Address;groupBinding:Address;pricingProgram:Address;programData:Address;api:typeof sdk.makerA|typeof sdk.makerB;makerId:number};
  const makers: Maker[][] = [];
  for (const marketIndex of [0,1]) {
    const pair: Maker[] = [];
    for (const makerId of [0,1]) {
      const api = makerId===0?sdk.makerA:sdk.makerB, signer = makerOwners[makerId];
      const pricingProgram = makerId===0?sdk.makerA.MAKER_A_PROGRAM_ADDRESS:sdk.makerB.MAKER_B_PROGRAM_ADDRESS;
      const capital = operators[makerId+1].capital[marketIndex], market = markets[marketIndex];
      const [config] = await getProgramDerivedAddress({programAddress:pricingProgram,seeds:[Buffer.from('maker-v2'),encoder.encode(capital)]});
      const [programData] = await getProgramDerivedAddress({programAddress:LOADER,seeds:[encoder.encode(pricingProgram)]});
      const registration = await groupPda('registration-v2',encoder.encode(market),Uint8Array.of(makerId));
      const binding = await groupPda('binding-v2',encoder.encode(group),encoder.encode(capital));
      const accounts = {...common,owner:signer,authority:payer,market,capital,config,registration,groupBinding:binding,pricingProgram,programData};
      if(marketIndex===0 && makerId===0){
        for(const invalidCapital of [operators[0].capital[0],cross]){
          const [invalidConfig]=await getProgramDerivedAddress({programAddress:pricingProgram,seeds:[Buffer.from('maker-v2'),encoder.encode(invalidCapital)]});
          await reject('reject trader-role or cross root as maker capital',[await api.getInitializeGroupConfigInstructionAsync({
            ...accounts,owner,capital:invalidCapital,config:invalidConfig,duration:3600n})],[owner],6001);
          assert.equal(await h.read(invalidConfig),null);
        }
      }
      await reject('reject foreign maker-config owner',[await api.getInitializeGroupConfigInstructionAsync({...accounts,owner,duration:3600n})],[owner],6000);
      await reject('reject maker-config market mismatch',[await api.getInitializeGroupConfigInstructionAsync({...accounts,market:markets[1-marketIndex],duration:3600n})],[signer],6001);
      assert.equal(await h.read(config),null);
      await h.send('initialize owner-bound V2 maker config',[await api.getInitializeGroupConfigInstructionAsync({...accounts,duration:3600n})],[signer]);
      await reject('reject maker admission by foreign group authority',[await sdk.getRegisterGroupMakerV2InstructionAsync({...accounts,authority:owner,makerId,inventoryLimit:100_000n})],[signer,owner],2001);
      if(makerId===1){
        const existing=pair[0];
        const [aliasConfig]=await getProgramDerivedAddress({programAddress:pricingProgram,seeds:[Buffer.from('maker-v2'),encoder.encode(existing.capital)]});
        await h.send('configure second module for same owner capital before admission rejection',[
          await api.getInitializeGroupConfigInstructionAsync({...accounts,owner:existing.owner,capital:existing.capital,config:aliasConfig,duration:3600n})],[existing.owner]);
        const bound=await h.read(existing.groupBinding);
        await reject('reject reuse of one funded root across maker registrations',[
          await sdk.getRegisterGroupMakerV2InstructionAsync({...accounts,owner:existing.owner,capital:existing.capital,
            config:aliasConfig,groupBinding:existing.groupBinding,makerId,inventoryLimit:100_000n})],[existing.owner],0);
        assert.deepEqual(await h.read(existing.groupBinding),bound);assert.equal(await h.read(registration),null);
      }
      await h.send('admit separately funded maker',[await sdk.getRegisterGroupMakerV2InstructionAsync({...accounts,makerId,inventoryLimit:100_000n})],[signer]);
      const stored = sdk.getMakerRegistrationV2Decoder().decode((await h.read(registration))!);
      assert.equal(stored.group,group); assert.equal(stored.market,market); assert.equal(stored.capital,capital);
      assert.equal(stored.marketIndex,marketIndex); assert.equal(stored.owner,signer.address);
      assert.equal(sdk.getCapitalBindingV2Decoder().decode((await h.read(binding))!).registration,registration);
      pair.push({...accounts,api,makerId});
    }
    makers.push(pair);
  }
  assert.equal(new Set(makers.flat().map(maker=>maker.capital)).size,4);
  for (const marketIndex of [0,1]) {
    const market = await marketState(marketIndex);
    for (const maker of makers[marketIndex]) {
      const args = {side:0,lots:100n,referencePrice:marketIndex===0?60_000n:30_000n,
        quoteEpoch:1n,authorityEpoch:1n,termsEpoch:1n,configEpoch:market.configEpoch};
      const quote = await sdk.getPreviewGroupMakerV2Instruction({...maker,args});
      const before = await snapshot();
      const response = sdk.getQuoteResponseDecoder().decode(await h.quote('authenticated read-only group quote',quote));
      assert.equal(response.version,2); assert.equal(response.grossQuote,(marketIndex===0?6_000_000n:3_000_000n)+(maker.makerId===0?5_950n:3_000n));
      assert.deepEqual(await snapshot(),before);
      await reject('reject writable quote config',[{...quote,accounts:quote.accounts.map(account=>account.address===maker.config?{...account,role:AccountRole.WRITABLE}:account)}],[],6110);
      await reject('reject foreign config',[await sdk.getPreviewGroupMakerV2Instruction({...maker,config:makers[1-marketIndex][maker.makerId].config,args})],[],2001);
      await reject('reject epoch reset before config publication',[await sdk.getUpdateGroupMakerV2Instruction({...maker,actor:maker.owner,coSigner:undefined,operation:1})],[maker.owner],6112);
      await reject('reject unilateral code approval',[await sdk.getUpdateGroupMakerV2Instruction({...maker,actor:maker.owner,coSigner:undefined,operation:0})],[maker.owner],6102);
      const request = {group,quote:{version:2,domain,market:maker.market,capital:maker.capital,quoteEpoch:1n,authorityEpoch:1n,
        termsEpoch:1n,marketConfigEpoch:market.configEpoch,side:0,lots:1n,inventory:0n,cash:500_000_000n,
        inventoryLimit:100_000n,consumed:0n,referencePrice:args.referencePrice,slot:await h.slot()}};
      await reject('reject cross-group maker request',[await maker.api.getQuoteGroupInstruction({config:maker.config,...request,group:mint.address})],[],6003);
    }
  }
  const feeds: {feed:Address;signer:Keypair;index:number}[] = [];
  for (let index=0;index<6;index++) {
    const signer = [0,1,4].includes(index)?primary:guard, id = Buffer.alloc(32,index+1);
    const [feed] = await getProgramDerivedAddress({programAddress:ORACLE_FIXTURE,seeds:[Buffer.from('feed'),encoder.encode(signer.address),id]});
    await h.send('initialize signed local source',[{programAddress:ORACLE_FIXTURE,accounts:[{address:signer.address,role:AccountRole.WRITABLE_SIGNER},
      {address:feed,role:AccountRole.WRITABLE},{address:address('11111111111111111111111111111111'),role:AccountRole.READONLY}],data:Buffer.concat([discriminator('initialize'),id])}],[signer]);
    feeds.push({feed,signer,index});
  }
  async function publish(index: number, change: {price?:bigint;published?:bigint;level?:number}={}) {
    const source=feeds[index], data=Buffer.alloc(69); discriminator('publish').copy(data);
    data.set(encoder.encode(ORACLE_FIXTURE),8); data[40]=change.level??2;
    data.writeBigInt64LE(change.price??([0,2].includes(index)?60_000_000_000n:[4,5].includes(index)?3_000_000_000n:1_000_000n),41);
    data.writeBigUInt64LE(0n,49);data.writeInt32LE(-6,57);data.writeBigInt64LE(change.published??await h.now(),61);
    await h.send('publish signed local source',[{programAddress:ORACLE_FIXTURE,accounts:[{address:source.signer.address,role:AccountRole.READONLY_SIGNER},
      {address:source.feed,role:AccountRole.WRITABLE}],data}],[source.signer]);
  }
  const sampleAccounts = (index: number) => {
    const [first,second]=makers[index];
    return {...common,market:markets[index],primaryAsset:feeds[index===0?0:4].feed,primaryCollateral:feeds[1].feed,
      guardAsset:feeds[index===0?2:5].feed,guardCollateral:feeds[3].feed,
      firstCapital:first.capital,firstRegistration:first.registration,firstProgram:first.pricingProgram,firstProgramData:first.programData,firstConfig:first.config,
      secondCapital:second.capital,secondRegistration:second.registration,secondProgram:second.pricingProgram,secondProgramData:second.programData,secondConfig:second.config};
  };
  for (const index of [0,1]) await h.send('bind independent market source identities',[await sdk.getInitializeGroupOracleV2Instruction({...common,
    market:markets[index],authority:payer,primary:primary.address,guard:guard.address})]);
  for (let index=0;index<6;index++) await publish(index);
  for (let round=0;round<4;round++) {
    if (round>0) await h.advance(2n);
    for (const index of [0,1]) {
      const other = await h.read(markets[1-index]);
      await h.send('sample complete two-maker authenticated market',[await sdk.getSampleGroupOracleV2Instruction(sampleAccounts(index))]);
      assert.deepEqual(await h.read(markets[1-index]),other,'sampling changed sibling market');
      const market=await marketState(index);
      assert.equal(market.referencePrice,index===0?60_000n:30_000n); assert.equal(market.oracle.status,round===3?2:1);
      assert.equal(market.fundingIndexScaled,0n,'custody sample charged funding');
      assert.equal(market.oracle.coveredSeconds,0n); assert.equal(market.oracle.quantity,index===0?100n:200n);
    }
  }
  await h.advance(2n);
  await reject('reject substitution of BTC source for ETH',[await sdk.getSampleGroupOracleV2Instruction({...sampleAccounts(1),primaryAsset:feeds[0].feed})],[],6123);
  await publish(4,{price:60_000_000_000n});
  await h.send('record ETH out-of-profile raw price',[await sdk.getSampleGroupOracleV2Instruction(sampleAccounts(1))]);
  assert.equal((await marketState(1)).oracle.status,0);
  assert.equal((await marketState(0)).oracle.status,2);
  await publish(4); await h.advance(2n);
  await h.send('begin ETH recovery from bad source',[await sdk.getSampleGroupOracleV2Instruction(sampleAccounts(1))]);
  assert.equal((await marketState(1)).oracle.status,1);
  await h.advance(2n); await publish(5,{published:(await h.now())-21n});
  await h.send('degrade on authenticated stale ETH guard',[await sdk.getSampleGroupOracleV2Instruction(sampleAccounts(1))]);
  assert.equal((await marketState(1)).oracle.status,1); assert.equal((await marketState(1)).oracle.premiumScaled,0n);
  await h.advance(2n); await publish(4,{published:(await h.now())-21n});
  await h.send('restrict on authenticated stale ETH primary',[await sdk.getSampleGroupOracleV2Instruction(sampleAccounts(1))]);
  assert.equal((await marketState(1)).oracle.status,0);
  const first=makers[0][0];
  await reject('reject owner unilateral quarantine',[await sdk.getUpdateGroupMakerV2Instruction({...first,actor:first.owner,coSigner:undefined,operation:2})],[first.owner],6102);
  await h.send('authority quarantine distinct BTC maker',[await sdk.getUpdateGroupMakerV2Instruction({...first,actor:payer,coSigner:undefined,operation:2})]);
  await h.advance(2n); for (let index=0;index<6;index++) await publish(index);
  await h.send('quarantined required maker degrades funding qualification',[await sdk.getSampleGroupOracleV2Instruction(sampleAccounts(0))]);
  assert.equal((await marketState(0)).oracle.status,1);
  await h.send('joint approval restores unchanged code without consumption reset',[await sdk.getUpdateGroupMakerV2Instruction({...first,
    actor:first.owner,coSigner:payer,operation:0})],[first.owner]);
  const beforeEpoch = sdk.getMakerRegistrationV2Decoder().decode((await h.read(first.registration))!);
  await h.advance(2n,4000n);
  for (const maker of makers.flat()) {
    await h.send('owner publishes next maker epoch',[await maker.api.getPublishGroupEpochInstruction({owner:maker.owner,config:maker.config,duration:3600n})],[maker.owner]);
    await h.send('owner synchronizes expired epoch',[await sdk.getUpdateGroupMakerV2Instruction({...maker,actor:maker.owner,coSigner:undefined,operation:1})],[maker.owner]);
  }
  const afterEpoch=sdk.getMakerRegistrationV2Decoder().decode((await h.read(first.registration))!);
  assert.equal(afterEpoch.quoteEpoch,2n);assert.equal(afterEpoch.authorityEpoch,beforeEpoch.authorityEpoch);
  for (let index=0;index<6;index++) await publish(index);
  for(let round=0;round<4;round++) {
    if(round>0)await h.advance(2n);
    for(const index of [0,1])await h.send('fresh epoch recovery sample',[await sdk.getSampleGroupOracleV2Instruction(sampleAccounts(index))]);
  }
  const finalMarkets=await Promise.all([0,1].map(marketState));
  assert(finalMarkets.every(market=>market.oracle.status===2 && market.fundingIndexScaled===0n));
  const finalGroup=sdk.getClearingGroupV2Decoder().decode((await h.read(group))!);
  assert.equal(finalGroup.totalCash,2_002_000_000n);assert.equal(finalGroup.allocatedVault,2_002_000_000n);
  assert.equal(getTokenDecoder().decode((await h.read(vault))!).amount,2_002_000_000n);
  for(const root of roots) {
    const state=sdk.getMarginAccountV2Decoder().decode((await h.read(root))!);
    assert.equal(state.nonce,0n);assert.equal(state.reserved,0n);
    assert(state.positions.every(position=>position.lots===0n && position.virtualScaled===0n && position.fundingCheckpointScaled===0n));
  }
  return {common,group,registry,vault,markets,roots,cross,operators,makers,feeds,sampleAccounts,finalMarkets,finalGroup};
}
