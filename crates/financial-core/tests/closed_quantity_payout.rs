//! Native qualification of a fresh-account payout rule. Prices are collateral atoms per BTC lot.
//! The test composes Rivalt's real trading, risk, backing, settlement and attribution arithmetic.
//! Storage admission here uses only the bytes occupied by the opening/increasing position.
use clearing_accounting::attribution::Attribution;
use financial_core::{
    backing::{MarketRegion, Region, Summary},
    margin::{reconcile, route_candidate, Margin, Mode, Risk},
    Error, Pools, Result, SCALE,
};

const SLOT: usize = 256;
const CASH: u64 = 80_000_000_000;
const TRADER: usize = 0;
const MAKER_A: usize = 1;
const MAKER_B: usize = 2;

struct Market {
    accounts: [Margin; 3],
    history: [Attribution; 3],
    pools: Pools,
    mark: u64,
    funding: i128,
}

impl Market {
    fn new() -> Self {
        Self {
            accounts: std::array::from_fn(|id| Margin {
                id: id as u64,
                mode: if id == TRADER {
                    Mode::Cross
                } else {
                    Mode::Isolated(0)
                },
                positions: Default::default(),
                cash: CASH,
                reserved: 0,
            }),
            history: Default::default(),
            pools: Pools {
                vault: CASH * 3,
                ..Default::default()
            },
            mark: 61_000,
            funding: 0,
        }
    }

    fn risks(&self) -> [Risk; 2] {
        [
            Risk {
                lower: self.mark,
                upper: self.mark,
                funding: self.funding,
            },
            Risk {
                lower: 2_000,
                upper: 2_000,
                funding: 0,
            },
        ]
    }

    fn claim(&self, member: usize) -> i128 {
        self.accounts[member].positions[0]
            .unpaid(self.mark, self.funding)
            .unwrap()
    }

    fn cap(&self, member: usize) -> u64 {
        self.history[member]
            .closed_quantity_payment_cap(
                self.accounts[member].positions[0].lots,
                self.mark,
                self.claim(member),
            )
            .unwrap()
    }

    fn reconcile(&self) {
        reconcile(
            &self.accounts,
            self.pools,
            [self.mark, 2_000],
            [self.funding, 0],
        )
        .unwrap();
    }

    fn trade(&mut self, side: u8, orders: &[(usize, u64, u64)]) -> Result<u64> {
        let makers: Vec<_> = orders.iter().map(|&(id, _, _)| self.accounts[id]).collect();
        let legs: Vec<_> = orders
            .iter()
            .map(|&(_, lots, price)| (lots, lots * price))
            .collect();
        let (trader, makers, fee) = route_candidate(
            self.accounts[TRADER],
            &makers,
            0,
            &legs,
            side,
            [self.funding, 0],
            0,
        )?;
        let trader_update = (TRADER, trader, legs.iter().map(|&(_, gross)| gross).sum());
        let maker_updates = orders
            .iter()
            .zip(makers)
            .zip(legs)
            .map(|((&(id, _, _), maker), (_, gross))| (id, maker, gross));
        let mut accounts = self.accounts;
        let mut history = self.history.clone();
        for (id, account, gross) in std::iter::once(trader_update).chain(maker_updates) {
            account.admissible(self.risks())?;
            let lots = account.positions[0].lots;
            history[id] = history[id].fill(accounts[id].positions[0].lots, lots, gross)?;
            let mut slot = [0; SLOT];
            history[id].write(&mut slot)?;
            assert_eq!(Attribution::read(&slot, lots)?, history[id]);
            accounts[id] = account;
        }
        self.accounts = accounts;
        self.history = history;
        let total_fees = self.pools.insurance + self.pools.fees + fee;
        self.pools.insurance = total_fees / 4;
        self.pools.fees = total_fees - self.pools.insurance;
        self.reconcile();
        Ok(fee)
    }

