//! Authenticated local source initialization and current account action policy.
use super::*;

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeAccountOracle {
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"custody-v3", venue.address().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.address().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<BorshAccount<Market>>,
}

pub(crate) fn feed_indexes(market: u8) -> Result<[usize; 4]> {
    match market {
        0 => Ok([0, 1, 2, 3]),
        1 => Ok([4, 1, 5, 3]),
        _ => Err(ProgramError::from(ClearingError::OracleSource)),
    }
}

fn event(
    venue: &BorshAccount<Venue>,
    market: &mut BorshAccount<Market>,
) -> Result<crate::events::AccountOracleChanged> {
    increment(&mut market.observation_sequence)?;
    Ok(crate::events::AccountOracleChanged {
        venue: venue.address().to_owned(),

        slot: Clock::get()?.slot,
        market: market.address().to_owned(),
        state: crate::events::MarketSnapshot::from(&**market),
    })
}

/// Same source authority/state contract; profile-specific callers own activation
/// gates. This does not admit profile4 to the legacy two-maker sampler.
pub(crate) fn initialize_accounts(
    ctx: &mut Context<InitializeAccountOracle>,
    events: &mut crate::event_cpi::Payloads,
    primary: Address,
    guard: Address,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(
        ctx.accounts.safety.mode == CUSTODY
            && market.oracle.sources == [Address::default(); 4]
            && primary != guard
            && primary != Address::default()
            && guard != Address::default(),
        ClearingError::OracleSource
    );
    for (position, feed) in feed_indexes(market.index)?.into_iter().enumerate() {
        let authority = if position < 2 { primary } else { guard };
        market.oracle.sources[position] = find_program_address(
            &[b"feed", authority.as_ref(), &[feed as u8 + 1; 32]],
            &oracle_fixture::ID,
        )
        .0;
    }
    market.config_epoch = market
        .config_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    events.emit(
        &(event(&ctx.accounts.venue, market)?),
        ctx.accounts.event_authority.account().clone(),
    )?;
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
