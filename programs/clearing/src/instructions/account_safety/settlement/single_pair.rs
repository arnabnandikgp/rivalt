//! A complete-cohort proof with exactly one BTC debtor and one opposing lot.
//! Once membership traversal finishes, its 544-byte checkpoint becomes an
//! episode-bound selection receipt. Frozen financial rows remain immutable.
use super::*;
pub const AWAIT_PAIR: u8 = 4;
#[cfg(feature = "single-pair-default-qualification")]
const RECEIPT: &[u8; 8] = b"RVPAIR01";

#[cfg(feature = "single-pair-default-qualification")]
fn receipt(header: &PreparedSettlement) -> Result<(u64, u64, u64)> {
    let bytes = &header.state.membership;
    require!(bytes.starts_with(RECEIPT), ClearingError::Resolution);
    let read = |offset: usize| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
    require!(read(8) == header.epoch, ClearingError::Resolution);
    Ok((read(16), read(24), read(32)))
}
#[cfg(feature = "single-pair-default-qualification")]
pub(super) fn verified_charge(header: &PreparedSettlement) -> Result<u64> {
    Ok(receipt(header)?.2)
}

pub(super) fn economic_claims(
    header: &PreparedSettlement,
    frozen: &FrozenMargin,
) -> Result<[i128; 2]> {
    #[cfg(feature = "single-pair-default-qualification")]
    {
        let (debtor, winner, charge) = receipt(header)?;
        let scaled = i128::from(charge) * financial_core::SCALE;
        let delta = if frozen.id == debtor {
            scaled
        } else if frozen.id == winner {
            -scaled
        } else {
            0
        };
        let claim = frozen.claims[0]
            .checked_add(delta)
            .ok_or(ClearingError::Arithmetic)?;
        Ok([claim, frozen.claims[1]])
    }
    #[cfg(not(feature = "single-pair-default-qualification"))]
    {
        let _ = header;
        Ok(frozen.claims)
    }
}

#[cfg(not(feature = "single-pair-default-qualification"))]
pub fn verify(
    _: &mut Context<VerifyFrozenPair>,
    _: &mut crate::event_cpi::Payloads,
    _: u64,
    _: u64,
    _: u64,
    _: u64,
) -> Result<()> {
    Err(ClearingError::Profile.into())
}

#[cfg(feature = "single-pair-default-qualification")]
pub fn verify(
    ctx: &mut Context<VerifyFrozenPair>,
    events: &mut crate::event_cpi::Payloads,
    epoch: u64,
    revision: u64,
    debtor_ordinal: u64,
    winner_ordinal: u64,
) -> Result<()> {
    use financial_core::clearing::scalable::snapshot::FrozenSide;
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    let prepared = &mut accounts.prepared;
    accounts.source.frozen().matches(prepared)?;
    require!(
        prepared.stage == AWAIT_PAIR
            && prepared.epoch == epoch
            && prepared.revision == revision
            && debtor_ordinal != winner_ordinal
            && accounts.winner_page.is_some() == (debtor_ordinal / 8 != winner_ordinal / 8),
        ClearingError::Resolution
    );
    let winner_page = accounts
        .winner_page
        .as_deref()
        .unwrap_or(&accounts.debtor_page);
    let debtor = plan::frozen_row(prepared, &accounts.debtor_page, debtor_ordinal)?;
    let winner = plan::frozen_row(prepared, winner_page, winner_ordinal)?;
    require!(
        debtor.member == *accounts.debtor.address()
            && winner.member == *accounts.winner.address()
            && debtor.id != winner.id,
        ClearingError::Resolution
    );
    plan::original_margin(prepared, &debtor, &accounts.debtor)?;
    plan::original_margin(prepared, &winner, &accounts.winner)?;
    let mark = prepared.prices[0];
    let cap = crate::profit_attribution::frozen_cap(&accounts.winner, mark, winner.claims[0])?;
    let side = |row: &FrozenMargin| FrozenSide {
        lots: row.lots[0],
        claim: row.claims[0],
        cash: row.cash,
    };
    let pair = SnapshotScan::from_checkpoint(&prepared.state.valuation, snapshot_binding(prepared))
        .and_then(|scan| scan.select_single_btc_pair(side(&debtor), side(&winner), mark, cap))
        .map_err(|_| ClearingError::Resolution)?;
    // No other claim or funded amount moves. Preserve original rows for the
    // custody reconciliation that authenticates every root just before payout.
    let bytes = &mut prepared.state.membership;
    bytes.fill(0);
    bytes[..8].copy_from_slice(RECEIPT);
    for (index, value) in [
        epoch,
        debtor.id,
        winner.id,
        pair.charge,
        pair.price.unwrap_or(0),
        cap,
    ]
    .iter()
    .enumerate()
    {
        bytes[8 + 8 * index..16 + 8 * index].copy_from_slice(&value.to_le_bytes());
    }
    prepared.stage = DENOMINATOR;
    events.emit(
        &crate::events::FrozenPairVerified {
            venue: prepared.venue,
            slot: Clock::get()?.slot,
            epoch,
            debtor_id: debtor.id,
            winner_id: winner.id,
            mark,
            price: pair.price.unwrap_or(0),
            charge: pair.charge,
            unpaid_gain_cap: cap,
        },
        accounts.event_authority.account().clone(),
    )
}
