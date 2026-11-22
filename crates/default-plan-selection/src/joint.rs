//! Native admission of a complete proposed BTC/ETH reduction. A successful
//! receipt establishes feasibility on the supplied cohort, not optimality.
extern crate alloc;
pub mod foreign_protection;
pub mod original_terms;
pub mod receipt_bounds;
pub mod ordered_fill;
pub mod winner_inventory;
mod pair_order;
#[cfg(not(target_arch = "bpf"))]
mod dense_sharing;
#[cfg(not(target_arch = "bpf"))]
pub use dense_sharing::SharingResult;
use alloc::{collections::BTreeSet, vec::Vec};
use clearing_accounting::attribution::{Attribution, FrozenCapacity, PairedLots};
use financial_core::{
    clearing::{
        row::Row,
        scalable::{
            number::{Arithmetic, Number},
            rounding::{Circulation, Rounded},
            settlement::{verify, verify_reduced_claims, Proposal, Verified},
            wide::required_limbs,
        },
    },
    Error, Result, MAX_PRICE, SCALE,
};
use num_bigint::{BigInt, BigUint};
use num_integer::Integer;
use num_traits::{ToPrimitive, Zero};

pub struct Member<'a> {
    pub id: u64,
    pub row: Row,
    pub lots: [i64; 2],
    pub history: [&'a [u8]; 2],
}

pub struct FrozenBook<'a> {
    pub members: &'a [Member<'a>],
    pub marks: [u64; 2],
    pub pools: [u64; 2],
    pub insurance: [u64; 2],
    pub fees: [u64; 2],
}

/// The rate and remainder witnesses are proposals. Clearing independently
/// verifies the greatest rates and the canonical rounding order for both books.
#[derive(Clone, Copy)]
pub struct Witness<'a> {
    pub rates: &'a [Proposal],
    pub orders: [&'a [u64]; 2],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Charge {
    pub market: usize,
    pub debtor: u64,
    pub winner: u64,
    pub atoms: u64,
}

pub struct Receipt {
    pub budgets: Vec<[u64; 2]>,
    pub remaining_lots: Vec<[i64; 2]>,
    pub fills: Vec<PairedLots>,
    pub rounded: Rounded,
    pub spent: [u64; 2],
    /// Insurance budgets in the effective settlement, before measuring insurance spent.
    pub effective_budgets: [u64; 2],
    pub market_rates: [(BigUint, BigUint); 2],
    pub original_losses: [BigUint; 2],
    /// Net market loss removed, capped by the actual charge, in exact collateral atoms.
    pub recovered: [(BigInt, BigUint); 2],
}

pub struct OpenLotBound {
    pub budgets: Vec<[u64; 2]>,
    pub ceilings: [BigUint; 2],
    pub reached: bool,
}

fn budget_totals(budgets: &[[u64; 2]]) -> [BigUint; 2] {
    core::array::from_fn(|market| budgets.iter().map(|row| BigUint::from(row[market])).sum())
}

impl Receipt {
    /// The original settlement includes debt from both flat and open members.
    pub fn recovery_ceilings(&self) -> [BigUint; 2] {
        budget_totals(&self.budgets)
    }

    fn reaches(&self, ceilings: &[BigUint; 2]) -> bool {
        self.recovered.iter().zip(ceilings).all(|((numerator, denominator), ceiling)| {
            *numerator == BigInt::from(ceiling * denominator)
        })
    }

    pub fn reaches_both_recovery_ceilings(&self) -> bool {
        self.reaches(&self.recovery_ceilings())
    }
}

fn integer(value: &Number) -> BigUint {
    BigUint::new(
        value
            .words()
            .iter()
            .flat_map(|word| [*word as u32, (word >> 32) as u32])
            .collect(),
    )
}

fn recovery(
    original: &Verified<'_>,
    effective: &Verified<'_>,
    charged: [u128; 2],
) -> [(BigInt, BigUint); 2] {
    let before = integer(original.denominator());
    let after = integer(effective.denominator());
    let common = &before * &after;
    core::array::from_fn(|market| {
        let prior = integer(&original.market_losses()[market]) * &after;
        let current = integer(&effective.market_losses()[market]) * &before;
        let delta = (BigInt::from(prior) - BigInt::from(current))
            .min(BigInt::from(&common * charged[market]));
        let divisor = delta.magnitude().gcd(&common);
        (delta / BigInt::from(divisor.clone()), &common / divisor)
    })
}

