//! Fresh-genesis comparison build. Each lane keeps exact conservation totals separately
//! from its conservative debtor bounds. No historical lane may be opened or resized in place.
use super::*;
use crate::instructions::{account_cash, account_membership};

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Default)]
pub(super) struct Totals {
    lots: [i128; 2],
    fixed: [i128; 2],
    open: [u16; 2],
    flat_debt_with_sibling: [u16; 2],
    both_open: u16,
}

impl Totals {
    pub(super) fn replace(
        &mut self,
        before: Option<CoverageMember>,
        after: Option<CoverageMember>,
    ) -> Result<()> {
        for (row, sign) in [(before, -1i128), (after, 1)] {
            let Some(row) = row else { continue };
            let count = |value: &mut u16| -> Result<()> {
                *value = value
                    .checked_add_signed(sign as i16)
                    .ok_or(ClearingError::Arithmetic)?;
                Ok(())
            };
            for market in 0..2 {
                // MAX_FIXED < 2^87 per member, and each lane is capped at ROWS_PER_LANE.
                self.lots[market] = self.lots[market]
                    .checked_add(sign * i128::from(row.lots[market]))
                    .ok_or(ClearingError::Arithmetic)?;
                let delta = sign
                    .checked_mul(row.fixed[market])
                    .ok_or(ClearingError::Arithmetic)?;
                self.fixed[market] = self.fixed[market]
                    .checked_add(delta)
                    .ok_or(ClearingError::Arithmetic)?;
                if row.lots[market] != 0 {
                    count(&mut self.open[market])?;
                } else if row.fixed[market] < 0 && row.lots[1 - market] != 0 {
                    count(&mut self.flat_debt_with_sibling[market])?;
                }
            }
            if row.lots.iter().all(|lots| *lots != 0) {
                count(&mut self.both_open)?;
            }
        }
        Ok(())
    }

    pub(super) fn read(view: &AccountView) -> Result<Self> {
        require!(
            view.data_len() == CoverageLane::SPACE,
            ClearingError::ExitCohort
        );
        crate::wire::read(&view.try_borrow()?[CoverageLane::ROW_SPACE..])
    }

    pub(super) fn write(&self, view: &AccountView) -> Result<()> {
        crate::wire::write(
            self,
            &mut view.clone().try_borrow_mut()?[CoverageLane::ROW_SPACE..],
        )
    }
}

#[derive(Default)]
pub(super) struct MarketCheck {
    lots: i128,
    fixed: i128,
    required: u8,
}

impl MarketCheck {
    pub(super) fn add(
        &mut self,
        totals: Totals,
        rows: impl Iterator<Item = Result<CoverageMember>>,
        target: usize,
        prices: [[i128; 2]; 2],
    ) -> Result<()> {
        self.lots = self
            .lots
            .checked_add(totals.lots[target])
            .ok_or(ClearingError::Arithmetic)?;
        self.fixed = self
            .fixed
            .checked_add(totals.fixed[target])
            .ok_or(ClearingError::Arithmetic)?;
        if totals.open[target] > 0 {
            self.required |= 1 << target;
        }
        let sibling = 1 << (1 - target);
        if totals.flat_debt_with_sibling[target] > 0 {
            self.required |= sibling;
        }
        if self.required & sibling == 0 && totals.both_open != 0 {
            for row in rows {
                let row = row?;
                if row.lots.contains(&0) {
                    continue;
                }
                let lots = row.lots[target];
                let price = prices[target][usize::from(lots < 0)];
                let marked = i128::from(lots)
                    .checked_mul(price)
                    .and_then(|value| value.checked_add(row.fixed[target]))
                    .ok_or(ClearingError::Arithmetic)?;
                if marked < 0 {
                    self.required |= sibling;
                    break;
                }
            }
        }
        Ok(())
    }

    fn conserve(&self, pool: u64) -> Result<()> {
        require!(
            pool <= financial_core::MAX_CASH
                && self.lots == 0
                && self.fixed == engine::checked(financial_core::scaled(pool))?,
            ClearingError::Reconciliation
        );
        Ok(())
    }

