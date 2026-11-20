//! A caller proposes the last marginal charge unit. Every subsequent row and
//! charge is derived by clearing, so a different payer may finish the proof.
//! Only a full scan reaching exactly min(shortfall, total available gain) can
//! release the denominator stage. A bad cutoff returns to the frozen gate.
use super::*;

#[cfg(not(feature = "btc-allocation-qualification"))]
pub fn advance(
    _: &mut Context<AdvanceBtcAllocation>,
    _: &mut crate::event_cpi::Payloads,
    _: u64,
    _: u64,
    _: u64,
    _: Option<[u64; 4]>,
) -> Result<()> {
    Err(ClearingError::Profile.into())
}

#[cfg(feature = "btc-allocation-qualification")]
mod candidate {
    use super::*;
    use default_plan_selection::{
        member_priority,
        proportional::{Marginal, MemberPriority},
    };
    use financial_core::clearing::scalable::snapshot::FrozenSide;

    const SCORING: u8 = 5;
    const MARKER: &[u8; 8] = b"RVBTC001";

    #[derive(AnchorSerialize, AnchorDeserialize)]
    pub struct Allocation {
        epoch: u64,
        attempt: u64,
        pub debtor: u64,
        shortfall: u64,
        cursor: u64,
        pub recovered: u64,
        capacity: u64,
        cutoff: [u64; 4],
        priority: [u8; 32],
    }

    impl Allocation {
        fn read(header: &PreparedSettlement) -> Result<Self> {
            let bytes = &header.state.membership;
            require!(bytes.starts_with(MARKER), ClearingError::Resolution);
            let plan =
                crate::wire::read::<Self>(&bytes[8..128]).map_err(|_| ClearingError::Resolution)?;
            require!(
                plan.epoch == header.epoch && plan.cursor <= header.count,
                ClearingError::Resolution
            );
            Ok(plan)
        }
        fn write(&self, header: &mut PreparedSettlement) -> Result<()> {
            let bytes = &mut header.state.membership;
            bytes.fill(0);
            bytes[..8].copy_from_slice(MARKER);
            crate::wire::write(self, &mut bytes[8..128])
                .map_err(|_| ClearingError::Resolution.into())
        }

        fn threshold(&self) -> Option<Marginal> {
            let [unit, capacity, extra_lots, id] = self.cutoff;
            (unit != 0).then_some(Marginal {
                unit,
                capacity,
                extra_lots,
                member: MemberPriority {
                    digest: self.priority,
                    id,
                },
            })
        }
    }

    pub fn committed(header: &PreparedSettlement) -> Result<Option<Allocation>> {
        if !header.state.membership.starts_with(MARKER) {
            return Ok(None);
        }
        let plan = Allocation::read(header)?;
        require!(
            matches!(header.stage, DENOMINATOR | PROPOSAL)
                && plan.cursor == header.count
                && plan.recovered == plan.capacity,
            ClearingError::Resolution
        );
        Ok(Some(plan))
    }

