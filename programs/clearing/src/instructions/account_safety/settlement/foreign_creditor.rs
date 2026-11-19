//! Atomic qualification for a BTC winner whose receipts also back an ETH debt.
use super::*;

#[cfg(not(feature = "foreign-creditor-qualification"))]
pub fn verify(
    _: &mut Context<VerifyForeignCreditors>,
    _: &mut crate::event_cpi::Payloads,
    _: u64,
    _: u64,
    _: [u64; 4],
    _: [u64; 2],
) -> Result<()> {
    Err(ClearingError::Profile.into())
}

#[cfg(feature = "foreign-creditor-qualification")]
pub use qualified::*;

#[cfg(feature = "foreign-creditor-qualification")]
mod qualified {
    use super::super::linked_pair::Leg;
    use super::*;
    use default_plan_selection::foreign_creditor::ForeignCreditorBook;

    const MARKER: &[u8; 8] = b"RVCHAIN1";
    const END: usize = 8 + 8 + 4 * 8 + 2 * 48;

    #[derive(AnchorSerialize, AnchorDeserialize)]
    pub struct Receipt {
        epoch: u64,
        members: [u64; 4],
        pub legs: [Leg; 2],
    }
    impl Receipt {
        pub fn read(header: &PreparedSettlement) -> Result<Option<Self>> {
            let bytes = &header.state.membership;
            if !bytes.starts_with(MARKER) {
                return Ok(None);
            }
            let receipt =
                crate::wire::read::<Self>(&bytes[8..END]).map_err(|_| ClearingError::Resolution)?;
            require!(
                receipt.epoch == header.epoch && matches!(header.stage, DENOMINATOR | PROPOSAL),
                ClearingError::Resolution
            );
            Ok(Some(receipt))
        }
        pub fn claims(&self, row: &FrozenMargin) -> Result<[i128; 2]> {
            let debtors = [self.members[0], self.members[2]];
            let mut claims = row.claims;
            for (market, leg) in self.legs.iter().enumerate() {
                let delta = if row.id == debtors[market] {
                    i128::from(leg.charge)
                } else if row.id == leg.winner {
                    -i128::from(leg.charge)
                } else {
                    0
                };
                claims[market] = claims[market]
                    .checked_add(delta * financial_core::SCALE)
                    .ok_or(ClearingError::Arithmetic)?;
            }
            Ok(claims)
        }
    }

    fn positive_atoms(scaled: i128) -> Result<u64> {
        require!(
            scaled > 0 && scaled % financial_core::SCALE == 0,
            ClearingError::Resolution
        );
        u64::try_from(scaled / financial_core::SCALE).map_err(|_| ClearingError::Resolution.into())
    }

    #[inline(never)]
    fn book(header: &PreparedSettlement, rows: &[FrozenMargin; 4]) -> Result<ForeignCreditorBook> {
        let [debtor, flat, cross, eth] = rows;
        require!(
            header.pools == [0; 2]
                && debtor.lots[1] == 0
                && flat.lots == [0; 2]
                && eth.lots[0] == 0
                && debtor.claims[1] == 0
                && flat.claims[1] == 0
                && eth.claims[0] == 0,
            ClearingError::Resolution
        );
        let debts = [debtor.claims[0], cross.claims[1]];
        let creditors = [cross.lots[0], eth.lots[1]];
        let opposing = [debtor.lots[0], cross.lots[1]];
        let totals =
            SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
                .and_then(|scan| scan.result())
                .map_err(|_| ClearingError::Resolution)?;
        for market in 0..2 {
            let magnitude = debts[market].unsigned_abs();
            let words = [magnitude as u64, (magnitude >> 64) as u64, 0];
            require!(
                debts[market] < 0
                    && totals.negative[market].words() == words
                    && totals.positive[market].words() == words
                    && creditors[market] != 0
                    && creditors[market].checked_neg() == Some(opposing[market])
                    && creditors[market].unsigned_abs().checked_mul(2)
                        == Some(header.gross[market]),
                ClearingError::Resolution
            );
        }
        require!(
            cross.claims[1].checked_neg() == Some(eth.claims[1]),
            ClearingError::Resolution
        );
        Ok(ForeignCreditorBook {
            btc_debt: positive_atoms(
                debtor.claims[0]
                    .checked_neg()
                    .ok_or(ClearingError::Arithmetic)?,
            )?,
            eth_debt: positive_atoms(eth.claims[1])?,
            flat_btc: positive_atoms(flat.claims[0])?,
            cross_btc: positive_atoms(cross.claims[0])?,
            debtor_cash: debtor.cash,
            cross_cash: cross.cash,
            insurance: header.insurance,
        })
    }

