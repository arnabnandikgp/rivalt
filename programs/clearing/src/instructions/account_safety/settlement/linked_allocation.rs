//! Full recovery for one cross debtor and market-local creditors. Both cutoff
//! proposals are fixed before the first member. Only the completed canonical
//! scan can make the per-row charges available to rates and payment.
use super::*;

#[cfg(not(feature = "linked-allocation-qualification"))]
pub fn advance(
    _: &mut Context<AdvanceBtcAllocation>,
    _: &mut crate::event_cpi::Payloads,
    _: u64,
    _: u64,
    _: u64,
    _: Option<[[u64; 4]; 2]>,
) -> Result<()> {
    Err(ClearingError::Profile.into())
}

#[cfg(all(
    feature = "linked-pair-qualification",
    not(feature = "linked-allocation-qualification")
))]
pub(super) fn charges(_: &PreparedSettlement) -> Result<Option<[u64; 2]>> {
    Ok(None)
}

#[cfg(feature = "linked-allocation-qualification")]
mod candidate {
    use super::*;
    use clearing_accounting::attribution::PairedLots;
    use default_plan_selection::{
        member_priority,
        proportional::{Marginal, MemberPriority},
    };

    const MARKER: &[u8; 8] = b"RVJALLOC";
    const SCORING: u8 = 7;

    #[derive(AnchorSerialize, AnchorDeserialize)]
    pub struct Allocation {
        epoch: u64,
        attempt: u64,
        debtor: u64,
        shares: [u64; 2],
        targets: [u64; 2],
        cursor: u64,
        recovered: [u64; 2],
        cutoffs: [[u64; 4]; 2],
    }

    impl Allocation {
        fn read(header: &PreparedSettlement) -> Result<Self> {
            let bytes = &header.state.membership;
            require!(bytes.starts_with(MARKER), ClearingError::Resolution);
            let value =
                crate::wire::read::<Self>(&bytes[8..152]).map_err(|_| ClearingError::Resolution)?;
            require!(
                value.epoch == header.epoch && value.cursor <= header.count,
                ClearingError::Resolution
            );
            Ok(value)
        }

        fn write(&self, header: &mut PreparedSettlement) -> Result<()> {
            let bytes = &mut header.state.membership;
            bytes.fill(0);
            bytes[..8].copy_from_slice(MARKER);
            crate::wire::write(self, &mut bytes[8..152])
                .map_err(|_| ClearingError::Resolution.into())
        }

        pub fn claims(&self, row: &FrozenMargin) -> Result<[i128; 2]> {
            let mut claims = row.claims;
            for (market, claim) in claims.iter_mut().enumerate() {
                let change = if row.id == self.debtor {
                    i128::from(self.targets[market])
                } else {
                    -i128::from(row.linked_charges[market])
                };
                *claim = claim
                    .checked_add(change * financial_core::SCALE)
                    .ok_or(ClearingError::Arithmetic)?;
            }
            Ok(claims)
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
                && plan.recovered == plan.targets,
            ClearingError::Resolution
        );
        Ok(Some(plan))
    }

    pub fn charges(header: &PreparedSettlement) -> Result<Option<[u64; 2]>> {
        Ok(committed(header)?.map(|plan| plan.targets))
    }

    #[inline(never)]
    fn begin(
        header: &mut PreparedSettlement,
        debtor: &FrozenMargin,
        cutoffs: [[u64; 4]; 2],
    ) -> Result<()> {
        require!(
            header.stage == single_pair::AWAIT_PAIR,
            ClearingError::Resolution
        );
        let row = Row {
            cash: debtor.cash,
            claims: debtor.claims,
        };
        let scan = SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
            .map_err(|_| ClearingError::Resolution)?;
        let shares = scan
            .linked_cash_shares(row, debtor.lots)
            .map_err(|_| ClearingError::Resolution)?;
        let mut targets = [0; 2];
        for (market, cutoff) in cutoffs.iter().enumerate() {
            require!(
                cutoff[0] > 0 && cutoff[0] <= cutoff[1],
                ClearingError::Resolution
            );
            let debt = u64::try_from(row.debts()[market] / financial_core::SCALE as u128)
                .map_err(|_| ClearingError::Arithmetic)?;
            targets[market] = debt
                .checked_sub(shares[market])
                .and_then(|unpaid| unpaid.checked_sub(header.insurance[market]))
                .filter(|value| *value > 0)
                .ok_or(ClearingError::Resolution)?;
        }
        Allocation {
            epoch: header.epoch,
            attempt: header.revision,
            debtor: debtor.id,
            shares,
            targets,
            cursor: 0,
            recovered: [0; 2],
            cutoffs,
        }
        .write(header)?;
        header.stage = SCORING;
        Ok(())
    }

