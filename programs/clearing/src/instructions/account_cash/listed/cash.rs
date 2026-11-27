//! A funded cash movement never opens a slot. Its donor must cover all current
//! obligations and the adverse funding endpoint on every occupied market.
use super::*;
use clearing_accounting::market_slots::storage::HEADER_BYTES;
use financial_core::{cash_add, cash_sub};

impl ListedMargin {
    pub(crate) fn load_cash(
        root: &mut BorshAccount<MarginAccount>,
        base: &Snapshot,
        donor: bool,
    ) -> Result<Self> {
        require!(root.lifecycle == MEMBER_FINANCIAL, ClearingError::Profile);
        let bytes = Self::read_directory(root)?;
        let directory = if bytes.is_empty() {
            MarketSlots::new(Mode::CashOnly, 0)
        } else {
            let mode = if root.mode == MODE_CROSS {
                Mode::Cross
            } else {
                // Cash cannot select a new maker market. The only existing
                // slot was created through its authenticated maker registration.
                require!(
                    root.mode == MODE_ISOLATED
                        && root.isolated_market_index == LISTED_CAPITAL_TAG
                        && root.role == ROLE_MAKER,
                    ClearingError::Profile
                );
                let id =
                    u16::from_le_bytes(bytes[HEADER_BYTES..HEADER_BYTES + 2].try_into().unwrap());
                if id == 0 {
                    Mode::CashOnly
                } else {
                    Mode::Isolated(usize::from(id))
                }
            };
            checked(MarketSlots::from_listed_bytes(&bytes, mode, &[]))?
        };
        Ok(Self {
            root: base.refresh(root, donor)?,
            directory,
        })
    }

    pub(crate) fn needs_source(&self, market: u16) -> bool {
        self.directory
            .records()
            .iter()
            .any(|(_, image)| image.market == market && image.position.lots != 0)
    }

    pub(crate) fn change_cash(
        &mut self,
        base: &Snapshot,
        sources: &[MarketWindow],
        amount: u64,
        donor: bool,
    ) -> Result<()> {
        require!(amount > 0, ClearingError::Amount);
        let mut model = trading::model(&self.root)?;
        model.cash = checked(if donor {
            cash_sub(model.cash, amount)
        } else {
            cash_add(model.cash, amount)
        })?;
        let (mut slots, mut windows) = base.base_risk_inputs(&model)?;
        let mut images = Vec::with_capacity(self.directory.records().len());
        for (_, stored) in self.directory.records() {
            let mut image = *stored;
            if image.position.lots != 0 {
                let index = sources
                    .binary_search_by_key(&image.market, |source| source.market)
                    .map_err(|_| ClearingError::OracleSource)?;
                let window = sources[index];
                image.position = position_of(checked(
                    participant_of(&self.root, image.position).accrued(window.current.funding),
                )?);
                windows.push(window);
            }
            slots.push(OccupiedSlot {
                market: image.market,
                position: image.position,
            });
            images.push(image);
        }
        if donor {
            check_available_cash(&model, &slots, &windows)?;
        }
        let directory = checked(self.directory.successor(&images, &[]))?;
        super::super::advance(&mut self.root)?;
        self.root.cash = model.cash;
        self.directory = directory;
        Ok(())
    }
}

use crate::events::{ListedCashAccrued, ListedCashCheckpoint, ListedCashPositions};
use anchor_lang::AccountDeserialize;

pub(crate) struct CashSources {
    pub windows: Vec<MarketWindow>,
    checkpoints: Vec<ListedCashCheckpoint>,
}

impl CashSources {
    pub(crate) fn read(
        venue: &BorshAccount<Venue>,
        views: &mut [AccountView],
        donor: &ListedMargin,
        recipient: Option<&ListedMargin>,
        clock: &Clock,
    ) -> Result<Self> {
        let mut ids: Vec<u16> = donor
            .directory
            .records()
            .iter()
            .chain(
                recipient
                    .into_iter()
                    .flat_map(|margin| margin.directory.records()),
            )
            .filter(|(_, image)| image.position.lots != 0)
            .map(|(key, _)| key.market)
            .collect();
        ids.sort_unstable();
        ids.dedup();
        require!(views.len() == ids.len() * 2, ClearingError::OracleSource);
        let mut result = Self {
            windows: Vec::with_capacity(ids.len()),
            checkpoints: Vec::with_capacity(ids.len()),
        };
        for (id, pair) in ids.into_iter().zip(views.chunks_exact_mut(2)) {
            let (window, checkpoint) = load_window(venue, id, pair, donor.needs_source(id), clock)?;
            result.windows.push(window);
            result.checkpoints.push(checkpoint);
        }
        Ok(result)
    }

