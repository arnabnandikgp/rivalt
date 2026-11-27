//! Bind verified movements to the original frozen pages for the existing settlement controller.
use super::*;
use crate::instructions::account_safety::settlement::{
    snapshot_binding, VerifyInventoryBook, ORIGINAL_DENOMINATOR,
};
use clearing_accounting::attribution::{FrozenCapacity, LotRate};
use default_plan_selection::market_indexed::{self as verifier, Cell, Episode, Member, RatesProof};
use financial_core::SCALE;

pub fn bind(
    ctx: &mut Context<VerifyInventoryBook>,
    events: &mut crate::event_cpi::Payloads,
    epoch: u64,
    revision: u64,
    selected: u8,
    denominator: u32,
    rates: Vec<u32>,
) -> Result<()> {
    let mut pages = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    let header = &mut accounts.prepared;
    accounts.source.frozen().matches(header)?;
    require!(
        header.epoch == epoch
            && header.revision == revision
            && (1..=verifier::MEMBERS as u64).contains(&header.count)
            && matches!(header.stage, single_pair::AWAIT_PAIR | ORIGINAL_DENOMINATOR),
        ClearingError::Resolution
    );
    // A partially run original denominator pass may have already written scratch limbs.
    // Only the freshly initialized checkpoint may be reused by the payout controller.
    let capacity = financial_core::clearing::scalable::wide::required_limbs(header.count)
        .map_err(|_| ClearingError::Resolution)?;
    let fresh = financial_core::clearing::scalable::cohort_denominator::DenominatorPass::new(
        header.count,
        capacity,
    )
    .map_err(|_| ClearingError::Resolution)?
    .checkpoint();
    require!(header.state.denominator == fresh, ClearingError::Resolution);
    let frozen = paged::read(header, &pages)?;
    let mut ids = Vec::with_capacity(frozen.len());
    let mut original = Vec::with_capacity(frozen.len());
    let mut capacities = Vec::new();
    let mut rows = Vec::with_capacity(frozen.len());
    for (index, row) in frozen.iter().enumerate() {
        ids.push(row.id);
        let mut cells = Vec::with_capacity(2);
        for market in 0..2 {
            let claim = row.claims[market];
            require!(claim % SCALE == 0, ClearingError::Resolution);
            let mut eligible = 0;
            if claim > 0 && row.lots[market] != 0 {
                let [numerator, denominator] = row.recovery_lot_rates[market];
                let capacity = FrozenCapacity::from_frozen_rate(
                    LotRate {
                        numerator,
                        denominator,
                    },
                    row.lots[market].unsigned_abs(),
                    claim,
                )
                .map_err(|_| ClearingError::Resolution)?;
                eligible =
                    u32::try_from(capacity.eligible).map_err(|_| ClearingError::Resolution)?;
                if eligible > 0 {
                    capacities.push((index, market, capacity));
                }
            }
            cells.push(Cell {
                claim: i32::try_from(claim / SCALE).map_err(|_| ClearingError::Resolution)?,
                lots: row.lots[market],
                eligible,
            });
        }
        rows.push(Member {
            cash: u32::try_from(row.cash).map_err(|_| ClearingError::Resolution)?,
            cells,
        });
        original.push(SearchMember {
            id: row.id,
            cash: row.cash,
            claims: row.claims,
            lots: row.lots,
            histories: Default::default(),
        });
    }
    let result = verifier::verify_book(
        &rows,
        &header.pools,
        &header.insurance,
        &RatesProof {
            selected,
            denominator,
            numerators: rates,
        },
        Some(Episode {
            venue: header.venue.as_array(),
            ordinal: epoch,
            member_ids: &ids,
            market_ids: &[0, 1],
            capacities: &capacities,
        }),
    )
    .map_err(|_| ClearingError::Resolution)?;
    let mut members = Vec::with_capacity(rows.len());
    let mut scan = RecoveryPayoutScan::default();
    for (index, posting) in result.postings.iter().enumerate() {
        let member = MemberResult {
            id: ids[index],
            cash: result.cash[index],
            claim_delta: [posting.claim_delta[0], posting.claim_delta[1]],
            movements: [posting.movement[0], posting.movement[1]],
        };
        scan = scan
            .accept(
                index as u64,
                member.id,
                frozen[index].cash,
                member.cash,
                member.movements,
                member.claim_delta,
            )
            .map_err(|_| ClearingError::Reconciliation)?;
        members.push(member);
    }
    let remaining = [
        header.insurance[0].checked_sub(result.spent[0]),
        header.insurance[1].checked_sub(result.spent[1]),
    ];
    let spent = scan
        .finish(
            snapshot_binding(header),
            [
                remaining[0].ok_or(ClearingError::Reconciliation)?,
                remaining[1].ok_or(ClearingError::Reconciliation)?,
            ],
            header.fees,
        )
        .map_err(|_| ClearingError::Reconciliation)?;
    let receipt = BoundResult {
        epoch,
        search: *header.address(),
        charges: [result.charges[0], result.charges[1]],
        insurance_spent: spent,
        member_count: header.count,
        schedule: result.selected_ordinal as u128,
        schedules_checked: result.checked_plans as u128,
    };
    paged::store(header, &original, &members, &mut pages)?;
    let bytes = &mut header.state.membership;
    bytes.fill(0);
    bytes[..8].copy_from_slice(MARKER);
    crate::wire::write(&receipt, &mut bytes[8..8 + RECEIPT_LEN])
        .map_err(|_| ClearingError::Resolution)?;
    header.stage = DENOMINATOR;
    events.emit(
        &crate::events::IndexedSettlementBound {
            venue: header.venue,
            epoch,
            prepared: *header.address(),
            selection_ordinal: result.selected_ordinal as u64,
            verified_plans: result.checked_plans as u64,
            charge_atoms: receipt.charges,
            insurance_spent: spent,
            member_ids: ids,
            claim_deltas: members.iter().map(|m| m.claim_delta).collect(),
            movements: members.iter().map(|m| m.movements).collect(),
            final_cash: result.cash,
            slot: Clock::get()?.slot,
        },
        accounts.event_authority.account().clone(),
    )
}
