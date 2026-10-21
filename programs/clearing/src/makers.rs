//! Standing maker authorization and bounded read-only pricing.
use crate::{ClearingError, MarketState, Participant};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
};
use maker_interface::{MakerState, QuoteRequest, QuoteResponse, VERSION};
use solana_sha256_hasher::hash;

pub const MAKER_A: Pubkey = pubkey!("7Kp4Y5yeBiuS9NYmw67quMLRto5Y9CcUQ29VjLviHggU");
pub const MAKER_B: Pubkey = pubkey!("F3ETRB1fPHjJ2KQYuL8SomC1auBpWK5VtVqFwAU7k2Yc");

#[account]
#[derive(InitSpace)]
pub struct MakerRegistration {
    pub version: u16,
    pub maker_id: u8,
    pub market: Pubkey,
    pub capital: Pubkey,
    pub owner: Pubkey,
    pub pricing_program: Pubkey,
    pub program_data: Pubkey,
    pub config: Pubkey,
    /// Entire loader ProgramData, including deployment slot, authority and code.
    pub approved_hash: [u8; 32],
    pub authority_epoch: u64,
    pub quote_epoch: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub inventory_limit: u64,
    pub buy_consumed: u64,
    pub sell_consumed: u64,
    pub quarantined: bool,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct CapitalBinding {
    pub market: Pubkey,
    pub capital: Pubkey,
    pub registration: Pubkey,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(maker_id: u8)]
pub struct RegisterMaker<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(mut, seeds=[b"market".as_ref(),b"BTC".as_ref()], bump=market.bump, has_one=authority)]
    pub market: Account<'info, MarketState>,
    #[account(seeds=[b"participant",market.key().as_ref(),owner.key().as_ref()], bump=capital.bump, has_one=market, has_one=owner)]
    pub capital: Account<'info, Participant>,
    #[account(init,payer=owner,space=8+MakerRegistration::INIT_SPACE,seeds=[b"maker",market.key().as_ref(),&[maker_id]],bump)]
    pub registration: Account<'info, MakerRegistration>,
    #[account(init,payer=owner,space=8+CapitalBinding::INIT_SPACE,seeds=[b"maker-capital",capital.key().as_ref()],bump)]
    pub binding: Account<'info, CapitalBinding>,
    #[account(constraint=pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub pricing_program: Program<'info>,
    pub program_data: Account<'info, ProgramData>,
    /// CHECK: Exact owner, PDA, discriminator, length and stored bindings validated by config_state.
    pub config: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ApproveMaker<'info> {
    pub owner: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=authority)]
    pub market: Account<'info, MarketState>,
    #[account(seeds=[b"participant",market.key().as_ref(),owner.key().as_ref()],bump=capital.bump,has_one=market,has_one=owner)]
    pub capital: Account<'info, Participant>,
    #[account(mut,seeds=[b"maker",market.key().as_ref(),&[registration.maker_id]],bump=registration.bump,
        has_one=market,has_one=capital,has_one=owner,has_one=pricing_program,has_one=program_data,has_one=config)]
    pub registration: Account<'info, MakerRegistration>,
    #[account(constraint=pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub pricing_program: Program<'info>,
    pub program_data: Account<'info, ProgramData>,
    /// CHECK: Validated by config_state before approval.
    pub config: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SyncMaker<'info> {
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump)]
    pub market: Account<'info, MarketState>,
    #[account(seeds=[b"participant",market.key().as_ref(),capital.owner.as_ref()],bump=capital.bump,has_one=market)]
    pub capital: Account<'info, Participant>,
    #[account(mut,seeds=[b"maker",market.key().as_ref(),&[registration.maker_id]],bump=registration.bump,
        has_one=market,has_one=capital,has_one=pricing_program,has_one=program_data,has_one=config)]
    pub registration: Account<'info, MakerRegistration>,
    #[account(constraint=pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub pricing_program: Program<'info>,
    pub program_data: Account<'info, ProgramData>,
    /// CHECK: Validated by config_state; only an owner-signed expired-epoch publication can advance.
    pub config: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct QuarantineMaker<'info> {
    pub authority: Signer<'info>,
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=authority)]
    pub market: Account<'info, MarketState>,
    #[account(mut,seeds=[b"maker",market.key().as_ref(),&[registration.maker_id]],bump=registration.bump,has_one=market)]
    pub registration: Account<'info, MakerRegistration>,
}

