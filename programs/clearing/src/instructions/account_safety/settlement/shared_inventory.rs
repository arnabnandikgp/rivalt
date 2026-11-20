//! Complete one-market recovery with two one-lot debtors and two one-lot winners.
use super::*;

#[cfg(not(feature = "shared-inventory-qualification"))]
pub fn verify(
    _: &mut Context<VerifySharedInventory>,
    _: &mut crate::event_cpi::Payloads,
    _: u64,
    _: u64,
    _: [u64; 4],
    _: [u64; 2],
) -> Result<()> {
    Err(ClearingError::Profile.into())
}

#[cfg(feature = "shared-inventory-qualification")]
pub use qualified::*;

#[cfg(feature = "shared-inventory-qualification")]
mod qualified {
    use super::*;
    use default_plan_selection::single_lot::MemberAmount;

    #[cfg(not(feature = "partial-inventory-qualification"))]
    const MARKER: &[u8; 8] = b"RVLOTS01";
    #[cfg(feature = "partial-inventory-qualification")]
    const MARKER: &[u8; 8] = b"RVLOTS02";
    const END: usize = 96;

    #[derive(AnchorSerialize, AnchorDeserialize)]
    pub struct Receipt {
        epoch: u64,
        members: [u64; 4],
        charges: [u64; 2],
        eligible: [u64; 2],
        prices: [u64; 2],
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
                header.epoch == receipt.epoch && matches!(header.stage, DENOMINATOR | PROPOSAL),
                ClearingError::Resolution
            );
            Ok(Some(receipt))
        }

        pub fn total_charge(&self) -> Result<u64> {
            self.charges[0]
                .checked_add(self.charges[1])
                .ok_or(ClearingError::Arithmetic.into())
        }

        pub fn claims(&self, member: &FrozenMargin) -> Result<[i128; 2]> {
            let mut claims = member.claims;
            for index in 0..2 {
                let charge = i128::from(self.charges[index]) * financial_core::SCALE;
                if member.id == self.members[index] {
                    claims[0] = claims[0]
                        .checked_add(charge)
                        .ok_or(ClearingError::Arithmetic)?;
                } else if member.id == self.members[index + 2] {
                    claims[0] = claims[0]
                        .checked_sub(charge)
                        .ok_or(ClearingError::Arithmetic)?;
                }
            }
            Ok(claims)
        }
    }

    #[inline(never)]
    fn debtor_budgets(header: &PreparedSettlement, rows: &[FrozenMargin; 4]) -> Result<[u64; 2]> {
        require!(
            header.pools == [0, 0]
                && header.gross == [4, 0]
                && rows[0].id < rows[1].id
                && rows[2].id != rows[3].id,
            ClearingError::Resolution
        );
        let side = rows[0].lots[0];
        require!(side.unsigned_abs() == 1, ClearingError::Resolution);
        let mut faces = [0u64; 4];
        for (index, row) in rows.iter().enumerate() {
            let debtor = index < 2;
            require!(
                row.lots == [if debtor { side } else { -side }, 0]
                    && row.claims[1] == 0
                    && if debtor {
                        row.claims[0] < 0
                    } else if cfg!(feature = "partial-inventory-qualification") {
                        row.claims[0] >= 0
                    } else {
                        row.claims[0] > 0
                    }
                    && row.claims[0] % financial_core::SCALE == 0,
                ClearingError::Resolution
            );
            faces[index] =
                u64::try_from(row.claims[0].unsigned_abs() / financial_core::SCALE as u128)
                    .map_err(|_| ClearingError::Arithmetic)?;
        }
        let face = u128::from(faces[0]) + u128::from(faces[1]);
        // The complete snapshot below excludes any additional debtor or open lot.
        // A flat creditor can retain the remainder of the positive BTC face.
        let open_credit = u128::from(faces[2]) + u128::from(faces[3]);
        require!(
            if cfg!(feature = "partial-inventory-qualification") {
                open_credit <= face
            } else {
                open_credit == face
            },
            ClearingError::Resolution
        );
        let scaled = face * financial_core::SCALE as u128;
        let words = [scaled as u64, (scaled >> 64) as u64, 0];
        let totals =
            SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
                .and_then(|scan| scan.result())
                .map_err(|_| ClearingError::Resolution)?;
        require!(
            totals.positive[0].words() == words
                && totals.negative[0].words() == words
                && totals.positive[1].words() == [0; 3]
                && totals.negative[1].words() == [0; 3],
            ClearingError::Resolution
        );
        let uncovered = [
            faces[0].checked_sub(rows[0].cash),
            faces[1].checked_sub(rows[1].cash),
        ];
        let uncovered = [
            uncovered[0].ok_or(ClearingError::Resolution)?,
            uncovered[1].ok_or(ClearingError::Resolution)?,
        ];
        // A u64 total also bounds the products below by u128::MAX.
        let total = uncovered[0]
            .checked_add(uncovered[1])
            .ok_or(ClearingError::Arithmetic)?;
        require!(total > header.insurance[0], ClearingError::Resolution);
        let residual = total - header.insurance[0];
        Ok(uncovered
            .map(|loss| ((u128::from(loss) * u128::from(residual)) / u128::from(total)) as u64))
    }

    #[inline(never)]
    fn certify(
        header: &PreparedSettlement,
        rows: &[FrozenMargin; 4],
        roots: [&BorshAccount<MarginAccount>; 2],
        charges: [u64; 2],
    ) -> Result<Receipt> {
        let budgets = debtor_budgets(header, rows)?;
        #[cfg(not(feature = "partial-inventory-qualification"))]
        require!(charges == budgets, ClearingError::Resolution);
        let members = rows.each_ref().map(|row| row.id);
        let mut eligible = [0; 2];
        let mut prices = [0; 2];
        for (index, root) in roots.into_iter().enumerate() {
            let row = &rows[index + 2];
            require!(row.member == *root.address(), ClearingError::Resolution);
            plan::original_margin(header, row, root)?;
            let capacity = crate::profit_attribution::frozen_history(root, 0)?
                .frozen_capacity(row.lots[0], header.prices[0], row.claims[0], 1)
                .map_err(|_| ClearingError::Resolution)?;
            let terms = capacity
                .schedule(charges[index])
                .map_err(|_| ClearingError::Resolution)?;
            require!(
                terms.matched
                    == if cfg!(feature = "partial-inventory-qualification") {
                        u64::from(charges[index] != 0)
                    } else {
                        1
                    }
                    && terms.extra_tick_lots == 0,
                ClearingError::Resolution
            );
            eligible[index] = terms.eligible;
            if terms.matched == 0 {
                continue;
            }
            prices[index] = if row.lots[0] > 0 {
                header.prices[0].checked_sub(terms.base_ticks)
            } else {
                header.prices[0].checked_add(terms.base_ticks)
            }
            .ok_or(ClearingError::Arithmetic)?;
        }
        let debtors = core::array::from_fn::<_, 2, _>(|index| MemberAmount {
            id: members[index],
            atoms: budgets[index],
        });
        let mut winners = core::array::from_fn::<_, 2, _>(|index| MemberAmount {
            id: members[index + 2],
            atoms: eligible[index],
        });
        winners.sort_unstable_by_key(|entry| entry.id);
        #[cfg(feature = "partial-inventory-qualification")]
        {
            let plan = default_plan_selection::two_debtors::assign(
                &header.venue.to_bytes(),
                header.epoch,
                debtors,
                winners,
            )
            .ok_or(ClearingError::Resolution)?;
            require!(
                charges == plan.charges
                    && members[2] == winners[plan.winners[0]].id
                    && members[3] == winners[plan.winners[1]].id,
                ClearingError::Resolution
            );
        }
        #[cfg(not(feature = "partial-inventory-qualification"))]
        {
            let assignment = default_plan_selection::single_lot::assign(
                &header.venue.to_bytes(),
                header.epoch,
                &debtors,
                &winners,
            )
            .ok_or(ClearingError::Resolution)?;
            for pair in assignment {
                let index = usize::from(pair.debtor != members[0]);
                require!(
                    members[index] == pair.debtor
                        && members[index + 2] == pair.winner
                        && charges[index] == pair.charge,
                    ClearingError::Resolution
                );
            }
        }
        Ok(Receipt {
            epoch: header.epoch,
            members,
            charges,
            eligible,
            prices,
        })
    }

    pub fn verify(
        ctx: &mut Context<VerifySharedInventory>,
        events: &mut crate::event_cpi::Payloads,
        epoch: u64,
        revision: u64,
        ordinals: [u64; 4],
        charges: [u64; 2],
    ) -> Result<()> {
        require!(!cfg!(feature="book-inventory-qualification"),ClearingError::Profile);
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
        let rows = foreign_creditor::four_rows(
            header,
            [
                Some(&*accounts.first_page),
                accounts.second_page.as_deref(),
                accounts.third_page.as_deref(),
                accounts.fourth_page.as_deref(),
            ],
            ordinals,
        )?;
        let receipt = certify(
            header,
            &rows,
            [&accounts.first_winner, &accounts.second_winner],
            charges,
        )?;
        let bytes = &mut header.state.membership;
        bytes.fill(0);
        bytes[..8].copy_from_slice(MARKER);
        crate::wire::write(&receipt, &mut bytes[8..END]).map_err(|_| ClearingError::Resolution)?;
        header.stage = DENOMINATOR;
        events.emit(
            &crate::events::SharedInventoryVerified {
                venue: header.venue,
                epoch,
                slot: Clock::get()?.slot,
                members: receipt.members,
                charges,
                eligible: receipt.eligible,
                prices: receipt.prices,
            },
            accounts.event_authority.account().clone(),
        )
    }
}