    pub fn advance(
        ctx: &mut Context<AdvanceBtcAllocation>,
        events: &mut crate::event_cpi::Payloads,
        epoch: u64,
        revision: u64,
        ordinal: u64,
        cutoff: Option<[u64; 4]>,
    ) -> Result<()> {
        require!(
            ctx.remaining_accounts()?.is_empty(),
            ClearingError::Resolution
        );
        let accounts = &mut ctx.accounts;
        let header = &mut accounts.prepared;
        accounts.source.frozen().matches(header)?;
        require!(
            header.epoch == epoch && header.revision == revision,
            ClearingError::Resolution
        );
        let row = plan::frozen_row(header, &accounts.page, ordinal)?;
        require!(
            row.member == *accounts.margin.address(),
            ClearingError::Resolution
        );
        plan::original_margin(header, &row, &accounts.margin)?;
        if let Some(cutoff) = cutoff {
            require!(
                header.stage == single_pair::AWAIT_PAIR,
                ClearingError::Resolution
            );
            let [unit, capacity, _, id] = cutoff;
            require!(
                cutoff == [0; 4] || (unit > 0 && unit <= capacity),
                ClearingError::Resolution
            );
            let shortfall =
                SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
                    .and_then(|scan| {
                        scan.unique_btc_debtor_shortfall(FrozenSide {
                            lots: row.lots[0],
                            claim: row.claims[0],
                            cash: row.cash,
                        })
                    })
                    .map_err(|_| ClearingError::Resolution)?;
            Allocation {
                epoch,
                attempt: revision,
                debtor: row.id,
                shortfall,
                cursor: 0,
                recovered: 0,
                capacity: 0,
                cutoff,
                priority: member_priority(header.venue.as_ref(), epoch, id),
            }
            .write(header)?;
            header.stage = SCORING;
            return Ok(());
        }
        require!(header.stage == SCORING, ClearingError::Resolution);
        let mut plan = Allocation::read(header)?;
        require!(plan.cursor == ordinal, ClearingError::Resolution);
        let mark = header.prices[0];
        let lots = row.lots[0];
        let mut terms = clearing_accounting::attribution::PairedLots::default();
        if row.id != plan.debtor && lots != 0 && row.claims[0] > 0 {
            let history = crate::profit_attribution::frozen_btc_history(&accounts.margin)?;
            let terms_at = history
                .frozen_capacity(lots, mark, row.claims[0], lots.unsigned_abs())
                .map_err(|_| ClearingError::Resolution)?;
            let member = MemberPriority {
                digest: member_priority(header.venue.as_ref(), epoch, row.id),
                id: row.id,
            };
            let charge = match plan.threshold() {
                None => 0,
                Some(pivot) => pivot
                    .charge(terms_at.eligible, member, |amount| {
                        terms_at.schedule(amount).ok().map(|terms| terms.matched)
                    })
                    .ok_or(ClearingError::Resolution)?,
            };
            terms = terms_at
                .schedule(charge)
                .map_err(|_| ClearingError::Resolution)?;
        }
        accounts.page.rows[(ordinal % 8) as usize].btc_charge = terms.charge;
        plan.cursor += 1;
        plan.capacity = plan
            .shortfall
            .min(plan.capacity.saturating_add(terms.eligible));
        let sum = u128::from(plan.recovered) + u128::from(terms.charge);
        let status = if sum > u128::from(plan.shortfall)
            || (plan.cursor == header.count && sum != u128::from(plan.capacity))
        {
            // A future attempt overwrites every row before its charges can be used.
            header.stage = single_pair::AWAIT_PAIR;
            header.state.membership.fill(0);
            2
        } else {
            plan.recovered = sum as u64;
            plan.write(header)?;
            if plan.cursor == header.count {
                header.stage = DENOMINATOR;
                1
            } else {
                0
            }
        };
        let base_price = if terms.matched == 0 {
            0
        } else if lots > 0 {
            mark.checked_sub(terms.base_ticks)
                .ok_or(ClearingError::Arithmetic)?
        } else {
            mark.checked_add(terms.base_ticks)
                .ok_or(ClearingError::Arithmetic)?
        };
        events.emit(
            &crate::events::FrozenBtcAllocationRow {
                venue: header.venue,
                slot: Clock::get()?.slot,
                epoch,
                attempt: plan.attempt,
                ordinal,
                debtor_id: plan.debtor,
                member_id: row.id,
                shortfall: plan.shortfall,
                eligible: terms.eligible,
                charge: terms.charge,
                matched_lots: terms.matched,
                base_price,
                extra_tick_lots: terms.extra_tick_lots,
                status,
            },
            accounts.event_authority.account().clone(),
        )
    }
}
#[cfg(feature = "btc-allocation-qualification")]
pub use candidate::{advance, committed};