    #[inline(never)]
    fn score(
        header: &PreparedSettlement,
        plan: &Allocation,
        row: &FrozenMargin,
        margin: &BorshAccount<MarginAccount>,
    ) -> Result<[PairedLots; 2]> {
        let mut result = [PairedLots::default(); 2];
        if row.id == plan.debtor {
            return Ok(result);
        }
        require!(
            row.claims
                .iter()
                .all(|claim| *claim >= 0 && *claim % financial_core::SCALE == 0),
            ClearingError::Resolution
        );
        for market in 0..2 {
            let other = 1 - market;
            if row.claims[market] != 0 || row.lots[market] != 0 {
                require!(
                    row.claims[other] == 0 && row.lots[other] == 0,
                    ClearingError::Resolution
                );
            }
            let lots = row.lots[market];
            if lots == 0 || row.claims[market] == 0 {
                continue;
            }
            let history = crate::profit_attribution::frozen_history(margin, market)?;
            let capacity = history
                .frozen_capacity(
                    lots,
                    header.prices[market],
                    row.claims[market],
                    lots.unsigned_abs(),
                )
                .map_err(|_| ClearingError::Resolution)?;
            let priority = |id| MemberPriority {
                id,
                digest: member_priority(header.venue.as_ref(), header.epoch, id),
            };
            let [unit, weight, extra_lots, id] = plan.cutoffs[market];
            let pivot = Marginal {
                unit,
                capacity: weight,
                extra_lots,
                member: priority(id),
            };
            let charge = pivot
                .charge(capacity.eligible, priority(row.id), |amount| {
                    capacity.schedule(amount).ok().map(|terms| terms.matched)
                })
                .ok_or(ClearingError::Resolution)?;
            result[market] = capacity
                .schedule(charge)
                .map_err(|_| ClearingError::Resolution)?;
        }
        Ok(result)
    }

    pub fn advance(
        ctx: &mut Context<AdvanceBtcAllocation>,
        events: &mut crate::event_cpi::Payloads,
        epoch: u64,
        revision: u64,
        ordinal: u64,
        cutoffs: Option<[[u64; 4]; 2]>,
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
        if let Some(cutoffs) = cutoffs {
            return begin(header, &row, cutoffs);
        }
        require!(header.stage == SCORING, ClearingError::Resolution);
        let mut plan = Allocation::read(header)?;
        require!(ordinal == plan.cursor, ClearingError::Resolution);
        let terms = score(header, &plan, &row, &accounts.margin)?;
        let charges = terms.map(|leg| leg.charge);
        accounts.page.rows[(ordinal % 8) as usize].linked_charges = charges;
        plan.cursor += 1;
        let mut excess = false;
        let mut prices = [0; 2];
        for market in 0..2 {
            if charges[market] > plan.targets[market] - plan.recovered[market] {
                excess = true;
            } else {
                plan.recovered[market] += charges[market];
            }
            if terms[market].matched > 0 {
                prices[market] = if row.lots[market] > 0 {
                    header.prices[market].checked_sub(terms[market].base_ticks)
                } else {
                    header.prices[market].checked_add(terms[market].base_ticks)
                }
                .ok_or(ClearingError::Arithmetic)?;
            }
        }
        let complete = plan.cursor == header.count;
        let status = if excess || (complete && plan.recovered != plan.targets) {
            header.stage = single_pair::AWAIT_PAIR;
            header.state.membership.fill(0);
            2
        } else {
            plan.write(header)?;
            if complete {
                header.stage = DENOMINATOR;
                1
            } else {
                0
            }
        };
        events.emit(
            &crate::events::FrozenLinkedAllocationRow {
                venue: header.venue,
                slot: Clock::get()?.slot,
                epoch,
                attempt: plan.attempt,
                ordinal,
                debtor_id: plan.debtor,
                member_id: row.id,
                shares: plan.shares,
                targets: plan.targets,
                eligible: terms.map(|leg| leg.eligible),
                charges,
                matched_lots: terms.map(|leg| leg.matched),
                base_prices: prices,
                extra_tick_lots: terms.map(|leg| leg.extra_tick_lots),
                status,
            },
            accounts.event_authority.account().clone(),
        )
    }
}
#[cfg(feature = "linked-allocation-qualification")]
pub use candidate::{advance, charges, committed};
