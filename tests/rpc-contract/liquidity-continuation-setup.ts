import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AccountRole, getAddressEncoder, type Address, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import { executionTestHelpers } from './liquidity-execution-helpers.js';
import { goldenShape, type CanonicalHarness } from './canonical-maker-cases.js';
import { ORACLE_FIXTURE } from './oracle-fixture.js';
import type { WireRpc } from './wire.js';
import type { Profile } from './liquidity-continuation-model.js';
export function comparisonShape(profile: Profile, instance: number): sdk.makerA.LiquidityShapeArgs {
    const regions = instance === 0 ? [{ endLots: 512n, offset: 10n, slope: 1n }]
        : instance === 2 ? [{ endLots: 256n, offset: 30n, slope: 0n }, { endLots: 4096n, offset: 30n, slope: 1n }]
            : [{ endLots: 4096n, offset: 20n, slope: 1n }];
    const padded = [...regions, ...Array.from({ length: 8 - regions.length }, () => ({ endLots: 0n, offset: 0n, slope: 0n }))];
    const cap = profile === 'control' && instance === 1 ? 0n : 100000n;
    return { ...goldenShape, ttlSlots: 150, target: 0n, skewStep: 64n, skewTick: profile === 'treatment' ? 4n : 0n,
        longCap: cap, shortCap: cap, bidCount: regions.length, askCount: regions.length, bids: padded, asks: padded };
}
export async function continuationSetup(h: CanonicalHarness, rpc: WireRpc, profile: Profile) {
    const now = async () => (await h.read(sdk.ACCOUNT_CLOCK))!.readBigInt64LE(32);
    const slot = async () => (await h.read(sdk.ACCOUNT_CLOCK))!.readBigUInt64LE(0);
    const advance = async (seconds: bigint) => {
        const target = await now() + seconds, deadline = Date.now() + 20000;
        while (await now() < target) {
            assert(Date.now() < deadline);
            await delay(50);
        }
    };
    const canonical = await liquidityExecutionSetup(h, rpc, {
        shape: instance => comparisonShape(profile, instance), makerCash: 500000000n
    });
    const setup = canonical;
    const trader = canonical.roots[1];
    const owner = canonical.traderOwner;
    const identity = { venue: setup.venue, mint: setup.mint.address, domain: setup.domain.toString('hex') };
    const read = () => sdk.readAccountTradeSnapshot(rpc, identity, trader, 0);
    const sourceFeeds = canonical.feeds;
    const encoder = getAddressEncoder();
    async function sources() {
        const time = await now(), signers = [...new Map(sourceFeeds.map(feed => [feed.authority.address, feed.authority])).values()];
        const instructions = sourceFeeds.map(({ index, feed, authority }): Instruction => {
            const data = Buffer.alloc(69);
            createHash('sha256').update('global:publish').digest().subarray(0, 8).copy(data);
            data.set(encoder.encode(ORACLE_FIXTURE), 8);
            data[40] = 2;
            data.writeBigInt64LE([0, 2].includes(index) ? 60000000000n : [4, 5].includes(index) ? 3000000000n : 1000000n, 41);
            data.writeBigUInt64LE(0n, 49);
            data.writeInt32LE(-6, 57);
            data.writeBigInt64LE(time, 61);
            return { programAddress: ORACLE_FIXTURE, accounts: [{ address: authority.address, role: AccountRole.READONLY_SIGNER },
                    { address: feed, role: AccountRole.WRITABLE }], data };
        });
        await h.send('continuation source update', instructions, signers);
    }
    let repricesAfterConsumption = 0;
    async function reprice(tick: number) {
        const before = await Promise.all(canonical.instances.map(maker => maker.registrationState()));
        const instructions = await Promise.all(canonical.instances.map(async (maker, index) => {
            const config = await maker.state(), price = maker.module.getMakerPriceDecoder().decode((await h.read(maker.price))!).state;
            return maker.module.getRepriceInstruction({ ...maker.makerCommon, actor: canonical.updater,
                expectedControl: config.controlEpoch, expectedSequence: price.sequence,
                anchor: (index < 3 ? 60000n : 30000n) + (profile === 'treatment' ? (tick % 2 === 0 ? -1n : 1n) : 0n) });
        }));
        await h.send('continuation reprice batch', instructions, [canonical.updater]);
        // Trading may increment consumption concurrently. It can never decrease on
        // a reprice; structural controls run on this same updater loop.
        const after = await Promise.all(canonical.instances.map(maker => maker.registrationState()));
        before.forEach((state, index) => {
            assert.equal(after[index].depthEpoch, state.depthEpoch);
            assert(after[index].buyConsumed >= state.buyConsumed && after[index].sellConsumed >= state.sellConsumed);
        });
        if (before.some(state => state.buyConsumed + state.sellConsumed > 0n))
            repricesAfterConsumption++;
    }
    async function funding() {
        {
            const instructions: Instruction[] = [];
            for (const index of [0, 1] as const) {
                const market = await canonical.marketState(index);
                if (await now() < market.oracle.sampledAt + 2n)
                    continue;
                const input = await sdk.readFundingReport(rpc, canonical.venue, index);
                instructions.push(sdk.getPublishFundingReportInstruction({ ...canonical.common, ...input.instructionAccounts,
                    publisher: canonical.updater, report: input.report }));
            }
            if (instructions.length)
                await h.send('continuation publisher reports', instructions, [canonical.updater]);
        }
    }
    async function quarantine(recover: boolean) {
        {
            const maker = canonical.instances[0], registration = await maker.registrationState();
            await h.send(recover ? 'continuation joint maker recovery' : 'continuation quarantine', [recover
                    ? sdk.getApproveLiquidityInstruction({ ...maker.controlCommon, coSigner: canonical.payer, expectedAuthority: registration.authorityEpoch })
                    : sdk.getQuarantineLiquidityInstruction({ ...canonical.common, authority: canonical.payer,
                        market: maker.market, registration: maker.registration, capital: maker.capital, expectedAuthority: registration.authorityEpoch })], recover ? [canonical.owner] : []);
        }
    }
    async function strictEpochs() {
        const helpers = executionTestHelpers(h, canonical), maker = canonical.instances[0];
        for (let index = 0; index < 20; index++) {
            const prepared = await helpers.route({ trader, actor: owner, marketIndex: 0, side: 0, makers: [maker], lots: [1n] });
            const registration = await maker.registrationState();
            await h.send('supplement explicit replenish', [sdk.getReplenishLiquidityInstruction({ ...maker.controlCommon,
                    expectedAuthority: registration.authorityEpoch, expectedDepth: registration.depthEpoch, sides: 3 })], [canonical.owner]);
            const keys: Address[] = [trader, maker.capital, maker.registration, canonical.custody, canonical.markets[0], canonical.ledgers[0]];
            const before: (Buffer | null)[] = await Promise.all(keys.map(h.read));
            await h.send('supplement stale structural route', [prepared], [owner], sdk.CLEARING_ERROR__MAKER_EPOCH);
            assert.deepEqual(await Promise.all(keys.map(h.read)), before, 'Strict epoch rejection is atomic');
        }
        return 20;
    }
    return { ...setup, canonical, trader, owner, identity, read, now, slot, sources, reprice, funding, quarantine, strictEpochs,
        allRoots: [...canonical.instances.map(maker => maker.capital), ...canonical.roots],
        repricesAfterConsumption: () => repricesAfterConsumption };
}