fn debtor_budgets(
    baseline: &Verified<'_>,
    count: usize,
    arithmetic: &mut Arithmetic,
) -> Result<Vec<[u64; 2]>> {
    let losses = baseline.market_losses().each_ref().map(integer);
    let totals = baseline.market_residuals().each_ref().map(integer);
    let denominator = integer(baseline.denominator());
    let divisors = totals.map(|residual| residual * &denominator);
    (0..count)
        .map(|index| {
            let attribution = baseline.attribution(index, arithmetic)?;
            let mut budget = [0; 2];
            for market in 0..2 {
                if !divisors[market].is_zero() {
                    let share = integer(&attribution.residuals[market]) * &losses[market]
                        / &divisors[market];
                    budget[market] = share.to_u64().ok_or(Error::Overflow)?;
                }
            }
            Ok(budget)
        })
        .collect()
}

pub struct Edge {
    pub capacity: clearing_accounting::attribution::FrozenCapacity,
    pub market: usize,
    pub debtor: usize,
    pub winner: usize,
    pub maximum: u64,
}

impl FrozenBook<'_> {
    /// Forced reduction must close an original debtor lot in the charged market.
    /// A flat member's writeoff remains in the settlement and cannot fund a close.
    pub fn open_lot_bound(&self, receipt: &Receipt) -> Result<OpenLotBound> {
        if self.members.len() != receipt.budgets.len() {
            return Err(Error::Cohort);
        }
        let budgets: Vec<_> = self.members.iter().zip(&receipt.budgets).map(|(member, amounts)| {
            core::array::from_fn(|market| if member.lots[market] == 0 { 0 } else { amounts[market] })
        }).collect();
        let ceilings = budget_totals(&budgets);
        Ok(OpenLotBound { reached: receipt.reaches(&ceilings), budgets, ceilings })
    }

    /// The original greatest settlement rates determine each debtor's usable loss.
    pub fn edge_budgets(&self, original: Witness<'_>) -> Result<Vec<[u64; 2]>> {
        let rows: Vec<_> = self.members.iter().map(|member| member.row).collect();
        let count = u64::try_from(rows.len()).map_err(|_| Error::Bounds)?;
        let mut arithmetic = Arithmetic::new(required_limbs(count)?, 128)?;
        let plan = verify(
            &rows,
            self.pools,
            self.insurance,
            self.fees,
            original.rates,
            &mut arithmetic,
        )?;
        debtor_budgets(&plan, rows.len(), &mut arithmetic)
    }
    /// A zero-claim row contributes its retained cash and no market flow to
    /// the original rate equations. Combine those balances for this rate
    /// calculation, then return one budget for every original member.
    pub fn sparse_edge_budgets(&self, original: Witness<'_>) -> Result<Vec<[u64; 2]>> {
        // Native rate witnesses can use a common factor wider than the on-chain
        // u64 encoding. Keep the original cohort's arithmetic limits for them.
        #[cfg(not(target_arch = "bpf"))]
        if original.rates.iter().any(|proposal| proposal.factor.bits() > 64) {
            return self.edge_budgets(original);
        }
        let mut neutral = self.members.iter().filter(|member| member.row.claims == [0; 2]);
        if neutral.clone().count() < 2 {
            return self.edge_budgets(original);
        }
        let retained_cash = neutral.try_fold(0u64, |total, member| {
            total.checked_add(member.row.cash).ok_or(Error::Overflow)
        })?;
        let mut rows: Vec<_> = self.members.iter().map(|member| member.row)
            .filter(|row| row.claims != [0; 2]).collect();
        rows.push(Row { cash: retained_cash, claims: [0; 2] });
        let mut arithmetic = Arithmetic::new(required_limbs(rows.len() as u64)?, 128)?;
        let plan = verify(&rows, self.pools, self.insurance, self.fees, original.rates, &mut arithmetic)?;
        let mut active = debtor_budgets(&plan, rows.len() - 1, &mut arithmetic)?.into_iter();
        self.members.iter().map(|member| {
            if member.row.claims == [0; 2] { Ok([0; 2]) } else { active.next().ok_or(Error::Cohort) }
        }).collect()
    }
    /// Reconstruct each budget from payment rates and market loss fractions.
    /// The original settled book authenticates those terms once for all rows.
    #[cfg(not(target_arch = "bpf"))]
    pub fn original_page_budgets(&self, original: Witness<'_>) -> Result<Vec<[u64; 2]>> {
        let rows: Vec<_> = self.members.iter().map(|member| member.row).collect();
        let count = u64::try_from(rows.len()).map_err(|_| Error::Bounds)?;
        let mut arithmetic = Arithmetic::new(required_limbs(count)?, 128)?;
        let plan = verify(
            &rows,
            self.pools,
            self.insurance,
            self.fees,
            original.rates,
            &mut arithmetic,
        )?;
        let terms = original_terms::OriginalTerms::from_verified(&plan)?;
        rows.iter().map(|row| terms.debtor_budgets(row)).collect()
    }
    pub fn visit_edges(
        &self,
        budgets: &[[u64; 2]],
        mut visit: impl FnMut(Edge) -> Result<bool>,
    ) -> Result<bool> {
        if budgets.len() != self.members.len() {
            return Err(Error::Cohort);
        }
        for market in 0..2 {
            for (debtor, member) in self.members.iter().enumerate() {
                let budget = budgets[debtor][market];
                if budget == 0 || member.lots[market] == 0 {
                    continue;
                }
                for (winner, opposite) in self.members.iter().enumerate() {
                    if opposite.lots[market].signum() != -member.lots[market].signum() {
                        continue;
                    }
                    let lots = opposite.lots[market]
                        .unsigned_abs()
                        .min(member.lots[market].unsigned_abs());
                    let capacity = self.capacity(opposite, market, lots)?;
                    let maximum = capacity.eligible.min(budget);
                    if maximum == 0 {
                        continue;
                    }
                    if !visit(Edge {
                        capacity,
                        market,
                        debtor,
                        winner,
                        maximum,
                    })? {
                        return Ok(false);
                    }
                }
            }
        }
        Ok(true)
    }

    pub(super) fn capacity(
        &self,
        member: &Member<'_>,
        market: usize,
        available: u64,
    ) -> Result<FrozenCapacity> {
        let lots = member.lots[market];
        Attribution::read(member.history[market], lots)?.frozen_capacity(
            lots,
            self.marks[market],
            member.row.claims[market],
            available,
        )
    }

    pub fn verify_proposal(
        &self,
        original: Witness<'_>,
        effective: Witness<'_>,
        charges: &[Charge],
    ) -> Result<Receipt> {
        if self.marks.iter().any(|&mark| mark == 0 || mark > MAX_PRICE)
            || self.members.windows(2).any(|pair| pair[0].id >= pair[1].id)
        {
            return Err(Error::Cohort);
        }
        let rows: Vec<_> = self.members.iter().map(|member| member.row).collect();
        let mut lots: Vec<_> = self.members.iter().map(|member| member.lots).collect();
        let mut capacity = Vec::with_capacity(self.members.len());
        let mut net = [0i128; 2];
        for member in self.members {
            for (total, qty) in net.iter_mut().zip(member.lots) {
                *total = total.checked_add(i128::from(qty)).ok_or(Error::Overflow)?;
            }
            capacity.push([
                self.capacity(member, 0, member.lots[0].unsigned_abs())?,
                self.capacity(member, 1, member.lots[1].unsigned_abs())?,
            ]);
        }
        if net != [0, 0] {
            return Err(Error::Cohort);
        }
        let count = u64::try_from(rows.len()).map_err(|_| Error::Bounds)?;
        let mut arithmetic = Arithmetic::new(required_limbs(count)?, 128)?;
        let baseline = verify(
            &rows,
            self.pools,
            self.insurance,
            self.fees,
            original.rates,
            &mut arithmetic,
        )?;
        let budgets = debtor_budgets(&baseline, rows.len(), &mut arithmetic)?;
        let mut remaining_budget = budgets.clone();
        let mut charged = [0u128; 2];
        let mut adjusted = rows.clone();
        let mut fills = Vec::with_capacity(charges.len());
        let mut seen = BTreeSet::new();
        let index = |id| {
            self.members
                .binary_search_by_key(&id, |member| member.id)
                .map_err(|_| Error::Cohort)
        };
        for &Charge {
            market,
            debtor,
            winner,
            atoms,
        } in charges
        {
            if market >= 2 || atoms == 0 || !seen.insert((market, debtor, winner)) {
                return Err(Error::Cohort);
            }
            let debtor = index(debtor)?;
            let winner = index(winner)?;
            let winner_side = lots[winner][market].signum();
            if winner_side == 0 || lots[debtor][market].signum() != -winner_side {
                return Err(Error::Entitlement);
            }
            remaining_budget[debtor][market] = remaining_budget[debtor][market]
                .checked_sub(atoms)
                .ok_or(Error::Entitlement)?;
            let fill = capacity[winner][market].schedule(atoms)?;
            if fill.matched
                > lots[debtor][market]
                    .unsigned_abs()
                    .min(lots[winner][market].unsigned_abs())
            {
                return Err(Error::Entitlement);
            }
            let delta = i128::from(atoms) * SCALE;
            if adjusted[winner].claims[market] < delta {
                return Err(Error::Entitlement);
            }
            adjusted[winner].claims[market] -= delta;
            adjusted[debtor].claims[market] = adjusted[debtor].claims[market]
                .checked_add(delta)
                .ok_or(Error::Overflow)?;
            let signed_lots =
                i64::try_from(fill.matched).map_err(|_| Error::Overflow)? * winner_side;
            lots[winner][market] -= signed_lots;
            lots[debtor][market] += signed_lots;
            charged[market] = charged[market]
                .checked_add(u128::from(atoms))
                .ok_or(Error::Overflow)?;
            fills.push(fill);
        }
        let mut original_payout = Circulation::new(&baseline, original.orders, &mut arithmetic)?;
        while !original_payout.is_done() {
            original_payout.step()?;
        }
        let plan = verify_reduced_claims(
            &rows,
            &adjusted,
            self.pools,
            self.insurance,
            self.fees,
            effective.rates,
            &mut arithmetic,
        )?;
        let mut payout = Circulation::after_reduction(
            &plan,
            &original_payout,
            effective.orders,
            &mut arithmetic,
        )?;
        while !payout.is_done() {
            if payout.protected_search_exhausted() {
                return Err(Error::Entitlement);
            }
            payout.step()?;
        }
        let (rates, denominator) = plan.market_rates();
        Ok(Receipt {
            effective_budgets: plan.effective_budgets(),
            market_rates: rates
                .each_ref()
                .map(|value| (integer(value), integer(denominator))),
            budgets,
            remaining_lots: lots,
            fills,
            rounded: payout.result()?,
            spent: plan.insurance_spent(),
            original_losses: baseline.market_losses().each_ref().map(integer),
            recovered: recovery(&baseline, &plan, charged),
        })
    }
}

