//! Fresh schema-2 custody. No source, order, position or trading setter is exposed.
use crate::events::{GroupCustodyChangedV2, GroupMemberCashV2};
use crate::{error::ClearingError, state::v2::*};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use financial_core::{cash_add, cash_sub};

#[event_cpi]
#[derive(Accounts)]
#[instruction(domain: [u8; 32])]
pub struct InitializeGroupV2<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(constraint = clearing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::Authority)]
    pub clearing_program: Program<'info, crate::program::Clearing>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ ClearingError::Authority)]
    pub program_data: Box<Account<'info, ProgramData>>,
    #[account(constraint = quote_mint.decimals == 6 && quote_mint.freeze_authority.is_none() @ ClearingError::Mint)]
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = authority, space = 8 + ClearingGroupV2::INIT_SPACE,
        seeds = [b"group-v2", domain.as_ref()], bump)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(init, payer = authority, space = 8 + GroupRegistryV2::INIT_SPACE,
        seeds = [b"registry-v2", group.key().as_ref()], bump)]
    pub registry: Box<Account<'info, GroupRegistryV2>>,
    #[account(init, payer = authority, seeds = [b"vault-v2", group.key().as_ref()], bump,
        token::mint = quote_mint, token::authority = group)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(index: u8)]
pub struct InitializeGroupMarketV2<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = authority)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(init, payer = authority, space = 8 + GroupMarketV2::INIT_SPACE,
        seeds = [b"market-v2", group.key().as_ref(), &[index]], bump)]
    pub market: Box<Account<'info, GroupMarketV2>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(index: u16)]
pub struct CreatePortfolioV2<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(init, payer = owner, space = 8 + PortfolioV2::INIT_SPACE,
        seeds = [b"portfolio-v2", group.key().as_ref(), owner.key().as_ref(), &index.to_le_bytes()], bump)]
    pub portfolio: Box<Account<'info, PortfolioV2>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(subaccount_index: u16)]
pub struct RegisterMarginV2<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"registry-v2", group.key().as_ref()], bump = registry.bump, has_one = group)]
    pub registry: Box<Account<'info, GroupRegistryV2>>,
    #[account(mut, seeds = [b"portfolio-v2", group.key().as_ref(), owner.key().as_ref(), &portfolio.index.to_le_bytes()],
        bump = portfolio.bump, has_one = group, has_one = owner)]
    pub portfolio: Box<Account<'info, PortfolioV2>>,
    #[account(init, payer = owner, space = 8 + MarginAccountV2::INIT_SPACE,
        seeds = [b"margin-v2", portfolio.key().as_ref(), &subaccount_index.to_le_bytes()], bump)]
    pub margin: Box<Account<'info, MarginAccountV2>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct GroupCashTransferV2<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump,
        has_one = quote_mint, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"margin-v2", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = owner, has_one = group)]
    pub margin: Box<Account<'info, MarginAccountV2>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        token::mint = quote_mint, token::authority = group)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = user_token.key() != vault.key() @ ClearingError::Alias,
        token::mint = quote_mint, token::authority = owner)]
    pub user_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct TransferGroupCashV2<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"margin-v2", donor.portfolio.as_ref(), &donor.subaccount_index.to_le_bytes()],
        bump = donor.bump, has_one = owner, has_one = group)]
    pub donor: Box<Account<'info, MarginAccountV2>>,
    #[account(mut, seeds = [b"margin-v2", recipient.portfolio.as_ref(), &recipient.subaccount_index.to_le_bytes()],
        bump = recipient.bump, has_one = owner, has_one = group,
        constraint = recipient.key() != donor.key() @ ClearingError::Alias)]
    pub recipient: Box<Account<'info, MarginAccountV2>>,
    #[account(seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        constraint = vault.mint == group.quote_mint && vault.owner == group.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ControlGroupV2<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = authority, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        constraint = vault.mint == group.quote_mint && vault.owner == group.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

fn arithmetic<T>(result: financial_core::Result<T>) -> Result<T> {
    result.map_err(|_| error!(ClearingError::Arithmetic))
}

