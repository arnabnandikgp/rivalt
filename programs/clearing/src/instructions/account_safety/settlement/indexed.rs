//! Verify the candidate on the venue's original frozen book. All accounts are read-only.
use super::*;
use anchor_lang::AccountDeserialize;
use clearing_accounting::attribution::FrozenCapacity;
use default_plan_selection::market_indexed::{self as verifier, Cell, Episode, Member, RatesProof};

#[inline(never)]
fn read_member(
    account: &AccountView,
    source: &FrozenSource,
    ordinal: usize,
    capacities: &mut Vec<(usize, usize, FrozenCapacity)>,
    gross: &mut [u64; 2],
) -> Result<(u64, Member)> {
    require!(
        account.owner() == &crate::ID
            && !account.executable()
            && !account.is_writable()
            && valid_margin_size(account.data_len()),
        ClearingError::Resolution
    );
    #[cfg(feature = "listed-margin-storage")]
    legacy_margin_bytes(&account.try_borrow()?)?;
    let root = Box::new(MarginAccount::try_deserialize(
        &mut &account.try_borrow()?[..],
    )?);
    let canonical = create_program_address(
        &[
            b"margin-v3",
            root.portfolio.as_ref(),
            &root.subaccount_index.to_le_bytes(),
            &[root.bump],
        ],
        &crate::ID,
    )
    .map_err(|_| ClearingError::Resolution)?;
    require!(
        account.address() == &canonical
            && root.venue == source.venue_key
            && root.revision > 0
            && root.id < source.registry.next_id,
        ClearingError::Resolution
    );
    let model = crate::engine::account::model(&root)?;
    let mut cells = Vec::with_capacity(2);
    for (m, position) in model.positions.iter().enumerate() {
        let mark = source.source.prices[m];
        let claim = position
            .unpaid(mark, source.source.funding[m])
            .map_err(|_| ClearingError::Arithmetic)?;
        require!(
            claim % financial_core::SCALE == 0,
            ClearingError::Resolution
        );
        let mut eligible = 0;
        if position.lots != 0 && claim > 0 {
            let basis =
                crate::profit_attribution::frozen_account_basis(account, &root.positions, m)?;
            let capacity = basis
                .frozen_capacity(position.lots, mark, claim, position.lots.unsigned_abs())
                .map_err(|_| ClearingError::Resolution)?;
            eligible = u32::try_from(capacity.eligible).map_err(|_| ClearingError::Resolution)?;
            if eligible > 0 {
                capacities.push((ordinal, m, capacity));
            }
        }
        gross[m] = gross[m]
            .checked_add(position.lots.unsigned_abs())
            .ok_or(ClearingError::Arithmetic)?;
        cells.push(Cell {
            claim: i32::try_from(claim / financial_core::SCALE)
                .map_err(|_| ClearingError::Resolution)?,
            lots: position.lots,
            eligible,
        });
    }
    Ok((
        root.id,
        Member {
            cash: u32::try_from(root.cash).map_err(|_| ClearingError::Resolution)?,
            cells,
        },
    ))
}

/// Return member cash in stable ID order, followed by each market's insurance spend and forced charge.
pub fn preview(
    ctx: &mut Context<PreparedSourceIdentity>,
    epoch: u64,
    selected: u8,
    denominator: u32,
    rates: Vec<u32>,
) -> Result<Vec<u64>> {
    let accounts = ctx.remaining_accounts()?;
    let source = ctx.accounts.frozen();
    source.validate()?;
    require!(
        source.source.epoch == epoch
            && source.source.count == accounts.len() as u64
            && accounts.len() <= verifier::MEMBERS,
        ClearingError::Resolution
    );
    let mut rows = Vec::with_capacity(accounts.len());
    let mut ids = Vec::with_capacity(accounts.len());
    let mut capacities = Vec::new();
    let mut gross = [0; 2];
    for (ordinal, account) in accounts.iter().enumerate() {
        let (id, row) = read_member(account, &source, ordinal, &mut capacities, &mut gross)?;
        require!(
            ids.last().is_none_or(|&previous| previous < id),
            ClearingError::Resolution
        );
        ids.push(id);
        rows.push(row);
    }
    let header = source.source;
    require!(
        gross == header.remaining_gross
            && rows.iter().map(|r| u64::from(r.cash)).sum::<u64>() == header.cash_before,
        ClearingError::Reconciliation
    );
    let venue = source.venue_key.to_bytes();
    let result = verifier::verify_book(
        &rows,
        &header.pools_before,
        &header.insurance_before,
        &RatesProof {
            denominator,
            selected,
            numerators: rates,
        },
        Some(Episode {
            venue: &venue,
            ordinal: epoch,
            member_ids: &ids,
            market_ids:&[0,1],
            capacities: &capacities,
        }),
    )
    .map_err(|_| ClearingError::Resolution)?;
    let mut report = result.cash;
    report.extend_from_slice(&result.spent[..header.prices.len()]);
    report.extend_from_slice(&result.charges[..header.prices.len()]);
    Ok(report)
}
