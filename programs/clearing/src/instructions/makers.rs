//! Standing maker authorization and bounded read-only pricing.

use crate::error::ClearingError;
use crate::events::MakerChanged;
use crate::state::{CapitalBinding, MakerRegistration, MarketState, Participant};

pub use crate::constants::makers::*;

use anchor_lang::prelude::*;

use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
};

use maker_interface::{MakerState, QuoteRequest, QuoteResponse, VERSION};

use solana_sha256_hasher::hash;

#[event_cpi]
#[derive(Accounts)]
#[instruction(maker_id: u8)]
pub struct RegisterMaker<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        seeds = [b"participant", market.key().as_ref(), owner.key().as_ref()],
        bump = capital.bump,
        has_one = market,
        has_one = owner,
    )]
    pub capital: Box<Account<'info, Participant>>,
    #[account(
        init,
        payer = owner,
        space = 8 + MakerRegistration::INIT_SPACE,
        seeds = [b"maker", market.key().as_ref(), &[maker_id]],
        bump,
    )]
    pub registration: Box<Account<'info, MakerRegistration>>,
    #[account(
        init,
        payer = owner,
        space = 8 + CapitalBinding::INIT_SPACE,
        seeds = [b"maker-capital", capital.key().as_ref()],
        bump,
    )]
    pub binding: Account<'info, CapitalBinding>,
    #[account(constraint=pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub pricing_program: Program<'info>,
    pub program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: Exact owner, PDA, discriminator, length and stored bindings validated by config_state.
    pub config: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ApproveMaker<'info> {
    pub owner: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        seeds = [b"participant", market.key().as_ref(), owner.key().as_ref()],
        bump = capital.bump,
        has_one = market,
        has_one = owner,
    )]
    pub capital: Box<Account<'info, Participant>>,
    #[account(
        mut,
        seeds = [b"maker", market.key().as_ref(), &[registration.maker_id]],
        bump = registration.bump,
        has_one = market,
        has_one = capital,
        has_one = owner,
        has_one = pricing_program,
        has_one = program_data,
        has_one = config,
    )]
    pub registration: Box<Account<'info, MakerRegistration>>,
    #[account(constraint=pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub pricing_program: Program<'info>,
    pub program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: Validated by config_state before approval.
    pub config: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SyncMaker<'info> {
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        seeds = [b"participant", market.key().as_ref(), capital.owner.as_ref()],
        bump = capital.bump,
        has_one = market,
    )]
    pub capital: Box<Account<'info, Participant>>,
    #[account(
        mut,
        seeds = [b"maker", market.key().as_ref(), &[registration.maker_id]],
        bump = registration.bump,
        has_one = market,
        has_one = capital,
        has_one = pricing_program,
        has_one = program_data,
        has_one = config,
    )]
    pub registration: Box<Account<'info, MakerRegistration>>,
    #[account(constraint=pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub pricing_program: Program<'info>,
    pub program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: Validated by config_state; only an owner-signed expired-epoch publication can advance.
    pub config: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct QuarantineMaker<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"maker", market.key().as_ref(), &[registration.maker_id]],
        bump = registration.bump,
        has_one = market,
    )]
    pub registration: Box<Account<'info, MakerRegistration>>,
}

#[derive(Accounts)]
pub struct PreviewMaker<'info> {
    #[account(
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        seeds = [b"participant", market.key().as_ref(), capital.owner.as_ref()],
        bump = capital.bump,
        has_one = market,
    )]
    pub capital: Box<Account<'info, Participant>>,
    #[account(
        seeds = [b"maker", market.key().as_ref(), &[registration.maker_id]],
        bump = registration.bump,
        has_one = market,
        has_one = capital,
        has_one = pricing_program,
        has_one = program_data,
        has_one = config,
    )]
    pub registration: Box<Account<'info, MakerRegistration>>,
    #[account(constraint=pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub pricing_program: Program<'info>,
    pub program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: Validated by config_state; only this read-only account crosses maker CPI.
    pub config: UncheckedAccount<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PreviewArgs {
    pub side: u8,
    pub lots: u64,
    pub reference_price: u64,
    pub quote_epoch: u64,
    pub authority_epoch: u64,
    pub terms_epoch: u64,
    pub config_epoch: u64,
}