fn custody_profile(group: &ClearingGroupV2) -> Result<()> {
    require!(
        cfg!(feature = "successor-test-profile")
            && group.schema_version == SCHEMA_VERSION
            && group.profile_version == PROFILE_VERSION
            && group.mode == 0
            && group.settlement == 0
            && group.fees == 0,
        ClearingError::Profile
    );
    Ok(())
}

fn active(group: &ClearingGroupV2) -> Result<()> {
    custody_profile(group)?;
    require!(!group.paused, ClearingError::Paused);
    Ok(())
}

fn reconciled(group: &ClearingGroupV2, actual: u64) -> Result<()> {
    let allocated = u128::from(group.total_cash)
        + u128::from(group.settlement)
        + u128::from(group.insurance)
        + u128::from(group.fees);
    require!(
        allocated == u128::from(group.allocated_vault) && actual >= group.allocated_vault,
        ClearingError::Reconciliation
    );
    Ok(())
}

fn empty_financial_state(margin: &MarginAccountV2) -> Result<()> {
    let mut book_bytes = Vec::with_capacity(OrderBookV2::INIT_SPACE);
    margin.book.serialize(&mut book_bytes)?;
    require!(
        margin.schema_version == SCHEMA_VERSION
            && valid_identity(
                0,
                margin.subaccount_index,
                margin.mode,
                margin.isolated_market_index,
                margin.role
            )
            && margin.reserved == 0
            && margin.nonce == 0
            && margin.delegate == Pubkey::default()
            && margin.delegate_expiry_slot == 0
            && margin.delegate_epoch == 1
            && margin.positions.iter().all(|position| position.lots == 0
                && position.virtual_scaled == 0
                && position.funding_checkpoint_scaled == 0
                && position.generation == 0)
            && book_bytes.iter().all(|byte| *byte == 0),
        ClearingError::Profile
    );
    Ok(())
}

fn advance_margin(margin: &mut MarginAccountV2) -> Result<()> {
    margin.state_version = margin
        .state_version
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(())
}

fn member(account: &Account<MarginAccountV2>) -> GroupMemberCashV2 {
    GroupMemberCashV2 {
        margin: account.key(),
        portfolio: account.portfolio,
        owner: account.owner,
        subaccount_index: account.subaccount_index,
        id: account.id,
        mode: account.mode,
        isolated_market_index: account.isolated_market_index,
        role: account.role,
        cash: account.cash,
        state_version: account.state_version,
    }
}

fn event(
    group: &mut Account<ClearingGroupV2>,
    kind: u8,
    actor: Pubkey,
    subject: Pubkey,
    index: u16,
    amount: u64,
    actual_vault: Option<u64>,
    members: Vec<GroupMemberCashV2>,
) -> Result<GroupCustodyChangedV2> {
    group.sequence = group
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(GroupCustodyChangedV2 {
        schema_version: SCHEMA_VERSION,
        profile_version: PROFILE_VERSION,
        domain: group.domain,
        group: group.key(),
        sequence: group.sequence,
        slot: Clock::get()?.slot,
        kind,
        actor,
        subject,
        index,
        amount,
        members,
        authority: group.authority,
        quote_mint: group.quote_mint,
        vault: group.vault,
        markets: group.markets,
        market_count: group.market_count,
        mode: group.mode,
        paused: group.paused,
        terms_epoch: group.terms_epoch,
        config_epoch: group.config_epoch,
        total_cash: group.total_cash,
        settlement: group.settlement,
        insurance: group.insurance,
        fees: group.fees,
        allocated_vault: group.allocated_vault,
        actual_vault,
    })
}

pub fn initialize(ctx: Context<InitializeGroupV2>, domain: [u8; 32]) -> Result<()> {
    require!(
        cfg!(feature = "successor-test-profile"),
        ClearingError::Profile
    );
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    require!(domain != [0; 32], ClearingError::Domain);
    let group = &mut ctx.accounts.group;
    group.set_inner(ClearingGroupV2 {
        schema_version: SCHEMA_VERSION,
        profile_version: PROFILE_VERSION,
        domain,
        authority: ctx.accounts.authority.key(),
        quote_mint: ctx.accounts.quote_mint.key(),
        vault: ctx.accounts.vault.key(),
        terms_epoch: 1,
        config_epoch: 1,
        bump: ctx.bumps.group,
        vault_bump: ctx.bumps.vault,
        ..Default::default()
    });
    ctx.accounts.registry.set_inner(GroupRegistryV2 {
        schema_version: SCHEMA_VERSION,
        group: group.key(),
        bump: ctx.bumps.registry,
        ..Default::default()
    });
    emit_cpi!(event(
        group,
        0,
        ctx.accounts.authority.key(),
        group.key(),
        0,
        0,
        Some(0),
        vec![]
    )?);
    Ok(())
}

