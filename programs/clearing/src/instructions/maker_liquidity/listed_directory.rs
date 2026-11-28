//! Seal the complete registered set before a listed market can be used for funding or routing.
use super::*;
use anchor_lang::AccountDeserialize;

#[event_cpi]
#[derive(Accounts)]
pub struct SealListedLiquidity {
    #[account(mut)]
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"market-listing", venue.address().as_ref(), &listing.market_id.to_le_bytes()],
        bump = listing.bump, has_one = venue)]
    pub listing: Box<BorshAccount<MarketListing>>,
    #[account(init, payer = authority, space = 8 + LiquidityRegistry::INIT_SPACE,
        seeds = [b"liquidity-v4", listing.address().as_ref()], bump)]
    pub registry: Box<BorshAccount<LiquidityRegistry>>,
    pub system_program: Program<System>,
}

pub fn seal(
    ctx: &mut Context<SealListedLiquidity>,
    events: &mut crate::event_cpi::Payloads,
) -> Result<()> {
    let slots = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    let listing = *accounts.listing.address();
    let venue = *accounts.venue.address();
    crate::instructions::account_trading::base_identity(&accounts.venue, &accounts.safety)?;
    require!(!accounts.safety.paused, ClearingError::Paused);
    require!(
        accounts.listing.schema_version == LISTING_SCHEMA
            && accounts.listing.status == LISTING_INACTIVE
            && accounts.listing.quote_mint == accounts.venue.quote_mint
            && usize::from(accounts.listing.market_id) >= MARKET_COUNT,
        ClearingError::Profile
    );
    // Include possible vacancies. A keeper cannot choose to omit a previously admitted maker.
    require!(
        slots.len() == usize::from(canonical::REGISTRATION_LIMIT),
        ClearingError::MakerBinding
    );
    let mut keys = [Address::default(); 3];
    let mut capitals = Vec::with_capacity(slots.len());
    let mut programs = [false; 2];
    for (index, slot) in slots.iter().enumerate() {
        let instance = u8::try_from(index).map_err(|_| ClearingError::MakerBinding)?;
        let (expected, bump) =
            find_program_address(&[b"maker-v4", listing.as_ref(), &[instance]], &crate::ID);
        require!(
            slot.address() == &expected && !slot.is_writable() && !slot.executable(),
            ClearingError::MakerBinding
        );
        if slot.owner() == &anchor_lang::system_program::ID && slot.data_len() == 0 {
            continue;
        }
        require!(
            slot.owner() == &crate::ID && index == capitals.len(),
            ClearingError::MakerBinding
        );
        let maker = MakerRegistration::try_deserialize(&mut &slot.try_borrow()?[..])?;
        require!(
            maker.schema_version == SCHEMA_VERSION
                && maker.revision > 0
                && maker.bump == bump
                && maker.venue == venue
                && maker.market == listing
                && maker.instance == instance
                && !capitals.contains(&maker.capital),
            ClearingError::MakerBinding
        );
        if maker.pricing_program == MAKER_A {
            programs[0] = true;
        } else if maker.pricing_program == MAKER_B {
            programs[1] = true;
        } else {
            return Err(ClearingError::MakerBinding.into());
        }
        capitals.push(maker.capital);
        if let Some(key) = keys.get_mut(index) {
            *key = expected;
        }
    }
    require!(
        capitals.len() >= keys.len() && programs == [true; 2],
        ClearingError::MakerBinding
    );
    **accounts.registry = LiquidityRegistry {
        schema_version: SCHEMA_VERSION,
        revision: 0,
        venue,
        market: listing,
        count: u8::try_from(capitals.len()).map_err(|_| ClearingError::MakerBinding)?,
        sealed: true,
        registrations: keys,
        bump: ctx.bumps.registry,
    };
    accounts.listing.status = LISTING_MAKERS_SEALED;
    events.emit(
        &ListedLiquiditySealed {
            venue,
            slot: Clock::get()?.slot,
            listing,
            registry: *accounts.registry.address(),
            state: LiquidityRegistryPayload::from(&**accounts.registry),
        },
        accounts.event_authority.account().clone(),
    )
}
