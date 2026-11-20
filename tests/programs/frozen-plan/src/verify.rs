use super::*;
use clearing::state::accounts::FrozenMargin;
use default_plan_selection::{
    member_priority,
    proportional::{Boundary, Marginal, MemberPriority},
};
use financial_core::{
    clearing::{
        row::Row,
        scalable::snapshot::{SnapshotBinding, SnapshotScan},
    },
    SCALE,
};

fn priority(header: &PreparedSettlement, id: u64) -> MemberPriority {
    MemberPriority {
        id,
        digest: member_priority(header.venue.as_ref(), header.epoch, id),
    }
}
fn pack(value: Option<Marginal>) -> [u64; 4] {
    value
        .map(|m| [m.unit, m.capacity, m.extra_lots, m.member.id])
        .unwrap_or_default()
}
fn unpack(header: &PreparedSettlement, encoded: [u64; 4]) -> Option<Marginal> {
    let [unit, capacity, extra_lots, id] = encoded;
    (unit > 0).then(|| Marginal {
        unit,
        capacity,
        extra_lots,
        member: priority(header, id),
    })
}
pub fn begin(
    proof: &mut Comparison,
    header: &BorshAccount<PreparedSettlement>,
    debtor: &FrozenMargin,
    commitment: [u8; 32],
) -> Result<()> {
    require!(header.pools == [0; 2], ProofError::Unsupported);
    let binding = SnapshotBinding {
        count: header.count,
        allocated: header.allocated,
        pools: header.pools,
        fees: header.fees,
        insurance: header.insurance,
        gross: header.gross,
    };
    let model = Row {
        cash: debtor.cash,
        claims: debtor.claims,
    };
    let shares = SnapshotScan::from_checkpoint(&header.state.valuation, binding)
        .and_then(|scan| scan.linked_cash_shares(model, debtor.lots))
        .map_err(|_| ProofError::Unsupported)?;
    for (market, debt) in model.debts().iter().enumerate() {
        let face = u64::try_from(debt / SCALE as u128).map_err(|_| ProofError::Accounting)?;
        let loss = face
            .checked_sub(shares[market])
            .ok_or(ProofError::Accounting)?;
        proof.used_insurance[market] = loss.min(header.insurance[market]);
        proof.targets[market] = loss - proof.used_insurance[market];
    }
    proof.source = *header.address();
    proof.epoch = header.epoch;
    proof.revision = header.revision;
    proof.count = header.count;
    proof.debtor = debtor.id;
    proof.shares = shares;
    proof.opening_lots = debtor.lots;
    proof.remaining = commitment;
    proof.outcome = hashv(&[
        b"Rivalt/linked-payout/v1",
        header.address().as_ref(),
        &header.epoch.to_le_bytes(),
        &header.revision.to_le_bytes(),
        &header.registry_hash,
    ])
    .to_bytes();
    Ok(())
}
pub fn step(
    proof: &mut Comparison,
    header: &PreparedSettlement,
    row: &FrozenMargin,
    root: &BorshAccount<MarginAccount>,
    charges: [u64; 2],
) -> Result<()> {
    let mut cash = row.cash;
    let mut matched = [0u64; 2];
    if row.id == proof.debtor {
        require!(charges == [0; 2], ProofError::Charge);
        for share in proof.shares {
            cash = cash.checked_sub(share).ok_or(ProofError::Accounting)?;
        }
    } else {
        // Independent creditor payoffs follow only for this source family.
        require!(
            (row.claims[0] == 0 && row.lots[0] == 0) || (row.claims[1] == 0 && row.lots[1] == 0),
            ProofError::Unsupported
        );
        for (market, &charge) in charges.iter().enumerate() {
            let lots = row.lots[market];
            let claim = row.claims[market];
            require!(
                claim >= 0
                    && claim % SCALE == 0
                    && (lots == 0 || lots.signum() == -proof.opening_lots[market].signum()),
                ProofError::Unsupported
            );
            let capacity = clearing::frozen_history(root, market)?
                .frozen_capacity(lots, header.prices[market], claim, lots.unsigned_abs())
                .map_err(|_| ProofError::Source)?;
            require!(charge <= capacity.eligible, ProofError::Charge);
            let terms = capacity.schedule(charge).map_err(|_| ProofError::Charge)?;
            matched[market] = terms.matched;
            let bound = &mut proof.boundaries[market];
            // cap total is unnecessary here: seal requires the full shortfall.
            let mut boundary = Boundary {
                recovered: proof.recovered[market],
                capped_capacity: 0,
                last_selected: unpack(header, bound.last),
                first_remaining: unpack(header, bound.next),
            };
            boundary
                .include(
                    proof.targets[market],
                    priority(header, row.id),
                    capacity.eligible,
                    charge,
                    |amount| capacity.schedule(amount).ok().map(|value| value.matched),
                )
                .ok_or(ProofError::Charge)?;
            bound.last = pack(boundary.last_selected);
            bound.next = pack(boundary.first_remaining);
            proof.recovered[market] = boundary.recovered;
            proof.charged_lots[market] = proof.charged_lots[market]
                .checked_add(terms.matched)
                .ok_or(ProofError::Accounting)?;
            let face = u64::try_from(claim / SCALE).map_err(|_| ProofError::Accounting)?;
            cash = cash
                .checked_add(face.checked_sub(charge).ok_or(ProofError::Charge)?)
                .ok_or(ProofError::Accounting)?;
        }
    }
    proof.total_cash = proof
        .total_cash
        .checked_add(cash)
        .ok_or(ProofError::Accounting)?;
    proof.outcome = hashv(&[
        &proof.outcome,
        row.member.as_ref(),
        &row.id.to_le_bytes(),
        &cash.to_le_bytes(),
        &charges[0].to_le_bytes(),
        &charges[1].to_le_bytes(),
        &matched[0].to_le_bytes(),
        &matched[1].to_le_bytes(),
    ])
    .to_bytes();
    Ok(())
}
pub fn seal(proof: &mut Comparison, header: &PreparedSettlement) -> Result<()> {
    require!(
        proof.cursor == proof.count
            && proof.remaining == [0; 32]
            && proof.recovered == proof.targets,
        ProofError::Incomplete
    );
    let mut allocated = proof.total_cash;
    for (market, cut) in proof.boundaries.iter().enumerate() {
        require!(
            proof.charged_lots[market] <= proof.opening_lots[market].unsigned_abs(),
            ProofError::Charge
        );
        if let (Some(last), Some(next)) = (unpack(header, cut.last), unpack(header, cut.next)) {
            require!(!last.compare(&next).is_gt(), ProofError::Priority);
        }
        allocated = allocated
            .checked_add(header.insurance[market] - proof.used_insurance[market])
            .and_then(|amount| amount.checked_add(header.fees[market]))
            .ok_or(ProofError::Accounting)?;
    }
    require!(allocated == header.allocated, ProofError::Accounting);
    proof.sealed = true;
    Ok(())
}
