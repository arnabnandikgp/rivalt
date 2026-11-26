//! Sparse positions use the same stored records and occupancy counter as the custody fixture.
use super::*;
use crate::slot_custody::{checked, CashSlot};
use clearing_accounting::{
    entry_cost::EntryCost,
    market_slots::{MarketImage, MarketSlots},
    Mode, Position,
};
use financial_core::{Participant, SCALE};
use risk_engine::{
    orders,
    withdrawal::{cash_required, CashRequired, MarketWindow, OccupiedSlot},
    Risk,
};

pub const CROSS: u16 = u16::MAX;
const CROSS_CAPACITY: usize = 8;

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Default, Copy, Clone)]
pub struct OrderTerms {
    pub market: u16,
    pub side: u8,
    pub lots: u64,
    pub limit: u64,
    pub fee_budget: u64,
    pub expires: u64,
    pub reduce_only: bool,
}
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Default, Copy, Clone)]
pub struct RestingOrder {
    pub terms: OrderTerms,
    pub remaining: u64,
    pub gross: u64,
    pub fee_left: u64,
    pub generation: u64,
}

impl RestingOrder {
    fn markets(&self) -> &[u16] {
        if self.remaining == 0 {
            &[]
        } else {
            core::slice::from_ref(&self.terms.market)
        }
    }

    pub fn eligible(&self, position: Position) -> u64 {
        if !self.terms.reduce_only {
            return self.remaining;
        }
        if position.lots == 0
            || self.generation != position.generation
            || (self.terms.side == 1) != (position.lots > 0)
        {
            return 0;
        }
        self.remaining.min(position.lots.unsigned_abs())
    }
}

#[account(borsh)]
pub struct TradingMargin {
    pub owner: Address,
    pub custody: Address,
    pub isolated: u16,
    pub revision: u64,
    pub cash: u64,
    pub last_incarnation: u64,
    pub order: RestingOrder,
    pub slots: Vec<CashSlot>,
}

#[account(borsh)]
#[derive(InitSpace)]
pub struct TradingMarket {
    pub custody: Address,
    pub id: u16,
    pub revision: u64,
    pub price: u64,
    pub funding: i128,
    pub expires: u64,
    pub retained: u64,
    pub insurance: u64,
    pub carry: u8,
    pub bump: u8,
}

impl TradingMarket {
    pub fn window(&self, slot: u64) -> Result<MarketWindow> {
        require!(slot < self.expires, ProofError::TradeTerms);
        Ok(MarketWindow {
            market: self.id,
            current: Risk {
                lower: self.price,
                upper: self.price,
                funding: self.funding,
            },
            funding_low: self.funding - 2 * SCALE,
            funding_high: self.funding + 2 * SCALE,
        })
    }
}

pub struct FillLeg {
    pub market: u16,
    pub side: u8,
    pub lots: u64,
    pub gross: u64,
}

pub(super) fn window(windows: &[MarketWindow], market: u16) -> Result<&MarketWindow> {
    windows
        .binary_search_by_key(&market, |w| w.market)
        .map(|i| &windows[i])
        .map_err(|_| ProofError::Incomplete.into())
}

impl TradingMargin {
    fn capacity(isolated: u16) -> usize {
        if isolated == CROSS {
            CROSS_CAPACITY
        } else {
            1
        }
    }
    pub fn space(isolated: u16) -> usize {
        8 + 64
            + 2
            + 3 * 8
            + RestingOrder::INIT_SPACE
            + 4
            + Self::capacity(isolated) * CashSlot::INIT_SPACE
    }
    fn directory(&self) -> Result<MarketSlots> {
        let records = self
            .slots
            .iter()
            .map(CashSlot::decode)
            .collect::<Result<_>>()?;
        let mode = if self.isolated == CROSS {
            Mode::Cross
        } else {
            Mode::Isolated(self.isolated.into())
        };
        checked(MarketSlots::restore(
            mode,
            Self::capacity(self.isolated),
            self.last_incarnation,
            records,
            self.order.markets(),
        ))
    }
    pub fn position(&self, id: u16) -> Result<Position> {
        self.slots
            .iter()
            .find(|row| row.market() == id)
            .map(|row| row.decode().map(|(_, image)| image.position))
            .unwrap_or(Ok(Position::default()))
    }
    pub fn guard(&self, expected: u64) -> Result<()> {
        require!(expected == self.revision, ProofError::WrongCursor);
        Ok(())
    }
    pub fn advance(&mut self) -> Result<()> {
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(ProofError::WrongCursor)?;
        Ok(())
    }
    fn store(&mut self, book: MarketSlots, order: RestingOrder) -> Result<()> {
        self.slots = book
            .records()
            .iter()
            .map(CashSlot::encode)
            .collect::<Result<_>>()?;
        self.last_incarnation = book.last_incarnation();
        self.order = order;
        Ok(())
    }