    pub(crate) fn emit(
        self,
        venue: Address,
        slot: u64,
        roots: &[(&BorshAccount<MarginAccount>, &ListedMargin)],
        events: &mut crate::event_cpi::Payloads,
        authority: AccountView,
    ) -> Result<()> {
        let mut positions = Vec::new();
        for &(account, margin) in roots {
            if !margin.directory.records().is_empty() {
                positions.push(ListedCashPositions {
                    margin: *account.address(),
                    positions: margin.packed_positions(account.account().data_len())?,
                });
            }
        }
        events.emit(
            &ListedCashAccrued {
                venue,
                slot,
                roots: positions,
                checkpoints: self.checkpoints,
            },
            authority,
        )
    }
}

#[inline(never)]
fn load_window(
    venue: &BorshAccount<Venue>,
    id: u16,
    pair: &mut [AccountView],
    donor_open: bool,
    clock: &Clock,
) -> Result<(MarketWindow, ListedCashCheckpoint)> {
    let listing = MarketListing::try_deserialize(&mut &pair[0].try_borrow()?[..])?;
    let mut funding = ListedFunding::try_deserialize(&mut &pair[1].try_borrow()?[..])?;
    let key = *pair[0].address();
    let funding_key = *pair[1].address();
    require!(
        listing.schema_version == LISTING_SCHEMA
            && listing.status == LISTING_QUALIFICATION
            && listing.market_id == id
            && listing.venue == *venue.address()
            && listing.quote_mint == venue.quote_mint
            && funding.schema_version == LISTING_SCHEMA
            && funding.listing == key,
        ClearingError::OracleSource
    );
    let listing_pda = create_program_address(
        &[
            b"market-listing",
            venue.address().as_ref(),
            &id.to_le_bytes(),
            &[listing.bump],
        ],
        &crate::ID,
    )
    .map_err(|_| ClearingError::OracleSource)?;
    let funding_pda = create_program_address(
        &[b"listed-funding", key.as_ref(), &[funding.bump]],
        &crate::ID,
    )
    .map_err(|_| ClearingError::OracleSource)?;
    require!(
        key == listing_pda && funding_key == funding_pda,
        ClearingError::OracleSource
    );
    let mut market = funding.values.market(&listing);
    if donor_open {
        crate::engine::oracle::action(&market, clock, false)?;
    }
    crate::engine::oracle::materialize(2, &mut market, clock)?;
    let [funding_low, funding_high] = crate::engine::oracle::funding_bounds(2, &market, clock)?;
    let index = market.funding_index_scaled;
    funding.values.funding_index_scaled = index;
    funding.values.funding_time = market.funding_time;
    crate::wire::write_account(&funding, &mut pair[1].try_borrow_mut()?[..])?;
    Ok((
        MarketWindow {
            market: id,
            current: financial_core::margin::Risk {
                lower: market.lower,
                upper: market.upper,
                funding: index,
            },
            funding_low,
            funding_high,
        },
        ListedCashCheckpoint {
            market: id,
            funding: funding_key,
            funding_index_scaled: index,
            funding_time: market.funding_time,
        },
    ))
}

#[inline(never)]
pub(crate) fn apply(
    identity: &super::super::AccountFinancialIdentity,
    donor: &mut BorshAccount<MarginAccount>,
    recipient: Option<&mut BorshAccount<MarginAccount>>,
    sources: &mut [AccountView],
    amount: u64,
    events: &mut crate::event_cpi::Payloads,
    authority: AccountView,
) -> Result<Clock> {
    crate::instructions::maker_liquidity::routes::listed_venue::identity(
        &identity.venue,
        &identity.safety,
    )?;
    let base = Snapshot::optional(identity.markets(), &Clock::get()?)?;
    let mut debit = ListedMargin::load_cash(donor, &base, true)?;
    let mut recipient = recipient;
    let credit = recipient
        .as_deref_mut()
        .map(|root| ListedMargin::load_cash(root, &base, false))
        .transpose()?;
    let funding = CashSources::read(
        &identity.venue,
        sources,
        &debit,
        credit.as_ref(),
        &base.clock,
    )?;
    debit.change_cash(&base, &funding.windows, amount, true)?;
    let venue = *identity.venue.address();
    if let (Some(recipient), Some(mut credit)) = (recipient, credit) {
        credit.change_cash(&base, &funding.windows, amount, false)?;
        debit.commit(donor)?;
        credit.commit(recipient)?;
        funding.emit(
            venue,
            base.clock.slot,
            &[(donor, &debit), (recipient, &credit)],
            events,
            authority,
        )?;
    } else {
        debit.commit(donor)?;
        funding.emit(
            venue,
            base.clock.slot,
            &[(donor, &debit)],
            events,
            authority,
        )?;
    }
    Ok(base.clock)
}
