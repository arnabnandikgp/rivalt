//! Compute the unique first-difference charge at one ordered pair. Completing
//! a market with this kernel is a sufficient proof. A loose bound may fail.
use crate::pair_prefix::{LotBudget, Position};
use clearing_accounting::attribution::LotRate;
use financial_core::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OrderedFill {
    pub atoms: u64,
    pub matched: u64,
}

pub fn apply_pair(
    budget: &mut LotBudget,
    debtor: &mut Position,
    winner: &mut Position,
    rate: LotRate,
) -> Result<OrderedFill> {
    rate.validate()?;
    if winner.rate != rate.numerator.div_ceil(rate.denominator) {
        return Err(Error::Invariant);
    }
    let atoms = budget
        .upper_charge(*debtor, *winner)
        .ok_or(Error::Entitlement)?;
    let matched = rate.matched(atoms)?;
    let reduce = |mut position: Position, floor: u128| -> Result<(Position, u128)> {
        let original = position.minimum_lots().ok_or(Error::Bounds)?;
        position.atoms = position
            .atoms
            .checked_sub(atoms)
            .ok_or(Error::Entitlement)?;
        position.lots = position
            .lots
            .checked_sub(matched)
            .ok_or(Error::Entitlement)?;
        let required = position.minimum_lots().ok_or(Error::Bounds)?;
        if required > position.lots {
            return Err(Error::Entitlement);
        }
        Ok((
            position,
            floor
                .checked_sub(u128::from(original - required))
                .ok_or(Error::Invariant)?,
        ))
    };
    let (debtor_next, debtor_floor) = reduce(*debtor, budget.debtor_floor)?;
    let (winner_next, winner_floor) = reduce(*winner, budget.winner_floor)?;
    let remaining = budget
        .remaining
        .checked_sub(u128::from(matched))
        .ok_or(Error::Entitlement)?;
    if debtor_floor > remaining || winner_floor > remaining {
        return Err(Error::Entitlement);
    }
    *debtor = debtor_next;
    *winner = winner_next;
    *budget = LotBudget {
        remaining,
        debtor_floor,
        winner_floor,
    };
    Ok(OrderedFill { atoms, matched })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_fraction_can_reject_a_loose_prefix_without_changing_either_position() {
        let mut debtor = Position {
            atoms: 3,
            lots: 2,
            rate: 2,
        };
        let mut winner = Position {
            atoms: 3,
            lots: 2,
            rate: 2,
        };
        let mut budget = LotBudget {
            remaining: 2,
            debtor_floor: 2,
            winner_floor: 2,
        };
        // 4/3 atoms per lot only permits two atoms in two lots. The relaxed
        // integer bound proposes three. No filled prefix can be certified.
        assert!(apply_pair(
            &mut budget,
            &mut debtor,
            &mut winner,
            LotRate {
                numerator: 4,
                denominator: 3
            }
        )
        .is_err());
        assert_eq!(
            (debtor.atoms, debtor.lots, winner.atoms, winner.lots),
            (3, 2, 3, 2)
        );
        assert_eq!(
            (budget.remaining, budget.debtor_floor, budget.winner_floor),
            (2, 2, 2)
        );
    }

    #[test]
    fn a_slower_winner_can_leave_a_zero_prefix_for_the_next_debtor() {
        let mut debtor = Position {
            atoms: 8,
            lots: 2,
            rate: 4,
        };
        let mut winner = Position {
            atoms: 4,
            lots: 2,
            rate: 2,
        };
        let mut budget = LotBudget {
            remaining: 4,
            debtor_floor: 3,
            winner_floor: 4,
        };
        let none = apply_pair(
            &mut budget,
            &mut debtor,
            &mut winner,
            LotRate {
                numerator: 2,
                denominator: 1,
            },
        )
        .unwrap();
        assert_eq!((none.atoms, none.matched), (0, 0));
        let mut second = Position {
            atoms: 4,
            lots: 2,
            rate: 4,
        };
        let fill = apply_pair(
            &mut budget,
            &mut second,
            &mut winner,
            LotRate {
                numerator: 2,
                denominator: 1,
            },
        )
        .unwrap();
        assert_eq!((fill.atoms, fill.matched), (4, 2));
        assert_eq!(
            (second.atoms, winner.atoms, debtor.atoms, budget.remaining),
            (0, 0, 8, 2)
        );
    }
}