pub fn initialize_market(ctx: Context<InitializeGroupMarketV2>, index: u8) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let group = &mut ctx.accounts.group;
    active(group)?;
    require!(
        usize::from(index) < MARKET_COUNT && index == group.market_count,
        ClearingError::Profile
    );
    ctx.accounts.market.set_inner(GroupMarketV2 {
        schema_version: SCHEMA_VERSION,
        group: group.key(),
        index,
        symbol: if index == 0 {
            *b"BTC\0\0\0\0\0"
        } else {
            *b"ETH\0\0\0\0\0"
        },
        lots_per_unit: if index == 0 { 1_000_000 } else { 100_000 },
        terms_epoch: 1,
        config_epoch: 1,
        bump: ctx.bumps.market,
        ..Default::default()
    });
    group.markets[usize::from(index)] = ctx.accounts.market.key();
    group.market_count += 1;
    emit_cpi!(event(
        group,
        1,
        ctx.accounts.authority.key(),
        ctx.accounts.market.key(),
        u16::from(index),
        0,
        None,
        vec![]
    )?);
    Ok(())
}

pub fn create_portfolio(ctx: Context<CreatePortfolioV2>, index: u16) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    active(&ctx.accounts.group)?;
    require!(
        index < MAX_PORTFOLIOS && usize::from(ctx.accounts.group.market_count) == MARKET_COUNT,
        ClearingError::Profile
    );
    ctx.accounts.portfolio.set_inner(PortfolioV2 {
        schema_version: SCHEMA_VERSION,
        group: ctx.accounts.group.key(),
        owner: ctx.accounts.owner.key(),
        index,
        children: 0,
        bump: ctx.bumps.portfolio,
    });
    emit_cpi!(event(
        &mut ctx.accounts.group,
        2,
        ctx.accounts.owner.key(),
        ctx.accounts.portfolio.key(),
        index,
        0,
        None,
        vec![]
    )?);
    Ok(())
}

pub fn register(
    ctx: Context<RegisterMarginV2>,
    subaccount_index: u16,
    mode: u8,
    isolated_market_index: u8,
    role: u8,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    active(&ctx.accounts.group)?;
    let portfolio = &mut ctx.accounts.portfolio;
    require!(
        portfolio.schema_version == SCHEMA_VERSION
            && usize::from(ctx.accounts.group.market_count) == MARKET_COUNT
            && valid_identity(
                portfolio.index,
                subaccount_index,
                mode,
                isolated_market_index,
                role
            ),
        ClearingError::Profile
    );
    let child_mask = 1u16
        .checked_shl(u32::from(subaccount_index))
        .ok_or(ClearingError::Profile)?;
    require!(portfolio.children & child_mask == 0, ClearingError::Profile);
    let registry = &mut ctx.accounts.registry;
    require!(
        registry.schema_version == SCHEMA_VERSION
            && usize::from(registry.count) == registry.members.len(),
        ClearingError::Profile
    );
    require!(
        registry.members.len() < MAX_MEMBERS,
        ClearingError::Capacity
    );
    ctx.accounts.margin.set_inner(MarginAccountV2 {
        schema_version: SCHEMA_VERSION,
        group: ctx.accounts.group.key(),
        portfolio: portfolio.key(),
        owner: ctx.accounts.owner.key(),
        subaccount_index,
        id: registry.count,
        mode,
        isolated_market_index,
        role,
        delegate_epoch: 1,
        bump: ctx.bumps.margin,
        ..Default::default()
    });
    portfolio.children |= child_mask;
    registry.members.push(ctx.accounts.margin.key());
    registry.count += 1;
    emit_cpi!(event(
        &mut ctx.accounts.group,
        3,
        ctx.accounts.owner.key(),
        ctx.accounts.margin.key(),
        subaccount_index,
        0,
        None,
        vec![member(&ctx.accounts.margin)]
    )?);
    Ok(())
}

