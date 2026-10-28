//! Reuse actual route maker transitions for each funding-search quantity. This
//! must not replace financial feasibility with a prefix or free-cash estimate.
use super::*;
use crate::instructions::{account_trading, group_margin, group_trading};
use crate::state::v2::{GroupMarketV2, MarginAccountV2};
use financial_core::margin::{Margin, Risk};

pub(crate) struct MakerAdmission<'market> {
    root: Box<MarginAccountV2>,
    accrued: Margin,
    prepared_risk: financial_core::liquidity::PreparedMakerRisk,
    reservations: super::reservations::Reservations,
    market: &'market GroupMarketV2,
    funding: [i128; 2],
    risks: [Risk; 2],
    slot: u64,
}

impl<'market> MakerAdmission<'market> {
    #[inline(never)]
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
        let position = accrued.positions[usize::from(market.index)];
        let selected = financial_core::Participant {
            id: accrued.id,
            cash: accrued.cash,
            lots: position.lots,
            virtual_scaled: position.virtual_scaled,
            funding_checkpoint: position.funding_checkpoint,
            generation: position.generation,
            reserved: 0,
        };
        let reservations = super::reservations::Reservations::new(&root, market, slot);
        let prepared_risk =
            group_trading::checked(financial_core::liquidity::PreparedMakerRisk::new(
                selected,
                market.lower,
                market.upper,
                funding,
            ))?;
        Ok(Self {
            root,
            accrued,
            prepared_risk,
            reservations,
            market,
            funding: indexes,
            risks: group_trading::risk(market, funding)?,
            slot,
        })
    }

    /// The same scalar fill, reserve and risk arithmetic with invariant book
    /// inputs prepared once. Unhealthy quantities allocate no Anchor errors.
    #[inline(never)]
    pub(crate) fn admits(&self, side: u8, lots: u64, gross: u64) -> bool {
        let Some(ten_gross) = gross.checked_mul(10) else {
            return false;
        };
        let Some(reference_notional) = lots.checked_mul(self.market.reference_price) else {
            return false;
        };
        let Some(low) = reference_notional.checked_mul(9) else {
            return false;
        };
        let Some(high) = reference_notional.checked_mul(11) else {
            return false;
        };
        if side > 1 || self.root.state_version == u64::MAX || ten_gross < low || ten_gross > high {
            return false;
        }
        let Ok(candidate) = self.prepared_risk.quote(side, lots, gross) else {
            return false;
        };
        let Ok(reserved) = self
            .reservations
            .required(candidate.lots, candidate.generation)
        else {
            return false;
        };
        candidate.admits(reserved)
    }

    /// Recheck every selected leg with actual whole-root mutation/book refresh,
    /// not just the prepared projection used to populate the bounded search.
    #[inline(never)]
    pub(crate) fn selected_admits(&self, side: u8, lots: u64, gross: u64) -> bool {
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

    #[test]
    fn prepared_search_matches_full_route_with_funding_orders_and_protection() {
        use financial_core::SCALE;
        let mut comparisons = 0;
        for market_index in 0..2usize {
            for inventory in [-4i64, -1, 0, 1, 4] {
                for funding in [-SCALE, 0, SCALE] {
                    for cash in [0, 500, 15000] {
                        for claim in [-1, 0, 500 * SCALE] {
                            for book_kind in 0..4 {
                                let (mut capital, mut market) = environment();
                                market.index = market_index as u8;
                                capital.isolated_market_index = market.index;
                                capital.cash = cash;
                                capital.positions = [v2::PositionV2::default(); 2];
                                capital.positions[market_index] = v2::PositionV2 {
                                    lots: inventory,
                                    virtual_scaled: claim - i128::from(inventory) * 10000 * SCALE,
                                    generation: 1,
                                    ..Default::default()
                                };
                                if book_kind > 0 {
                                    capital.book.last_order_id = 4;
                                    capital.reserved = 4;
                                    let reduce_side = u8::from(inventory >= 0);
                                    for (index, stored) in
                                        capital.book.orders.iter_mut().enumerate()
                                    {
                                        stored.market_index = market.index;
                                        stored.order = crate::state::StoredOrder {
                                            id: index as u64 + 1,
                                            version: 1,
                                            state: 1,
                                            lots: 4,
                                            filled: 1,
                                            fee_budget: 7,
                                            reserve: 1,
                                            terms_epoch: 1,
                                            side: if book_kind == 2 {
                                                reduce_side
                                            } else {
                                                index as u8 % 2
                                            },
                                            limit: if index % 2 == 0 { 10010 } else { 9990 },
                                            expiry_slot: if book_kind == 3 && index == 0 {
                                                100
                                            } else {
                                                200
                                            },
                                            reduce_only: book_kind == 2,
                                            generation: 1,
                                            group_id: if book_kind == 2 { 1 } else { 0 },
                                            ..Default::default()
                                        };
                                        if book_kind == 3 && index == 1 {
                                            stored.delegate_epoch = 1;
                                        }
                                        if book_kind == 3 && index == 2 {
                                            stored.order.terms_epoch = 0;
                                        }
                                    }
                                    if book_kind == 2 {
                                        capital.book.last_group_id = 1;
                                        capital.book.protections[0].market_index = market.index;
                                        capital.book.protections[0].protection =
                                            crate::state::ProtectiveGroup {
                                                id: 1,
                                                version: 1,
                                                original: 3,
                                                remaining: 2,
                                                generation: 1,
                                                side: reduce_side,
                                            };
                                    }
                                }
                                let admission =
                                    MakerAdmission::new(&capital, &market, funding, 100).unwrap();
                                for side in 0..=1 {
                                    for lots in 1..=12 {
                                        for price in [9000, 9990, 10010, 11000] {
                                            assert_eq!(admission.admits(side, lots, lots * price),
                                                admission.selected_admits(side, lots, lots * price),
                                                "market={market_index} q={inventory} funding={funding} cash={cash} claim={claim} book={book_kind} side={side} lots={lots} price={price}");
                                            comparisons += 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        assert_eq!(comparisons, 103680);
    }
}
