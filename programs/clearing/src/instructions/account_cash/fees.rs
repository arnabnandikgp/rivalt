//! Market-local treasury accounting; only actual token exits load custody.
use super::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
pub struct TreasuryIdentity {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"ledger-v3", ledger.market.as_ref()], bump = ledger.bump, has_one = venue,
        constraint = ledger.market_index < 2 && ledger.market == venue.markets[ledger.market_index as usize] @ ClearingError::Profile)]
    pub ledger: Box<BorshAccount<MarketLedger>>,
}

#[derive(Accounts)]
pub struct TreasuryTokenIdentity {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = vault)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"ledger-v3", ledger.market.as_ref()], bump = ledger.bump, has_one = venue,
        constraint = ledger.market_index < 2 && ledger.market == venue.markets[ledger.market_index as usize] @ ClearingError::Profile)]
    pub ledger: Box<BorshAccount<MarketLedger>>,
    #[account(mut, seeds = [b"custody-v3", venue.address().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(mut, seeds = [b"vault-v3", venue.address().as_ref()], bump = venue.vault_bump,
        constraint = *vault.owner() == venue.address().to_owned() && *vault.mint() == venue.quote_mint @ ClearingError::Mint)]
    pub vault: Box<Account<TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AllocateMarketFees {
    pub identity: Nested<TreasuryIdentity>,
    #[account(address = identity.venue.fee_authority @ ClearingError::Authority)]
    pub fee_authority: Signer,
}

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawMarketFees {
    pub identity: Nested<TreasuryTokenIdentity>,
    #[account(address = identity.venue.fee_authority @ ClearingError::Authority)]
    pub fee_authority: Signer,
    #[account(address = identity.venue.quote_mint @ ClearingError::Mint)]
    pub quote_mint: Box<Account<Mint>>,
    #[account(mut, token::mint = quote_mint, token::authority = fee_authority,
        constraint = user_token.address().to_owned() != identity.vault.address().to_owned() @ ClearingError::Alias)]
    pub user_token: Box<Account<TokenAccount>>,
    pub token_program: Program<Token>,
}

/// Read every canonical registration for the current bounded market and commit
/// unclassified fees. No caller chooses the interest, market or destination.
#[event_cpi]
#[derive(Accounts)]
pub struct ClassifyMarketFees {
    pub identity: Nested<TreasuryIdentity>,
    #[account(seeds=[b"maker-v4",identity.ledger.market.as_ref(),&[0]],bump=first.bump)]
    pub first: Box<BorshAccount<crate::state::liquidity::MakerRegistration>>,
    #[account(seeds=[b"maker-v4",identity.ledger.market.as_ref(),&[1]],bump=second.bump)]
    pub second: Box<BorshAccount<crate::state::liquidity::MakerRegistration>>,
    #[account(seeds=[b"maker-v4",identity.ledger.market.as_ref(),&[2]],bump=third.bump)]
    pub third: Box<BorshAccount<crate::state::liquidity::MakerRegistration>>,
}

pub fn classify(ctx:&mut Context<ClassifyMarketFees>, events:&mut crate::event_cpi::Payloads) -> Result<()> {
    #[cfg(not(feature="aggregate-fee-qualification"))]
    { let _=(ctx,events); return Err(ClearingError::Profile.into()); }
    #[cfg(feature="aggregate-fee-qualification")]
    {
        require!(ctx.remaining_accounts()?.is_empty(),ClearingError::Profile);
        let a=&mut ctx.accounts;
        require!(a.identity.venue.insurance_fee_share_bps==2500 && a.identity.safety.mode!=FROZEN, ClearingError::Profile);
        #[cfg(feature="listed-venue-execution")]
        if a.identity.venue.profile_version == LISTED_VENUE_PROFILE {
            crate::instructions::maker_liquidity::routes::listed_venue::active_profile(&a.identity.venue,&a.identity.safety)?;
        }
        let ledger=&mut a.identity.ledger;
        #[cfg(feature="read-only-route-ledger")]
        crate::ledger_lane::fold(ledger, [&a.first,&a.second,&a.third])?;
        let (classified,amount,credit)=crate::market_fees::collect(ledger,[&mut a.first,&mut a.second,&mut a.third])?;
        events.emit(&crate::events::MarketFeesClassified{venue:ledger.venue,market:ledger.market,slot:Clock::get()?.slot,classified,amount,insurance_credit:credit,
            ledger:super::super::account_custody::ledger_snapshot(ledger)},a.event_authority.account().clone())
    }
}

