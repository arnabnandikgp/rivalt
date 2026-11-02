use super::*;
use crate::{ProgramData, UpgradeableProgramAddress};

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeLiquidity {
    #[account(mut)]
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"market-v3", venue.address().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<BorshAccount<Market>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(init, payer = authority, space = 8 + LiquidityRegistry::INIT_SPACE,
        seeds = [b"liquidity-v4", market.address().as_ref()], bump)]
    pub registry: Box<BorshAccount<LiquidityRegistry>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(instance: u8)]
pub struct RegisterLiquidity {
    #[account(mut)]
    pub owner: Signer,
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(seeds = [b"market-v3", venue.address().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<BorshAccount<Market>>,
    #[account(mut, seeds = [b"liquidity-v4", market.address().as_ref()], bump = registry.bump, has_one = venue, has_one = market)]
    pub registry: Box<BorshAccount<LiquidityRegistry>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, has_one = venue, has_one = owner)]
    pub capital: Box<BorshAccount<MarginAccount>>,
    #[account(init, payer = owner, space = 8 + MakerRegistration::INIT_SPACE,
        seeds = [b"maker-v4", market.address().as_ref(), &[instance]], bump)]
    pub registration: Box<BorshAccount<MakerRegistration>>,
    #[account(init, payer = owner, space = 8 + CapitalBinding::INIT_SPACE,
        seeds = [b"capital-v3", capital.address().as_ref()], bump)]
    pub capital_binding: Box<BorshAccount<CapitalBinding>>,
    /// CHECK: exact maker owner, discriminator, size, PDA and identity checked below.
    pub config: UncheckedAccount,
    /// CHECK: exact maker owner, discriminator, size, PDA and binding checked below.
    pub price: UncheckedAccount,
    /// CHECK: executable identity is bound to its loader metadata and approved hash.
    #[account(executable)]
    pub pricing_program: UncheckedAccount,
    #[account(constraint = pricing_program.programdata_address()? == Some(program_data.address().to_owned()) @ ClearingError::MakerBinding)]
    pub program_data: Box<BorshAccount<ProgramData>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SealLiquidity {
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"market-v3", venue.address().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<BorshAccount<Market>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"liquidity-v4", market.address().as_ref()], bump = registry.bump, has_one = venue, has_one = market)]
    pub registry: Box<BorshAccount<LiquidityRegistry>>,
    #[account(address = registry.registrations[0] @ ClearingError::MakerBinding)]
    pub first: Box<BorshAccount<MakerRegistration>>,
    #[account(address = registry.registrations[1] @ ClearingError::MakerBinding)]
    pub second: Box<BorshAccount<MakerRegistration>>,
    #[account(address = registry.registrations[2] @ ClearingError::MakerBinding)]
    pub third: Box<BorshAccount<MakerRegistration>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ControlLiquidity {
    pub actor: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.address().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<BorshAccount<Market>>,
    #[account(mut, seeds = [b"maker-v4", market.address().as_ref(), &[registration.instance]], bump = registration.bump,
        has_one = venue, has_one = market, has_one = capital, has_one = config, has_one = price,
        has_one = pricing_program, has_one = program_data)]
    pub registration: Box<BorshAccount<MakerRegistration>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, has_one = venue)]
    pub capital: Box<BorshAccount<MarginAccount>>,
    /// CHECK: authenticated fixed config; only this writable account goes to maker CPI.
    #[account(mut)]
    pub config: UncheckedAccount,
    /// CHECK: authenticated fixed read-only price.
    pub price: UncheckedAccount,
    /// CHECK: executable identity is bound to its loader metadata and approved hash.
    #[account(executable)]
    pub pricing_program: UncheckedAccount,
    #[account(constraint = pricing_program.programdata_address()? == Some(program_data.address().to_owned()) @ ClearingError::MakerBinding)]
    pub program_data: Box<BorshAccount<ProgramData>>,
    /// CHECK: dedicated noncustodial signer, canonical seeds and bump below.
    #[account(seeds = [b"liquidity-control-v4", venue.address().as_ref(), capital.address().as_ref()], bump)]
    pub controller: UncheckedAccount,
    /// CHECK: canonical maker event-CPI authority, not a pricing dependency.
    #[account(seeds = [b"__event_authority"], bump, seeds::program = pricing_program.address().to_owned())]
    pub maker_event_authority: UncheckedAccount,
    /// Required only for joint code approval. Never passed to maker CPI.
    pub co_signer: Option<Signer>,
}

/// Safety quarantine must remain possible after a maker closes/upgrades/corrupts
/// its own dependencies. It invokes no maker code and loads no maker-owned state.
#[event_cpi]
#[derive(Accounts)]
pub struct QuarantineLiquidity {
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.address().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<BorshAccount<Market>>,
    #[account(mut, seeds = [b"maker-v4", market.address().as_ref(), &[registration.instance]], bump = registration.bump,
        has_one = venue, has_one = market, has_one = capital)]
    pub registration: Box<BorshAccount<MakerRegistration>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, has_one = venue)]
    pub capital: Box<BorshAccount<MarginAccount>>,
}
