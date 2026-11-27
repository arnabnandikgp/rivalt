//! Candidate accounting for a quote against a listed market on a funded margin root.
//! The caller authenticates the listing, its funding account and the maker's permanent
//! registration, then commits all sides of the route together after admission.
use super::{check_available_cash, checked, trading, Snapshot};
use crate::state::accounts::*;
use crate::ClearingError;
use anchor_lang::prelude::*;
use clearing_accounting::{
    market_slots::{storage::FIRST_LISTED_MARKET, MarketImage, MarketSlots},
    Mode, Position,
};
use financial_core::{
    withdrawal::{MarketWindow, OccupiedSlot},
    Participant,
};

#[derive(Clone)]
pub(crate) struct ListedMargin {
    pub root: Box<MarginAccount>,
    pub directory: MarketSlots,
}

fn position_of(participant: Participant) -> Position {
    Position {
        lots: participant.lots,
        virtual_scaled: participant.virtual_scaled,
        funding_checkpoint: participant.funding_checkpoint,
        generation: participant.generation,
    }
}

fn participant_of(root: &MarginAccount, position: Position) -> Participant {
    Participant {
        id: root.id,
        cash: root.cash,
        reserved: root.reserved,
        lots: position.lots,
        virtual_scaled: position.virtual_scaled,
        funding_checkpoint: position.funding_checkpoint,
        generation: position.generation,
    }
}

impl ListedMargin {
    /// Load the independent directory without re-decoding or committing the borrowed
    /// Borsh prefix. Only the recorded extent for this specific root mode is valid.
    pub(crate) fn load(
        root: &mut BorshAccount<MarginAccount>,
        maker_market: Option<u16>,
        base: &Snapshot,
        increase: bool,
    ) -> Result<Self> {
        let view = root.account().clone();
        root.release_borrow()?;
        let result = {
            let bytes = view.try_borrow()?;
            let tail = bytes
                .get(MARGIN_ALLOCATION..)
                .ok_or(ClearingError::Profile)?;
            Self::prepare(root, tail, maker_market, base, increase)
        };
        root.reacquire_guard_only()?;
        result
    }

    /// The Borsh writer owns the fixed prefix. Writing only the directory above
    /// the attribution records preserves both inline markets' entry costs.
    pub(crate) fn commit(&self, root: &mut BorshAccount<MarginAccount>) -> Result<()> {
        trading::commit_root(root, &self.root)?;
        let mut view = root.account().clone();
        root.release_borrow()?;
        let result = {
            let mut bytes = view.try_borrow_mut()?;
            let tail = bytes
                .get_mut(MARGIN_ALLOCATION..)
                .ok_or(ClearingError::Profile)?;
            checked(self.directory.write_listed_bytes(tail))
        };
        root.reacquire_guard_only()?;
        result
    }

    /// An isolated maker's permanent registration supplies its full market ID.
    /// The one-byte marker in the base margin account cannot identify a listing.
    pub(crate) fn prepare(
        root: &MarginAccount,
        directory_bytes: &[u8],
        maker_market: Option<u16>,
        base: &Snapshot,
        increase: bool,
    ) -> Result<Self> {
        let mode = match (root.mode, root.role, maker_market) {
            (MODE_CROSS, ROLE_TRADER, None) => Mode::Cross,
            (MODE_ISOLATED, ROLE_MAKER, Some(id))
                if root.isolated_market_index == LISTED_CAPITAL_TAG
                    && id >= FIRST_LISTED_MARKET =>
            {
                Mode::Isolated(usize::from(id))
            }
            _ => return Err(ClearingError::MakerCapital.into()),
        };
        require!(
            directory_bytes.len()
                == initial_margin_size(root.mode, root.isolated_market_index) - MARGIN_ALLOCATION,
            ClearingError::Profile
        );
        // The ordinary order book stores BTC/ETH orders only. Its live orders and
        // reservations are refreshed before admission. Listed fills here are immediate.
        let directory = checked(MarketSlots::from_listed_bytes(directory_bytes, mode, &[]))?;
        let root = base.refresh(root, false)?;
        for (index, position) in root.positions.iter().enumerate() {
            if position.lots != 0
                || root.book.orders.iter().any(|stored| {
                    stored.order.active() && usize::from(stored.market_index) == index
                })
            {
                crate::engine::oracle::action(base.market(index)?, &base.clock, increase)?;
            }
        }
        Ok(Self { root, directory })
    }

    pub(crate) fn participant(&self, market: u16) -> Result<Participant> {
        require!(market >= FIRST_LISTED_MARKET, ClearingError::Profile);
        let records = self.directory.records();
        let position = records
            .binary_search_by_key(&market, |(binding, _)| binding.market)
            .map(|index| records[index].1.position)
            .unwrap_or_default();
        Ok(participant_of(&self.root, position))
    }

    /// Apply one side returned by financial_core::route::candidate. That routine
    /// charges the aggregate taker fee once. Every side still needs full admission.
    /// Sources cover the touched market and each other open listed position, even
    /// when a fill closes the target. Flat debts remain chargeable without a price.
    pub(crate) fn admit_fill(
        &mut self,
        base: &Snapshot,
        market: u16,
        filled: Participant,
        gross: u64,
        sources: &[MarketWindow],
    ) -> Result<()> {
        require!(
            market >= FIRST_LISTED_MARKET
                && filled.id == self.root.id
                && filled.reserved == self.root.reserved
                && filled.cash <= self.root.cash,
            ClearingError::Profile
        );
        let mut images: Vec<_> = self
            .directory
            .records()
            .iter()
            .map(|(_, image)| *image)
            .collect();
        let offset = match images.binary_search_by_key(&market, |image| image.market) {
            Ok(index) => index,
            Err(index) => {
                images.insert(
                    index,
                    MarketImage {
                        market,
                        position: Position::default(),
                        entry: Default::default(),
                    },
                );
                index
            }
        };
        let mut model = trading::model(&self.root)?;
        model.cash = filled.cash;
        let (mut slots, mut windows) = base.base_risk_inputs(&model)?;
        let mut source_iter = sources.iter();
        for (index, image) in images.iter_mut().enumerate() {
            if index == offset || image.position.lots != 0 {
                let window = source_iter.next().ok_or(ClearingError::OracleSource)?;
                require!(window.market == image.market, ClearingError::OracleSource);
                if index == offset {
                    require!(
                        filled.funding_checkpoint == window.current.funding,
                        ClearingError::OraclePolicy
                    );
                    image.entry =
                        checked(image.entry.fill(image.position.lots, filled.lots, gross))?;
                    image.position = position_of(filled);
                } else {
                    image.position = position_of(checked(
                        participant_of(&self.root, image.position).accrued(window.current.funding),
                    )?);
                }
                if image.position.lots != 0 {
                    windows.push(MarketWindow {
                        market: window.market,
                        current: window.current,
                        funding_low: window.funding_low,
                        funding_high: window.funding_high,
                    });
                }
            }
            slots.push(OccupiedSlot {
                market: image.market,
                position: image.position,
            });
        }
        require!(source_iter.next().is_none(), ClearingError::OracleSource);
        check_available_cash(&model, &slots, &windows)?;
        let next = checked(self.directory.successor(&images, &[]))?;
        self.directory = next;
        self.root.cash = model.cash;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
