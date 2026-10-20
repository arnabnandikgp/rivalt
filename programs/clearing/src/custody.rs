use crate::ClearingError;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use financial_core::{cash_add, cash_sub, MAX_PARTICIPANTS};

pub const SCHEMA_VERSION: u16 = 1;
pub const PROFILE_VERSION: u16 = 1;
pub const DECIMALS: u8 = 6;

#[account]
#[derive(InitSpace)]
pub struct MarketState {
    pub schema_version: u16,
    pub profile_version: u16,
    pub domain: [u8; 32],
    pub authority: Pubkey,
    pub quote_mint: Pubkey,
    pub vault: Pubkey,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub sequence: u64,
    pub paused: bool,
    /// Only CustodyOnly (0) exists in this schema.
    pub mode: u8,
    pub funding_index_scaled: i128,
    pub total_cash: u64,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    /// Allocated token assets. Actual vault may have separately observable surplus.
    pub allocated_vault: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Participant {
    pub schema_version: u16,
    pub market: Pubkey,
    pub owner: Pubkey,
    pub id: u16,
    pub cash: u64,
    pub lots: i64,
    pub virtual_scaled: i128,
    pub funding_checkpoint_scaled: i128,
    pub generation: u64,
    pub nonce: u64,
    pub reserved: u64,
    /// Zero means empty. P08 owns order records and the nonzero slot authority.
    pub order_ids: [u64; 4],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ParticipantRegistry {
    pub schema_version: u16,
    pub market: Pubkey,
    pub count: u16,
    #[max_len(64)]
    pub members: Vec<Pubkey>,
    pub bump: u8,
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(constraint = clearing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::Authority)]
    pub clearing_program: Program<'info, crate::program::Clearing>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ ClearingError::Authority)]
    pub program_data: Account<'info, ProgramData>,
    #[account(constraint = quote_mint.decimals == DECIMALS @ ClearingError::Mint,
        constraint = quote_mint.freeze_authority.is_none() @ ClearingError::Mint)]
    pub quote_mint: Account<'info, Mint>,
    #[account(init, payer = authority, space = 8 + MarketState::INIT_SPACE, seeds = [b"market".as_ref(), b"BTC".as_ref()], bump)]
    pub market: Account<'info, MarketState>,
    #[account(init, payer = authority, space = 8 + ParticipantRegistry::INIT_SPACE, seeds = [b"registry", market.key().as_ref()], bump)]
    pub registry: Box<Account<'info, ParticipantRegistry>>,
    #[account(init, payer = authority, seeds = [b"vault", market.key().as_ref()], bump,
        token::mint = quote_mint, token::authority = market)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RegisterParticipant<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"market".as_ref(), b"BTC".as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketState>,
    #[account(mut, seeds = [b"registry", market.key().as_ref()], bump = registry.bump, has_one = market)]
    pub registry: Box<Account<'info, ParticipantRegistry>>,
    #[account(init, payer = owner, space = 8 + Participant::INIT_SPACE,
        seeds = [b"participant", market.key().as_ref(), owner.key().as_ref()], bump)]
    pub participant: Account<'info, Participant>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CashTransfer<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"market".as_ref(), b"BTC".as_ref()], bump = market.bump, has_one = quote_mint, has_one = vault)]
    pub market: Account<'info, MarketState>,
    #[account(mut, seeds = [b"participant", market.key().as_ref(), owner.key().as_ref()], bump = participant.bump,
        has_one = owner, has_one = market)]
    pub participant: Account<'info, Participant>,
    pub quote_mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = market.vault_bump,
        token::mint = quote_mint, token::authority = market)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_token.key() != vault.key() @ ClearingError::Alias,
        token::mint = quote_mint, token::authority = owner)]
    pub user_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct FundInsurance<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"market".as_ref(), b"BTC".as_ref()], bump = market.bump,
        has_one = authority, has_one = quote_mint, has_one = vault)]
    pub market: Account<'info, MarketState>,
    pub quote_mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = market.vault_bump,
        token::mint = quote_mint, token::authority = market)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = source.key() != vault.key() @ ClearingError::Alias,
        token::mint = quote_mint, token::authority = authority)]
    pub source: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ControlMarket<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"market".as_ref(), b"BTC".as_ref()], bump = market.bump, has_one = authority, has_one = vault)]
    pub market: Account<'info, MarketState>,
    #[account(seeds = [b"vault", market.key().as_ref()], bump = market.vault_bump,
        constraint = vault.mint == market.quote_mint @ ClearingError::Mint,
        constraint = vault.owner == market.key() @ ClearingError::Authority)]
    pub vault: Account<'info, TokenAccount>,
}

