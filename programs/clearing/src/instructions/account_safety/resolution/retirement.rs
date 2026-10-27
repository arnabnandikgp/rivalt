//! Irreversible venue retirement. The scan is an administrative proof, never a
//! prerequisite for a funded owner exit. No reserve can leave a live identity.
use super::*;
use account_cash::{
    __client_accounts_account_financial_identity_v3,
    __cpi_client_accounts_account_financial_identity_v3, AccountFinancialIdentityV3,
    AccountFinancialIdentityV3Bumps,
};
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
pub struct InitializeAccountRetirementV3<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(init, payer = payer, space = 8 + RetirementCertificateV3::INIT_SPACE,
        seeds = [b"retirement-v3", venue.key().as_ref()], bump)]
    pub certificate: Box<Account<'info, RetirementCertificateV3>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CheckAccountRetirementV3<'info> {
    pub identity: ResolutionIdentityV3<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistryV3>>,
    #[account(mut, seeds = [b"retirement-v3", identity.venue.key().as_ref()], bump = certificate.bump,
        constraint = certificate.venue == identity.venue.key() @ ClearingError::Profile)]
    pub certificate: Box<Account<'info, RetirementCertificateV3>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RetireAccountsV3<'info> {
    pub identity: ResolutionIdentityV3<'info>,
    #[account(address = identity.venue.authority @ ClearingError::Authority)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"registry-v3", identity.venue.key().as_ref()], bump = registry.bump,
        constraint = registry.venue == identity.venue.key() @ ClearingError::Profile)]
    pub registry: Box<Account<'info, VenueRegistryV3>>,
    #[account(seeds = [b"retirement-v3", identity.venue.key().as_ref()], bump = certificate.bump,
        constraint = certificate.venue == identity.venue.key() @ ClearingError::Profile)]
    pub certificate: Option<Box<Account<'info, RetirementCertificateV3>>>,
    #[account(mut, seeds = [b"resolution-v3", identity.venue.key().as_ref()], bump = resolution.bump,
        constraint = resolution.venue == identity.venue.key() @ ClearingError::Profile)]
    pub resolution: Option<Box<Account<'info, ResolutionV3>>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawRetiredReserveV3<'info> {
    pub identity: AccountFinancialIdentityV3<'info>,
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

fn reserve_destination(venue: &VenueV3) -> Pubkey {
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

fn registry_valid(registry: &VenueRegistryV3) -> Result<()> {
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
    certificate: &RetirementCertificateV3,
    safety: &SafetyV3,
    custody: &CustodyV3,
    registry: &VenueRegistryV3,
) -> bool {
    certificate.schema_version == SCHEMA_VERSION
        && certificate.safety_epoch == safety.epoch
        && certificate.membership_version == registry.membership_version
        && certificate.custody_sequence == custody.sequence
        && certificate.count == registry.count
}

fn global_flat(identity: &ResolutionIdentityV3) -> Result<()> {
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

pub fn initialize(ctx: Context<InitializeAccountRetirementV3>) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty()
            && cfg!(feature = "account-safety-qualification")
            && ctx.accounts.venue.schema_version == SCHEMA_VERSION
            && ctx.accounts.venue.profile_version == PROFILE_VERSION
            && ctx.accounts.safety.schema_version == SCHEMA_VERSION
            && matches!(ctx.accounts.safety.mode, CUSTODY | ACTIVE | RESOLVED),
        ClearingError::Profile
    );
    ctx.accounts.certificate.set_inner(RetirementCertificateV3 {
        schema_version: SCHEMA_VERSION,
        venue: ctx.accounts.venue.key(),
        bump: ctx.bumps.certificate,
        ..Default::default()
    });
    Ok(())
}

pub fn check(ctx: Context<CheckAccountRetirementV3>, start: u16) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    global_flat(&accounts.identity)?;
    require!(
        matches!(accounts.identity.safety.mode, CUSTODY | ACTIVE),
        ClearingError::Resolution
    );
    registry_valid(&accounts.registry)?;
    let length = ctx.remaining_accounts.len();
    require!(
        (1..=2).contains(&length) || (length == 0 && accounts.registry.count == 0),
        ClearingError::Resolution
    );
    let certificate = &mut accounts.certificate;
    let current = matches(
        certificate,
        &accounts.identity.safety,
        &accounts.identity.custody,
        &accounts.registry,
    );
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
            certificate.cash == accounts.identity.custody.total_cash,
            ClearingError::Reconciliation
        );
        certificate.complete = true;
    }
    increment(&mut accounts.identity.custody.sequence)?;
    certificate.custody_sequence = accounts.identity.custody.sequence;
    crate::event_cpi::emit(
        &crate::events::AccountRetirementProgressV3 {
            venue: accounts.identity.venue.key(),
            sequence: accounts.identity.custody.sequence,
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

pub fn retire(ctx: Context<RetireAccountsV3>, safety_epoch: u64) -> Result<()> {
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
            matches(
                certificate,
                &accounts.identity.safety,
                &accounts.identity.custody,
                &accounts.registry
            ) && certificate.complete
                && certificate.next == certificate.count
                && certificate.cash == accounts.identity.custody.total_cash,
            ClearingError::Resolution
        );
    }
    accounts.identity.safety.mode = RETIRED;
    accounts.identity.safety.paused = false;
    increment(&mut accounts.identity.safety.epoch)?;
    increment(&mut accounts.identity.venue.terms_epoch)?;
    increment(&mut accounts.identity.custody.sequence)?;
    crate::event_cpi::emit(
        &crate::events::AccountsRetiredV3 {
            venue: accounts.identity.venue.key(),
            sequence: accounts.identity.custody.sequence,
            slot: Clock::get()?.slot,
            safety_epoch: accounts.identity.safety.epoch,
            terms_epoch: accounts.identity.venue.terms_epoch,
            count: accounts.registry.count,
            total_cash: accounts.identity.custody.total_cash,
            allocated_vault: accounts.identity.custody.allocated_vault,
            actual_vault: accounts.identity.vault.amount,
        },
        accounts.event_authority.to_account_info(),
    )
}

