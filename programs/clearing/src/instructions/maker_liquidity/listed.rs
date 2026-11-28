//! Bind one funded maker to an inactive listing. The binding survives cash withdrawals.
use super::*;
use crate::{ProgramData, UpgradeableProgramAddress};

#[event_cpi]
#[derive(Accounts)]
#[instruction(instance: u8)]
pub struct AdmitListedMaker {
    #[account(mut)]
    pub owner: Signer,
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(seeds = [b"market-listing", venue.address().as_ref(), &listing.market_id.to_le_bytes()],
        bump = listing.bump, has_one = venue)]
    pub listing: Box<BorshAccount<MarketListing>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, has_one = venue, has_one = owner)]
    pub capital: Box<BorshAccount<MarginAccount>>,
    #[account(init, payer = owner, space = 8 + MakerRegistration::INIT_SPACE + crate::market_fees::LANE_EXTRA,
        seeds = [b"maker-v4", listing.address().as_ref(), &[instance]], bump)]
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

pub fn admit(
    ctx: &mut Context<AdmitListedMaker>,
    events: &mut crate::event_cpi::Payloads,
    instance: u8,
) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    crate::instructions::account_trading::base_identity(&accounts.venue, &accounts.safety)?;
    require!(!accounts.safety.paused, ClearingError::Paused);
    require!(
        accounts.listing.schema_version == LISTING_SCHEMA
            && accounts.listing.status == LISTING_INACTIVE
            && usize::from(accounts.listing.market_id) >= MARKET_COUNT
            && accounts.listing.quote_mint == accounts.venue.quote_mint,
        ClearingError::Profile
    );
    crate::engine::account::model(&accounts.capital)?;
    require!(
        accounts.capital.mode == MODE_ISOLATED
            && accounts.capital.role == ROLE_MAKER
            && accounts.capital.isolated_market_index == LISTED_CAPITAL_TAG
            && accounts.capital.cash > 0,
        ClearingError::MakerCapital
    );
    require!(!accounts.config.is_writable(), ClearingError::MakerBinding);
    validate_curve(accounts, instance)?;
    initialize_registration(
        &mut accounts.registration,
        &mut accounts.capital_binding,
        *accounts.venue.address(),
        *accounts.listing.address(),
        &accounts.capital,
        *accounts.pricing_program.address(),
        &accounts.program_data,
        *accounts.config.address(),
        *accounts.price.address(),
        instance,
        ctx.bumps.registration,
    )?;
    events.emit(
        &ListedMakerAdmitted {
            venue: *accounts.venue.address(),
            slot: Clock::get()?.slot,
            registration: *accounts.registration.address(),
            capital_binding: *accounts.capital_binding.address(),
            state: MakerRegistrationPayload::from(&**accounts.registration),
        },
        accounts.event_authority.account().clone(),
    )
}

#[inline(never)]
fn validate_curve(accounts: &AdmitListedMaker, instance: u8) -> Result<()> {
    config_and_price(
        &accounts.config,
        &accounts.price,
        *accounts.pricing_program.address(),
        instance,
        &accounts.venue,
        *accounts.listing.address(),
        &accounts.capital,
    )?;
    Ok(())
}