pub(crate) fn treasury_profile(
    venue: &Venue,
    safety: &VenueSafety,
    ledger: &MarketLedger,
    selected: u8,
) -> Result<()> {
    require!(
        cfg!(feature = "liquidity-execution-qualification")
            && venue.schema_version == SCHEMA_VERSION
            && trading::supported_profile(venue)
            && venue.insurance_fee_share_bps == 2500
            && safety.schema_version == SCHEMA_VERSION
            && matches!(safety.mode, CUSTODY | ACTIVE | RESOLVED | RETIRED)
            && selected < 2
            && ledger.market_index == selected
            && ledger.schema_version == SCHEMA_VERSION
            && ledger.insurance_fee_remainder < 4,
        ClearingError::Profile
    );
    require!(!safety.paused, ClearingError::Paused);
    Ok(())
}

pub fn allocate(
    ctx: &mut Context<AllocateMarketFees>,
    events: &mut crate::event_cpi::Payloads,
    market_index: u8,
    amount: u64,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(
        remaining_accounts.is_empty() && amount > 0,
        ClearingError::Amount
    );
    let accounts = &mut ctx.accounts;
    let identity = &mut *accounts.identity;
    #[cfg(feature="aggregate-fee-qualification")]
    crate::market_fees::clean(&mut identity.ledger)?;
    treasury_profile(
        &identity.venue,
        &identity.safety,
        &identity.ledger,
        market_index,
    )?;
    identity.ledger.fees = checked(math::cash_sub(identity.ledger.fees, amount))?;
    identity.ledger.insurance = checked(math::cash_add(identity.ledger.insurance, amount))?;
    increment(&mut identity.ledger.version)?;
    emit_treasury(
        &identity.venue,
        &identity.safety,
        &identity.ledger,
        events,
        accounts.event_authority.account().clone(),
        accounts.fee_authority.address().to_owned(),
        5,
        amount,
        None,
    )
}

pub fn withdraw(
    ctx: &mut Context<WithdrawMarketFees>,
    events: &mut crate::event_cpi::Payloads,
    market_index: u8,
    amount: u64,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(
        remaining_accounts.is_empty() && amount > 0,
        ClearingError::Amount
    );
    let accounts = &mut ctx.accounts;
    let identity = &mut *accounts.identity;
    #[cfg(feature="aggregate-fee-qualification")]
    crate::market_fees::clean(&mut identity.ledger)?;
    treasury_profile(
        &identity.venue,
        &identity.safety,
        &identity.ledger,
        market_index,
    )?;
    super::super::account_custody::vault_backed(&identity.custody, identity.vault.amount())?;
    identity.ledger.fees = checked(math::cash_sub(identity.ledger.fees, amount))?;
    identity.custody.allocated_vault =
        checked(math::cash_sub(identity.custody.allocated_vault, amount))?;
    increment(&mut identity.ledger.version)?;
    let bump = [identity.venue.bump];
    let seeds: &[&[u8]] = &[b"venue-v3", &identity.venue.domain, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            accounts.token_program.address(),
            TransferChecked {
                from: identity.vault.try_to_cpi_handle_mut()?,
                to: accounts.user_token.try_to_cpi_handle_mut()?,
                mint: accounts.quote_mint.to_cpi_handle(),
                authority: identity.venue.to_cpi_handle(),
            },
            &[seeds],
        ),
        amount,
        6,
    )?;
    identity.vault.revalidate_after_cpi()?;
    super::super::account_custody::vault_backed(&identity.custody, identity.vault.amount())?;
    emit_treasury(
        &identity.venue,
        &identity.safety,
        &identity.ledger,
        events,
        accounts.event_authority.account().clone(),
        accounts.fee_authority.address().to_owned(),
        6,
        amount,
        Some((identity.custody.allocated_vault, identity.vault.amount())),
    )
}

fn emit_treasury<'info>(
    venue: &BorshAccount<Venue>,
    safety: &VenueSafety,
    ledger: &BorshAccount<MarketLedger>,
    events: &mut crate::event_cpi::Payloads,
    authority: AccountView,
    actor: Address,
    kind: u8,
    amount: u64,
    tokens: Option<(u64, u64)>,
) -> Result<()> {
    events.emit(
        &crate::events::AccountFinancialChanged {
            venue: venue.address().to_owned(),
            slot: Clock::get()?.slot,
            actor,
            kind,
            market_index: ledger.market_index,
            amount,
            safety_epoch: safety.epoch,
            allocated_vault: tokens.map(|value| value.0),
            actual_vault: tokens.map(|value| value.1),
            roots: vec![],
            root_states: vec![],
            markets: vec![],
            ledgers: vec![super::super::account_custody::ledger_snapshot(ledger)],
        },
        authority,
    )
}
