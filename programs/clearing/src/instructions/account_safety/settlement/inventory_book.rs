//! Authenticate all active one-lot BTC positions against the completed valuation.
//! The remaining accounts are only the canonical frozen pages containing those lots.
use super::*;

#[cfg(not(feature = "book-inventory-qualification"))]
pub fn verify(
    _: &mut Context<VerifyInventoryBook>,
    _: &mut crate::event_cpi::Payloads,
    _: u64,
    _: u64,
    _: Vec<u64>,
) -> Result<()> {
    Err(ClearingError::Profile.into())
}

#[cfg(feature = "book-inventory-qualification")]
pub use qualified::*;

#[cfg(feature = "book-inventory-qualification")]
mod qualified {
    use super::*;
    use default_plan_selection::{inventory_book::propose, single_lot::MemberAmount};
    const MARKER: &[u8; 8] = b"RVBOOK01";
    #[cfg(feature = "multi-lot-book-qualification")]
    mod multi_lot {
        use super::*;
        include!("inventory_multi_lot.rs");
    }
    const PAGE_PREFIX: usize = 8 + 2 + 8 + 32 + 8 + 8 + 1;
    const SCALE: i128 = financial_core::SCALE;

    #[derive(AnchorSerialize, AnchorDeserialize)]
    pub struct Receipt {
        pub epoch: u64,
        pub total: u64,
        pub pair_count: u64,
        pub digest: [u8; 32],
    }
    impl Receipt {
        pub fn read(header: &PreparedSettlement) -> Result<Option<Self>> {
            let bytes = &header.state.membership;
            #[cfg(feature = "multi-lot-book-qualification")]
            let admitted = bytes.starts_with(MARKER) || bytes.starts_with(multi_lot::MARKER);
            #[cfg(not(feature = "multi-lot-book-qualification"))]
            let admitted = bytes.starts_with(MARKER);
            if !admitted {
                return Ok(None);
            }
            let value = crate::wire::read::<Self>(&bytes[8..64])?;
            require!(
                value.epoch == header.epoch && matches!(header.stage, DENOMINATOR | PROPOSAL),
                ClearingError::Resolution
            );
            Ok(Some(value))
        }
    }
    struct Position {
        ordinal: u64,
        id: u64,
        lots: i64,
        face: i128,
        cash: u64,
        capacity: u64,
        #[cfg(feature = "multi-lot-book-qualification")]
        rate: [u64; 2],
        charge: u64,
    }

    fn row_start(ordinal: u64) -> usize {
        PAGE_PREFIX + (ordinal % 8) as usize * FrozenMargin::INIT_SPACE
    }
    fn page_index(page: &AccountView, venue: &Address, epoch: u64) -> Result<u64> {
        let bytes = page.try_borrow()?;
        // Scoped history checks owner, discriminator, exact layout and writability.
        require!(
            bytes.len() == 8 + FrozenMarginPage::INIT_SPACE
                && bytes[..8] == *FrozenMarginPage::DISCRIMINATOR
                && bytes[18..50] == venue.as_ref()[..]
                && bytes[50..58] == epoch.to_le_bytes(),
            ClearingError::Resolution
        );
        let index = u64::from_le_bytes(bytes[58..66].try_into().unwrap());
        let expected = create_program_address(
            &[
                b"frozen-margin-page",
                venue.as_ref(),
                &index.to_le_bytes(),
                &[bytes[bytes.len() - 1]],
            ],
            &crate::ID,
        )
        .map_err(|_| ClearingError::Resolution)?;
        require_keys_eq!(expected, *page.address(), ClearingError::Resolution);
        Ok(index)
    }

