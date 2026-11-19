// Loaded within the frozen-book adapter to reuse its authenticated row and receipt types.
use crate::events::MultiLotBookVerified;
use clearing_accounting::attribution::LotRate;
use default_plan_selection::compact_book::{select, Debtor, Winner};
pub(super) const MARKER: &[u8; 8] = b"RVMULT01";

#[inline(never)]
pub(super) fn certify(
    header: &PreparedSettlement,
    positions: &mut [Position],
) -> Result<MultiLotBookVerified> {
    SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
        .and_then(|scan| scan.verified_whole_btc_book())
        .map_err(|_| ClearingError::Resolution)?;
    let mut debt = 0u128;
    let mut uncovered = 0u128;
    let mut debtors = Vec::new();
    let mut winners = Vec::new();
    for position in positions.iter() {
        let face =
            u64::try_from(position.face.unsigned_abs()).map_err(|_| ClearingError::Arithmetic)?;
        if position.face < 0 {
            let loss = face.saturating_sub(position.cash);
            debt = debt
                .checked_add(u128::from(face))
                .ok_or(ClearingError::Arithmetic)?;
            uncovered = uncovered
                .checked_add(u128::from(loss))
                .ok_or(ClearingError::Arithmetic)?;
            debtors.push(Debtor {
                id: position.id,
                lots: position.lots,
                budget: loss,
            });
        } else {
            let [numerator, denominator] = position.rate;
            winners.push(Winner {
                id: position.id,
                lots: position.lots,
                face,
                rate: LotRate {
                    numerator,
                    denominator,
                },
            });
        }
    }
    verify_totals(header, debt)?;
    for debtor in &mut debtors {
        debtor.budget = post_insurance(debtor.budget, uncovered, header.insurance[0])?;
    }
    let plan = select(&header.venue.to_bytes(), header.epoch, &debtors, &winners)
        .map_err(|_| ClearingError::Resolution)?
        .ok_or(ClearingError::Resolution)?;
    let capacities = plan
        .capacities
        .into_iter()
        .zip(winners)
        .map(|([id, capacity], winner)| {
            [id, capacity, winner.rate.numerator, winner.rate.denominator]
        })
        .collect();
    let mut pairs = Vec::with_capacity(plan.pairs.len());
    for pair in plan.pairs {
        let mut side = 0;
        for id in [pair.debtor, pair.winner] {
            let index = positions
                .binary_search_by_key(&id, |position| position.id)
                .map_err(|_| ClearingError::Resolution)?;
            let position = &mut positions[index];
            position.charge = position
                .charge
                .checked_add(pair.charge)
                .ok_or(ClearingError::Arithmetic)?;
            if id == pair.winner {
                side = position.lots.signum();
            }
        }
        let ticks = pair.charge / pair.matched;
        let base = if side > 0 {
            header.prices[0].checked_sub(ticks)
        } else {
            header.prices[0].checked_add(ticks)
        }
        .ok_or(ClearingError::Arithmetic)?;
        pairs.push([
            pair.debtor,
            pair.winner,
            pair.charge,
            pair.matched,
            base,
            pair.charge % pair.matched,
        ]);
    }
    Ok(MultiLotBookVerified {
        venue: header.venue,
        epoch: header.epoch,
        slot: Clock::get()?.slot,
        total: plan.total,
        capacities,
        pairs,
    })
}

pub(super) fn digest(event: &MultiLotBookVerified) -> [u8; 32] {
    use solana_sha256_hasher::hashv;
    let mut hash = hashv(&[
        b"Rivalt/multi-lot-book/v1",
        &event.venue.to_bytes(),
        &event.epoch.to_le_bytes(),
        &event.total.to_le_bytes(),
        &(event.capacities.len() as u64).to_le_bytes(),
        &(event.pairs.len() as u64).to_le_bytes(),
    ])
    .to_bytes();
    for row in &event.capacities {
        hash = hashv(&[
            &hash,
            &row[0].to_le_bytes(),
            &row[1].to_le_bytes(),
            &row[2].to_le_bytes(),
            &row[3].to_le_bytes(),
        ])
        .to_bytes();
    }
    for row in &event.pairs {
        hash = hashv(&[
            &hash,
            &row[0].to_le_bytes(),
            &row[1].to_le_bytes(),
            &row[2].to_le_bytes(),
            &row[3].to_le_bytes(),
            &row[4].to_le_bytes(),
            &row[5].to_le_bytes(),
        ])
        .to_bytes();
    }
    hash
}
