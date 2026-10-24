use crate::error::ClearingError;
use crate::events::CustodyChanged;
use crate::state::{MarketState, Participant, ParticipantRegistry};

pub use crate::constants::custody::*;

use anchor_lang::prelude::*;

use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use financial_core::{cash_add, cash_sub, MAX_PARTICIPANTS};

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(constraint = clearing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::Authority)]
    pub clearing_program: Program<'info, crate::program::Clearing>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ ClearingError::Authority)]
    pub program_data: Box<Account<'info, ProgramData>>,
    #[account(
        constraint = quote_mint.decimals == DECIMALS @ ClearingError::Mint,
        constraint = quote_mint.freeze_authority.is_none() @ ClearingError::Mint,
    )]
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = authority,
        space = 8 + MarketState::INIT_SPACE,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        init,
        payer = authority,
        space = 8 + ParticipantRegistry::INIT_SPACE,
        seeds = [b"registry", market.key().as_ref()],
        bump,
    )]
    pub registry: Box<Account<'info, ParticipantRegistry>>,
    #[account(
        init,
        payer = authority,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = market,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RegisterParticipant<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"registry", market.key().as_ref()],
        bump = registry.bump,
        has_one = market,
    )]
    pub registry: Box<Account<'info, ParticipantRegistry>>,
    #[account(
        init,
        payer = owner,
        space = 8 + Participant::INIT_SPACE,
        seeds = [b"participant", market.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub participant: Box<Account<'info, Participant>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CashTransfer<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = quote_mint,
        has_one = vault,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"participant", market.key().as_ref(), owner.key().as_ref()],
        bump = participant.bump,
        has_one = owner,
        has_one = market,
    )]
    pub participant: Box<Account<'info, Participant>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        token::mint = quote_mint,
        token::authority = market,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = user_token.key() != vault.key() @ ClearingError::Alias,
        token::mint = quote_mint,
        token::authority = owner,
    )]
    pub user_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct FundInsurance<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = authority,
        has_one = quote_mint,
        has_one = vault,
    )]
    pub market: Box<Account<'info, MarketState>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        token::mint = quote_mint,
        token::authority = market,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = source.key() != vault.key() @ ClearingError::Alias,
        token::mint = quote_mint,
        token::authority = authority,
    )]
    pub source: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ControlMarket<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = authority,
        has_one = vault,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        constraint = vault.mint == market.quote_mint @ ClearingError::Mint,
        constraint = vault.owner == market.key() @ ClearingError::Authority,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
}

fn arithmetic<T>(value: financial_core::Result<T>) -> Result<T> {
    value.map_err(|_| error!(ClearingError::Arithmetic))
}

pub(crate) fn profile(market: &MarketState) -> Result<()> {
    require!(
        market.schema_version == SCHEMA_VERSION
            && market.profile_version == PROFILE_VERSION
            && market.mode <= 3
            && (market.mode >= 2 || market.funding_index_scaled == 0)
            && (market.mode > 0 || (market.fees == 0 && market.settlement == 0)),
        ClearingError::Profile
    );
    Ok(())
}

fn active(market: &MarketState) -> Result<()> {
    profile(market)?;
    require!(!market.paused, ClearingError::Paused);
    Ok(())
}

pub(crate) fn reconciled(market: &MarketState, actual: u64) -> Result<()> {
    let sum = u128::from(market.total_cash)
        + u128::from(market.settlement)
        + u128::from(market.insurance)
        + u128::from(market.fees);
    require!(
        sum == u128::from(market.allocated_vault) && actual >= market.allocated_vault,
        ClearingError::Reconciliation
    );
    Ok(())
}

fn flat(participant: &Participant) -> Result<()> {
    require!(
        participant.schema_version == SCHEMA_VERSION
            && participant.lots == 0
            && participant.virtual_scaled == 0
            && participant.funding_checkpoint_scaled == 0
            && participant.reserved == 0
            && participant.order_ids == [0; 4],
        ClearingError::Profile
    );
    Ok(())
}