    fn settle(&mut self, member: usize, atoms: u64, gain: bool) -> Result<()> {
        if gain {
            if atoms > self.cap(member) {
                return Err(Error::Entitlement);
            }
            // Complete fixture membership; authenticate identities and held windows on chain.
            let region = Region {
                markets: self.risks().map(|risk| MarketRegion {
                    price_low: risk.lower,
                    price_high: risk.upper,
                    funding_low: risk.funding,
                    funding_high: risk.funding,
                }),
            };
            let mut summary = Summary::default();
            for account in &self.accounts {
                summary = summary.insert(region.contribution(account, 0)?)?;
            }
            if !summary.arithmetically_ready(self.accounts.len() as u64, self.pools.settlement)? {
                return Err(Error::Cohort);
            }
        }
        let (account, pools) = self.accounts[member].settle_claim(
            self.pools,
            0,
            atoms,
            [self.mark, 2_000],
            self.risks(),
            gain,
        )?;
        self.accounts[member] = account;
        self.pools = pools;
        self.reconcile();
        Ok(())
    }
}

#[test]
fn close_half_pay_then_close_the_remainder_at_each_notional() {
    for lots in [1, 3, 1_640, 16_394, 163_935, 1_000_000] {
        for (opening_side, entry, exit, mark) in
            [(0, 61_002, 61_998, 62_000), (1, 60_998, 60_002, 60_000)]
        {
            let mut market = Market::new();
            let mut fees = market
                .trade(opening_side, &[(MAKER_A, lots, entry)])
                .unwrap();
            for member in [TRADER, MAKER_A] {
                assert!(market.history[member].write(&mut [0; 12]).is_err());
                market.history[member].write(&mut [0; 13]).unwrap();
            }
            market.mark = mark;
            // Collect the open maker's 998-atom per-lot loss. The pool can fund even
            // the legacy open payout; the candidate still refuses one atom of it.
            market.settle(MAKER_A, lots * 998, false).unwrap();
            assert_eq!(market.claim(TRADER), i128::from(lots * 998) * SCALE);
            assert_eq!(market.cap(TRADER), 0);
            assert_eq!(market.settle(TRADER, 1, true), Err(Error::Entitlement));
            let first_close = lots.div_ceil(2);
            for closed in [first_close, lots - first_close]
                .into_iter()
                .filter(|&n| n != 0)
            {
                fees += market
                    .trade(1 - opening_side, &[(MAKER_B, closed, exit)])
                    .unwrap();
                // Difference between executed entry and exit is exactly 996 either way.
                let eligible = closed * 996;
                assert_eq!(market.cap(TRADER), eligible);
                assert_eq!(
                    market.settle(TRADER, eligible + 1, true),
                    Err(Error::Entitlement)
                );
                let before = market.history[TRADER].clone();
                market.settle(TRADER, eligible - 1, true).unwrap();
                assert_eq!(market.cap(TRADER), 1);
                market.settle(TRADER, 1, true).unwrap();
                assert_eq!(market.history[TRADER], before);
                assert_eq!(market.cap(TRADER), 0);
                let remaining = market.accounts[TRADER].positions[0].lots;
                assert_eq!(
                    market.history[TRADER].charge_cap(
                        remaining,
                        mark,
                        market.claim(TRADER),
                        remaining.unsigned_abs()
                    ),
                    Ok(remaining.unsigned_abs() * 998)
                );
            }
            assert_eq!(market.accounts[TRADER].positions[0].lots, 0);
            assert_eq!(market.claim(TRADER), 0);
            assert_eq!(
                market.accounts[MAKER_A].positions[0].lots.unsigned_abs(),
                lots
            );
            assert_eq!(market.cap(MAKER_B), 0);
            let expected_fees = (lots * entry).div_ceil(5_000)
                + (first_close * exit).div_ceil(5_000)
                + ((lots - first_close) * exit).div_ceil(5_000);
            assert_eq!(fees, expected_fees);
            assert_eq!(
                market.accounts[TRADER].cash,
                CASH + lots * 996 - expected_fees
            );
            assert_eq!(market.pools.settlement, 2 * lots);
            assert_eq!(market.claim(MAKER_B), i128::from(2 * lots) * SCALE);
        }
    }
}

