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
#[cfg(all(feature = "read-only-route-market",not(feature = "read-only-route-ledger")))]
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

/// Both checkpoint instructions authenticate three registrations and update
/// only their own market or ledger. A contiguous block can cover the complete
/// set in any order. No mutation may intervene before financial consumption.
#[cfg(feature = "read-only-route-ledger")]
pub(crate) fn require_financial_checkpoints(instruction: [u8;8], entries: impl Iterator<Item=(u8,Address)>) -> Result<()> {
    const MARKET: [u8;8]=[234,231,222,47,209,237,138,64];
    const LEDGER: [u8;8]=[119,160,87,122,107,187,203,113];
    const MARKET_LANE: [u8;8]=[154,97,38,114,234,143,70,85];
    // Binding reads only the two immutable collateral feed addresses. It never
    // consumes market totals, funding or fees and does not write the market.
    const BIND_LISTING_INDEX: [u8;8]=[130,194,213,225,127,24,57,109];
    let mut required=[None;4];
    let mut count=0;
    for (kind,address) in entries {
        let needs_market=kind==6 && instruction!=MARKET && instruction!=MARKET_LANE && instruction!=BIND_LISTING_INDEX;
        let needs_ledger=kind==7 && instruction!=LEDGER;
        if needs_market||needs_ledger {
            require!(count<required.len(),ClearingError::Profile);
            required[count]=Some((kind,address));count+=1;
        }
    }
    for prior in 0..count {
        let ix=solana_instruction::syscalls::get_processed_sibling_instruction(prior).ok_or(ClearingError::MarketCheckpoint)?;
        require!(ix.program_id.as_ref()==crate::ID.as_ref(),ClearingError::MarketCheckpoint);
        let kind=if ix.data==MARKET {6} else if ix.data==LEDGER {7} else {return Err(ClearingError::MarketCheckpoint.into());};
        let key=ix.accounts.get(2).ok_or(ClearingError::MarketCheckpoint)?;
        let entry=required.iter_mut().find(|entry| entry.is_some_and(|(expected,address)| expected==kind && address.as_ref()==key.pubkey.as_ref()))
            .ok_or(ClearingError::MarketCheckpoint)?;
        *entry=None;
    }
    Ok(())
}
