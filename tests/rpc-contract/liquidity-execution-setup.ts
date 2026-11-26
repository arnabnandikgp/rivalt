// Fresh signed schema-10/profile-6 provisioning. No injected financial state or retained
// acceptance dump is used as a deployment configuration.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { address, AccountRole, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS, getInitializeAccount3Instruction, getMintToInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { provisionCanonicalMakers, goldenShape, type CanonicalHarness } from './canonical-maker-cases.js';
import {registerFinancialTestMargin} from './account-membership-setup.js';
import { fixtureKey } from './harness.js';
import { ORACLE_FIXTURE } from './oracle-fixture.js';
import type { WireRpc } from './wire.js';

const encoder = getAddressEncoder();
const discriminator = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
export async function liquidityExecutionSetup(h: CanonicalHarness, rpc: Pick<WireRpc,'call'>,
  options: { recoveryCapacity?:number; makerCounts?:readonly [number,number]; marketCheckpoints?:boolean; traderCount?:number; independentTraders?:boolean; anchorOffset?:(instance:number)=>bigint; marginLayout?:sdk.MarginLayout; shape?: sdk.makerA.LiquidityShapeArgs | ((instance: number) => sdk.makerA.LiquidityShapeArgs); makerCash?: bigint; traderCash?: bigint; traderDeposits?: readonly bigint[]; verifyRejections?: boolean; refreshDuringSampleInterval?: boolean } = {}) {
  const traderCount=options.traderCount??2;
  const makerCounts=options.makerCounts??[3,3];
  const population=traderCount+makerCounts[0]+makerCounts[1];
  if(options.traderDeposits)assert(options.traderDeposits.length===traderCount && options.traderDeposits.every(amount=>amount>0n));
  const deposit=(index:number)=>options.traderDeposits?.[index]??options.traderCash??1_000_000n;
  assert(Number.isSafeInteger(traderCount)&&traderCount>0&&population<=1024,'Requested Financial members must fit the qualification storage fixture');
  const region = (offset: bigint) => [{ endLots: 4096n, offset, slope: 0n },
    ...Array.from({ length: 7 }, () => ({ endLots: 0n, offset: 0n, slope: 0n }))];
  const shape = { ...goldenShape, skewTick: 0n, longCap: 4096n, shortCap: 4096n,
    bidCount: 1, askCount: 1, bids: region(2n), asks: region(3n) };
  const recoveryCapacity = options.recoveryCapacity ?? Math.max(64,population);
  assert(Number.isSafeInteger(recoveryCapacity) && recoveryCapacity >= population && recoveryCapacity <= 1024);
  const fixture = await provisionCanonicalMakers(h, options.shape ?? shape, [0, 1], options.makerCash,BigInt(recoveryCapacity),makerCounts);
  const { payer, common, markets, instances, venue } = fixture;
  const now = async () => (await h.read(sdk.ACCOUNT_CLOCK))!.readBigInt64LE(32);
  const slot = async () => (await h.read(sdk.ACCOUNT_CLOCK))!.readBigUInt64LE(0);
  const waitUntil = async (time: bigint) => {
    const deadline = Date.now() + 20_000;
    while (await now() < time) { assert(Date.now() < deadline, 'Clock progress'); await delay(100); }
  };
  const marketState = async (index: number) => sdk.getMarketDecoder().decode((await h.read(markets[index]))!);
  // Signed test oracle values, independently converted to each market's lot
  // units. Mutating these inputs never injects account state or funding indexes.
  const sourcePrices = { btc: 60_000_000_000n, eth: 3_000_000_000n };
  const primary = await fixtureKey('p32-primary'), guard = await fixtureKey('p32-guard');
  const traderOwner = await fixtureKey('p32-trader'), traderToken = await fixtureKey('p32-trader-token');
  await h.send('fund local test participants', [primary, guard, traderOwner].map(signer => getTransferSolInstruction({
    source: payer, destination: signer.address, amount: 1_000_000_000n })));
  const roots:Address[]=[], traderOwners:(typeof traderOwner)[]=[];
  const identityCapacity=options.independentTraders?1:4*9; // An independent owner starts at its own cross account.
  for(let first=0;first<traderCount;first+=identityCapacity) {
    const owner=first===0?traderOwner:await fixtureKey('p32-scale-trader-'+first);
    const token=first===0?traderToken:await fixtureKey('p32-scale-token-'+first);
    const count=Math.min(identityCapacity,traderCount-first);
    if(first>0)await h.send('fund additional local trader rent',[getTransferSolInstruction({
      source:payer,destination:owner.address,amount:1_000_000_000n})]);
    await h.send('mint test trader collateral',[getCreateAccountInstruction({payer,newAccount:token,
      lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
      getInitializeAccount3Instruction({account:token.address,mint:fixture.mint.address,owner:owner.address}),
      getMintToInstruction({mint:fixture.mint.address,token:token.address,mintAuthority:payer,
        amount:Array.from({length:count},(_,index)=>deposit(first+index)).reduce((sum,amount)=>sum+amount,0n)})],[token]);
    for(let local=0;local<count;local++) {
      const index=Math.floor(local/9),subaccountIndex=local%9;
      const [portfolio]=await sdk.deriveAccountPortfolio(venue,owner.address,index);
      if(subaccountIndex===0)await h.send('create test trader portfolio',[await sdk.getCreatePortfolioInstructionAsync({
        ...common,owner,portfolio,index})],[owner]);
      const [margin]=await sdk.deriveMarginAccount(portfolio,subaccountIndex);
      await registerFinancialTestMargin(h,common,payer,{owner,portfolio,margin,subaccountIndex,
        mode:subaccountIndex===0?0:1,isolatedMarketIndex:subaccountIndex===0?255:0,role:0});
      await h.send('deposit actual test trader collateral',[await sdk.getDepositAccountInstructionAsync({...common,
        owner,margin,quoteMint:fixture.mint.address,userToken:token.address,amount:deposit(first+local)})],[owner]);
      roots.push(margin);traderOwners.push(owner);
    }
  }
  const feeds: { index: number; feed: Address; authority: typeof primary }[] = [];
  for (let index = 0; index < 6; index++) {
    const authority = [0, 1, 4].includes(index) ? primary : guard, id = Buffer.alloc(32, index + 1);
    const [feed] = await getProgramDerivedAddress({ programAddress: ORACLE_FIXTURE,
      seeds: [Buffer.from('feed'), encoder.encode(authority.address), id] });
    await h.send('initialize test source', [{ programAddress: ORACLE_FIXTURE, accounts: [
      { address: authority.address, role: AccountRole.WRITABLE_SIGNER }, { address: feed, role: AccountRole.WRITABLE },
      { address: address('11111111111111111111111111111111'), role: AccountRole.READONLY }],
      data: Buffer.concat([discriminator('initialize'), id]) }], [authority]);
    feeds.push({ index, feed, authority });
  }
  const configurations: Address[] = [];
  for (const index of [0, 1]) {
    await h.send('initialize canonical source bindings', [sdk.getInitializeLiquidityOracleInstruction({ ...common,
      authority: payer, market: markets[index], primary: primary.address, guard: guard.address })]);
    const [configuration] = await sdk.findFundingPublisherPda({ market: markets[index] });
    await h.send('P32 publisher initialize', [sdk.getInitializeFundingPublisherInstruction({ ...common, authority: payer,
      market: markets[index], registry: instances[index * makerCounts[0]].liquidityRegistry, configuration, publisher: fixture.updater.address })]);
    configurations.push(configuration);
  }
  const [resolution] = await sdk.deriveVenueComponent(venue, 'resolution');
  const storage=fixture.storage;
  const safetyCommon={...common,authority:payer,payer,btc:markets[0],eth:markets[1],resolution,storage};
  await h.send('initialize storage-backed resolution header',[sdk.getInitializeAccountResolutionInstruction(safetyCommon)]);
  async function sourceInstructions() {
    const time = await now();
    return feeds.map(({ index, feed, authority }):Instruction => {
      const data = Buffer.alloc(69); discriminator('publish').copy(data);
      data.set(encoder.encode(ORACLE_FIXTURE), 8); data[40] = 2;
      data.writeBigInt64LE([0, 2].includes(index) ? sourcePrices.btc : [4, 5].includes(index) ? sourcePrices.eth : 1_000_000n, 41);
      data.writeBigUInt64LE(0n, 49); data.writeInt32LE(-6, 57); data.writeBigInt64LE(time, 61);
      return { programAddress: ORACLE_FIXTURE, accounts: [{ address: authority.address, role: AccountRole.READONLY_SIGNER },
        { address: feed, role: AccountRole.WRITABLE }], data };
    });
  }
  async function freshSources() {
    await h.send('refresh independent sources only',await sourceInstructions(),[primary,guard]);
  }
  async function fresh() {
    const sources=await sourceInstructions();
    const reprices = await Promise.all(instances.map(async (maker, index) => {
      const config = await maker.state(), price = maker.module.getMakerPriceDecoder().decode((await h.read(maker.price))!).state;
      return maker.module.getRepriceInstruction({ ...maker.makerCommon, actor: fixture.updater,
        expectedControl: config.controlEpoch, expectedSequence: price.sequence,
        anchor: (index < makerCounts[0] ? sourcePrices.btc / 1_000_000n : sourcePrices.eth / 100_000n) + (options.anchorOffset?.(index)??0n) });
    }));
    if (reprices.length === 6) {
      await h.send('refresh independent sources and six maker publications', [...sources, ...reprices], [primary, guard, fixture.updater]);
    } else {
      // A maker update writes two accounts. Limit each signed v1 packet to
      // eight instructions and refresh the independent oracles last.
      for (let start=0;start<reprices.length;start+=8) {
        await h.send('refresh registered makers '+start,reprices.slice(start,start+8),[fixture.updater]);
      }
      await freshSources();
    }
  }
  async function checkpoint(market:0|1) {
    return sdk.getCheckpointMarketInstructionAsync({...common,venue,safety:fixture.safety,market:markets[market]});
  }
  async function sample(reportMarkets: readonly (0|1)[] = [0,1], verifyCheckpoints=false) {
    const previous = await Promise.all([0, 1].map(marketState));
    const publishers = await Promise.all(configurations.map(async configuration =>
      sdk.getFundingPublisherDecoder().decode((await h.read(configuration))!)));
    const sampleTime = previous.reduce((latest, market) => market.oracle.sampledAt > latest ? market.oracle.sampledAt : latest, 0n) + 2n;
    const fenceTime = publishers.reduce((latest, publisher) => publisher.lastObservedTime > latest ? publisher.lastObservedTime : latest, 0n);
    const fenceSlot = publishers.reduce((latest, publisher) => publisher.lastObservedSlot > latest ? publisher.lastObservedSlot : latest, 0n);
    // On a native validator these are two confirmed transactions. Publish the
    // inputs during the minimum interval, then use the ordinary report fences.
    if (options.refreshDuringSampleInterval) await fresh();
    await waitUntil(sampleTime > fenceTime ? sampleTime : fenceTime);
    // Fast confirmed provisioning can still be in the publisher's initialization
    // slot. Wait before refreshing inputs; never re-date a report or relax its
    // strictly newer-slot fence. No signed original exists at this point.
    const deadline = Date.now() + 20_000;
    while (await slot() <= fenceSlot) { assert(Date.now() < deadline, 'Publisher fence Clock progress'); await delay(100); }
    if (!options.refreshDuringSampleInterval) await fresh();
    const reports: Instruction[] = [];
    const checkpointRequired=options.marketCheckpoints &&
      sdk.getVenueSafetyDecoder().decode((await h.read(fixture.safety))!).mode===1;
    for (const index of reportMarkets) {
      if(checkpointRequired)reports.push(await checkpoint(index));
      const input = await sdk.readFundingReport(rpc, venue, index,'confirmed',options.marginLayout);
      assert.equal(input.report.outcome, 0, input.coverageReason ?? 'available complete publication');
      const reference = index === 0 ? sourcePrices.btc / 1_000_000n : sourcePrices.eth / 100_000n;
      assert.equal(input.report.referencePrice, reference);
      assert.equal(input.report.quantity, (6_000_000n + reference - 1n) / reference);
      const instruction=sdk.getPublishFundingReportInstruction({ ...common,
        ...input.instructionAccounts, publisher: fixture.updater, report: input.report });
      if(verifyCheckpoints && index===0) {
        const checkpoints=input.checkpointAccounts;
        assert.equal(checkpoints.length,3);
        const before=await Promise.all([h.read(markets[index]),h.read(input.configuration)]);
        await h.send('reject omitted funding checkpoint',[sdk.withFundingCheckpoints(instruction,checkpoints.slice(1))],
          [fixture.updater],sdk.CLEARING_ERROR__PROFILE);
        await h.send('reject duplicate funding checkpoint',[sdk.withFundingCheckpoints(instruction,[checkpoints[0],checkpoints[0],checkpoints[2]])],
          [fixture.updater],sdk.CLEARING_ERROR__ALIAS);
        const substituted=[instances[makerCounts[0]].registration,...checkpoints.slice(1)];
        await h.send('reject foreign funding checkpoint',[sdk.withFundingCheckpoints(instruction,substituted)],
          [fixture.updater],sdk.CLEARING_ERROR__MAKER_BINDING);
        assert.deepEqual(await Promise.all([h.read(markets[index]),h.read(input.configuration)]),before);
      }
      reports.push(sdk.withFundingCheckpoints(instruction,input.checkpointAccounts));
    }
    await h.send(reportMarkets.length===2?'P32 publisher available two-market reports':'publish selected-market funding report', reports, [fixture.updater]);
  }
  const qualify = async () => { for (let round = 0; round < 4; round++) await sample(); };
  await qualify();
  if(options.verifyRejections!==false)await h.send('retired activation discriminator rejects', [{programAddress:sdk.CLEARING_PROGRAM_ADDRESS,accounts:[],data:discriminator('activate_accounts_v3')}], [], 'InvalidInstructionData');
  await h.send('activate storage-ready canonical candidate', [sdk.getActivateLiquidityInstruction(safetyCommon)]);
  if(options.verifyRejections!==false)await h.send('canonical activation cannot replay', [sdk.getActivateLiquidityInstruction(safetyCommon)], [], sdk.CLEARING_ERROR__PROFILE);
  await qualify();
  const identity = { venue, marginLayout:options.marginLayout, mint: fixture.mint.address, domain: fixture.domain.toString('hex') };
  const snapshot = (root = roots[0], marketIndex: 0 | 1 = 0) => sdk.readAccountTradeSnapshot(rpc, identity, root, marketIndex);
  return { ...fixture, primary, guard, traderOwner, traderToken, roots, traderOwners, feeds, configurations, resolution, storage,
    safetyCommon, sourcePrices, now, slot, waitUntil, marketState, sourceInstructions, fresh, freshSources, sample, checkpoint, qualify, identity, snapshot };
}