fn active(market: &MarketState) -> Result<()> {
    crate::custody::profile(market)?;
    require!(!market.paused, ClearingError::Paused);
    Ok(())
}

fn capital_ready(capital: &Participant) -> Result<()> {
    crate::routes::participant_model(capital)?;
    require!(capital.cash > 0, ClearingError::MakerCapital);
    Ok(())
}

pub(crate) fn config_state(
    config: &AccountInfo,
    program: Pubkey,
    maker_id: u8,
    market: &Account<MarketState>,
    capital: &Account<Participant>,
) -> Result<MakerState> {
    let expected = match maker_id {
        0 => MAKER_A,
        1 => MAKER_B,
        _ => return err!(ClearingError::MakerBinding),
    };
    require_keys_eq!(program, expected, ClearingError::MakerBinding);
    require_keys_eq!(*config.owner, program, ClearingError::MakerBinding);
    let (key, bump) = Pubkey::find_program_address(&[b"maker", capital.key().as_ref()], &program);
    require_keys_eq!(config.key(), key, ClearingError::MakerBinding);
    let bytes = config.try_borrow_data()?;
    let discriminator = hash(b"account:MakerConfig").to_bytes();
    require!(
        bytes.len() == 8 + MakerState::INIT_SPACE && bytes[..8] == discriminator[..8],
        ClearingError::MakerBinding
    );
    let state =
        MakerState::try_from_slice(&bytes[8..]).map_err(|_| error!(ClearingError::MakerBinding))?;
    require!(
        state.version == VERSION
            && state.maker_id == maker_id
            && state.domain == market.domain
            && state.market == market.key()
            && state.capital == capital.key()
            && state.owner == capital.owner
            && state.bump == bump,
        ClearingError::MakerBinding
    );
    let duration = state
        .expiry_slot
        .checked_sub(state.start_slot)
        .ok_or(ClearingError::MakerEpoch)?;
    require!(
        state.quote_epoch > 0
            && (maker_interface::MIN_EPOCH_SLOTS..=maker_interface::MAX_EPOCH_SLOTS)
                .contains(&duration),
        ClearingError::MakerEpoch
    );
    Ok(state)
}

fn module_hash(data: &Account<ProgramData>) -> Result<[u8; 32]> {
    let account = data.to_account_info();
    let bytes = account.try_borrow_data()?;
    require!(bytes.len() <= 1_048_576, ClearingError::MakerBinding);
    Ok(hash(&bytes).to_bytes())
}

fn approved(registration: &MakerRegistration, data: &Account<ProgramData>) -> Result<()> {
    require!(
        registration.version == VERSION && !registration.quarantined,
        ClearingError::MakerQuarantined
    );
    require!(
        module_hash(data)? == registration.approved_hash,
        ClearingError::MakerUpgrade
    );
    Ok(())
}

fn event(
    market: &mut Account<MarketState>,
    registration: &Account<MakerRegistration>,
    kind: u8,
) -> Result<MakerChanged> {
    market.sequence = market
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    if market.mode == 2 {
        market.config_epoch = market
            .config_epoch
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?;
    }
    Ok(MakerChanged {
        version: VERSION,
        domain: market.domain,
        market: market.key(),
        sequence: market.sequence,
        slot: Clock::get()?.slot,
        kind,
        registration: registration.key(),
        capital: registration.capital,
        maker_id: registration.maker_id,
        authority_epoch: registration.authority_epoch,
        quote_epoch: registration.quote_epoch,
        quarantined: registration.quarantined,
        approved_hash: registration.approved_hash,
        config_epoch: market.config_epoch,
    })
}