    pub fn cancel(&mut self) -> Result<()> {
        require!(self.order.remaining > 0, ProofError::TradeTerms);
        let book = self.directory()?;
        let images: Vec<_> = book.records().iter().map(|(_, image)| *image).collect();
        self.store(
            checked(book.successor(&images, &[]))?,
            RestingOrder::default(),
        )?;
        self.advance()
    }

    /// Refresh the whole book, apply one optional side of a fill, and derive the
    /// next dependency set from the resulting claims, lots and remaining order.
    pub fn transition(
        &mut self,
        windows: &[MarketWindow],
        mut next_order: RestingOrder,
        fill: Option<FillLeg>,
    ) -> Result<CashRequired> {
        let book = self.directory()?;
        let mut images: Vec<_> = book.records().iter().map(|(_, image)| *image).collect();
        let touched = fill
            .as_ref()
            .map(|f| f.market)
            .or_else(|| next_order.markets().first().copied());
        if let Some(market) = touched {
            if let Err(offset) = images.binary_search_by_key(&market, |i| i.market) {
                images.insert(
                    offset,
                    MarketImage {
                        market,
                        position: Position::default(),
                        entry: EntryCost::default(),
                    },
                );
            }
        }
        for image in &mut images {
            let old = image.position;
            let leg = fill.as_ref().filter(|leg| leg.market == image.market);
            if leg.is_none() && old.lots == 0 {
                continue;
            }
            let price = window(windows, image.market)?;
            let participant = Participant {
                lots: old.lots,
                virtual_scaled: old.virtual_scaled,
                funding_checkpoint: old.funding_checkpoint,
                generation: old.generation,
                ..Participant::default()
            };
            let next = if let Some(leg) = leg {
                let next = checked(participant.quoted_fill(
                    leg.side,
                    leg.lots,
                    leg.gross,
                    price.current.funding,
                ))?;
                image.entry = checked(image.entry.fill(old.lots, next.lots, leg.gross))?;
                next
            } else {
                checked(participant.accrued(price.current.funding))?
            };
            image.position = Position {
                lots: next.lots,
                virtual_scaled: next.virtual_scaled,
                funding_checkpoint: next.funding_checkpoint,
                generation: next.generation,
            };
        }
        let mut eligible = next_order.remaining;
        if eligible > 0 && next_order.terms.reduce_only {
            let offset = images
                .binary_search_by_key(&next_order.terms.market, |image| image.market)
                .map_err(|_| ProofError::Incomplete)?;
            eligible = next_order.eligible(images[offset].position);
            if eligible == 0 {
                next_order = RestingOrder::default();
            }
        }
        let next = checked(book.successor(&images, next_order.markets()))?;
        let mut slots = Vec::new();
        let mut open = Vec::new();
        for (binding, image) in next.records() {
            slots.push(OccupiedSlot {
                market: binding.market,
                position: image.position,
            });
            if image.position.lots != 0 {
                let w = window(windows, binding.market)?;
                open.push(MarketWindow {
                    market: w.market,
                    current: w.current,
                    funding_low: w.funding_low,
                    funding_high: w.funding_high,
                });
            }
        }
        let mut reserve = 0;
        if next_order.remaining > 0 {
            let terms = next_order.terms;
            let risk = window(windows, terms.market)?.current;
            reserve = checked(orders::reserve(
                eligible,
                terms.limit,
                next_order.fee_left,
                terms.side,
                terms.reduce_only,
                risk.lower,
                risk.upper,
            ))?;
        }
        let required = checked(cash_required(&slots, &open, reserve))?;
        self.store(next, next_order)?;
        Ok(required)
    }
}
