//! Candidate sparse storage for one margin account. The transition adapter supplies
//! complete post-transition positions and live order markets from canonical state.
//! Stored orders refer to market IDs. A physical offset cannot identify a market.
extern crate alloc;
use crate::{entry_cost::EntryCost, Error, Mode, Position, Result};
use alloc::vec::Vec;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MarketImage {
    pub market: u16,
    pub position: Position,
    pub entry: EntryCost,
}

/// Scoped to one margin account. Closing and reopening the same market gives
/// it a new binding, even if its position generation or vector offset repeats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Binding {
    pub market: u16,
    pub incarnation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarketSlots {
    mode: Mode,
    capacity: usize,
    last_incarnation: u64,
    records: Vec<(Binding, MarketImage)>,
}

impl MarketSlots {
    pub fn new(mode: Mode, capacity: usize) -> Self {
        Self {
            mode,
            capacity,
            last_incarnation: 0,
            records: Vec::new(),
        }
    }

    /// Restore a directory from an authenticated account. The counter can exceed
    /// every surviving incarnation after the most recently admitted slot is retired.
    pub fn restore(
        mode: Mode,
        capacity: usize,
        last_incarnation: u64,
        records: Vec<(Binding, MarketImage)>,
        live_order_markets: &[u16],
    ) -> Result<Self> {
        if records.len() > capacity {
            return Err(Error::Bounds);
        }
        let mut prior_market = None;
        for (index, (binding, image)) in records.iter().enumerate() {
            if binding.market != image.market
                || prior_market.is_some_and(|market| market >= binding.market)
                || binding.incarnation == 0
                || binding.incarnation > last_incarnation
                || records[..index]
                    .iter()
                    .any(|(other, _)| other.incarnation == binding.incarnation)
                || (image.position.lots == 0
                    && image.position.virtual_scaled == 0
                    && !live_order_markets.contains(&binding.market))
                || mode == Mode::CashOnly
                || matches!(mode, Mode::Isolated(market) if market != usize::from(binding.market))
            {
                return Err(Error::Invariant);
            }
            image.position.validate()?;
            image.entry.validate(image.position.lots)?;
            prior_market = Some(binding.market);
        }
        for market in live_order_markets {
            if records
                .binary_search_by_key(market, |(binding, _)| binding.market)
                .is_err()
            {
                return Err(Error::Invariant);
            }
        }
        Ok(Self {
            mode,
            capacity,
            last_incarnation,
            records,
        })
    }

    pub fn last_incarnation(&self) -> u64 {
        self.last_incarnation
    }

    pub fn records(&self) -> &[(Binding, MarketImage)] {
        &self.records
    }

    pub fn resolve(&self, binding: Binding) -> Result<&MarketImage> {
        let index = self
            .records
            .binary_search_by_key(&binding.market, |(key, _)| key.market)
            .map_err(|_| Error::Generation)?;
        let (current, image) = &self.records[index];
        if *current != binding {
            return Err(Error::Generation);
        }
        Ok(image)
    }

    /// Images cover all preceding occupants plus markets touched by the operation,
    /// ordered by market ID. Discharging a market requires its explicit final image.
    /// The caller derives live_order_markets from every Open/Partial order, including
    /// protective children. Terminal order records and funding cursors alone own no slot.
    /// Build a successor so a failed update leaves both the records and counter intact.
    pub fn successor(&self, images: &[MarketImage], live_order_markets: &[u16]) -> Result<Self> {
        if images
            .windows(2)
            .any(|pair| pair[0].market >= pair[1].market)
        {
            return Err(Error::Invariant);
        }
        for market in live_order_markets {
            if images
                .binary_search_by_key(market, |image| image.market)
                .is_err()
            {
                return Err(Error::Invariant);
            }
        }
        let mut prior = self.records.iter().peekable();
        let mut next = Self::new(self.mode, self.capacity);
        next.last_incarnation = self.last_incarnation;
        for image in images {
            image.position.validate()?;
            image.entry.validate(image.position.lots)?;
            let old = match prior.peek() {
                Some((binding, _)) if binding.market < image.market => {
                    return Err(Error::Invariant)
                }
                Some((binding, _)) if binding.market == image.market => prior.next(),
                _ => None,
            };
            if image.position.lots == 0
                && image.position.virtual_scaled == 0
                && !live_order_markets.contains(&image.market)
            {
                continue;
            }
            if next.records.len() == self.capacity
                || self.mode == Mode::CashOnly
                || matches!(self.mode, Mode::Isolated(index) if index != usize::from(image.market))
            {
                return Err(Error::Bounds);
            }
            let binding = if let Some((binding, _)) = old {
                *binding
            } else {
                next.last_incarnation = next
                    .last_incarnation
                    .checked_add(1)
                    .ok_or(Error::Overflow)?;
                Binding {
                    market: image.market,
                    incarnation: next.last_incarnation,
                }
            };
            next.records.push((binding, *image));
        }
        if prior.next().is_some() {
            return Err(Error::Invariant);
        }
        Ok(next)
    }
}
