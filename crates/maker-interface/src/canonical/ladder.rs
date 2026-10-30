//! Exact consecutive quantity quotes for bounded clearing search. Validate the
//! shape once, then walk its marginal offsets and convex inventory potential.
//! Pricing only: execution requires capital admission; D74 funding does not.
use super::*;

pub struct QuoteLadder<'shape> {
    shape: &'shape LiquidityShape,
    regions: &'shape [PriceRegion],
    anchor: i64,
    direction: i64,
    relative_inventory: i64,
    capacity: u64,
    consumed: u64,
    filled: u64,
    gross: u64,
    region_index: usize,
    region_start: u64,
    failed: bool,
}

impl<'shape> QuoteLadder<'shape> {
    pub fn new(
        shape: &'shape LiquidityShape,
        anchor: u64,
        side: u8,
        inventory: i64,
        consumed: u64,
    ) -> QuoteResult<Self> {
        shape.validate()?;
        if shape.mode == 0 || !(1..=MAX_PRICE).contains(&anchor) {
            return Err(QuoteError::Bounds);
        }
        let capacity = available(shape, side, inventory, consumed)?;
        let regions = shape.side_regions(side)?;
        let mut region_index = 0;
        let mut region_start = 0;
        while region_index < regions.len() && consumed >= regions[region_index].end_lots {
            region_start = regions[region_index].end_lots;
            region_index += 1;
        }
        Ok(Self {
            shape,
            regions,
            anchor: i64::try_from(anchor).map_err(|_| QuoteError::Arithmetic)?,
            direction: if side == 0 { -1 } else { 1 },
            relative_inventory: inventory
                .checked_sub(shape.target)
                .ok_or(QuoteError::Arithmetic)?,
            capacity,
            consumed,
            filled: 0,
            gross: 0,
            region_index,
            region_start,
            failed: false,
        })
    }

    pub fn capacity(&self) -> u64 {
        self.capacity
    }

    /// Yield gross and remaining capacity for quantities 1,2,...,capacity.
    /// A bad marginal invalidates every later prefix; callers cannot skip it and
    /// obtain an apparently valid average. Zero capacity yields None normally.
    pub fn next_quote(&mut self) -> QuoteResult<Option<(u64, u64)>> {
        if self.failed {
            return Err(QuoteError::Bounds);
        }
        if self.filled == self.capacity {
            return Ok(None);
        }
        let answer = self.advance();
        if answer.is_err() {
            self.failed = true;
        }
        answer.map(Some)
    }