fn event(
    market: &mut Account<MarketState>,
    kind: u8,
    actor: Pubkey,
    participant: Pubkey,
    amount: u64,
    cash: u64,
    actual: u64,
) -> Result<CustodyChanged> {
    market.sequence = market
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(CustodyChanged {
        schema_version: SCHEMA_VERSION,
        profile_version: PROFILE_VERSION,
        domain: market.domain,
        market: market.key(),
        terms_epoch: market.terms_epoch,
        config_epoch: market.config_epoch,
        sequence: market.sequence,
        slot: Clock::get()?.slot,
        kind,
        actor,
        participant,
        amount,
        participant_cash: cash,
        total_cash: market.total_cash,
        settlement: market.settlement,
        insurance: market.insurance,
        fees: market.fees,
        allocated_vault: market.allocated_vault,
        actual_vault: actual,
        paused: market.paused,
    })
}

pub fn initialize(ctx: Context<InitializeMarket>, domain: [u8; 32]) -> Result<()> {
    require!(domain != [0; 32], ClearingError::Domain);
    let market = &mut ctx.accounts.market;
    market.set_inner(MarketState {
        schema_version: SCHEMA_VERSION,
        profile_version: PROFILE_VERSION,
        domain,
        authority: ctx.accounts.authority.key(),
        quote_mint: ctx.accounts.quote_mint.key(),
        vault: ctx.accounts.vault.key(),
        terms_epoch: 1,
        config_epoch: 1,
        sequence: 0,
        paused: false,
        mode: 0,
        funding_index_scaled: 0,
        funding_time: 0,
        total_cash: 0,
        settlement: 0,
        insurance: 0,
        fees: 0,
        allocated_vault: 0,
        bump: ctx.bumps.market,
        vault_bump: ctx.bumps.vault,
    });
    ctx.accounts.registry.set_inner(ParticipantRegistry {
        schema_version: SCHEMA_VERSION,
        market: market.key(),
        count: 0,
        members: Vec::new(),
        bump: ctx.bumps.registry,
    });
    emit_cpi!(event(
        market,
        0,
        ctx.accounts.authority.key(),
        Pubkey::default(),
        0,
        0,
        0
    )?);
    Ok(())
}

pub fn register(ctx: Context<RegisterParticipant>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    active(market)?;
    let registry = &mut ctx.accounts.registry;
    require!(
        registry.schema_version == SCHEMA_VERSION
            && registry.members.len() == registry.count as usize,
        ClearingError::Profile
    );
    require!(
        (registry.count as usize) < MAX_PARTICIPANTS,
        ClearingError::Capacity
    );
    let participant = &mut ctx.accounts.participant;
    participant.set_inner(Participant {
        schema_version: SCHEMA_VERSION,
        market: market.key(),
        owner: ctx.accounts.owner.key(),
        id: registry.count,
        cash: 0,
        lots: 0,
        virtual_scaled: 0,
        funding_checkpoint_scaled: 0,
        generation: 0,
        nonce: 0,
        reserved: 0,
        order_ids: [0; 4],
        book: crate::state::OrderBook::default(),
        bump: ctx.bumps.participant,
    });
    registry.members.push(participant.key());
    registry.count += 1; // bounded by 64 above
                         // No token account is read here; actual_vault=0 is non-applicable for kind 1.
    emit_cpi!(event(
        market,
        1,
        participant.owner,
        participant.key(),
        0,
        0,
        0
    )?);
    Ok(())
}

