// Included by each first-party maker. V3 capital is explicitly isolated to one market.
use clearing::state::accounts::{MarginAccount, Market, VenueSafety, Venue};

#[account]
#[derive(InitSpace)]
pub struct MakerAccountConfig {
    pub venue: Pubkey,
    pub state: MakerState,
}

#[derive(Accounts)]
pub struct InitializeAccountConfig<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, seeds::program = CLEARING_ID)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, seeds::program = CLEARING_ID,
        constraint = safety.venue == venue.key() @ MakerError::Binding)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump,
        seeds::program = CLEARING_ID, constraint = market.venue == venue.key() @ MakerError::Binding)]
    pub market: Box<Account<'info, Market>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, seeds::program = CLEARING_ID,
        constraint = capital.owner == owner.key() @ MakerError::Authority,
        constraint = capital.venue == venue.key() @ MakerError::Binding)]
    pub capital: Box<Account<'info, MarginAccount>>,
    #[account(init, payer = owner, space = 8 + MakerAccountConfig::INIT_SPACE,
        seeds = [b"maker-v3", capital.key().as_ref()], bump)]
    pub config: Account<'info, MakerAccountConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PublishAccount<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"maker-v3", config.state.capital.as_ref()], bump = config.state.bump,
        constraint = config.state.owner == owner.key() @ MakerError::Authority)]
    pub config: Account<'info, MakerAccountConfig>,
}

#[derive(Accounts)]
pub struct ReadAccountQuote<'info> {
    #[account(seeds = [b"maker-v3", config.state.capital.as_ref()], bump = config.state.bump)]
    pub config: Account<'info, MakerAccountConfig>,
}

fn venue_profile() -> Result<()> {
    require!(
        cfg!(feature = "account-trading-qualification"),
        MakerError::Binding
    );
    Ok(())
}

fn initialize_account(context: Context<InitializeAccountConfig>, duration: u64) -> Result<()> {
    venue_profile()?;
    require!(context.remaining_accounts.is_empty(), MakerError::Binding);
    let venue = &context.accounts.venue;
    let market = &context.accounts.market;
    let capital = &context.accounts.capital;
    require!(
        venue.schema_version == 3
            && venue.profile_version == 3
            && venue.market_count == 2
            && context.accounts.safety.schema_version == 3
            && context.accounts.safety.mode <= 1
            && !context.accounts.safety.paused
            && market.schema_version == 3
            && market.index < 2
            && venue.markets[usize::from(market.index)] == market.key()
            && capital.schema_version == 3
            && capital.mode == MODE_ISOLATED
            && capital.role == ROLE_MAKER
            && capital.isolated_market_index == market.index,
        MakerError::Binding
    );
    let slot = Clock::get()?.slot;
    context.accounts.config.venue = venue.key();
    context.accounts.config.state = MakerState {
        version: maker_interface::ACCOUNT_VERSION,
        maker_id: MAKER_ID,
        owner: context.accounts.owner.key(),
        market: market.key(),
        capital: capital.key(),
        domain: venue.domain,
        quote_epoch: 1,
        start_slot: slot,
        expiry_slot: expiry(slot, duration)?,
        bump: context.bumps.config,
    };
    Ok(())
}

fn publish_account(context: Context<PublishAccount>, duration: u64) -> Result<()> {
    venue_profile()?;
    require!(context.remaining_accounts.is_empty(), MakerError::Binding);
    let slot = Clock::get()?.slot;
    let state = &mut context.accounts.config.state;
    require!(
        state.version == maker_interface::ACCOUNT_VERSION && slot >= state.expiry_slot,
        MakerError::Lifetime
    );
    state.quote_epoch = state
        .quote_epoch
        .checked_add(1)
        .ok_or(MakerError::Lifetime)?;
    state.start_slot = slot;
    state.expiry_slot = expiry(slot, duration)?;
    Ok(())
}

fn read_account_quote(
    context: Context<ReadAccountQuote>,
    mut request: maker_interface::AccountQuoteRequest,
) -> Result<QuoteResponse> {
    venue_profile()?;
    require!(
        context.remaining_accounts.is_empty()
            && !context.accounts.config.to_account_info().is_writable
            && context.accounts.config.state.maker_id == MAKER_ID,
        MakerError::Binding
    );
    request.quote.slot = Clock::get()?.slot;
    maker_interface::account_quote(
        context.accounts.config.venue,
        &context.accounts.config.state,
        &request,
    )
    .map_err(|_| error!(MakerError::Quote))
}