#[test]
fn mixed_split_basis_fractional_closes_and_flip() {
    let mut market = Market::new();
    market
        .trade(0, &[(MAKER_A, 2, 61_000), (MAKER_B, 1, 61_001)])
        .unwrap();
    market.mark = 61_010;
    assert_eq!(market.cap(TRADER), 0);
    // One lot of the three realizes 1 2/3 atoms. The second realizes the same
    // amount. A three-lot flip closes the last long for 2 2/3 and opens two shorts.
    market.trade(1, &[(MAKER_B, 1, 61_002)]).unwrap();
    assert_eq!(market.cap(TRADER), 1);
    assert_eq!(market.settle(TRADER, 1, true), Err(Error::Entitlement)); // empty pool
    market.settle(MAKER_A, 10, false).unwrap();
    market.settle(TRADER, 1, true).unwrap();
    market.trade(1, &[(MAKER_B, 1, 61_002)]).unwrap();
    assert_eq!(market.cap(TRADER), 2);
    market.settle(TRADER, 2, true).unwrap();
    market.trade(1, &[(MAKER_B, 3, 61_003)]).unwrap();
    assert_eq!(market.accounts[TRADER].positions[0].lots, -2);
    assert_eq!(market.cap(TRADER), 0); // two losing shorts offset the fixed claim
    market.mark = 61_002;
    assert_eq!(market.cap(TRADER), 3);
    market.settle(TRADER, 3, true).unwrap();
    assert_eq!(market.claim(TRADER), 2 * SCALE);
    assert_eq!(market.cap(TRADER), 0);
}

#[test]
fn funding_and_repayment_of_previously_collected_cash_are_fixed() {
    let mut market = Market::new();
    market.trade(0, &[(MAKER_A, 2, 61_000)]).unwrap();
    market.mark = 60_990;
    market.settle(TRADER, 20, false).unwrap();
    market.mark = 61_005;
    // Return the 20 debited atoms. The 10 new atoms of open price profit stay unpaid.
    assert_eq!(market.cap(TRADER), 20);
    market.settle(TRADER, 20, true).unwrap();
    assert_eq!(market.cap(TRADER), 0);
    market.funding = -3 * SCALE / 4;
    assert_eq!(market.claim(TRADER), 11 * SCALE + SCALE / 2);
    assert_eq!(market.cap(TRADER), 1); // 1.5 fixed atoms
    market.settle(MAKER_A, 1, false).unwrap();
    market.settle(TRADER, 1, true).unwrap();
    market.funding = SCALE / 4;
    assert_eq!(market.cap(TRADER), 0);
    assert_eq!(market.claim(TRADER), 8 * SCALE + SCALE / 2);
    market.trade(1, &[(MAKER_A, 2, 61_005)]).unwrap();
    assert_eq!(market.cap(TRADER), 8);
    assert_eq!(market.claim(TRADER), 8 * SCALE + SCALE / 2);
}

#[test]
fn a_profitable_maker_can_collect_on_its_partial_buyback() {
    let mut market = Market::new();
    market.trade(0, &[(MAKER_A, 1_640, 61_002)]).unwrap();
    market.mark = 60_002;
    market.settle(TRADER, 1_640_000, false).unwrap();
    assert_eq!(market.cap(MAKER_A), 0);
    market.trade(1, &[(MAKER_A, 820, 60_002)]).unwrap();
    assert_eq!(market.accounts[MAKER_A].positions[0].lots, -820);
    assert_eq!(market.cap(MAKER_A), 820_000);
    market.settle(MAKER_A, 820_000, true).unwrap();
    assert_eq!(market.accounts[MAKER_A].cash, CASH + 820_000);
    assert_eq!(market.claim(MAKER_A), 820_000 * SCALE);
    assert_eq!(market.cap(MAKER_A), 0);
}

