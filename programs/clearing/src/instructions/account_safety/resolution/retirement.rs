//! Irreversible venue retirement. The scan is an administrative proof, never a
//! prerequisite for a funded owner exit. No reserve can leave a live identity.
use super::*;
use account_cash::fees::{
    __client_accounts_treasury_token_identity, __cpi_client_accounts_treasury_token_identity,
    TreasuryTokenIdentity, TreasuryTokenIdentityBumps,
};
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeAccountRetirement<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(init, payer = payer, space = 8 + RetirementCertificate::INIT_SPACE,
        seeds = [b"retirement-v3", venue.key().as_ref()], bump)]
    pub certificate: Box<Account<'info, RetirementCertificate>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CheckAccountRetirement<'info> {
    pub identity: ResolutionIdentity<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistry>>,
    #[account(mut, seeds = [b"retirement-v3", identity.venue.key().as_ref()], bump = certificate.bump,
        constraint = certificate.venue == identity.venue.key() @ ClearingError::Profile)]
    pub certificate: Box<Account<'info, RetirementCertificate>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RetireAccounts<'info> {
    pub identity: ResolutionIdentity<'info>,
    #[account(address = identity.venue.authority @ ClearingError::Authority)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistry>>,
    #[account(seeds = [b"retirement-v3", identity.venue.key().as_ref()], bump = certificate.bump,
        constraint = certificate.venue == identity.venue.key() @ ClearingError::Profile)]
    pub certificate: Option<Box<Account<'info, RetirementCertificate>>>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.key() @ ClearingError::Profile)]
    pub resolution: Option<Box<Account<'info, Resolution>>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawRetiredReserve<'info> {
    pub identity: TreasuryTokenIdentity<'info>,
    #[account(address = identity.venue.reserve_authority @ ClearingError::Authority)]
    pub reserve_authority: Signer<'info>,
    #[account(address = identity.venue.quote_mint @ ClearingError::Mint)]
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = quote_mint,
        constraint = destination.owner == identity.venue.reserve_destination_owner @ ClearingError::Authority,
        constraint = destination.key() == reserve_destination(&identity.venue) @ ClearingError::Mint,
        constraint = destination.key() != identity.vault.key() @ ClearingError::Alias)]
    pub destination: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

fn reserve_destination(venue: &Venue) -> Pubkey {
    Pubkey::find_program_address(
        &[
            venue.reserve_destination_owner.as_ref(),
            token::ID.as_ref(),
            venue.quote_mint.as_ref(),
        ],
        &pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    )
    .0
}

fn registry_valid(registry: &VenueRegistry) -> Result<()> {
    require!(
        registry.schema_version == SCHEMA_VERSION
            && usize::from(registry.count) == registry.members.len()
            && registry.members.len() <= MAX_MEMBERS,
        ClearingError::Resolution
    );
    if registry.count > 0 {
        registry_hash(registry)?;
    }
    Ok(())
}

fn matches(
    certificate: &RetirementCertificate,
    safety: &VenueSafety,
    registry: &VenueRegistry,
) -> bool {
    certificate.schema_version == SCHEMA_VERSION
        && certificate.safety_epoch == safety.epoch
        && certificate.membership_version == registry.membership_version
        && safety.paused
        && certificate.count == registry.count
}

fn global_flat(identity: &ResolutionIdentity) -> Result<()> {
    profile(identity)?;
    require!(
        identity.btc.gross_lots == 0
            && identity.eth.gross_lots == 0
            && identity.btc_ledger.settlement == 0
            && identity.eth_ledger.settlement == 0,
        ClearingError::Resolution
    );
    Ok(())
}

pub fn initialize(
    ctx: &mut Context<InitializeAccountRetirement>,
    _events: &mut crate::event_cpi::Payloads,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty()
            && cfg!(feature = "liquidity-execution-qualification")
            && ctx.accounts.venue.schema_version == SCHEMA_VERSION
            && account_trading::supported_profile(&ctx.accounts.venue)
            && ctx.accounts.safety.schema_version == SCHEMA_VERSION
            && matches!(ctx.accounts.safety.mode, CUSTODY | ACTIVE | RESOLVED),
        ClearingError::Profile
    );
    ctx.accounts.certificate.set_inner(RetirementCertificate {
        schema_version: SCHEMA_VERSION,
        venue: ctx.accounts.venue.key(),
        bump: ctx.bumps.certificate,
        ..Default::default()
    });
    Ok(())
}

