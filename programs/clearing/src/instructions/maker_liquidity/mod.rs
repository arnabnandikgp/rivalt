//! Fresh profile-4 maker lifecycle. P30 permits custody/configuration only; all
//! active trading/funding/default integration remains disabled until P32 acceptance.
use super::account_custody::increment;
use crate::constants::makers::{MAKER_A, MAKER_B};
use crate::state::liquidity::{LiquidityRegistryPayload, MakerRegistrationPayload};
use crate::{
    error::ClearingError,
    events::*,
    state::{
        accounts::*,
        liquidity::{LiquidityRegistry, MakerRegistration},
    },
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use maker_interface::canonical::{self, CurveControl, CurveState, PriceState};
use solana_sha256_hasher::hash;

mod contexts;
pub use contexts::*;
mod validation;
pub(crate) use validation::*;
pub(crate) mod pricing;
// Retain the pre-D74 projection/full-execution comparisons as regression tests;
// the published-liquidity sampler does not compile or invoke these checks.
#[cfg(test)]
pub(crate) mod admission;
pub(crate) mod funding;
pub mod publisher;
#[cfg(test)]
mod reservations;
pub mod routes;
pub mod sampling;

#[cfg(test)]
mod tests;

fn registry_event(
    venue: Address,
    registry: &BorshAccount<LiquidityRegistry>,
) -> Result<LiquidityRegistryChanged> {
    Ok(LiquidityRegistryChanged {
        venue,

        slot: Clock::get()?.slot,
        registry: registry.address().to_owned(),
        state: LiquidityRegistryPayload::from(&**registry),
    })
}

fn maker_event(
    venue: Address,
    market: &BorshAccount<Market>,
    registration: &BorshAccount<MakerRegistration>,
    operation: u8,
) -> Result<LiquidityMakerChanged> {
    Ok(LiquidityMakerChanged {
        venue,

        slot: Clock::get()?.slot,
        market: market.address().to_owned(),
        market_state: MarketSnapshot::from(&**market),
        registration: registration.address().to_owned(),
        state: MakerRegistrationPayload::from(&**registration),
        operation,
    })
}

fn truncate_funding(mode: u8, market: &mut BorshAccount<Market>) -> Result<()> {
    if cfg!(feature = "liquidity-execution-qualification") {
        let mut next = funding::control_candidate(mode, market, &Clock::get()?)?;
        increment(&mut next.observation_sequence)?;
        **market = next;
    }
    Ok(())
}

pub fn initialize(
    ctx: &mut Context<InitializeLiquidity>,
    events: &mut crate::event_cpi::Payloads,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(remaining_accounts.is_empty(), ClearingError::Profile);
    custody_only(
        &ctx.accounts.venue,
        &ctx.accounts.safety,
        &ctx.accounts.market,
    )?;
    **ctx.accounts.registry = LiquidityRegistry {
        revision: 0,
        schema_version: 8,
        venue: ctx.accounts.venue.address().to_owned(),
        market: ctx.accounts.market.address().to_owned(),
        count: 0,
        sealed: false,
        registrations: [Address::default(); 3],
        bump: ctx.bumps.registry,
    };
    let emitted_registry = registry_event(
        ctx.accounts.venue.address().to_owned(),
        &ctx.accounts.registry,
    )?;
    events.emit(
        &emitted_registry,
        ctx.accounts.event_authority.account().clone(),
    )?;
    Ok(())
}

// Keep the full decoded curve out of the registration/event frame on SBF.
#[inline(never)]
fn validate_registration(accounts: &RegisterLiquidity, instance: u8) -> Result<()> {
    custody_only(&accounts.venue, &accounts.safety, &accounts.market)?;
    require!(
        accounts.registry.schema_version == 8
            && !accounts.registry.sealed
            && instance < 3
            && instance == accounts.registry.count,
        ClearingError::MakerBinding
    );
    capital_identity(&accounts.capital, &accounts.market)?;
    require!(accounts.capital.cash > 0, ClearingError::MakerCapital);
    let (config, _) = config_and_price(
        &accounts.config,
        &accounts.price,
        accounts.pricing_program.address().to_owned(),
        instance,
        &accounts.venue,
        &accounts.market,
        &accounts.capital,
    )?;
    require!(
        !accounts.config.is_writable() && !accounts.price.is_writable(),
        ClearingError::MakerBinding
    );
    require_keys_eq!(
        config.owner,
        accounts.owner.address().to_owned(),
        ClearingError::Authority
    );
    Ok(())
}

pub fn register(
    ctx: &mut Context<RegisterLiquidity>,
    events: &mut crate::event_cpi::Payloads,
    instance: u8,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    validate_registration(accounts, instance)?;
    **accounts.registration = MakerRegistration {
        revision: 0,
        schema_version: 8,
        venue: accounts.venue.address().to_owned(),
        market: accounts.market.address().to_owned(),
        capital: accounts.capital.address().to_owned(),
        owner: accounts.owner.address().to_owned(),
        pricing_program: accounts.pricing_program.address().to_owned(),
        program_data: accounts.program_data.address().to_owned(),
        config: accounts.config.address().to_owned(),
        price: accounts.price.address().to_owned(),
        approved_hash: module_hash(&accounts.program_data)?,
        instance,
        authority_epoch: 1,
        depth_epoch: 1,
        buy_consumed: 0,
        sell_consumed: 0,
        quarantined: false,
        bump: ctx.bumps.registration,
    };
    **accounts.capital_binding = CapitalBinding {
        revision: 0,
        schema_version: SCHEMA_VERSION,
        venue: accounts.venue.address().to_owned(),
        capital: accounts.capital.address().to_owned(),
        registration: accounts.registration.address().to_owned(),
    };
    accounts.registry.registrations[usize::from(instance)] =
        accounts.registration.address().to_owned();
    accounts.registry.count = accounts
        .registry
        .count
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    let emitted_maker = maker_event(
        accounts.venue.address().to_owned(),
        &accounts.market,
        &accounts.registration,
        0,
    )?;
    let emitted_registry = registry_event(accounts.venue.address().to_owned(), &accounts.registry)?;
    events.emit(
        &emitted_maker,
        ctx.accounts.event_authority.account().clone(),
    )?;
    events.emit(
        &emitted_registry,
        ctx.accounts.event_authority.account().clone(),
    )?;
    Ok(())
}

pub fn seal(
    ctx: &mut Context<SealLiquidity>,
    events: &mut crate::event_cpi::Payloads,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    custody_only(&accounts.venue, &accounts.safety, &accounts.market)?;
    require!(
        accounts.registry.schema_version == 8
            && accounts.registry.count == 3
            && !accounts.registry.sealed,
        ClearingError::MakerBinding
    );
    let makers = [&accounts.first, &accounts.second, &accounts.third];
    for (index, registration) in makers.iter().enumerate() {
        require!(
            registration.schema_version == 8
                && usize::from(registration.instance) == index
                && registration.venue == accounts.venue.address().to_owned()
                && registration.market == accounts.market.address().to_owned(),
            ClearingError::MakerBinding
        );
        for previous in makers.iter().take(index) {
            require_keys_neq!(registration.capital, previous.capital, ClearingError::Alias);
        }
    }
    // Three instances and two admitted programs necessarily share an implementation.
    require!(
        makers.iter().any(|maker| maker.pricing_program == MAKER_A)
            && makers.iter().any(|maker| maker.pricing_program == MAKER_B),
        ClearingError::MakerBinding
    );
    accounts.registry.sealed = true;
    let emitted_registry = registry_event(accounts.venue.address().to_owned(), &accounts.registry)?;
    events.emit(
        &emitted_registry,
        ctx.accounts.event_authority.account().clone(),
    )?;
    Ok(())
}

fn control_cpi(
    accounts: &mut ControlLiquidity,
    config: &CurveState,
    action: CurveControl,
    bump: u8,
) -> Result<()> {
    let expected = canonical::control(
        config,
        config.control_epoch,
        config.shape_epoch,
        action.clone(),
        Clock::get()?.slot,
    )
    .map_err(|_| ProgramError::from(ClearingError::MakerBinding))?;
    let mut data = hash(b"global:control_curve").to_bytes()[..8].to_vec();
    crate::wire::write(&config.control_epoch, &mut data)?;
    crate::wire::write(&config.shape_epoch, &mut data)?;
    crate::wire::write(&action, &mut data)?;
    let venue_key = accounts.venue.address().to_owned();
    let capital_key = accounts.capital.address().to_owned();
    let seeds: &[&[u8]] = &[
        b"liquidity-control-v4",
        venue_key.as_ref(),
        capital_key.as_ref(),
        &[bump],
    ];
    invoke_signed(
        &Instruction {
            program_id: accounts.pricing_program.address().to_owned(),
            accounts: vec![
                AccountMeta::new_readonly(accounts.controller.address().to_owned(), true),
                AccountMeta::new(accounts.config.address().to_owned(), false),
                AccountMeta::new_readonly(accounts.price.address().to_owned(), false),
                AccountMeta::new_readonly(
                    accounts.maker_event_authority.address().to_owned(),
                    false,
                ),
                AccountMeta::new_readonly(accounts.pricing_program.address().to_owned(), false),
            ],
            data,
        },
        &[
            accounts.controller.cpi_handle(),
            accounts.config.try_cpi_handle_mut()?.into(),
            accounts.price.cpi_handle(),
            accounts.maker_event_authority.cpi_handle(),
            accounts.pricing_program.cpi_handle(),
        ],
        &[seeds],
    )?;
    verify_control_result(
        &accounts.config,
        accounts.pricing_program.address().to_owned(),
        &expected,
    )
}

pub fn control(
    ctx: &mut Context<ControlLiquidity>,
    events: &mut crate::event_cpi::Payloads,
    authority: u64,
    expected_control: u64,
    expected_shape: u64,
    action: CurveControl,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    let config = authenticated_control(accounts, authority, true)?;
    require_keys_eq!(
        accounts.actor.address().to_owned(),
        accounts.registration.owner,
        ClearingError::Authority
    );
    require!(
        accounts.co_signer.is_none()
            && action.operation() < 3
            && config.control_epoch == expected_control
            && config.shape_epoch == expected_shape,
        ClearingError::MakerEpoch
    );
    let operation = action.operation() + 1;
    truncate_funding(accounts.safety.mode, &mut accounts.market)?;
    control_cpi(accounts, &config, action, ctx.bumps.controller)?;
    let emitted_maker = maker_event(
        accounts.venue.address().to_owned(),
        &accounts.market,
        &accounts.registration,
        operation,
    )?;
    events.emit(
        &emitted_maker,
        ctx.accounts.event_authority.account().clone(),
    )?;
    Ok(())
}

pub fn replenish(
    ctx: &mut Context<ControlLiquidity>,
    events: &mut crate::event_cpi::Payloads,
    authority: u64,
    expected_depth: u64,
    sides: u8,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    let config = authenticated_control(accounts, authority, true)?;
    require_keys_eq!(
        accounts.actor.address().to_owned(),
        accounts.registration.owner,
        ClearingError::Authority
    );
    require!(
        accounts.co_signer.is_none()
            && (1..=3).contains(&sides)
            && config.shape.mode != 0
            && !accounts.registration.quarantined
            && accounts.registration.depth_epoch == expected_depth,
        ClearingError::MakerEpoch
    );
    truncate_funding(accounts.safety.mode, &mut accounts.market)?;
    increment(&mut accounts.registration.depth_epoch)?;
    if sides & 1 != 0 {
        accounts.registration.buy_consumed = 0;
    }
    if sides & 2 != 0 {
        accounts.registration.sell_consumed = 0;
    }
    let emitted_maker = maker_event(
        accounts.venue.address().to_owned(),
        &accounts.market,
        &accounts.registration,
        4,
    )?;
    events.emit(
        &emitted_maker,
        ctx.accounts.event_authority.account().clone(),
    )?;
    Ok(())
}

pub fn quarantine(
    ctx: &mut Context<QuarantineLiquidity>,
    events: &mut crate::event_cpi::Payloads,
    authority: u64,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    control_base(&accounts.venue, &accounts.safety, &accounts.market)?;
    capital_identity(&accounts.capital, &accounts.market)?;
    require!(
        accounts.registration.schema_version == 8
            && accounts.registration.authority_epoch == authority
            && authority > 0
            && accounts.registration.owner == accounts.capital.owner,
        ClearingError::MakerBinding
    );
    truncate_funding(accounts.safety.mode, &mut accounts.market)?;
    increment(&mut accounts.registration.authority_epoch)?;
    accounts.registration.quarantined = true;
    let emitted = maker_event(
        accounts.venue.address().to_owned(),
        &accounts.market,
        &accounts.registration,
        5,
    )?;
    events.emit(&emitted, ctx.accounts.event_authority.account().clone())?;
    Ok(())
}

pub fn approve(
    ctx: &mut Context<ControlLiquidity>,
    events: &mut crate::event_cpi::Payloads,
    authority: u64,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    let config = authenticated_control(accounts, authority, false)?;
    require_keys_eq!(
        accounts.actor.address().to_owned(),
        accounts.registration.owner,
        ClearingError::Authority
    );
    require!(
        accounts
            .co_signer
            .as_ref()
            .is_some_and(|signer| signer.address().to_owned() == accounts.venue.authority),
        ClearingError::Authority
    );
    let approved_hash = module_hash(&accounts.program_data)?;
    truncate_funding(accounts.safety.mode, &mut accounts.market)?;
    control_cpi(
        accounts,
        &config,
        CurveControl::Invalidate,
        ctx.bumps.controller,
    )?;
    increment(&mut accounts.registration.authority_epoch)?;
    accounts.registration.approved_hash = approved_hash;
    accounts.registration.quarantined = false;
    let emitted_maker = maker_event(
        accounts.venue.address().to_owned(),
        &accounts.market,
        &accounts.registration,
        6,
    )?;
    events.emit(
        &emitted_maker,
        ctx.accounts.event_authority.account().clone(),
    )?;
    Ok(())
}