#[event]
pub struct CustodyChanged {
    pub schema_version: u16,
    pub profile_version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub sequence: u64,
    pub slot: u64,
    /// 0 initialize, 1 register, 2 deposit, 3 withdraw, 4 insurance, 5 surplus, 6 pause.
    pub kind: u8,
    pub actor: Pubkey,
    /// Default pubkey means a market-wide event.
    pub participant: Pubkey,
    pub amount: u64,
    pub participant_cash: u64,
    pub total_cash: u64,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    pub allocated_vault: u64,
    pub actual_vault: u64,
    pub paused: bool,
}

fn arithmetic<T>(value: financial_core::Result<T>) -> Result<T> {
    value.map_err(|_| error!(ClearingError::Arithmetic))
}
fn profile(m: &MarketState) -> Result<()> {
    require!(
        m.schema_version == SCHEMA_VERSION
            && m.profile_version == PROFILE_VERSION
            && m.mode == 0
            && m.funding_index_scaled == 0
            && m.settlement == 0
            && m.fees == 0,
        ClearingError::Profile
    );
    Ok(())
}
fn active(m: &MarketState) -> Result<()> {
    profile(m)?;
    require!(!m.paused, ClearingError::Paused);
    Ok(())
}
fn reconciled(m: &MarketState, actual: u64) -> Result<()> {
    let sum = u128::from(m.total_cash)
        + u128::from(m.settlement)
        + u128::from(m.insurance)
        + u128::from(m.fees);
    require!(
        sum == u128::from(m.allocated_vault) && actual >= m.allocated_vault,
        ClearingError::Reconciliation
    );
    Ok(())
}
fn flat(p: &Participant) -> Result<()> {
    require!(
        p.schema_version == SCHEMA_VERSION
            && p.lots == 0
            && p.virtual_scaled == 0
            && p.funding_checkpoint_scaled == 0
            && p.reserved == 0
            && p.order_ids == [0; 4],
        ClearingError::Profile
    );
    Ok(())
}
fn event(
    m: &mut Account<MarketState>,
    kind: u8,
    actor: Pubkey,
    participant: Pubkey,
    amount: u64,
    cash: u64,
    actual: u64,
) -> Result<CustodyChanged> {
    m.sequence = m.sequence.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    Ok(CustodyChanged {
        schema_version: SCHEMA_VERSION,
        profile_version: PROFILE_VERSION,
        domain: m.domain,
        market: m.key(),
        terms_epoch: m.terms_epoch,
        config_epoch: m.config_epoch,
        sequence: m.sequence,
        slot: Clock::get()?.slot,
        kind,
        actor,
        participant,
        amount,
        participant_cash: cash,
        total_cash: m.total_cash,
        settlement: m.settlement,
        insurance: m.insurance,
        fees: m.fees,
        allocated_vault: m.allocated_vault,
        actual_vault: actual,
        paused: m.paused,
    })
}

