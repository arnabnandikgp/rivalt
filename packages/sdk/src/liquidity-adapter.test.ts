import { expect,it } from 'vitest';
import { authenticateLiquidityMarket } from './liquidity-adapter.js';
import { liquidityAccountFixture } from '../test-support/liquidity-accounts.js';
import { testAddress } from '../test-support/liquidity-fixture.js';

it('authenticates three distinct capital instances across two programs and freezes quoted state',async () => {
  const fixture = await liquidityAccountFixture();
  const { adapters } = await authenticateLiquidityMarket(fixture.snapshot,fixture.accounts);
  expect(adapters.map(maker => maker.config.instance)).toEqual([0,1,2]);
  expect(adapters[0].registrationState.pricingProgram).toEqual(adapters[1].registrationState.pricingProgram);
  expect(adapters[2].quote(0,3n)).toEqual({ gross: 30032n,remaining: 4093n });
  expect(adapters[2].depthHints(0)).toEqual([4096n]);
  expect(() => { adapters[0].config.shapeEpoch++; }).toThrow();
  const request = adapters[0].request(0,1n);(request.domain as Uint8Array)[0] = 0;
  expect(adapters[0].request(0,1n).domain[0]).toBe(31);
});

it.each([
  ['quarantine','quarantined',(state: any) => { state.registrationState.quarantined = true; }],
  ['unapproved code','unapproved-code',(state: any) => { state.registrationState.approvedHash = new Uint8Array(32); }],
  ['disabled','disabled',(state: any) => { state.configState.shape.mode = 0; }],
  ['stale time','stale-publication',(state: any) => { state.priceState.updatedTime = 94n; }],
  ['stale slot','stale-publication',(state: any) => { state.configState.shape.ttlSlots = 1; }],
  ['old control','invalid-publication',(state: any) => { state.priceState.controlEpoch = 0n; }],
  ['future','invalid-publication',(state: any) => { state.priceState.updatedSlot = 101n; }],
] as const)('classifies %s without hiding the sealed candidate',async (_,reason,change) => {
  const fixture = await liquidityAccountFixture();change(fixture.states[0]);fixture.states[0].write();
  const result = await authenticateLiquidityMarket(fixture.snapshot,fixture.accounts);
  expect(result.adapters).toHaveLength(3);expect(result.adapters[0].unavailable).toBe(reason);
  expect(() => result.adapters[0].quote(0,1n)).toThrow(/unavailable/);
});

it.each([
  ['capability',(fixture: any) => { fixture.states[0].configState.capability = 2; }],
  ['capital alias',(fixture: any) => { fixture.states[1].registrationState.capital = fixture.states[0].capital; }],
  ['root id alias',(fixture: any) => { fixture.states[1].capitalState.id = fixture.states[0].capitalState.id; }],
  ['foreign domain',(fixture: any) => { fixture.states[0].configState.domain = new Uint8Array(32); }],
  ['foreign isolated slot',(fixture: any) => { fixture.states[0].capitalState.positions[1].virtualScaled = 1n; }],
  ['capital binding',(fixture: any) => { fixture.states[0].bindingState.registration = testAddress(50); }],
  ['substituted config',(fixture: any) => { fixture.states[0].registrationState.config = fixture.states[1].config; }],
  ['noncanonical curve',(fixture: any) => { fixture.states[0].configState.shape.asks[1].offset = 1n; }],
  ['unsealed registry',(fixture: any) => { fixture.registryState.sealed = false; }],
] as const)('rejects %s before claiming an exact snapshot',async (_,change) => {
  const fixture = await liquidityAccountFixture();change(fixture);
  fixture.states.forEach(state => state.write());fixture.writeRegistry();
  await expect(authenticateLiquidityMarket(fixture.snapshot,fixture.accounts)).rejects.toThrow();
});

it('checks owners, exact layout, executable and full ProgramData binding',async () => {
  for (const change of [
    (fixture: Awaited<ReturnType<typeof liquidityAccountFixture>>) => { fixture.accounts.get(fixture.states[0].config)!.owner = testAddress(60); },
    (fixture: Awaited<ReturnType<typeof liquidityAccountFixture>>) => { fixture.accounts.get(fixture.states[0].config)!.data[0] = ''; },
    (fixture: Awaited<ReturnType<typeof liquidityAccountFixture>>) => { fixture.accounts.get(fixture.states[0].program)!.executable = false; },
    (fixture: Awaited<ReturnType<typeof liquidityAccountFixture>>) => { fixture.accounts.delete(fixture.states[0].programData); },
  ]) {
    const fixture = await liquidityAccountFixture();change(fixture);
    await expect(authenticateLiquidityMarket(fixture.snapshot,fixture.accounts)).rejects.toThrow();
  }
});