pub fn process_deposit(ctx: Context<CashTransfer>, amount: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;
    active(market)?;
    crate::routes::participant_model(&ctx.accounts.participant)?;
    require!(amount > 0, ClearingError::Amount);
    reconciled(market, ctx.accounts.vault.amount)?;
    let participant = &mut ctx.accounts.participant;
    participant.cash = arithmetic(cash_add(participant.cash, amount))?;
    market.total_cash = arithmetic(cash_add(market.total_cash, amount))?;
    market.allocated_vault = arithmetic(cash_add(market.allocated_vault, amount))?;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.user_token.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
        DECIMALS,
    )?;
    ctx.accounts.vault.reload()?;
    reconciled(market, ctx.accounts.vault.amount)?;
    emit_cpi!(event(
        market,
        2,
        participant.owner,
        participant.key(),
        amount,
        participant.cash,
        ctx.accounts.vault.amount
    )?);
    Ok(())
}

pub fn process_withdraw(ctx: Context<CashTransfer>, amount: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;
    active(market)?;
    // P06 adds guarded exits with settlement/whole-market policy.
    require!(market.mode == 0, ClearingError::Profile);
    flat(&ctx.accounts.participant)?;
    require!(amount > 0, ClearingError::Amount);
    reconciled(market, ctx.accounts.vault.amount)?;
    let participant = &mut ctx.accounts.participant;
    participant.cash = arithmetic(cash_sub(participant.cash, amount))?;
    market.total_cash = arithmetic(cash_sub(market.total_cash, amount))?;
    market.allocated_vault = arithmetic(cash_sub(market.allocated_vault, amount))?;
    let bump = [market.bump];
    let signer: &[&[u8]] = &[b"market", b"BTC", &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.user_token.to_account_info(),
                authority: market.to_account_info(),
            },
            &[signer],
        ),
        amount,
        DECIMALS,
    )?;
    ctx.accounts.vault.reload()?;
    reconciled(market, ctx.accounts.vault.amount)?;
    emit_cpi!(event(
        market,
        3,
        participant.owner,
        participant.key(),
        amount,
        participant.cash,
        ctx.accounts.vault.amount
    )?);
    Ok(())
}

pub fn process_fund_insurance(ctx: Context<FundInsurance>, amount: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;
    active(market)?;
    require!(amount > 0, ClearingError::Amount);
    reconciled(market, ctx.accounts.vault.amount)?;
    market.insurance = arithmetic(cash_add(market.insurance, amount))?;
    market.allocated_vault = arithmetic(cash_add(market.allocated_vault, amount))?;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.source.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        amount,
        DECIMALS,
    )?;
    ctx.accounts.vault.reload()?;
    reconciled(market, ctx.accounts.vault.amount)?;
    emit_cpi!(event(
        market,
        4,
        ctx.accounts.authority.key(),
        Pubkey::default(),
        amount,
        0,
        ctx.accounts.vault.amount
    )?);
    Ok(())
}

pub fn process_classify_surplus(ctx: Context<ControlMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    profile(market)?;
    require!(market.mode != 3, ClearingError::Resolution);
    reconciled(market, ctx.accounts.vault.amount)?;
    let amount = ctx
        .accounts
        .vault
        .amount
        .checked_sub(market.allocated_vault)
        .ok_or(ClearingError::Reconciliation)?;
    require!(amount > 0, ClearingError::Amount);
    market.insurance = arithmetic(cash_add(market.insurance, amount))?;
    market.allocated_vault = arithmetic(cash_add(market.allocated_vault, amount))?;
    emit_cpi!(event(
        market,
        5,
        ctx.accounts.authority.key(),
        Pubkey::default(),
        amount,
        0,
        ctx.accounts.vault.amount
    )?);
    Ok(())
}

pub fn set_pause(ctx: Context<ControlMarket>, paused: bool) -> Result<()> {
    let market = &mut ctx.accounts.market;
    profile(market)?;
    require!(market.mode != 3, ClearingError::Resolution);
    reconciled(market, ctx.accounts.vault.amount)?;
    market.paused = paused;
    market.config_epoch = market
        .config_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    emit_cpi!(event(
        market,
        6,
        ctx.accounts.authority.key(),
        Pubkey::default(),
        0,
        0,
        ctx.accounts.vault.amount
    )?);
    Ok(())
}
