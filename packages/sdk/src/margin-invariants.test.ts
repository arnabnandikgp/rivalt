import {expect, it} from 'vitest';
import {getMarketDecoder, getMarginAccountDecoder} from './generated/index.js';
import {effectiveAccountFunding, accountBalanceView, accountOrderRemaining} from './account-balance.js';

const scale = 1_000_000_000n;
function fixture() {
  const marketDecoder = getMarketDecoder(), rootDecoder = getMarginAccountDecoder();
  const markets = [0,1].map(index => ({...marketDecoder.decode(new Uint8Array(marketDecoder.fixedSize)),schemaVersion:5,index,termsEpoch:1n,configEpoch:1n,
    referencePrice:100n,lower:100n,upper:100n,validFrom:1n,validUntil:100n}));
  for (const market of markets) Object.assign(market.oracle,{status:2,sampledAt:100n,sourceDeadline:120n,lastQualified:100n,
    heldEpoch:1n,heldUntil:106n,heldSlot:100n,fundingBase:0n,premiumScaled:0n});
  const root = {...rootDecoder.decode(new Uint8Array(rootDecoder.fixedSize)),schemaVersion:5,mode:0,isolatedMarketIndex:255,cash:1000n,delegateEpoch:1n};
  root.positions[0].lots=1n; root.positions[0].virtualScaled=200n*scale;
  root.positions[1].lots=2n; root.positions[1].virtualScaled=-400n*scale;
  return {root,markets,group:{venue:root.venue,mode:1,paused:false}};
}
it('sums negative claims with one cash balance and zero positive open-profit credit', () => {
  const {root,markets,group}=fixture();
  const result=accountBalanceView(root,group,markets,100n,10n);
  expect(result).toMatchObject({cash:'1000',riskEquityScaled:'800000000000',initialMargin:'30',maintenanceMargin:'15',
    positiveUnpaidMarginCredit:'0',correlationDiscount:'0',localCashHeadroom:'770',withdrawableCash:null});
  expect(result.positions.map(position=>position.unpaidClaimScaled)).toEqual(['300000000000','-200000000000']);
});
it('applies pending ETH funding without root writes, including fractional loss', () => {
  const {root,markets,group}=fixture(), before=structuredClone(root);
  markets[1].oracle.premiumScaled=360n*scale; // 0.1 atom per lot per second.
  const result=accountBalanceView(root,group,markets,101n,11n);
  expect(result.riskEquityScaled).toBe('799800000000');
  expect(result.positions[1].pendingFundingDebitScaled).toBe('200000000');
  expect(result.positions[1].unpaidClaimScaled).toBe('-200200000000');
  expect(root).toEqual(before);
  expect(effectiveAccountFunding({venue:root.venue,mode:1,paused:false},markets[1],101n,11n)).toBe(100000000n);
});
it('stops pending funding at its hold, invalid epoch and catch-up boundaries', () => {
  const {markets,group}=fixture(); markets[1].oracle.premiumScaled=360n*scale;
  expect(effectiveAccountFunding(group,markets[1],107n,10n)).toBe(600000000n);
  expect(effectiveAccountFunding(group,markets[1],131n,10n)).toBe(0n);
  expect(effectiveAccountFunding(group,markets[1],101n,100n)).toBe(0n);
  markets[1].configEpoch=2n;
  expect(effectiveAccountFunding(group,markets[1],101n,10n)).toBe(0n);
});
it('refuses a stale exposed second market while leaving an empty slot irrelevant', () => {
  const {root,markets,group}=fixture(); markets[1].oracle.sourceDeadline=101n;
  expect(accountBalanceView(root,group,markets,101n,11n)).toMatchObject({riskEquityScaled:null,localCashHeadroom:null,valuationStatus:'RequiredSourceUnavailable'});
  root.positions[1].lots=0n; root.positions[1].virtualScaled=-1n;
  expect(accountBalanceView(root,group,markets,101n,11n)).toMatchObject({riskEquityScaled:'999999999999',localCashHeadroom:'989'});
});
it('recomputes cross-market reserves and revokes expired delegate orders', () => {
  const {root,markets,group}=fixture();
  root.delegate='Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo' as typeof root.delegate;
  root.delegateExpirySlot=20n;
  const stored=root.book.orders[0]; stored.marketIndex=1; stored.delegateEpoch=1n;
  Object.assign(stored.order,{id:1n,state:1,termsEpoch:1n,expirySlot:30n,lots:3n,filled:0n,limit:110n,feeBudget:5n});
  // 3 * (10 adverse execution loss + 10 IM) + 5 remaining fees = 65.
  expect(accountBalanceView(root,group,markets,101n,19n).reserved).toBe('65');
  expect(accountBalanceView(root,group,markets,101n,20n).reserved).toBe('0');
  stored.delegateEpoch=0n;
  expect(accountBalanceView(root,group,markets,101n,20n).reserved).toBe('65');
});
it('bounds protective order remainder by its market, generation and shared allowance', () => {
  const {root,markets}=fixture(); root.positions[1].lots=10n; root.positions[1].generation=7n;
  const stored=root.book.orders[0]; stored.marketIndex=1;
  Object.assign(stored.order,{id:1n,state:2,termsEpoch:1n,expirySlot:30n,lots:10n,filled:4n,reduceOnly:true,side:1,generation:7n,groupId:2n});
  root.book.protections[0]={marketIndex:1,protection:{id:2n,version:1n,generation:7n,side:1,original:10n,remaining:6n}};
  expect(accountOrderRemaining(root,stored,markets[1],10n)).toBe(6n);
  root.positions[0].generation=99n; expect(accountOrderRemaining(root,stored,markets[1],10n)).toBe(6n);
  root.positions[1].lots=3n; expect(accountOrderRemaining(root,stored,markets[1],10n)).toBe(3n);
  root.positions[1].generation=8n; expect(accountOrderRemaining(root,stored,markets[1],10n)).toBe(0n);
});
it('rounds each market requirement upward separately and exposes no frozen exit capacity', () => {
  const {root,markets,group}=fixture(); root.positions[1].lots=1n; markets.forEach(market=>market.upper=101n);
  expect(accountBalanceView(root,group,markets,101n,10n)).toMatchObject({initialMargin:'22',maintenanceMargin:'12'});
  expect(accountBalanceView(root,{...group,mode:2,paused:true},markets,101n,10n)).toMatchObject({valuationStatus:'FrozenResolution',localCashHeadroom:null,withdrawableCash:null});
});