    #[inline(never)]
    fn collect(
        header: &PreparedSettlement,
        pages: &[AccountView],
        ordinals: &[u64],
    ) -> Result<Vec<Position>> {
        require!(
            !ordinals.is_empty()
                && header.gross[1] == 0
                && (cfg!(feature = "multi-lot-book-qualification")
                    || header.gross[0] == ordinals.len() as u64)
                && header.pools == [0, 0]
                && ordinals.windows(2).all(|pair| pair[0] < pair[1])
                && *ordinals.last().unwrap() < header.count,
            ClearingError::Resolution
        );
        let mut positions = Vec::with_capacity(ordinals.len());
        let mut cursor = 0;
        for page in pages {
            let index = page_index(page, &header.venue, header.epoch)?;
            require!(
                ordinals.get(cursor).map(|ordinal| ordinal / 8) == Some(index),
                ClearingError::Resolution
            );
            let bytes = page.try_borrow()?;
            require!(
                u64::from(bytes[66]) == (header.count - index * 8).min(8),
                ClearingError::Resolution
            );
            while let Some(&ordinal) = ordinals.get(cursor).filter(|ordinal| *ordinal / 8 == index)
            {
                let start = row_start(ordinal);
                let row = crate::wire::read::<FrozenMargin>(
                    &bytes[start..start + FrozenMargin::INIT_SPACE],
                )?;
                require!(
                    (row.lots[0].unsigned_abs() == 1
                        || (cfg!(feature = "multi-lot-book-qualification")
                            && (row.lots[0] != 0 || row.claims[0] < 0)))
                        && row.lots[1] == 0
                        && row.claims[1] == 0
                        && row.claims[0] % SCALE == 0
                        && row.book_charge == 0,
                    ClearingError::Resolution
                );
                positions.push(Position {
                    ordinal,
                    id: row.id,
                    lots: row.lots[0],
                    face: row.claims[0] / SCALE,
                    cash: row.cash,
                    capacity: row.book_capacity,
                    #[cfg(feature = "multi-lot-book-qualification")]
                    rate: row.lot_rate,
                    charge: 0,
                });
                cursor += 1;
            }
        }
        require!(
            cursor == ordinals.len() && positions.windows(2).all(|pair| pair[0].id < pair[1].id),
            ClearingError::Resolution
        );
        let gross = positions
            .iter()
            .try_fold(0u64, |sum, row| sum.checked_add(row.lots.unsigned_abs()))
            .ok_or(ClearingError::Arithmetic)?;
        require!(gross == header.gross[0], ClearingError::Resolution);
        Ok(positions)
    }

    fn verify_totals(header: &PreparedSettlement, debt: u128) -> Result<()> {
        let scaled = debt
            .checked_mul(SCALE as u128)
            .ok_or(ClearingError::Arithmetic)?;
        let words = [scaled as u64, (scaled >> 64) as u64, 0];
        let totals =
            SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
                .and_then(|scan| scan.result())
                .map_err(|_| ClearingError::Resolution)?;
        require!(
            totals.negative[0].words() == words
                && totals.positive[0].words() == words
                && totals.negative[1].words() == [0; 3]
                && totals.positive[1].words() == [0; 3],
            ClearingError::Resolution
        );
        Ok(())
    }

    fn post_insurance(uncovered: u64, total: u128, insurance: u64) -> Result<u64> {
        if total <= u128::from(insurance) {
            return Ok(0);
        }
        let covered = (u128::from(uncovered) * u128::from(insurance)).div_ceil(total);
        uncovered
            .checked_sub(u64::try_from(covered).map_err(|_| ClearingError::Arithmetic)?)
            .ok_or(ClearingError::Arithmetic.into())
    }

    #[inline(never)]
    fn certify(
        header: &PreparedSettlement,
        positions: &mut [Position],
    ) -> Result<crate::events::InventoryBookVerified> {
        let side = positions
            .iter()
            .find(|position| position.face < 0)
            .ok_or(ClearingError::Resolution)?
            .lots;
        let mut debtors = Vec::new();
        let mut winners = Vec::new();
        let mut debt = 0u128;
        let mut losses = 0u128;
        for position in positions.iter() {
            let face = u64::try_from(position.face.unsigned_abs())
                .map_err(|_| ClearingError::Arithmetic)?;
            if position.face < 0 {
                require!(
                    position.lots == side && position.capacity == 0,
                    ClearingError::Resolution
                );
                let loss = face.saturating_sub(position.cash);
                debt = debt
                    .checked_add(u128::from(face))
                    .ok_or(ClearingError::Arithmetic)?;
                losses = losses
                    .checked_add(u128::from(loss))
                    .ok_or(ClearingError::Arithmetic)?;
                debtors.push(MemberAmount {
                    id: position.id,
                    atoms: loss,
                });
            } else {
                require!(
                    position.lots == -side && position.capacity <= face,
                    ClearingError::Resolution
                );
                winners.push(MemberAmount {
                    id: position.id,
                    atoms: position.capacity,
                });
            }
        }
        verify_totals(header, debt)?;
        for debtor in &mut debtors {
            debtor.atoms = post_insurance(debtor.atoms, losses, header.insurance[0])?;
        }
        let plan = propose(&header.venue.to_bytes(), header.epoch, &debtors, &winners)
            .ok_or(ClearingError::Resolution)?;
        let mut pairs = Vec::with_capacity(plan.len());
        let mut total = 0u64;
        for step in plan {
            let pair = step.pair;
            let price = if side > 0 {
                header.prices[0].checked_add(pair.charge)
            } else {
                header.prices[0].checked_sub(pair.charge)
            }
            .ok_or(ClearingError::Arithmetic)?;
            for id in [pair.debtor, pair.winner] {
                let index = positions
                    .binary_search_by_key(&id, |position| position.id)
                    .map_err(|_| ClearingError::Resolution)?;
                require!(positions[index].charge == 0, ClearingError::Resolution);
                positions[index].charge = pair.charge;
            }
            total = total
                .checked_add(pair.charge)
                .ok_or(ClearingError::Arithmetic)?;
            pairs.push([pair.debtor, pair.winner, pair.charge, price]);
        }
        let capacities = winners
            .iter()
            .map(|winner| [winner.id, winner.atoms])
            .collect();
        Ok(crate::events::InventoryBookVerified {
            venue: header.venue,
            epoch: header.epoch,
            slot: Clock::get()?.slot,
            total,
            capacities,
            pairs,
        })
    }

