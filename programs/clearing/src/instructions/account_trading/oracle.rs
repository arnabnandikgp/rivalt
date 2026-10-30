//! Authenticated local source initialization and current account action policy.
use super::*;

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeAccountOracle<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<Account<'info, Market>>,
}

pub(crate) fn feed_indexes(market: u8) -> Result<[usize; 4]> {
    match market {
        0 => Ok([0, 1, 2, 3]),
        1 => Ok([4, 1, 5, 3]),
        _ => err!(ClearingError::OracleSource),
    }
}

fn event(
    venue: &Account<Venue>,
    custody: &mut Account<Custody>,
    market: &mut Account<Market>,
) -> Result<crate::events::AccountOracleChanged> {
    increment(&mut custody.sequence)?;
    increment(&mut market.observation_sequence)?;
    Ok(crate::events::AccountOracleChanged {
        venue: venue.key(),
        sequence: custody.sequence,
        slot: Clock::get()?.slot,
        market: market.key(),
        state: crate::events::MarketSnapshot::from(&**market),
    })
}

/// Same source authority/state contract; profile-specific callers own activation
/// gates. This does not admit profile4 to the legacy two-maker sampler.
pub(crate) fn initialize_accounts(
    ctx: Context<InitializeAccountOracle>,
    primary: Pubkey,
    guard: Pubkey,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(
        ctx.accounts.safety.mode == CUSTODY
            && market.oracle.sources == [Pubkey::default(); 4]
            && primary != guard
            && primary != Pubkey::default()
            && guard != Pubkey::default(),
        ClearingError::OracleSource
    );
    for (position, feed) in feed_indexes(market.index)?.into_iter().enumerate() {
        let authority = if position < 2 { primary } else { guard };
        market.oracle.sources[position] = Pubkey::find_program_address(
            &[b"feed", authority.as_ref(), &[feed as u8 + 1; 32]],
            &oracle_fixture::ID,
        )
        .0;
    }
    market.config_epoch = market
        .config_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    emit_cpi!(event(
        &ctx.accounts.venue,
        &mut ctx.accounts.custody,
        market
    )?);
    Ok(())
}

pub(crate) fn effective(mode: u8, market: &Market, clock: &Clock) -> Result<i128> {
    shared_oracle::effective(
        if mode == ACTIVE { 2 } else { 0 },
        &market_view(market)?,
        clock,
    )
}

pub(crate) fn action(market: &Market, clock: &Clock, increase: bool) -> Result<()> {
    shared_oracle::action(&market_view(market)?, clock, increase)
}
