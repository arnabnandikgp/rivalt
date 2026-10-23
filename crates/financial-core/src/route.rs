//! Candidate-only FOK accounting. Authority, observations and CPI are clearing's job.
use super::*;

pub fn apply(
    trader: Participant,
    makers: &[Participant],
    legs: &[(u64, u64)],
    side: u8,
    lower: u64,
    upper: u64,
    funding: i128,
) -> Result<(Participant, Vec<Participant>, u64)> {
    let (t, next, fee) = candidate(trader, makers, legs, side, funding, 0)?;
    t.admissible(lower, upper, funding)?;
    for m in &next {
        m.admissible(lower, upper, funding)?;
    }
    Ok((t, next, fee))
}

/// Checked paired arithmetic only. Callers MUST recompute post-order reserves
/// and admit every candidate before committing any financial state.
pub fn candidate(
    trader: Participant,
    makers: &[Participant],
    legs: &[(u64, u64)],
    side: u8,
    funding: i128,
    notional_prefix: u64,
) -> Result<(Participant, Vec<Participant>, u64)> {
    if makers.is_empty() || makers.len() > 2 || makers.len() != legs.len() || side > 1 {
        return Err(Error::Bounds);
    }
    let mut cohort = vec![trader];
    cohort.extend_from_slice(makers);
    validate_cohort(&cohort)?;
    let mut t = trader.accrued(funding)?;
    let mut next = Vec::with_capacity(makers.len());
    let (mut quantity, mut notional) = (0u64, 0u64);
    for (maker, &(lots, gross)) in makers.iter().zip(legs) {
        // This checks each paired delta, but commits trader generation once for
        // the aggregate route, independent of the split and leg order.
        let m = if side == 0 {
            fill(trader, *maker, lots, gross, funding)?.1
        } else {
            fill(*maker, trader, lots, gross, funding)?.0
        };
        next.push(m);
        quantity = quantity.checked_add(lots).ok_or(Error::Overflow)?;
        notional = cash_add(notional, gross)?;
    }
    if quantity > MAX_LOTS as u64 || notional < MIN_ORDER_ATOMS {
        return Err(Error::Bounds);
    }
    let signed = if side == 0 {
        quantity as i64
    } else {
        -(quantity as i64)
    };
    t = t.with_lots(t.lots.checked_add(signed).ok_or(Error::Overflow)?)?;
    let quote = scaled(notional)?;
    t.virtual_scaled = if side == 0 {
        sub(t.virtual_scaled, quote)?
    } else {
        add(t.virtual_scaled, quote)?
    };
    let (_, fee) = fee_increment(notional_prefix, notional)?;
    t.cash = cash_sub(t.cash, fee)?;
    Ok((t, next, fee))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_split_and_generation() {
        let p = |id| Participant {
            id,
            cash: 1_000_000,
            ..Participant::default()
        };
        let (t, m, fee) = apply(
            p(0),
            &[p(1), p(2)],
            &[(2, 2000), (4, 4000)],
            0,
            1000,
            1000,
            0,
        )
        .unwrap();
        assert_eq!(
            (t.cash, t.lots, t.virtual_scaled, t.generation, fee),
            (999_998, 6, -6000 * SCALE, 1, 2)
        );
        assert_eq!(
            (m[0].lots, m[0].virtual_scaled, m[0].cash),
            (-2, 2000 * SCALE, 1_000_000)
        );
        assert_eq!((m[1].lots, m[1].virtual_scaled), (-4, 4000 * SCALE));
        let (flipped, _, _) = apply(t, &m, &[(6, 6000), (1, 1000)], 1, 1000, 1000, 0).unwrap();
        assert_eq!(
            (flipped.lots, flipped.virtual_scaled, flipped.generation),
            (-1, 1000 * SCALE, 2)
        );
    }
    #[test]
    fn fees_adverse_health_and_unpaid_credit() {
        let maker = Participant {
            id: 1,
            cash: 1_000_000,
            ..Participant::default()
        };
        let trader = Participant {
            id: 0,
            cash: 1000,
            ..Participant::default()
        };
        // Ten lots at 1000 need 1000 IM plus the two-atom fee.
        assert_eq!(
            apply(trader, &[maker], &[(10, 10000)], 0, 1000, 1000, 0),
            Err(Error::Health)
        );
        let rich_claim = Participant {
            virtual_scaled: 1_000_000 * SCALE,
            ..trader
        };
        assert_eq!(
            apply(rich_claim, &[maker], &[(10, 10000)], 0, 1000, 1000, 0),
            Err(Error::Health)
        );
        assert!(apply(
            Participant {
                cash: 1102,
                ..trader
            },
            &[maker],
            &[(10, 10000)],
            0,
            990,
            1000,
            0
        )
        .is_ok());
        assert_eq!(
            apply(
                Participant {
                    cash: 1101,
                    ..trader
                },
                &[maker],
                &[(10, 10000)],
                0,
                990,
                1000,
                0
            ),
            Err(Error::Health)
        );
        assert_eq!(
            apply(
                maker,
                &[Participant {
                    cash: 1000,
                    ..trader
                }],
                &[(10, 10000)],
                0,
                1000,
                1010,
                0
            ),
            Err(Error::Health)
        );
    }
}