#[cfg(test)]
mod budget_tests {
    use super::*;

    #[test]
    fn only_claimless_rows_can_be_combined_when_deriving_original_budgets() {
        let members: Vec<_> = (0..75).map(|id| Member {
            id,
            row: match id {
                3 => Row { cash: 20, claims: [-100 * SCALE, 0] },
                71 => Row { cash: 0, claims: [100 * SCALE, 0] },
                _ => Row { cash: id + 1, claims: [0; 2] },
            },
            lots: [0; 2],
            history: [&[], &[]],
        }).collect();
        let book = FrozenBook { members: &members, marks: [1; 2], pools: [0; 2], insurance: [0; 2], fees: [0; 2] };
        let rates = [Proposal { factor: 5u128.into(), rates: [1u128.into(), 5u128.into()] }];
        let witness = Witness { rates: &rates, orders: [&[], &[]] };
        let mut expected = alloc::vec![[0; 2]; 75];
        expected[3] = [80, 0];
        assert_eq!(book.edge_budgets(witness).unwrap(), expected);
        assert_eq!(book.sparse_edge_budgets(witness).unwrap(), expected);

        let wide = |coefficient: u64| Number::from_words(alloc::vec![0, 0, coefficient << 49]);
        let rates = [Proposal { factor: wide(5), rates: [wide(1), wide(5)] }];
        let witness = Witness { rates: &rates, orders: [&[], &[]] };
        assert_eq!(book.edge_budgets(witness).unwrap(), expected);
        assert_eq!(book.sparse_edge_budgets(witness).unwrap(), expected);
    }
}