pub fn withdraw(
    ctx: Context<WithdrawRetiredReserveV3>,
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
        cfg!(feature = "account-safety-qualification")
            && identity.venue.schema_version == SCHEMA_VERSION
            && identity.venue.profile_version == PROFILE_VERSION
            && identity.custody.schema_version == SCHEMA_VERSION
            && identity.safety.schema_version == SCHEMA_VERSION
            && identity.safety.mode == RETIRED
            && !identity.safety.paused,
        ClearingError::Profile
    );
    account_custody::reconciled(
        &identity.custody,
        [&identity.btc_ledger, &identity.eth_ledger],
        identity.vault.amount,
    )?;
    let ledger = if market_index == 0 {
        &mut identity.btc_ledger
    } else {
        &mut identity.eth_ledger
    };
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
    increment(&mut identity.custody.sequence)?;
    account_custody::reconciled(
        &identity.custody,
        [&identity.btc_ledger, &identity.eth_ledger],
        identity.vault.amount,
    )?;
    let ledger = if market_index == 0 {
        &identity.btc_ledger
    } else {
        &identity.eth_ledger
    };
    crate::event_cpi::emit(
        &crate::events::RetiredReserveWithdrawnV3 {
            venue: identity.venue.key(),
            sequence: identity.custody.sequence,
            slot: Clock::get()?.slot,
            authority: accounts.reserve_authority.key(),
            destination: accounts.destination.key(),
            market_index,
            amount,
            insurance: ledger.insurance,
            fees: ledger.fees,
            fee_remainder: ledger.insurance_fee_remainder,
            ledger_version: ledger.version,
            total_cash: identity.custody.total_cash,
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
    fn certificate_binds_all_mutation_and_membership_stamps() {
        let mut proof = RetirementCertificateV3 {
            schema_version: SCHEMA_VERSION,
            safety_epoch: 2,
            membership_version: 3,
            custody_sequence: 17,
            count: 2,
            ..Default::default()
        };
        let safety = SafetyV3 {
            epoch: 2,
            ..Default::default()
        };
        let custody = CustodyV3 {
            sequence: 17,
            ..Default::default()
        };
        let registry = VenueRegistryV3 {
            membership_version: 3,
            count: 2,
            ..Default::default()
        };
        assert!(matches(&proof, &safety, &custody, &registry));
        for field in 0..4 {
            let value = match field {
                0 => &mut proof.safety_epoch,
                1 => &mut proof.membership_version,
                2 => &mut proof.custody_sequence,
                _ => {
                    proof.count += 1;
                    assert!(!matches(&proof, &safety, &custody, &registry));
                    break;
                }
            };
            *value += 1;
            assert!(!matches(&proof, &safety, &custody, &registry));
            match field {
                0 => proof.safety_epoch -= 1,
                1 => proof.membership_version -= 1,
                _ => proof.custody_sequence -= 1,
            }
        }
    }
}
