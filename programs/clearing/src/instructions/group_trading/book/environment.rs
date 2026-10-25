use super::*;

/// One instruction snapshot. A cross root always supplies both canonical market
/// states; source credibility affects reserves but never removes a dependency.
pub(crate) struct Environment<'a> {
    pub markets: [Option<&'a GroupMarketV2>; 2],
    pub selected: usize,
    pub funding: [i128; 2],
    pub slot: u64,
    pub credible: [bool; 2],
}

impl<'a> Environment<'a> {
    pub fn isolated(
        market: &'a GroupMarketV2,
        funding: i128,
        slot: u64,
        credible: bool,
    ) -> Result<Self> {
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

    pub fn market(&self, index: usize) -> Result<&'a GroupMarketV2> {
        self.markets
            .get(index)
            .and_then(|market| *market)
            .ok_or_else(|| error!(ClearingError::OrderState))
    }

    pub fn validate(&self, root: &MarginAccountV2) -> Result<()> {
        let account = model(root)?;
        require!(account.allows(self.selected), ClearingError::OrderState);
        if root.mode == MODE_CROSS {
            require!(
                self.markets.iter().all(Option::is_some),
                ClearingError::OrderState
            );
        }
        for (index, market) in self.markets.iter().enumerate() {
            if let Some(market) = market {
                require!(
                    market.schema_version == SCHEMA_VERSION
                        && market.group == root.group
                        && usize::from(market.index) == index,
                    ClearingError::OrderState
                );
            }
        }
        self.market(self.selected)?;
        Ok(())
    }

    pub fn risks(&self) -> [math::margin::Risk; 2] {
        std::array::from_fn(|index| {
            self.markets[index].map_or(math::margin::Risk::default(), |market| math::margin::Risk {
                lower: market.lower.max(1),
                upper: market.upper.max(1),
                funding: self.funding[index],
            })
        })
    }
}