pub fn check(
    ctx: &mut Context<CheckAccountRetirement>,
    events: &mut crate::event_cpi::Payloads,
    start: u16,
) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    global_flat(&accounts.identity)?;
    require!(
        matches!(accounts.identity.safety.mode, CUSTODY | ACTIVE)
            && accounts.identity.safety.paused,
        ClearingError::Resolution
    );
    registry_valid(&accounts.registry)?;
    let length = ctx.remaining_accounts.len();
    require!(
        (1..=2).contains(&length) || (length == 0 && accounts.registry.count == 0),
        ClearingError::Resolution
    );
    let certificate = &mut accounts.certificate;
    let current = matches(certificate, &accounts.identity.safety, &accounts.registry);
    if start == 0 {
        require!(
            !current || (!certificate.complete && certificate.next == 0),
            ClearingError::Resolution
        );
        certificate.safety_epoch = accounts.identity.safety.epoch;
        certificate.membership_version = accounts.registry.membership_version;
        certificate.count = accounts.registry.count;
        certificate.next = 0;
        certificate.cash = 0;
        certificate.complete = false;
    } else {
        require!(current && !certificate.complete, ClearingError::Resolution);
    }
    require!(
        certificate.next == start && usize::from(start) + length <= usize::from(certificate.count),
        ClearingError::Resolution
    );
    for (offset, info) in ctx.remaining_accounts.iter().enumerate() {
        let root = pages::member(info, &accounts.registry, usize::from(start) + offset, false)?;
        account_custody::liability_free(&root)?;
        certificate.cash = checked(math::cash_add(certificate.cash, root.cash))?;
    }
    certificate.next = start
        .checked_add(length as u16)
        .ok_or(ClearingError::Arithmetic)?;
    if certificate.next == certificate.count {
        require!(
            certificate.cash
                == account_custody::accounted_cash(
                    &accounts.identity.custody,
                    [&accounts.identity.btc_ledger, &accounts.identity.eth_ledger]
                )?,
            ClearingError::Reconciliation
        );
        certificate.complete = true;
    }

    events.emit(
        &crate::events::AccountRetirementProgress {
            venue: accounts.identity.venue.key(),

            slot: Clock::get()?.slot,
            safety_epoch: certificate.safety_epoch,
            membership_version: certificate.membership_version,
            count: certificate.count,
            next: certificate.next,
            cash: certificate.cash,
            complete: certificate.complete,
        },
        accounts.event_authority.to_account_info(),
    )
}

pub fn retire(
    ctx: &mut Context<RetireAccounts>,
    events: &mut crate::event_cpi::Payloads,
    safety_epoch: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    let accounts = &mut *ctx.accounts;
    global_flat(&accounts.identity)?;
    registry_valid(&accounts.registry)?;
    require!(
        accounts.identity.safety.epoch == safety_epoch,
        ClearingError::Resolution
    );
    if accounts.identity.safety.mode == RESOLVED {
        require!(accounts.certificate.is_none(), ClearingError::Resolution);
        let header = accounts
            .resolution
            .as_mut()
            .ok_or(ClearingError::Resolution)?;
        require!(
            header.schema_version == SCHEMA_VERSION
                && header.stage == COMPLETE
                && header.epoch == accounts.identity.safety.resolution_epoch
                && header.cursor == header.count
                && header.count == accounts.registry.count
                && header.registry_hash == registry_hash(&accounts.registry)?,
            ClearingError::Resolution
        );
        header.stage = TERMINAL;
    } else {
        require!(
            matches!(accounts.identity.safety.mode, CUSTODY | ACTIVE)
                && accounts.resolution.is_none(),
            ClearingError::Resolution
        );
        let certificate = accounts
            .certificate
            .as_ref()
            .ok_or(ClearingError::Resolution)?;
        require!(
            matches(certificate, &accounts.identity.safety, &accounts.registry)
                && certificate.complete
                && certificate.next == certificate.count
                && certificate.cash
                    == account_custody::accounted_cash(
                        &accounts.identity.custody,
                        [&accounts.identity.btc_ledger, &accounts.identity.eth_ledger]
                    )?,
            ClearingError::Resolution
        );
    }
    accounts.identity.safety.mode = RETIRED;
    accounts.identity.safety.paused = false;
    increment(&mut accounts.identity.safety.epoch)?;
    increment(&mut accounts.identity.venue.terms_epoch)?;

    events.emit(
        &crate::events::AccountsRetired {
            venue: accounts.identity.venue.key(),

            slot: Clock::get()?.slot,
            safety_epoch: accounts.identity.safety.epoch,
            terms_epoch: accounts.identity.venue.terms_epoch,
            count: accounts.registry.count,
            total_cash: account_custody::accounted_cash(
                &accounts.identity.custody,
                [&accounts.identity.btc_ledger, &accounts.identity.eth_ledger],
            )?,
            allocated_vault: accounts.identity.custody.allocated_vault,
            actual_vault: accounts.identity.vault.amount,
        },
        accounts.event_authority.to_account_info(),
    )
}

