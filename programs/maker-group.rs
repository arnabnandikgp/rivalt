// Included by each first-party maker. V2 capital is explicitly isolated to one market.
use clearing::state::v2::{ClearingGroupV2, GroupMarketV2, MarginAccountV2, MODE_ISOLATED, ROLE_MAKER};

#[account]
#[derive(InitSpace)]
pub struct MakerGroupConfig {
    pub group: Pubkey,
    pub state: MakerState,
}

#[derive(Accounts)]
pub struct InitializeGroupConfig<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"group-v2", &group.domain], bump = group.bump, seeds::program = CLEARING_ID)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(seeds = [b"market-v2", group.key().as_ref(), &[market.index]], bump = market.bump,
        seeds::program = CLEARING_ID, constraint = market.group == group.key() @ MakerError::Binding)]
    pub market: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"margin-v2", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, seeds::program = CLEARING_ID,
        constraint = capital.owner == owner.key() @ MakerError::Authority,
        constraint = capital.group == group.key() @ MakerError::Binding)]
    pub capital: Box<Account<'info, MarginAccountV2>>,
    #[account(init, payer = owner, space = 8 + MakerGroupConfig::INIT_SPACE,
        seeds = [b"maker-v2", capital.key().as_ref()], bump)]
    pub config: Account<'info, MakerGroupConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PublishGroup<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"maker-v2", config.state.capital.as_ref()], bump = config.state.bump,
        constraint = config.state.owner == owner.key() @ MakerError::Authority)]
    pub config: Account<'info, MakerGroupConfig>,
}

#[derive(Accounts)]
pub struct ReadGroupQuote<'info> {
    #[account(seeds = [b"maker-v2", config.state.capital.as_ref()], bump = config.state.bump)]
    pub config: Account<'info, MakerGroupConfig>,
}

fn group_profile() -> Result<()> {
    require!(cfg!(feature = "successor-test-profile"), MakerError::Binding);
    Ok(())
}

fn initialize_group(context: Context<InitializeGroupConfig>, duration: u64) -> Result<()> {
    group_profile()?;
    require!(context.remaining_accounts.is_empty(), MakerError::Binding);
    let group = &context.accounts.group;
    let market = &context.accounts.market;
    let capital = &context.accounts.capital;
    require!(group.schema_version == 2 && group.profile_version == 2 && group.market_count == 2
        && group.mode <= 1 && !group.paused && market.schema_version == 2 && market.index < 2
        && group.markets[usize::from(market.index)] == market.key()
        && capital.schema_version == 2 && capital.mode == MODE_ISOLATED && capital.role == ROLE_MAKER
        && capital.isolated_market_index == market.index, MakerError::Binding);
    let slot = Clock::get()?.slot;
    context.accounts.config.group = group.key();
    context.accounts.config.state = MakerState {
        version: maker_interface::GROUP_VERSION, maker_id: MAKER_ID,
        owner: context.accounts.owner.key(), market: market.key(), capital: capital.key(),
        domain: group.domain, quote_epoch: 1, start_slot: slot,
        expiry_slot: expiry(slot, duration)?, bump: context.bumps.config,
    };
    Ok(())
}

fn publish_group(context: Context<PublishGroup>, duration: u64) -> Result<()> {
    group_profile()?;
    require!(context.remaining_accounts.is_empty(), MakerError::Binding);
    let slot = Clock::get()?.slot;
    let state = &mut context.accounts.config.state;
    require!(state.version == maker_interface::GROUP_VERSION && slot >= state.expiry_slot, MakerError::Lifetime);
    state.quote_epoch = state.quote_epoch.checked_add(1).ok_or(MakerError::Lifetime)?;
    state.start_slot = slot;
    state.expiry_slot = expiry(slot, duration)?;
    Ok(())
}

fn read_group_quote(context: Context<ReadGroupQuote>, mut request: maker_interface::GroupQuoteRequest) -> Result<QuoteResponse> {
    group_profile()?;
    require!(context.remaining_accounts.is_empty() && !context.accounts.config.to_account_info().is_writable
        && context.accounts.config.state.maker_id == MAKER_ID, MakerError::Binding);
    request.quote.slot = Clock::get()?.slot;
    maker_interface::group_quote(context.accounts.config.group, &context.accounts.config.state, &request)
        .map_err(|_| error!(MakerError::Quote))
}