#[test]
fn repeated_realized_payments_do_not_grow_a_single_entry_record() {
    for lots in [1_640, 16_394, 163_935, 1_000_000] {
        let mut market = Market::new();
        market.trade(0, &[(MAKER_A, lots, 61_002)]).unwrap();
        market.mark = 62_002;
        market.settle(MAKER_A, lots * 1_000, false).unwrap();
        // With 220 distinct remaining sizes the prior open-payment case grew on
        // every payout. Here each sale earns 1,000 atoms; pay one and leave the rest.
        for closed in 1..=220 {
            market.trade(1, &[(MAKER_B, 1, 62_002)]).unwrap();
            assert_eq!(market.cap(TRADER), 999 * (closed - 1) + 1_000);
            market.settle(TRADER, 1, true).unwrap();
            assert_eq!(market.cap(TRADER), closed * 999);
            market.history[TRADER].write(&mut [0; 13]).unwrap();
            market.history[MAKER_B].write(&mut [0; 13]).unwrap();
        }
        // Reprice below entry. The fixed gain is still in the claim, but exposed
        // losses can consume part or all of the spendable entitlement.
        market.mark = 60_002;
        let net_claim = i128::from(220 * 999) - i128::from((lots - 220) * 1_000);
        assert_eq!(market.claim(TRADER), net_claim * SCALE);
        assert_eq!(market.cap(TRADER), net_claim.max(0) as u64);
    }
}

#[test]
fn replay_the_prior_open_payout_requests_at_the_same_prime_lot_counts() {
    for lots in [1_640, 16_394, 163_935, 1_000_000] {
        let mut market = Market::new();
        market.trade(0, &[(MAKER_A, lots, 61_002)]).unwrap();
        market.mark = 62_002;
        market.settle(MAKER_A, lots * 1_000, false).unwrap();
        let mut previous = lots;
        let mut requests = 0;
        for remaining in (11..=lots)
            .rev()
            .filter(|&quantity| {
                (2..)
                    .take_while(|divisor| divisor * divisor <= quantity)
                    .all(|divisor| quantity % divisor != 0)
            })
            .take(220)
        {
            if remaining < previous {
                market
                    .trade(1, &[(MAKER_B, previous - remaining, 61_002)])
                    .unwrap();
            }
            // Selling at entry realizes zero. Even with a funded pool, a later
            // mark 1,000 above entry cannot make that one-atom payment eligible.
            assert_eq!(market.settle(TRADER, 1, true), Err(Error::Entitlement));
            market.history[TRADER].write(&mut [0; 13]).unwrap();
            requests += 1;
            previous = remaining;
        }
        assert_eq!(requests, 220);
        assert_eq!(market.pools.settlement, lots * 1_000);
    }
}

#[test]
fn mixed_entries_can_exhaust_a_slot_with_only_one_surviving_lot() {
    let mut market = Market::new();
    market.trade(0, &[(MAKER_A, 1, 60_001)]).unwrap();
    market.mark = 60_004;
    // After n round trips at 60,002, entry = 60,002 - 1/2^n. Only the
    // increasing fill grows the entry. Each market order is for one lot.
    for _ in 0..984 {
        market.trade(0, &[(MAKER_A, 1, 60_002)]).unwrap();
        market.trade(1, &[(MAKER_A, 1, 60_002)]).unwrap();
    }
    assert_eq!(market.cap(TRADER), 0); // realized profit is 1 - 1/2^984
    assert_eq!(
        market.history[TRADER].charge_cap(1, market.mark, market.claim(TRADER), 1),
        Ok(2)
    );
    let before = (market.accounts, market.history.clone(), market.pools);
    assert_eq!(market.trade(0, &[(MAKER_A, 1, 60_002)]), Err(Error::Bounds));
    assert_eq!(
        (market.accounts, market.history.clone(), market.pools),
        before
    );
    let next = market.history[TRADER].fill(1, 2, 60_002).unwrap();
    assert!(next.write(&mut [0; 256]).is_err());
    next.write(&mut [0; 257]).unwrap();
    market.trade(1, &[(MAKER_A, 1, 60_004)]).unwrap();
    assert_eq!(market.cap(TRADER), 3);
    market.settle(MAKER_A, 3, false).unwrap();
    market.settle(TRADER, 3, true).unwrap();
    assert_eq!(market.claim(TRADER), 0);
}

#[test]
fn rejects_histories_with_payments_on_surviving_lots() {
    let entry = Attribution::default().fill(0, 2, 122_004).unwrap();
    let legacy = entry.payment(2, 62_002, 2_000 * SCALE, 1).unwrap();
    assert_eq!(
        legacy.closed_quantity_payment_cap(2, 62_002, 1_999 * SCALE),
        Err(Error::Invariant)
    );
}
