//! A complete-cohort proof with exactly one BTC debtor and one opposing lot.
//! Once membership traversal finishes, its 544-byte checkpoint becomes an
//! episode-bound selection receipt. Frozen financial rows remain immutable.
use super::*;
pub const AWAIT_PAIR: u8 = 4;
#[cfg(feature = "btc-residual-qualification")]
const RECEIPT: &[u8; 8] = b"RVPAIR02";
#[cfg(all(
    feature = "single-pair-default-qualification",
    not(feature = "btc-residual-qualification")
))]
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
    #[cfg(feature="btc-allocation-qualification")]
    if let Some(plan) = super::btc_allocation::committed(header)? { return Ok(plan.recovered); }
    Ok(receipt(header)?.2)
}

pub(super) fn economic_claims(
    header: &PreparedSettlement,
    frozen: &FrozenMargin,
) -> Result<[i128; 2]> {
    #[cfg(feature="recovery-search-qualification")]
    { super::recovery::binding::BoundResult::read(header)?.claims(frozen) }

    #[cfg(all(feature = "single-pair-default-qualification", not(feature = "recovery-search-qualification")))]
    {
        #[cfg(feature="book-inventory-qualification")]
        if super::inventory_book::Receipt::read(header)?.is_some() {
            let charge=i128::from(frozen.book_charge)*financial_core::SCALE;
            let delta=if frozen.claims[0]<0 {charge} else {-charge};
            return Ok([frozen.claims[0].checked_add(delta).ok_or(ClearingError::Arithmetic)?,frozen.claims[1]]);
        }
        #[cfg(feature="shared-inventory-qualification")]
        if let Some(receipt) = super::shared_inventory::Receipt::read(header)? {
            return receipt.claims(frozen);
        }
        #[cfg(feature="foreign-creditor-qualification")]
        if let Some(receipt) = super::foreign_creditor::Receipt::read(header)? {
            return receipt.claims(frozen);
        }
        #[cfg(feature="linked-allocation-qualification")]
        if let Some(plan) = super::linked_allocation::committed(header)? {
            return plan.claims(frozen);
        }
        #[cfg(feature="linked-pair-qualification")]
        if let Some(joint) = super::linked_pair::Joint::read(header)? {
            require!(matches!(header.stage, DENOMINATOR | PROPOSAL), ClearingError::Resolution);
            return joint.claims(frozen);
        }
        #[cfg(feature="btc-allocation-qualification")]
        if let Some(plan) = super::btc_allocation::committed(header)? {
            let delta = if frozen.id == plan.debtor { i128::from(plan.recovered) } else { -i128::from(frozen.btc_charge) };
            let claim = frozen.claims[0].checked_add(delta * financial_core::SCALE).ok_or(ClearingError::Arithmetic)?;
            return Ok([claim, frozen.claims[1]]);
        }
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
    // The foreign-creditor build qualifies only its complete atomic certificate.
    require!(!cfg!(feature = "foreign-creditor-qualification"), ClearingError::Profile);
    use financial_core::clearing::scalable::snapshot::FrozenSide;
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    let prepared = &mut accounts.prepared;
    accounts.source.frozen().matches(prepared)?;
    require!(
        (prepared.stage == AWAIT_PAIR || (cfg!(feature = "linked-pair-qualification") && prepared.stage == 6))
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
    #[cfg(feature="linked-pair-qualification")]
    if prepared.gross[1] > 0 {
        return super::linked_pair::verify(prepared, debtor, winner, &accounts.winner, events,
            accounts.event_authority.account().clone());
    }
    let mark = prepared.prices[0];
    let side = |row: &FrozenMargin| FrozenSide {
        lots: row.lots[0],
        claim: row.claims[0],
        cash: row.cash,
    };
    let scan = SnapshotScan::from_checkpoint(&prepared.state.valuation, snapshot_binding(prepared))
        .map_err(|_| ClearingError::Resolution)?;
    #[cfg(not(feature = "btc-residual-qualification"))]
    let (charge, price, cap) = {
        let cap = crate::profit_attribution::frozen_cap(&accounts.winner, mark, winner.claims[0])?;
        let plan = scan
            .select_single_btc_pair(side(&debtor), side(&winner), mark, cap)
            .map_err(|_| ClearingError::Resolution)?;
        (plan.charge, plan.price.unwrap_or(0), cap)
    };
    #[cfg(feature = "btc-residual-qualification")]
    let (charge, price, cap, matched, extra) = {
        let shortfall = scan
            .sole_btc_shortfall(side(&debtor), side(&winner))
            .map_err(|_| ClearingError::Resolution)?;
        let terms = crate::profit_attribution::btc_reduction(
            &accounts.winner,
            mark,
            winner.claims[0],
            shortfall,
        )?;
        let price = if terms.matched == 0 {
            0
        } else if winner.lots[0] > 0 {
            mark.checked_sub(terms.base_ticks)
                .ok_or(ClearingError::Arithmetic)?
        } else {
            mark.checked_add(terms.base_ticks)
                .ok_or(ClearingError::Arithmetic)?
        };
        (
            terms.charge,
            price,
            terms.eligible,
            terms.matched,
            terms.extra_tick_lots,
        )
    };
    // No other claim or funded amount moves. Preserve original rows for the
    // custody reconciliation that authenticates every root just before payout.
    let bytes = &mut prepared.state.membership;
    bytes.fill(0);
    bytes[..8].copy_from_slice(RECEIPT);
    for (index, value) in [epoch, debtor.id, winner.id, charge, price, cap]
        .iter()
        .enumerate()
    {
        bytes[8 + 8 * index..16 + 8 * index].copy_from_slice(&value.to_le_bytes());
    }
    #[cfg(feature = "btc-residual-qualification")]
    {
        bytes[56..64].copy_from_slice(&matched.to_le_bytes());
        bytes[64..72].copy_from_slice(&extra.to_le_bytes());
    }
    prepared.stage = DENOMINATOR;
    #[cfg(feature = "btc-residual-qualification")]
    let event = crate::events::FrozenBtcReductionVerified {
        venue: prepared.venue,
        slot: Clock::get()?.slot,
        epoch,
        debtor_id: debtor.id,
        winner_id: winner.id,
        mark,
        base_price: price,
        charge,
        unpaid_gain_cap: cap,
        matched_lots: matched,
        extra_tick_lots: extra,
    };
    #[cfg(not(feature = "btc-residual-qualification"))]
    let event = crate::events::FrozenPairVerified {
        venue: prepared.venue,
        slot: Clock::get()?.slot,
        epoch,
        debtor_id: debtor.id,
        winner_id: winner.id,
        mark,
        price,
        charge,
        unpaid_gain_cap: cap,
    };
    events.emit(&event, accounts.event_authority.account().clone())
}