pub fn cash(ctx: Context<GroupCashTransferV2>, amount: u64, withdraw: bool) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let group = &mut ctx.accounts.group;
    active(group)?;
    empty_financial_state(&ctx.accounts.margin)?;
    require!(amount > 0, ClearingError::Amount);
    reconciled(group, ctx.accounts.vault.amount)?;
    let margin = &mut ctx.accounts.margin;
    let operation = if withdraw { cash_sub } else { cash_add };
    margin.cash = arithmetic(operation(margin.cash, amount))?;
    group.total_cash = arithmetic(operation(group.total_cash, amount))?;
    group.allocated_vault = arithmetic(operation(group.allocated_vault, amount))?;
    advance_margin(margin)?;
    if withdraw {
        let bump = [group.bump];
        let signer: &[&[u8]] = &[b"group-v2", group.domain.as_ref(), &bump];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: group.to_account_info(),
                },
                &[signer],
            ),
            amount,
            6,
        )?;
    } else {
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
            6,
        )?;
    }
    ctx.accounts.vault.reload()?;
    reconciled(group, ctx.accounts.vault.amount)?;
    emit_cpi!(event(
        group,
        if withdraw { 5 } else { 4 },
        ctx.accounts.owner.key(),
        margin.key(),
        margin.subaccount_index,
        amount,
        Some(ctx.accounts.vault.amount),
        vec![member(margin)]
    )?);
    Ok(())
}

pub fn transfer(ctx: Context<TransferGroupCashV2>, amount: u64) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    active(&ctx.accounts.group)?;
    empty_financial_state(&ctx.accounts.donor)?;
    empty_financial_state(&ctx.accounts.recipient)?;
    require!(amount > 0, ClearingError::Amount);
    reconciled(&ctx.accounts.group, ctx.accounts.vault.amount)?;
    ctx.accounts.donor.cash = arithmetic(cash_sub(ctx.accounts.donor.cash, amount))?;
    ctx.accounts.recipient.cash = arithmetic(cash_add(ctx.accounts.recipient.cash, amount))?;
    advance_margin(&mut ctx.accounts.donor)?;
    advance_margin(&mut ctx.accounts.recipient)?;
    emit_cpi!(event(
        &mut ctx.accounts.group,
        6,
        ctx.accounts.owner.key(),
        ctx.accounts.donor.key(),
        0,
        amount,
        Some(ctx.accounts.vault.amount),
        vec![member(&ctx.accounts.donor), member(&ctx.accounts.recipient)]
    )?);
    Ok(())
}

pub fn pause(ctx: Context<ControlGroupV2>, paused: bool) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    custody_profile(&ctx.accounts.group)?;
    reconciled(&ctx.accounts.group, ctx.accounts.vault.amount)?;
    ctx.accounts.group.paused = paused;
    emit_cpi!(event(
        &mut ctx.accounts.group,
        7,
        ctx.accounts.authority.key(),
        Pubkey::default(),
        0,
        0,
        Some(ctx.accounts.vault.amount),
        vec![]
    )?);
    Ok(())
}

pub fn classify_surplus(ctx: Context<ControlGroupV2>) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    active(&ctx.accounts.group)?;
    reconciled(&ctx.accounts.group, ctx.accounts.vault.amount)?;
    let surplus = ctx
        .accounts
        .vault
        .amount
        .checked_sub(ctx.accounts.group.allocated_vault)
        .ok_or(ClearingError::Reconciliation)?;
    require!(surplus > 0, ClearingError::Amount);
    ctx.accounts.group.insurance = arithmetic(cash_add(ctx.accounts.group.insurance, surplus))?;
    ctx.accounts.group.allocated_vault =
        arithmetic(cash_add(ctx.accounts.group.allocated_vault, surplus))?;
    emit_cpi!(event(
        &mut ctx.accounts.group,
        8,
        ctx.accounts.authority.key(),
        Pubkey::default(),
        0,
        surplus,
        Some(ctx.accounts.vault.amount),
        vec![]
    )?);
    Ok(())
}