pub fn initialize(ctx: Context<InitializeMarket>, domain: [u8; 32]) -> Result<()> {
    require!(domain != [0; 32], ClearingError::Domain);
    let m = &mut ctx.accounts.market;
    m.set_inner(MarketState {
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
        market: m.key(),
        count: 0,
        members: Vec::new(),
        bump: ctx.bumps.registry,
    });
    emit_cpi!(event(
        m,
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
    let m = &mut ctx.accounts.market;
    active(m)?;
    let r = &mut ctx.accounts.registry;
    require!(
        r.schema_version == SCHEMA_VERSION && r.members.len() == r.count as usize,
        ClearingError::Profile
    );
    require!(
        (r.count as usize) < MAX_PARTICIPANTS,
        ClearingError::Capacity
    );
    let p = &mut ctx.accounts.participant;
    p.set_inner(Participant {
        schema_version: SCHEMA_VERSION,
        market: m.key(),
        owner: ctx.accounts.owner.key(),
        id: r.count,
        cash: 0,
        lots: 0,
        virtual_scaled: 0,
        funding_checkpoint_scaled: 0,
        generation: 0,
        nonce: 0,
        reserved: 0,
        order_ids: [0; 4],
        bump: ctx.bumps.participant,
    });
    r.members.push(p.key());
    r.count += 1; // bounded by 64 above
                  // No token account is read here; actual_vault=0 is non-applicable for kind 1.
    emit_cpi!(event(m, 1, p.owner, p.key(), 0, 0, 0)?);
    Ok(())
}
pub fn process_deposit(ctx: Context<CashTransfer>, amount: u64) -> Result<()> {
    let m = &mut ctx.accounts.market;
    active(m)?;
    flat(&ctx.accounts.participant)?;
    require!(amount > 0, ClearingError::Amount);
    reconciled(m, ctx.accounts.vault.amount)?;
    let p = &mut ctx.accounts.participant;
    p.cash = arithmetic(cash_add(p.cash, amount))?;
    m.total_cash = arithmetic(cash_add(m.total_cash, amount))?;
    m.allocated_vault = arithmetic(cash_add(m.allocated_vault, amount))?;
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
    reconciled(m, ctx.accounts.vault.amount)?;
    emit_cpi!(event(
        m,
        2,
        p.owner,
        p.key(),
        amount,
        p.cash,
        ctx.accounts.vault.amount
    )?);
    Ok(())
}
pub fn process_withdraw(ctx: Context<CashTransfer>, amount: u64) -> Result<()> {
    let m = &mut ctx.accounts.market;
    active(m)?;
    flat(&ctx.accounts.participant)?;
    require!(amount > 0, ClearingError::Amount);
    reconciled(m, ctx.accounts.vault.amount)?;
    let p = &mut ctx.accounts.participant;
    p.cash = arithmetic(cash_sub(p.cash, amount))?;
    m.total_cash = arithmetic(cash_sub(m.total_cash, amount))?;
    m.allocated_vault = arithmetic(cash_sub(m.allocated_vault, amount))?;
    let bump = [m.bump];
    let signer: &[&[u8]] = &[b"market", b"BTC", &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.user_token.to_account_info(),
                authority: m.to_account_info(),
            },
            &[signer],
        ),
        amount,
        DECIMALS,
    )?;
    ctx.accounts.vault.reload()?;
    reconciled(m, ctx.accounts.vault.amount)?;
    emit_cpi!(event(
        m,
        3,
        p.owner,
        p.key(),
        amount,
        p.cash,
        ctx.accounts.vault.amount
    )?);
    Ok(())
}
pub fn process_fund_insurance(ctx: Context<FundInsurance>, amount: u64) -> Result<()> {
    let m = &mut ctx.accounts.market;
    active(m)?;
    require!(amount > 0, ClearingError::Amount);
    reconciled(m, ctx.accounts.vault.amount)?;
    m.insurance = arithmetic(cash_add(m.insurance, amount))?;
    m.allocated_vault = arithmetic(cash_add(m.allocated_vault, amount))?;
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
    reconciled(m, ctx.accounts.vault.amount)?;
    emit_cpi!(event(
        m,
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
    let m = &mut ctx.accounts.market;
    profile(m)?;
    reconciled(m, ctx.accounts.vault.amount)?;
    let amount = ctx
        .accounts
        .vault
        .amount
        .checked_sub(m.allocated_vault)
        .ok_or(ClearingError::Reconciliation)?;
    require!(amount > 0, ClearingError::Amount);
    m.insurance = arithmetic(cash_add(m.insurance, amount))?;
    m.allocated_vault = arithmetic(cash_add(m.allocated_vault, amount))?;
    emit_cpi!(event(
        m,
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
    let m = &mut ctx.accounts.market;
    profile(m)?;
    reconciled(m, ctx.accounts.vault.amount)?;
    m.paused = paused;
    m.config_epoch = m
        .config_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    emit_cpi!(event(
        m,
        6,
        ctx.accounts.authority.key(),
        Pubkey::default(),
        0,
        0,
        ctx.accounts.vault.amount
    )?);
    Ok(())
}
