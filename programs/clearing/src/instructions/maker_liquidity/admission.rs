//! Reuse actual route maker transitions for each funding-search quantity. This
//! must not replace financial feasibility with a prefix or free-cash estimate.
use super::*;
use crate::instructions::{account_trading, group_margin, group_trading};
use crate::state::v2::{GroupMarketV2, MarginAccountV2};
use financial_core::margin::{Margin, Risk};

pub(crate) struct MakerAdmission<'market> {
    root: Box<MarginAccountV2>,
    accrued: Margin,
    market: &'market GroupMarketV2,
    funding: [i128; 2],
    risks: [Risk; 2],
    slot: u64,
}

impl<'market> MakerAdmission<'market> {
    pub(crate) fn new(
        capital: &MarginAccountV3,
        market: &'market GroupMarketV2,
        funding: i128,
        slot: u64,
    ) -> Result<Self> {
        require!(
            capital.role == ROLE_MAKER
                && capital.mode == MODE_ISOLATED
                && capital.venue == market.group
                && capital.isolated_market_index == market.index
                && market.index < 2,
            ClearingError::MakerCapital
        );
        let root = account_trading::root_view(capital)?;
        group_trading::book::validate(&root)?;
        let mut indexes = [0; 2];
        indexes[usize::from(market.index)] = funding;
        let accrued = group_trading::checked(group_margin::model(&root)?.accrued(indexes))?;
        Ok(Self {
            root,
            accrued,
            market,
            funding: indexes,
            risks: group_trading::risk(market, funding)?,
            slot,
        })
    }

    /// Fresh candidate on the stack; no repeated heap allocation and no writes
    /// to live capital, orders, reservations, counters or consumption.
    #[inline(never)]
    pub(crate) fn admits(&self, side: u8, lots: u64, gross: u64) -> bool {
        if u128::from(gross) * 10 < u128::from(lots) * u128::from(self.market.reference_price) * 9
            || u128::from(gross) * 10
                > u128::from(lots) * u128::from(self.market.reference_price) * 11
        {
            return false;
        }
        let Ok(model) = self.accrued.maker_quote_candidate(
            usize::from(self.market.index),
            side,
            lots,
            gross,
            self.funding,
        ) else {
            return false;
        };
        let mut candidate = (*self.root).clone();
        group_trading::routes::finish_maker(
            &mut candidate,
            model,
            self.market,
            self.slot,
            self.risks,
        )
        .is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::v2;

    fn environment() -> (MarginAccountV3, GroupMarketV2) {
        let venue = Pubkey::new_unique();
        let capital = MarginAccountV3 {
            schema_version: 3,
            venue,
            owner: Pubkey::new_unique(),
            subaccount_index: 1,
            id: 1,
            mode: MODE_ISOLATED,
            isolated_market_index: 0,
            role: ROLE_MAKER,
            cash: 500,
            delegate_epoch: 1,
            positions: [
                v2::PositionV2 {
                    lots: 3,
                    virtual_scaled: -30_000 * financial_core::SCALE,
                    generation: 1,
                    ..Default::default()
                },
                v2::PositionV2::default(),
            ],
            ..Default::default()
        };
        let market = GroupMarketV2 {
            schema_version: 2,
            group: venue,
            index: 0,
            reference_price: 10_000,
            lower: 9900,
            upper: 10100,
            terms_epoch: 1,
            ..Default::default()
        };
        (capital, market)
    }

    #[test]
    fn funding_search_preserves_real_nonprefix_margin_and_fractional_claims() {
        let (mut capital, market) = environment();
        let admission = MakerAdmission::new(&capital, &market, financial_core::SCALE, 100).unwrap();
        assert_eq!(
            (1..=4)
                .map(|lots| admission.admits(0, lots, lots * 10010))
                .collect::<Vec<_>>(),
            [false, false, true, false]
        );
        assert_eq!(capital.positions[0].lots, 3);
        capital.cash = 0;
        capital.positions[0].virtual_scaled = -30030 * financial_core::SCALE - 1;
        assert!(!MakerAdmission::new(&capital, &market, 0, 100)
            .unwrap()
            .admits(0, 3, 30030));
        capital.positions[0].virtual_scaled += 1;
        assert!(MakerAdmission::new(&capital, &market, 0, 100)
            .unwrap()
            .admits(0, 3, 30030));
    }

    #[test]
    fn all_orders_and_generation_refresh_match_actual_route_admission() {
        let (mut capital, market) = environment();
        capital.book.last_order_id = 4;
        for (index, stored) in capital.book.orders.iter_mut().enumerate() {
            stored.order = crate::state::StoredOrder {
                id: index as u64 + 1,
                version: 1,
                state: 1,
                terms_epoch: 1,
                side: 0,
                lots: 1,
                limit: 10010,
                fee_budget: 3,
                expiry_slot: 200,
                start_slot: 1,
                reserve: 1123,
                ..Default::default()
            };
        }
        capital.reserved = 4492;
        assert!(!MakerAdmission::new(&capital, &market, 0, 100)
            .unwrap()
            .admits(0, 3, 30030));
        // All four reduce-only orders lose their generation when the maker is
        // flattened. The existing book engine removes those stale reservations.
        for stored in &mut capital.book.orders {
            stored.order.reduce_only = true;
            stored.order.side = 1;
            stored.order.generation = 1;
            stored.order.limit = 9990;
            stored.order.reserve = 113;
        }
        capital.reserved = 452;
        assert!(MakerAdmission::new(&capital, &market, 0, 100)
            .unwrap()
            .admits(0, 3, 30030));
        capital.state_version = u64::MAX;
        assert!(!MakerAdmission::new(&capital, &market, 0, 100)
            .unwrap()
            .admits(0, 3, 30030));
    }
}