    pub fn verify(
        ctx: &mut Context<VerifyInventoryBook>,
        events: &mut crate::event_cpi::Payloads,
        epoch: u64,
        revision: u64,
        ordinals: Vec<u64>,
    ) -> Result<()> {
        // Only the complete joint selection may advance the integrated profile.
        require!(!cfg!(feature="integrated-recovery-qualification"), ClearingError::Profile);
        let mut pages = ctx.remaining_accounts()?;
        let accounts = &mut ctx.accounts;
        let header = &mut accounts.prepared;
        accounts.source.frozen().matches(header)?;
        require!(
            header.epoch == epoch
                && header.revision == revision
                && header.stage == single_pair::AWAIT_PAIR,
            ClearingError::Resolution
        );
        let mut positions = collect(header, &pages, &ordinals)?;
        #[cfg(feature = "multi-lot-book-qualification")]
        if positions
            .iter()
            .any(|position| position.lots.unsigned_abs() != 1)
        {
            let event = multi_lot::certify(header, &mut positions)?;
            let receipt = Receipt {
                epoch,
                total: event.total,
                pair_count: event.pairs.len() as u64,
                digest: multi_lot::digest(&event),
            };
            persist(header, &mut pages, &positions, multi_lot::MARKER, &receipt)?;
            return events.emit(&event, accounts.event_authority.account().clone());
        }
        let event = certify(header, &mut positions)?;
        let mut digest = solana_sha256_hasher::hashv(&[
            b"Rivalt/inventory-book/v1",
            &header.venue.to_bytes(),
            &epoch.to_le_bytes(),
            &event.total.to_le_bytes(),
        ])
        .to_bytes();
        for entry in &event.capacities {
            digest = solana_sha256_hasher::hashv(&[
                &digest,
                &entry[0].to_le_bytes(),
                &entry[1].to_le_bytes(),
            ])
            .to_bytes();
        }
        for entry in &event.pairs {
            digest = solana_sha256_hasher::hashv(&[
                &digest,
                &entry[0].to_le_bytes(),
                &entry[1].to_le_bytes(),
                &entry[2].to_le_bytes(),
                &entry[3].to_le_bytes(),
            ])
            .to_bytes();
        }
        let receipt = Receipt {
            epoch,
            total: event.total,
            pair_count: event.pairs.len() as u64,
            digest,
        };
        persist(header, &mut pages, &positions, MARKER, &receipt)?;
        events.emit(&event, accounts.event_authority.account().clone())
    }

    #[inline(never)]
    fn persist(
        header: &mut PreparedSettlement,
        pages: &mut [AccountView],
        positions: &[Position],
        marker: &[u8; 8],
        receipt: &Receipt,
    ) -> Result<()> {
        let mut rows = positions.iter().peekable();
        for page in pages.iter_mut() {
            let mut bytes = page.try_borrow_mut()?;
            let page_index = u64::from_le_bytes(bytes[58..66].try_into().unwrap());
            while let Some(position) = rows.next_if(|position| position.ordinal / 8 == page_index) {
                // book_charge is the final field of the pinned candidate row.
                let end = row_start(position.ordinal) + FrozenMargin::INIT_SPACE;
                bytes[end - 8..end].copy_from_slice(&position.charge.to_le_bytes());
            }
        }
        require!(rows.next().is_none(), ClearingError::Resolution);
        let bytes = &mut header.state.membership;
        bytes.fill(0);
        bytes[..8].copy_from_slice(marker);
        crate::wire::write(receipt, &mut bytes[8..64])?;
        header.stage = DENOMINATOR;
        Ok(())
    }
}