    #[inline(never)]
    fn terms(
        root: &BorshAccount<MarginAccount>,
        row: &FrozenMargin,
        market: usize,
        mark: u64,
        charge: u64,
    ) -> Result<Leg> {
        let lots = row.lots[market];
        let schedule = crate::profit_attribution::frozen_history(root, market)?
            .frozen_capacity(lots, mark, row.claims[market], lots.unsigned_abs())
            .and_then(|capacity| capacity.schedule(charge))
            .map_err(|_| ClearingError::Resolution)?;
        let price = if lots > 0 {
            mark.checked_sub(schedule.base_ticks)
        } else {
            mark.checked_add(schedule.base_ticks)
        }
        .ok_or(ClearingError::Arithmetic)?;
        Ok(Leg {
            winner: row.id,
            charge,
            eligible: schedule.eligible,
            matched: schedule.matched,
            price,
            extra: schedule.extra_tick_lots,
        })
    }

    pub fn verify(
        ctx: &mut Context<VerifyForeignCreditors>,
        events: &mut crate::event_cpi::Payloads,
        epoch: u64,
        revision: u64,
        ordinals: [u64; 4],
        charges: [u64; 2],
    ) -> Result<()> {
        require!(
            ctx.remaining_accounts()?.is_empty(),
            ClearingError::Resolution
        );
        let accounts = &mut ctx.accounts;
        let header = &mut accounts.prepared;
        accounts.source.frozen().matches(header)?;
        require!(
            header.epoch == epoch
                && header.revision == revision
                && header.stage == single_pair::AWAIT_PAIR,
            ClearingError::Resolution
        );
        let pages = [
            Some(&*accounts.first_page),
            accounts.second_page.as_deref(),
            accounts.third_page.as_deref(),
            accounts.fourth_page.as_deref(),
        ];
        let mut indices = ordinals.map(|ordinal| ordinal / 8);
        indices.sort_unstable();
        let mut previous = None;
        let mut supplied = pages.iter().flatten();
        for index in indices {
            if previous != Some(index) {
                require!(
                    supplied.next().map(|page| page.page_index) == Some(index),
                    ClearingError::Resolution
                );
                previous = Some(index);
            }
        }
        require!(supplied.next().is_none(), ClearingError::Resolution);
        let row = |ordinal| {
            let page = pages
                .iter()
                .flatten()
                .find(|page| page.page_index == ordinal / 8)
                .ok_or(ClearingError::Resolution)?;
            plan::frozen_row(header, page, ordinal)
        };
        let rows = [
            row(ordinals[0])?,
            row(ordinals[1])?,
            row(ordinals[2])?,
            row(ordinals[3])?,
        ];
        require!(
            rows[2].member == *accounts.cross_winner.address()
                && rows[3].member == *accounts.eth_winner.address(),
            ClearingError::Resolution
        );
        plan::original_margin(header, &rows[2], &accounts.cross_winner)?;
        plan::original_margin(header, &rows[3], &accounts.eth_winner)?;
        require!(
            book(header, &rows)?.protected_charges() == Some(charges),
            ClearingError::Resolution
        );
        let legs = [
            terms(
                &accounts.cross_winner,
                &rows[2],
                0,
                header.prices[0],
                charges[0],
            )?,
            terms(
                &accounts.eth_winner,
                &rows[3],
                1,
                header.prices[1],
                charges[1],
            )?,
        ];
        let members = rows.each_ref().map(|row| row.id);
        let receipt = Receipt {
            epoch,
            members,
            legs,
        };
        let bytes = &mut header.state.membership;
        bytes.fill(0);
        bytes[..8].copy_from_slice(MARKER);
        crate::wire::write(&receipt, &mut bytes[8..END]).map_err(|_| ClearingError::Resolution)?;
        header.stage = DENOMINATOR;
        events.emit(
            &crate::events::ForeignCreditorsVerified {
                venue: header.venue,
                epoch,
                slot: Clock::get()?.slot,
                members,
                charges,
                eligible: legs.map(|leg| leg.eligible),
                matched_lots: legs.map(|leg| leg.matched),
                base_prices: legs.map(|leg| leg.price),
                extra_tick_lots: legs.map(|leg| leg.extra),
            },
            accounts.event_authority.account().clone(),
        )
    }
}
