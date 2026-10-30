use super::*;

/// One instruction snapshot. Every nonempty slot and requested effect is present.
/// `selected == 2` is internal account maintenance with no requested market effect.
pub(crate) struct Environment<'a> {
    pub markets: [Option<&'a Market>; 2],
    pub selected: usize,
    pub funding: [i128; 2],
    pub slot: u64,
    pub credible: [bool; 2],
}

impl<'a> Environment<'a> {
    pub fn isolated(market: &'a Market, funding: i128, slot: u64, credible: bool) -> Result<Self> {
        let selected = usize::from(market.index);
        require!(selected < 2, ClearingError::OrderState);
        let mut result = Self {
            markets: [None; 2],
            selected,
            funding: [0; 2],
            slot,
            credible: [false; 2],
        };
        result.markets[selected] = Some(market);
        result.funding[selected] = funding;
        result.credible[selected] = credible;
        Ok(result)
    }

    pub fn market(&self, index: usize) -> Result<&'a Market> {
        self.markets
            .get(index)
            .and_then(|market| *market)
            .ok_or_else(|| error!(ClearingError::OrderState))
    }

    pub fn validate(&self, root: &MarginAccount) -> Result<()> {
        let account = model(root)?;
        require!(self.selected <= 2, ClearingError::OrderState);
        let requested = if self.selected < 2 {
            require!(account.allows(self.selected), ClearingError::OrderState);
            1 << self.selected
        } else { 0 };
        super::super::markets::validate_environment(self.markets, &[root], requested)
    }

    pub fn risks(&self) -> [math::margin::Risk; 2] {
        std::array::from_fn(|index| {
            self.markets[index].map_or(super::super::markets::empty_risk(), |market| math::margin::Risk {
                lower: market.lower.max(1),
                upper: market.upper.max(1),
                funding: self.funding[index],
            })
        })
    }

    /// Source relevance is derived after terminal authority is cleaned up. Empty
    /// unrelated slots need no price, but cannot hide an open loss or live order.
    #[inline(never)]
    pub fn admit_sources(&self, root: &MarginAccount, clock: &Clock, increase: bool) -> Result<()> {
        require!(clock.slot == self.slot, ClearingError::Profile);
        let mut refreshed = root.clone();
        refresh_with_environment(&mut refreshed, self)?;
        for index in 0..2 {
            let relevant = index == self.selected
                || refreshed.positions[index].lots != 0
                || refreshed.book.orders.iter().any(|stored| {
                    stored.order.active() && usize::from(stored.market_index) == index
                });
            if relevant {
                oracle::action(self.market(index)?, clock, increase)?;
            }
        }
        Ok(())
    }
}
