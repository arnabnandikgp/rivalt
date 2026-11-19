//! Fold a market's three authenticated execution lanes at a financial boundary.
use crate::{
    event_cpi::Payloads,
    state::{accounts::{Market, Venue, VenueSafety}, liquidity::MakerRegistration},
    ClearingError,
};
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct CheckpointMarket {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, has_one = venue, seeds = [b"market-v3", venue.address().as_ref(), &[market.index]], bump = market.bump,
        constraint = market.index < 2 && venue.markets[market.index as usize] == *market.address() @ ClearingError::Profile)]
    pub market: Box<BorshAccount<Market>>,
    #[account(seeds = [b"maker-v4", market.address().as_ref(), &[0]], bump = first.bump)]
    pub first: Box<BorshAccount<MakerRegistration>>,
    #[account(seeds = [b"maker-v4", market.address().as_ref(), &[1]], bump = second.bump)]
    pub second: Box<BorshAccount<MakerRegistration>>,
    #[account(seeds = [b"maker-v4", market.address().as_ref(), &[2]], bump = third.bump)]
    pub third: Box<BorshAccount<MakerRegistration>>,
}

pub fn checkpoint(ctx: &mut Context<CheckpointMarket>, events: &mut Payloads) -> Result<()> {
    #[cfg(not(feature = "read-only-route-market"))]
    {
        let _ = (ctx, events);
        Err(ClearingError::Profile.into())
    }
    #[cfg(feature = "read-only-route-market")]
    {
        use crate::state::accounts::{ACTIVE, SCHEMA_VERSION};
        require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Profile);
        let accounts = &mut ctx.accounts;
        require!(
            accounts.venue.schema_version == SCHEMA_VERSION &&
            accounts.safety.schema_version == SCHEMA_VERSION && accounts.safety.mode == ACTIVE,
            ClearingError::Profile
        );
        let market = &mut accounts.market;
        let registrations = [&*accounts.first, &*accounts.second, &*accounts.third];
        let gross = crate::market_capacity::checkpoint_gross(market, registrations)?;
        let clock = Clock::get()?;
        let views = registrations.map(|registration| registration.account().clone());
        if let Some(prefix) = crate::market_funding::earned(market, &views, &clock, accounts.safety.mode == ACTIVE)? {
            market.funding_index_scaled = prefix.index;
            market.funding_time = prefix.through;
        }
        market.gross_lots = gross;
        events.emit(&crate::events::MarketCheckpointed {
            venue: *accounts.venue.address(),
            market: *market.address(),
            slot: clock.slot,
            state: crate::events::MarketSnapshot::from(&***market),
        }, accounts.event_authority.account().clone())
    }
}

/// Only a successful same-parent instruction in this transaction can serve as
/// a checkpoint. Checking the immediate siblings excludes an intervening fill,
/// including a fill that lands in the same slot.
#[cfg(feature = "read-only-route-market")]
pub(crate) fn require_recent(markets: impl Iterator<Item = Address>) -> Result<()> {
    let mut required = [None; 2];
    let mut count = 0;
    for market in markets {
        require!(count < required.len(), ClearingError::Profile);
        required[count] = Some(market);
        count += 1;
    }
    for prior in 0..count {
        let ix = solana_instruction::syscalls::get_processed_sibling_instruction(prior)
            .ok_or(ClearingError::MarketCheckpoint)?;
        require!(
            ix.program_id.as_ref() == crate::ID.as_ref() && ix.data == [234, 231, 222, 47, 209, 237, 138, 64],
            ClearingError::MarketCheckpoint
        );
        let key = ix.accounts.get(2).ok_or(ClearingError::MarketCheckpoint)?;
        let member = required.iter_mut().find(|value| value.as_ref().is_some_and(|market| market.as_ref() == key.pubkey.as_ref()))
            .ok_or(ClearingError::MarketCheckpoint)?;
        *member = None;
    }
    Ok(())
}