pub fn register(ctx: Context<RegisterMaker>, maker_id: u8, inventory_limit: u64) -> Result<()> {
    active(&ctx.accounts.market)?;
    capital_ready(&ctx.accounts.capital)?;
    require!(
        (1..=financial_core::MAX_LOTS as u64).contains(&inventory_limit),
        ClearingError::MakerCapital
    );
    let state = config_state(
        &ctx.accounts.config,
        ctx.accounts.pricing_program.key(),
        maker_id,
        &ctx.accounts.market,
        &ctx.accounts.capital,
    )?;
    let slot = Clock::get()?.slot;
    require!(
        slot >= state.start_slot && slot < state.expiry_slot,
        ClearingError::MakerEpoch
    );
    ctx.accounts.registration.set_inner(MakerRegistration {
        version: VERSION,
        maker_id,
        market: ctx.accounts.market.key(),
        capital: ctx.accounts.capital.key(),
        owner: ctx.accounts.owner.key(),
        pricing_program: ctx.accounts.pricing_program.key(),
        program_data: ctx.accounts.program_data.key(),
        config: ctx.accounts.config.key(),
        approved_hash: module_hash(&ctx.accounts.program_data)?,
        authority_epoch: 1,
        quote_epoch: state.quote_epoch,
        start_slot: state.start_slot,
        expiry_slot: state.expiry_slot,
        inventory_limit,
        buy_consumed: 0,
        sell_consumed: 0,
        quarantined: false,
        bump: ctx.bumps.registration,
    });
    ctx.accounts.binding.set_inner(CapitalBinding {
        market: ctx.accounts.market.key(),
        capital: ctx.accounts.capital.key(),
        registration: ctx.accounts.registration.key(),
    });
    emit_cpi!(event(
        &mut ctx.accounts.market,
        &ctx.accounts.registration,
        0
    )?);
    Ok(())
}

pub fn approve(ctx: Context<ApproveMaker>) -> Result<()> {
    active(&ctx.accounts.market)?;
    capital_ready(&ctx.accounts.capital)?;
    let state = config_state(
        &ctx.accounts.config,
        ctx.accounts.pricing_program.key(),
        ctx.accounts.registration.maker_id,
        &ctx.accounts.market,
        &ctx.accounts.capital,
    )?;
    let registration = &mut ctx.accounts.registration;
    // Approval never resets consumption or silently adopts a new quote epoch.
    require!(
        state.quote_epoch >= registration.quote_epoch,
        ClearingError::MakerEpoch
    );
    registration.approved_hash = module_hash(&ctx.accounts.program_data)?;
    registration.authority_epoch = registration
        .authority_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    registration.quarantined = false;
    emit_cpi!(event(
        &mut ctx.accounts.market,
        &ctx.accounts.registration,
        1
    )?);
    Ok(())
}

pub fn sync(ctx: Context<SyncMaker>) -> Result<()> {
    active(&ctx.accounts.market)?;
    approved(&ctx.accounts.registration, &ctx.accounts.program_data)?;
    let state = config_state(
        &ctx.accounts.config,
        ctx.accounts.pricing_program.key(),
        ctx.accounts.registration.maker_id,
        &ctx.accounts.market,
        &ctx.accounts.capital,
    )?;
    let slot = Clock::get()?.slot;
    let registration = &mut ctx.accounts.registration;
    require!(
        state.quote_epoch > registration.quote_epoch
            && state.start_slot >= registration.expiry_slot
            && slot >= state.start_slot
            && slot < state.expiry_slot,
        ClearingError::MakerEpoch
    );
    registration.quote_epoch = state.quote_epoch;
    registration.start_slot = state.start_slot;
    registration.expiry_slot = state.expiry_slot;
    registration.buy_consumed = 0;
    registration.sell_consumed = 0;
    emit_cpi!(event(
        &mut ctx.accounts.market,
        &ctx.accounts.registration,
        2
    )?);
    Ok(())
}

