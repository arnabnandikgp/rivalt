//! Shared authenticated account identity for canonical route execution.
use super::*;

macro_rules! route_identity {
    ($name:ident $(, $mutable:ident)?) => {
#[derive(Accounts)]
pub struct $name {
    pub actor: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account($($mutable,)? seeds = [b"market-v3", venue.address().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 @ ClearingError::Profile)]
    pub market: Box<BorshAccount<Market>>,
    #[account(mut, seeds = [b"market-v3", venue.address().as_ref(), &[other_market.index]], bump = other_market.bump,
        has_one = venue, constraint = other_market.address().to_owned() != market.address().to_owned() @ ClearingError::Alias)]
    pub other_market: Option<Box<BorshAccount<Market>>>,
    #[account(mut, seeds = [b"ledger-v3", market.address().as_ref()], bump = ledger.bump, has_one = venue, has_one = market)]
    pub ledger: Box<BorshAccount<MarketLedger>>,
    #[account(mut, seeds = [b"ledger-v3", venue.markets[1 - market.index as usize].as_ref()], bump = other_ledger.bump, has_one = venue,
        constraint = other_ledger.market == venue.markets[1 - market.index as usize] @ ClearingError::Profile)]
    pub other_ledger: Option<Box<BorshAccount<MarketLedger>>>,
    #[account(mut, seeds = [b"margin-v3", trader.portfolio.as_ref(), &trader.subaccount_index.to_le_bytes()], bump = trader.bump, has_one = venue)]
    pub trader: Box<BorshAccount<MarginAccount>>,
}
    };
}
route_identity!(AccountRouteIdentity, mut);
route_identity!(ReadOnlyMarketIdentity);

pub(crate) struct RouteIdentityView<'a> {
    pub actor: &'a Signer,
    pub venue: &'a BorshAccount<Venue>,
    pub safety: &'a BorshAccount<VenueSafety>,
    pub market: &'a mut BorshAccount<Market>,
    pub other_market: &'a mut Option<Box<BorshAccount<Market>>>,
    pub ledger: &'a mut BorshAccount<MarketLedger>,
    pub other_ledger: &'a mut Option<Box<BorshAccount<MarketLedger>>>,
    pub trader: &'a mut BorshAccount<MarginAccount>,
}

macro_rules! identity_view {
    ($name:ident) => {
        impl $name {
            pub(crate) fn view(&mut self) -> RouteIdentityView<'_> {
                RouteIdentityView { actor: &self.actor, venue: &self.venue, safety: &self.safety,
                    market: &mut self.market, other_market: &mut self.other_market,
                    ledger: &mut self.ledger, other_ledger: &mut self.other_ledger, trader: &mut self.trader }
            }
        }
    };
}
identity_view!(AccountRouteIdentity);
identity_view!(ReadOnlyMarketIdentity);

impl RouteIdentityView<'_> {
    pub(crate) fn maintain_root(
        &mut self,
        before: &MarginAccount,
        after: &MarginAccount,
    ) -> Result<()> {
        let other = self.other_ledger.as_deref_mut().map(|ledger| &mut **ledger);
        let ledgers = if self.market.index == 0 {
            [Some(&mut **self.ledger), other]
        } else {
            [other, Some(&mut **self.ledger)]
        };
        super::super::account_cash::maintained::update(ledgers, before, after, &self.safety)
    }
    pub(crate) fn maintain_trader(&mut self, after: &MarginAccount) -> Result<()> {
        let other = self.other_ledger.as_deref_mut().map(|ledger| &mut **ledger);
        let ledgers = if self.market.index == 0 {
            [Some(&mut **self.ledger), other]
        } else { [other, Some(&mut **self.ledger)] };
        super::super::account_cash::maintained::update(ledgers, &self.trader, after, &self.safety)
    }
}