pub fn withdraw(
    ctx: &mut Context<WithdrawRetiredReserve>,
    events: &mut crate::event_cpi::Payloads,
    market_index: u8,
    amount: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && market_index < 2 && amount > 0,
        ClearingError::Amount
    );
    let accounts = &mut *ctx.accounts;
    let identity = &mut accounts.identity;
    require!(
        cfg!(feature = "liquidity-execution-qualification")
            && identity.venue.schema_version == SCHEMA_VERSION
            && account_trading::supported_profile(&identity.venue)
            && identity.custody.schema_version == SCHEMA_VERSION
            && identity.safety.schema_version == SCHEMA_VERSION
            && identity.safety.mode == RETIRED
            && !identity.safety.paused,
        ClearingError::Profile
    );
    account_custody::vault_backed(&identity.custody, identity.vault.amount)?;
    account_cash::fees::treasury_profile(
        &identity.venue,
        &identity.safety,
        &identity.ledger,
        market_index,
    )?;
    let ledger = &mut identity.ledger;
    ledger.insurance = checked(math::cash_sub(ledger.insurance, amount))?;
    increment(&mut ledger.version)?;
    identity.custody.allocated_vault =
        checked(math::cash_sub(identity.custody.allocated_vault, amount))?;
    let bump = [identity.venue.bump];
    let seeds: &[&[u8]] = &[b"venue-v3", &identity.venue.domain, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            accounts.token_program.key(),
            TransferChecked {
                from: identity.vault.to_account_info(),
                to: accounts.destination.to_account_info(),
                mint: accounts.quote_mint.to_account_info(),
                authority: identity.venue.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        6,
    )?;
    identity.vault.reload()?;

    account_custody::vault_backed(&identity.custody, identity.vault.amount)?;
    let ledger = &identity.ledger;
    events.emit(
        &crate::events::RetiredReserveWithdrawn {
            venue: identity.venue.key(),

            slot: Clock::get()?.slot,
            authority: accounts.reserve_authority.key(),
            destination: accounts.destination.key(),
            market_index,
            amount,
            insurance: ledger.insurance,
            fees: ledger.fees,
            fee_remainder: ledger.insurance_fee_remainder,
            ledger_version: ledger.version,
            allocated_vault: identity.custody.allocated_vault,
            actual_vault: identity.vault.amount,
        },
        accounts.event_authority.to_account_info(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn certificate_requires_the_same_paused_epoch_and_complete_membership() {
        let proof = RetirementCertificate {
            schema_version: SCHEMA_VERSION,
            safety_epoch: 2,
            membership_version: 3,
            count: 2,
            ..Default::default()
        };
        let mut safety = VenueSafety {
            epoch: 2,
            paused: true,
            ..Default::default()
        };
        let mut registry = VenueRegistry {
            membership_version: 3,
            count: 2,
            ..Default::default()
        };
        assert!(matches(&proof, &safety, &registry));
        // Even an incorrectly retained epoch cannot make an unpaused proof valid.
        safety.paused = false;
        assert!(!matches(&proof, &safety, &registry));
        safety.paused = true;
        safety.epoch += 1;
        assert!(!matches(&proof, &safety, &registry));
        safety.epoch -= 1;
        registry.membership_version += 1;
        assert!(!matches(&proof, &safety, &registry));
        registry.membership_version -= 1;
        registry.count += 1;
        assert!(!matches(&proof, &safety, &registry));
        registry.count -= 1;
        // Unrelated journal revisions are not retirement authority.
        safety.revision += 1;
        registry.revision += 1;
        assert!(matches(&proof, &safety, &registry));
    }
}