#[derive(Accounts)]
pub struct PreviewMaker<'info> {
    #[account(seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump)]
    pub market: Account<'info, MarketState>,
    #[account(seeds=[b"participant",market.key().as_ref(),capital.owner.as_ref()],bump=capital.bump,has_one=market)]
    pub capital: Account<'info, Participant>,
    #[account(seeds=[b"maker",market.key().as_ref(),&[registration.maker_id]],bump=registration.bump,
        has_one=market,has_one=capital,has_one=pricing_program,has_one=program_data,has_one=config)]
    pub registration: Account<'info, MakerRegistration>,
    #[account(constraint=pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub pricing_program: Program<'info>,
    pub program_data: Account<'info, ProgramData>,
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
#[event]
pub struct MakerChanged {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub kind: u8,
    pub registration: Pubkey,
    pub capital: Pubkey,
    pub maker_id: u8,
    pub authority_epoch: u64,
    pub quote_epoch: u64,
    pub quarantined: bool,
    pub approved_hash: [u8; 32],
    pub config_epoch: u64,
}
fn active(m: &MarketState) -> Result<()> {
    crate::custody::profile(m)?;
    require!(!m.paused, ClearingError::Paused);
    Ok(())
}
fn capital_ready(p: &Participant) -> Result<()> {
    crate::routes::participant_model(p)?;
    require!(p.cash > 0, ClearingError::MakerCapital);
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
fn approved(r: &MakerRegistration, data: &Account<ProgramData>) -> Result<()> {
    require!(
        r.version == VERSION && !r.quarantined,
        ClearingError::MakerQuarantined
    );
    require!(
        module_hash(data)? == r.approved_hash,
        ClearingError::MakerUpgrade
    );
    Ok(())
}
fn event(
    m: &mut Account<MarketState>,
    r: &Account<MakerRegistration>,
    kind: u8,
) -> Result<MakerChanged> {
    m.sequence = m.sequence.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    if m.mode == 2 {
        m.config_epoch = m
            .config_epoch
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?;
    }
    Ok(MakerChanged {
        version: VERSION,
        domain: m.domain,
        market: m.key(),
        sequence: m.sequence,
        slot: Clock::get()?.slot,
        kind,
        registration: r.key(),
        capital: r.capital,
        maker_id: r.maker_id,
        authority_epoch: r.authority_epoch,
        quote_epoch: r.quote_epoch,
        quarantined: r.quarantined,
        approved_hash: r.approved_hash,
        config_epoch: m.config_epoch,
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
    let r = &mut ctx.accounts.registration;
    // Approval never resets consumption or silently adopts a new quote epoch.
    require!(
        state.quote_epoch >= r.quote_epoch,
        ClearingError::MakerEpoch
    );
    r.approved_hash = module_hash(&ctx.accounts.program_data)?;
    r.authority_epoch = r
        .authority_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    r.quarantined = false;
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
    let r = &mut ctx.accounts.registration;
    require!(
        state.quote_epoch > r.quote_epoch
            && state.start_slot >= r.expiry_slot
            && slot >= state.start_slot
            && slot < state.expiry_slot,
        ClearingError::MakerEpoch
    );
    r.quote_epoch = state.quote_epoch;
    r.start_slot = state.start_slot;
    r.expiry_slot = state.expiry_slot;
    r.buy_consumed = 0;
    r.sell_consumed = 0;
    emit_cpi!(event(
        &mut ctx.accounts.market,
        &ctx.accounts.registration,
        2
    )?);
    Ok(())
}
pub fn quarantine(ctx: Context<QuarantineMaker>) -> Result<()> {
    let r = &mut ctx.accounts.registration;
    r.quarantined = true;
    r.authority_epoch = r
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
    m: &Account<'info, MarketState>,
    p: &Account<'info, Participant>,
    r: &Account<'info, MakerRegistration>,
    pricing_program: &Program<'info>,
    program_data: &Account<'info, ProgramData>,
    config: &UncheckedAccount<'info>,
    args: PreviewArgs,
) -> Result<QuoteResponse> {
    capital_ready(p)?;
    approved(r, program_data)?;
    require!(
        args.quote_epoch == r.quote_epoch
            && args.authority_epoch == r.authority_epoch
            && args.terms_epoch == m.terms_epoch
            && args.config_epoch == m.config_epoch,
        ClearingError::MakerEpoch
    );
    let state = config_state(config, pricing_program.key(), r.maker_id, m, p)?;
    require!(
        state.quote_epoch == r.quote_epoch
            && state.start_slot == r.start_slot
            && state.expiry_slot == r.expiry_slot,
        ClearingError::MakerEpoch
    );
    let request = QuoteRequest {
        version: VERSION,
        domain: m.domain,
        market: m.key(),
        capital: p.key(),
        quote_epoch: r.quote_epoch,
        authority_epoch: r.authority_epoch,
        terms_epoch: m.terms_epoch,
        market_config_epoch: m.config_epoch,
        side: args.side,
        lots: args.lots,
        inventory: p.lots,
        cash: p.cash,
        inventory_limit: r.inventory_limit,
        consumed: if args.side == 0 {
            r.buy_consumed
        } else {
            r.sell_consumed
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