    pub(super) fn finish(&self, snapshot: &Snapshot, pool: u64) -> Result<()> {
        self.conserve(pool)?;
        for index in 0..2 {
            if self.required & (1 << index) != 0 {
                engine::oracle::action(snapshot.market(index)?, &snapshot.clock, false)?;
            }
        }
        msg!("backing pool={} sources={}", pool, self.required);
        Ok(())
    }
}

pub(super) fn pool(
    accounts: &ObserveCoverage,
    views: &[AccountView],
    target: usize,
) -> Result<u64> {
    let venue = accounts.venue.address();
    let safety = BorshAccount::<VenueSafety>::load(views[0].clone())?;
    let ledger = BorshAccount::<MarketLedger>::load(views[1].clone())?;
    let market = &accounts.venue.markets[target];
    for (view, seed, parent, bump) in [
        (&views[0], b"safety-v3".as_slice(), venue, safety.bump),
        (&views[1], b"ledger-v3".as_slice(), market, ledger.bump),
    ] {
        let key = create_program_address(&[seed, parent.as_ref(), &[bump]], &crate::ID)
            .map_err(|_| ClearingError::ExitCohort)?;
        require_keys_eq!(*view.address(), key, ClearingError::ExitCohort);
    }
    require!(
        safety.venue == *venue
            && ledger.venue == *venue
            && ledger.market == *market
            && ledger.market_index as usize == target
            && ledger.schema_version == SCHEMA_VERSION,
        ClearingError::ExitCohort
    );
    account_cash::profile(&accounts.venue, &safety)?;
    account_membership::members::registry(&accounts.registry)?;
    Ok(ledger.settlement)
}

#[cfg(test)]
mod tests {
    use super::*;
    const ATOM: i128 = 1_000_000_000;

    fn row(lots: [i64; 2], fixed: [i128; 2]) -> CoverageMember {
        CoverageMember {
            id: 1,
            cash: 20,
            lots,
            fixed: fixed.map(|n| n * ATOM),
        }
    }

    fn evaluate(rows: &[CoverageMember], target: usize, interval: [[i128; 2]; 2]) -> MarketCheck {
        let mut totals = Totals::default();
        for row in rows {
            totals.replace(None, Some(*row)).unwrap();
        }
        let mut check = MarketCheck::default();
        check
            .add(
                totals,
                rows.iter().copied().map(Ok),
                target,
                interval.map(|r| r.map(|n| n * ATOM)),
            )
            .unwrap();
        check
    }

    #[test]
    fn conservation_requires_exact_cash_and_flat_book() {
        let rows = [row([2, 0], [-20, 0]), row([-2, 0], [27, 0])];
        let check = evaluate(&rows, 0, [[9, 11], [1, 1]]);
        assert!(check.conserve(7).is_ok());
        assert!(check.conserve(6).is_err());
        assert!(check.conserve(8).is_err());
        assert!(evaluate(&[row([-1, 0], [7, 0])], 0, [[1, 1]; 2])
            .conserve(7)
            .is_err());
    }

    #[test]
    fn sibling_source_depends_on_the_target_at_its_adverse_endpoint() {
        let interval = [[9, 11], [1, 1]];
        for (position, mask) in [
            (row([0, 1], [0, 0]), 0),
            (row([0, 1], [-1, 0]), 2),
            (row([1, 1], [-9, 0]), 1),
            (row([1, 1], [-10, 0]), 3),
            (row([-1, 1], [11, 0]), 1),
            (row([-1, 1], [10, 0]), 3),
        ] {
            assert_eq!(evaluate(&[position], 0, interval).required, mask);
        }
    }

    #[test]
    fn replacing_and_removing_rows_erases_every_exact_total() {
        let mut totals = Totals::default();
        let before = row([2, -3], [1, 2]);
        let after = row([2, 0], [-3, -4]);
        totals.replace(None, Some(before)).unwrap();
        totals.replace(Some(before), Some(after)).unwrap();
        assert_eq!(totals.both_open, 0);
        assert_eq!(totals.flat_debt_with_sibling, [0, 1]);
        totals.replace(Some(after), None).unwrap();
        assert_eq!(
            (
                totals.lots,
                totals.fixed,
                totals.open,
                totals.flat_debt_with_sibling
            ),
            ([0; 2], [0; 2], [0; 2], [0; 2])
        );
    }
}
