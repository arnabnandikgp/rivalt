//! Permissionless default uses economic equity at the frozen reference prices.
//! Even an unpaid positive claim counts when deciding whether exposure is bankrupt.
use super::*;

pub(crate) struct FrozenEquity {
    funded: i128,
    net: i128,
    gross_debt: u128,
    flat: bool,
}

impl FrozenEquity {
    pub(crate) fn from_cash(cash: u64) -> Result<Self> {
        let funded = checked(math::scaled(cash))?;
        Ok(Self {
            funded,
            net: funded,
            gross_debt: 0,
            flat: true,
        })
    }

    pub(crate) fn include(&mut self, lots: i64, claim: i128) -> Result<()> {
        self.net = self
            .net
            .checked_add(claim)
            .ok_or(ClearingError::Arithmetic)?;
        self.gross_debt = self
            .gross_debt
            .checked_add(claim.min(0).unsigned_abs())
            .ok_or(ClearingError::Arithmetic)?;
        self.flat &= lots == 0;
        Ok(())
    }

    pub(crate) fn can_default(&self) -> bool {
        self.net < 0 || (self.flat && self.gross_debt > self.funded as u128)
    }
}

#[cfg(feature = "listed-venue-cash")]
pub(crate) mod listed {
    use super::*;
    use crate::instructions::account_cash::listed::ListedMargin;
    use clearing_accounting::market_slots::storage::FIRST_LISTED_MARKET;

    /// Values are in full market-ID order. BTC and ETH occupy the first two
    /// entries. A directory slot can never resolve by offset in this slice.
    #[derive(Clone, Copy)]
    pub(crate) struct Valuation {
        pub market: u16,
        pub reference: u64,
        pub funding: i128,
    }

    pub(crate) fn funded_equity(
        root: &MarginAccount,
        directory_bytes: &[u8],
        values: &[Valuation],
    ) -> Result<FrozenEquity> {
        require!(
            values.len() >= MARKET_COUNT
                && values[0].market == 0
                && values[1].market == 1
                && values
                    .windows(2)
                    .all(|pair| pair[0].market < pair[1].market),
            ClearingError::Resolution
        );
        let model = account_trading::model(root)?;
        let directory = ListedMargin::stored_directory(root, directory_bytes)?;
        let mut result = FrozenEquity::from_cash(root.cash)?;
        for (position, value) in model.positions.iter().zip(values) {
            result.include(
                position.lots,
                checked(position.unpaid(value.reference, value.funding))?,
            )?;
        }
        let listed = &values[usize::from(FIRST_LISTED_MARKET)..];
        for (binding, image) in directory.records() {
            let index = listed
                .binary_search_by_key(&binding.market, |value| value.market)
                .map_err(|_| ClearingError::Resolution)?;
            let value = listed[index];
            result.include(
                image.position.lots,
                checked(image.position.unpaid(value.reference, value.funding))?,
            )?;
        }
        Ok(result)
    }
}

#[cfg(all(test, feature = "listed-venue-cash"))]
mod tests {
    use super::{listed::*, *};
    use clearing_accounting::{
        entry_cost::EntryCost,
        market_slots::{MarketImage, MarketSlots},
        Mode, Position, SCALE,
    };

    #[test]
    fn funded_three_market_debtor_needs_every_claim_at_the_frozen_funding_index() {
        let root = MarginAccount {
            schema_version: SCHEMA_VERSION,
            mode: MODE_CROSS,
            isolated_market_index: CROSS_MARKET_SENTINEL,
            role: ROLE_TRADER,
            lifecycle: MEMBER_FINANCIAL,
            activation_generation: 1,
            delegate_epoch: 1,
            cash: 40_174,
            positions: [(1, -60_002), (-10, 299_980)].map(|(lots, cost)| crate::state::Position {
                lots,
                virtual_scaled: cost * SCALE,
                generation: 1,
                ..Default::default()
            }),
            ..Default::default()
        };
        let mut bytes =
            vec![0; initial_margin_size(root.mode, root.isolated_market_index) - MARGIN_ALLOCATION];
        let image = MarketImage {
            market: 17,
            position: Position {
                lots: 10,
                virtual_scaled: -1_520 * SCALE,
                generation: 1,
                ..Default::default()
            },
            entry: EntryCost::default().fill(0, 10, 1_520).unwrap(),
        };
        MarketSlots::new(Mode::Cross, 6)
            .successor(&[image], &[])
            .unwrap()
            .write_listed_bytes(&mut bytes)
            .unwrap();
        let mut values =
            [(0, 53_002), (1, 33_498), (17, 332)].map(|(market, reference)| Valuation {
                market,
                reference,
                funding: 0,
            });
        let equity = funded_equity(&root, &bytes, &values).unwrap();
        assert_eq!(equity.net, -26 * SCALE);
        assert!(equity.can_default());
        assert!(funded_equity(&root, &bytes, &values[..2]).is_err());
        values[2].market = 2;
        assert!(funded_equity(&root, &bytes, &values).is_err());
        values[2].market = 17;
        values[2].reference = 335;
        let solvent = funded_equity(&root, &bytes, &values).unwrap();
        assert_eq!(solvent.net, 4 * SCALE);
        assert!(!solvent.can_default());
        values[2].funding = 400_000_000;
        let boundary = funded_equity(&root, &bytes, &values).unwrap();
        assert_eq!(boundary.net, 0);
        assert!(!boundary.can_default());
        values[2].funding += 1;
        assert_eq!(funded_equity(&root, &bytes, &values).unwrap().net, -10);
        assert!(funded_equity(&root, &bytes, &values).unwrap().can_default());
        assert!(funded_equity(&root, &[], &values).is_err());
    }
}
