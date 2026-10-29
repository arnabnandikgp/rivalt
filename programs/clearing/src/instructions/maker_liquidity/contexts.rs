use super::*;

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeLiquidityV4<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(init, payer = authority, space = 8 + LiquidityRegistryV4::INIT_SPACE,
        seeds = [b"liquidity-v4", market.key().as_ref()], bump)]
    pub registry: Box<Account<'info, LiquidityRegistryV4>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(instance: u8)]
pub struct RegisterLiquidityV4<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(mut, seeds = [b"liquidity-v4", market.key().as_ref()], bump = registry.bump, has_one = venue, has_one = market)]
    pub registry: Box<Account<'info, LiquidityRegistryV4>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, has_one = venue, has_one = owner)]
    pub capital: Box<Account<'info, MarginAccountV3>>,
    #[account(init, payer = owner, space = 8 + MakerRegistrationV4::INIT_SPACE,
        seeds = [b"maker-v4", market.key().as_ref(), &[instance]], bump)]
    pub registration: Box<Account<'info, MakerRegistrationV4>>,
    #[account(init, payer = owner, space = 8 + CapitalBindingV3::INIT_SPACE,
        seeds = [b"capital-v3", capital.key().as_ref()], bump)]
    pub capital_binding: Box<Account<'info, CapitalBindingV3>>,
    /// CHECK: exact maker owner, discriminator, size, PDA and identity checked below.
    pub config: UncheckedAccount<'info>,
    /// CHECK: exact maker owner, discriminator, size, PDA and binding checked below.
    pub price: UncheckedAccount<'info>,
    pub pricing_program: Program<'info>,
    #[account(constraint = pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub program_data: Box<Account<'info, ProgramData>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SealLiquidityV4<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"liquidity-v4", market.key().as_ref()], bump = registry.bump, has_one = venue, has_one = market)]
    pub registry: Box<Account<'info, LiquidityRegistryV4>>,
    #[account(address = registry.registrations[0] @ ClearingError::MakerBinding)]
    pub first: Box<Account<'info, MakerRegistrationV4>>,
    #[account(address = registry.registrations[1] @ ClearingError::MakerBinding)]
    pub second: Box<Account<'info, MakerRegistrationV4>>,
    #[account(address = registry.registrations[2] @ ClearingError::MakerBinding)]
    pub third: Box<Account<'info, MakerRegistrationV4>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ControlLiquidityV4<'info> {
    pub actor: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(mut, seeds = [b"maker-v4", market.key().as_ref(), &[registration.instance]], bump = registration.bump,
        has_one = venue, has_one = market, has_one = capital, has_one = config, has_one = price,
        has_one = pricing_program, has_one = program_data)]
    pub registration: Box<Account<'info, MakerRegistrationV4>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, has_one = venue)]
    pub capital: Box<Account<'info, MarginAccountV3>>,
    /// CHECK: authenticated fixed config; only this writable account goes to maker CPI.
    #[account(mut)]
    pub config: UncheckedAccount<'info>,
    /// CHECK: authenticated fixed read-only price.
    pub price: UncheckedAccount<'info>,
    pub pricing_program: Program<'info>,
    #[account(constraint = pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: dedicated noncustodial signer, canonical seeds and bump below.
    #[account(seeds = [b"liquidity-control-v4", venue.key().as_ref(), capital.key().as_ref()], bump)]
    pub controller: UncheckedAccount<'info>,
    /// CHECK: canonical maker event-CPI authority, not a pricing dependency.
    #[account(seeds = [b"__event_authority"], bump, seeds::program = pricing_program.key())]
    pub maker_event_authority: UncheckedAccount<'info>,
    /// Required only for joint code approval. Never passed to maker CPI.
    pub co_signer: Option<Signer<'info>>,
}

/// Safety quarantine must remain possible after a maker closes/upgrades/corrupts
/// its own dependencies. It invokes no maker code and loads no maker-owned state.
#[event_cpi]
#[derive(Accounts)]
pub struct QuarantineLiquidityV4<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(mut, seeds = [b"maker-v4", market.key().as_ref(), &[registration.instance]], bump = registration.bump,
        has_one = venue, has_one = market, has_one = capital)]
    pub registration: Box<Account<'info, MakerRegistrationV4>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, has_one = venue)]
    pub capital: Box<Account<'info, MarginAccountV3>>,
}