    fn advance(&mut self) -> QuoteResult<(u64, u64)> {
        let quantity_index = self
            .consumed
            .checked_add(self.filled)
            .ok_or(QuoteError::Arithmetic)?;
        while self.region_index < self.regions.len()
            && quantity_index >= self.regions[self.region_index].end_lots
        {
            self.region_start = self.regions[self.region_index].end_lots;
            self.region_index += 1;
        }
        let region = self
            .regions
            .get(self.region_index)
            .ok_or(QuoteError::Capacity)?;
        let region_position = quantity_index
            .checked_sub(self.region_start)
            .ok_or(QuoteError::Arithmetic)?;
        let offset = region
            .slope
            .checked_mul(region_position)
            .and_then(|rising| region.offset.checked_add(rising))
            .ok_or(QuoteError::Arithmetic)?;

        // H(distance+1)-H(distance) = tick*floor(distance/step). Moving
        // toward target reverses the previous increment. Bounds established at
        // construction keep distance <=2*MAX_LOTS and this product within i64.
        let moving_away =
            self.relative_inventory == 0 || (self.relative_inventory > 0) == (self.direction > 0);
        let distance = self.relative_inventory.unsigned_abs();
        let step_index = if moving_away {
            distance
        } else {
            distance.checked_sub(1).ok_or(QuoteError::Arithmetic)?
        } / self.shape.skew_step;
        let magnitude = step_index
            .checked_mul(self.shape.skew_tick)
            .ok_or(QuoteError::Arithmetic)?;
        let signed_magnitude = i64::try_from(magnitude).map_err(|_| QuoteError::Arithmetic)?;
        let potential_change = if moving_away {
            signed_magnitude
        } else {
            -signed_magnitude
        };
        let spread = i64::try_from(offset)
            .map_err(|_| QuoteError::Arithmetic)?
            .checked_add(potential_change)
            .ok_or(QuoteError::Arithmetic)?;
        let marginal = self
            .anchor
            .checked_sub(
                self.direction
                    .checked_mul(spread)
                    .ok_or(QuoteError::Arithmetic)?,
            )
            .ok_or(QuoteError::Arithmetic)?;
        if !(1..=MAX_PRICE as i64).contains(&marginal) {
            return Err(QuoteError::Bounds);
        }
        self.gross = self
            .gross
            .checked_add(marginal as u64)
            .ok_or(QuoteError::Arithmetic)?;
        self.relative_inventory = self
            .relative_inventory
            .checked_add(self.direction)
            .ok_or(QuoteError::Arithmetic)?;
        self.filled = self.filled.checked_add(1).ok_or(QuoteError::Arithmetic)?;
        Ok((self.gross, self.capacity - self.filled))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn curve() -> LiquidityShape {
        let mut shape = LiquidityShape {
            mode: 1,
            ttl_slots: 150,
            skew_step: 2,
            skew_tick: 2,
            long_cap: 8,
            short_cap: 8,
            bid_count: 2,
            ask_count: 2,
            ..Default::default()
        };
        shape.bids[0] = PriceRegion {
            end_lots: 3,
            offset: 2,
            slope: 1,
        };
        shape.bids[1] = PriceRegion {
            end_lots: 8,
            offset: 8,
            slope: 0,
        };
        shape.asks[0] = PriceRegion {
            end_lots: 3,
            offset: 3,
            slope: 2,
        };
        shape.asks[1] = PriceRegion {
            end_lots: 8,
            offset: 12,
            slope: 0,
        };
        shape
    }

    #[test]
    fn literal_offsets_inventory_turn_and_consumed_boundaries() {
        let shape = curve();
        for (side, inventory, consumed, expected) in [
            (0, 0, 0, vec![103, 208, 317, 431]),
            (1, 0, 0, vec![98, 195, 289, 379]),
            (0, 3, 0, vec![101, 206, 313, 425]),
            (1, -3, 0, vec![100, 197, 293, 385]),
            (0, -3, 3, vec![114, 230, 346, 464]),
        ] {
            let mut ladder = QuoteLadder::new(&shape, 100, side, inventory, consumed).unwrap();
            for gross in expected {
                assert_eq!(ladder.next_quote().unwrap().unwrap().0, gross);
            }
        }
    }

    #[test]
    fn zero_capacity_is_not_an_invalid_publication_or_a_prefix_health_claim() {
        let mut shape = curve();
        shape.mode = 3;
        let mut ladder = QuoteLadder::new(&shape, 100, 0, -1, 0).unwrap();
        assert_eq!(ladder.capacity(), 0);
        assert_eq!(ladder.next_quote().unwrap(), None);
        let mut ladder = QuoteLadder::new(&shape, 100, 0, 3, 0).unwrap();
        assert_eq!(ladder.capacity(), 3);
        for _ in 0..3 {
            assert!(ladder.next_quote().unwrap().is_some());
        }
        assert_eq!(ladder.next_quote().unwrap(), None);
    }

    #[test]
    fn an_invalid_first_or_later_marginal_cannot_be_skipped() {
        let shape = curve();
        let mut first = QuoteLadder::new(&shape, 1, 1, 0, 0).unwrap();
        assert!(first.next_quote().is_err());
        assert!(first.next_quote().is_err());
        let mut later = QuoteLadder::new(&shape, 5, 1, 0, 0).unwrap();
        assert_eq!(later.next_quote().unwrap().unwrap().0, 3);
        assert_eq!(later.next_quote().unwrap().unwrap().0, 5);
        assert!(later.next_quote().is_err());
        assert!(later.next_quote().is_err());
    }
}