pub fn quarantine(ctx: Context<QuarantineMaker>) -> Result<()> {
    require!(ctx.accounts.market.mode != 3, ClearingError::Resolution);
    let registration = &mut ctx.accounts.registration;
    registration.quarantined = true;
    registration.authority_epoch = registration
        .authority_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    emit_cpi!(event(
        &mut ctx.accounts.market,
        &ctx.accounts.registration,
        3
    )?);
    Ok(())
}

pub fn preview(ctx: Context<PreviewMaker>, args: PreviewArgs) -> Result<QuoteResponse> {
    active(&ctx.accounts.market)?;
    capital_ready(&ctx.accounts.capital)?;
    quote_checked(
        &ctx.accounts.market,
        &ctx.accounts.capital,
        &ctx.accounts.registration,
        &ctx.accounts.pricing_program,
        &ctx.accounts.program_data,
        &ctx.accounts.config,
        args,
    )
}

pub(crate) fn quote_checked<'info>(
    market: &Account<'info, MarketState>,
    capital: &Account<'info, Participant>,
    registration: &Account<'info, MakerRegistration>,
    pricing_program: &Program<'info>,
    program_data: &Account<'info, ProgramData>,
    config: &UncheckedAccount<'info>,
    args: PreviewArgs,
) -> Result<QuoteResponse> {
    capital_ready(capital)?;
    approved(registration, program_data)?;
    require!(
        args.quote_epoch == registration.quote_epoch
            && args.authority_epoch == registration.authority_epoch
            && args.terms_epoch == market.terms_epoch
            && args.config_epoch == market.config_epoch,
        ClearingError::MakerEpoch
    );
    let state = config_state(
        config,
        pricing_program.key(),
        registration.maker_id,
        market,
        capital,
    )?;
    require!(
        state.quote_epoch == registration.quote_epoch
            && state.start_slot == registration.start_slot
            && state.expiry_slot == registration.expiry_slot,
        ClearingError::MakerEpoch
    );
    let request = QuoteRequest {
        version: VERSION,
        domain: market.domain,
        market: market.key(),
        capital: capital.key(),
        quote_epoch: registration.quote_epoch,
        authority_epoch: registration.authority_epoch,
        terms_epoch: market.terms_epoch,
        market_config_epoch: market.config_epoch,
        side: args.side,
        lots: args.lots,
        inventory: capital.lots,
        cash: capital.cash,
        inventory_limit: registration.inventory_limit,
        consumed: if args.side == 0 {
            registration.buy_consumed
        } else {
            registration.sell_consumed
        },
        reference_price: args.reference_price,
        slot: Clock::get()?.slot,
    };
    let expected =
        maker_interface::quote(&state, &request).map_err(|_| error!(ClearingError::MakerQuote))?;
    invoke_quote(config, pricing_program, &request, &expected)
}

/// Only for callers that have authenticated module/config/capital in this same
/// transaction. Inputs stay read-only, so later quote calls cannot change approval.
pub(crate) fn invoke_quote<'info>(
    config: &UncheckedAccount<'info>,
    pricing_program: &Program<'info>,
    request: &QuoteRequest,
    expected: &QuoteResponse,
) -> Result<QuoteResponse> {
    let mut data = hash(b"global:quote").to_bytes()[..8].to_vec();
    request.serialize(&mut data)?;
    // No signer, capital, market, vault or arbitrary remaining account crosses CPI.
    invoke(
        &Instruction {
            program_id: pricing_program.key(),
            accounts: vec![AccountMeta::new_readonly(config.key(), false)],
            data,
        },
        &[config.to_account_info(), pricing_program.to_account_info()],
    )?;
    let (producer, bytes) = get_return_data().ok_or(ClearingError::MakerResponse)?;
    maker_interface::validate_response(&pricing_program.key(), &producer, &bytes, expected)
        .map_err(|_| error!(ClearingError::MakerResponse))
}
