//! Complete market backing, scoped independently from funded-cash exit authority.
use super::*;

#[event_cpi]
#[derive(Accounts)]
#[instruction(market_index: u8)]
pub struct InitializeMarketBackingV3<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(init, payer = payer, space = 8 + SettlementCertificateV3::INIT_SPACE,
        seeds = [b"settlement-v3", venue.key().as_ref(), &[market_index]], bump)]
    pub certificate: Box<Account<'info, SettlementCertificateV3>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CheckMarketBackingV3<'info> {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(seeds = [b"registry-v3", venue.key().as_ref()], bump = registry.bump, has_one = venue)]
    pub registry: Box<Account<'info, VenueRegistryV3>>,
    #[account(seeds = [b"market-v3", venue.key().as_ref(), &[0]], bump = btc.bump, has_one = venue,
        constraint = venue.markets[0] == btc.key() @ ClearingError::Profile)]
    pub btc: Box<Account<'info, MarketV3>>,
    #[account(seeds = [b"market-v3", venue.key().as_ref(), &[1]], bump = eth.bump, has_one = venue,
        constraint = venue.markets[1] == eth.key() @ ClearingError::Profile)]
    pub eth: Box<Account<'info, MarketV3>>,
    #[account(seeds = [b"ledger-v3", ledger.market.as_ref()], bump = ledger.bump, has_one = venue,
        constraint = ledger.market_index < 2 && venue.markets[usize::from(ledger.market_index)] == ledger.market @ ClearingError::Profile)]
    pub ledger: Box<Account<'info, MarketLedgerV3>>,
    #[account(mut, seeds = [b"settlement-v3", venue.key().as_ref(), &[certificate.market_index]],
        bump = certificate.bump, has_one = venue,
        constraint = certificate.market_index == ledger.market_index @ ClearingError::Profile)]
    pub certificate: Box<Account<'info, SettlementCertificateV3>>,
}

pub fn initialize(ctx: Context<InitializeMarketBackingV3>, market_index: u8) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && market_index < 2,
        ClearingError::Profile
    );
    profile(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    ctx.accounts.certificate.set_inner(SettlementCertificateV3 {
        schema_version: SCHEMA_VERSION,
        venue: ctx.accounts.venue.key(),
        market_index,
        bump: ctx.bumps.certificate,
        ..Default::default()
    });
    increment(&mut ctx.accounts.custody.sequence)?;
    emit_certificate(
        &ctx.accounts.certificate,
        ctx.accounts.custody.sequence,
        ctx.accounts.event_authority.to_account_info(),
    )
}

fn registry_valid(registry: &VenueRegistryV3) -> Result<()> {
    require!(
        registry.schema_version == SCHEMA_VERSION
            && registry.count > 0
            && usize::from(registry.count) == registry.members.len()
            && registry.members.len() <= MAX_MEMBERS,
        ClearingError::ExitCohort
    );
    for (index, key) in registry.members.iter().enumerate() {
        require!(
            !registry.members[..index].contains(key),
            ClearingError::ExitCohort
        );
    }
    Ok(())
}

fn stamps(
    certificate: &SettlementCertificateV3,
    custody: &CustodyV3,
    safety: &SafetyV3,
    registry: &VenueRegistryV3,
    snapshot: &Snapshot,
) -> Result<()> {
    registry_valid(registry)?;
    let selected = usize::from(certificate.market_index);
    require!(
        certificate.schema_version == SCHEMA_VERSION
            && selected < 2
            && certificate.safety_epoch == safety.epoch
            && certificate.membership_version == registry.membership_version
            && certificate.count == registry.count
            && certificate.liability_versions[selected] == custody.liability_versions[selected]
            && certificate.required_market_mask < 4,
        ClearingError::ExitCohort
    );
    for index in 0..2 {
        if certificate.required_market_mask & (1 << index) != 0 {
            require!(
                certificate.observations[index] == snapshot.markets[index].observation_sequence
                    && snapshot.clock.unix_timestamp < certificate.source_deadlines[index]
                    && certificate.funding_bounds[index][0] <= snapshot.risks[index].funding
                    && snapshot.risks[index].funding <= certificate.funding_bounds[index][1],
                ClearingError::ExitCohort
            );
            super::super::group_trading::oracle::action(
                &snapshot.markets[index],
                &snapshot.clock,
                false,
            )?;
        }
    }
    Ok(())
}

pub(crate) fn certified(
    certificate: &Account<SettlementCertificateV3>,
    identity: &AccountFinancialIdentityV3,
    registry: &VenueRegistryV3,
    snapshot: &Snapshot,
    selected: usize,
) -> Result<()> {
    require!(
        selected < 2
            && certificate.market_index as usize == selected
            && certificate.venue == identity.venue.key()
            && certificate.complete
            && certificate.next == certificate.count,
        ClearingError::ExitCohort
    );
    let expected = Pubkey::create_program_address(
        &[
            b"settlement-v3",
            identity.venue.key().as_ref(),
            &[selected as u8],
            &[certificate.bump],
        ],
        &crate::ID,
    )
    .map_err(|_| error!(ClearingError::ExitCohort))?;
    require_keys_eq!(certificate.key(), expected, ClearingError::ExitCohort);
    stamps(
        certificate,
        &identity.custody,
        &identity.safety,
        registry,
        snapshot,
    )
}

#[inline(never)]
fn member(
    info: &AccountInfo,
    registry: &VenueRegistryV3,
    index: usize,
) -> Result<Box<MarginAccountV3>> {
    require!(
        info.owner == &crate::ID
            && !info.is_writable
            && !info.is_signer
            && registry.members.get(index) == Some(info.key)
            && info.data_len() == 8 + MarginAccountV3::INIT_SPACE,
        ClearingError::ExitCohort
    );
    let root = Box::new(MarginAccountV3::try_deserialize(
        &mut &info.try_borrow_data()?[..],
    )?);
    require!(
        root.venue == registry.venue && usize::from(root.id) == index,
        ClearingError::ExitCohort
    );
    let expected = Pubkey::create_program_address(
        &[
            b"margin-v3",
            root.portfolio.as_ref(),
            &root.subaccount_index.to_le_bytes(),
            &[root.bump],
        ],
        &crate::ID,
    )
    .map_err(|_| error!(ClearingError::ExitCohort))?;
    require_keys_eq!(expected, *info.key, ClearingError::ExitCohort);
    trading::model(&root)?;
    Ok(root)
}

/// Returns precisely the market observations needed to establish this root's
/// selected claim and, if it can be a debtor, both gross obligations.
pub(crate) fn debtor_mask(
    root: &MarginAccountV3,
    snapshot: &Snapshot,
    selected: usize,
) -> Result<u8> {
    require!(selected < 2, ClearingError::Profile);
    let model = trading::model(root)?;
    let mut mask = if root.positions[selected].lots != 0 {
        1 << selected
    } else {
        0
    };
    let prices = std::array::from_fn(|index| {
        if root.positions[index].lots < 0 {
            snapshot.risks[index].upper
        } else {
            snapshot.risks[index].lower
        }
    });
    let mut debtor = false;
    for funding in snapshot.bounds[selected] {
        let mut endpoints = snapshot.risks.map(|risk| risk.funding);
        endpoints[selected] = funding;
        debtor |= checked(model.claims(prices, endpoints))?[selected] < 0;
    }
    if debtor {
        for index in 0..2 {
            if root.positions[index].lots != 0 {
                mask |= 1 << index;
            }
        }
        snapshot.held_solvent(model)?;
    }
    for index in 0..2 {
        if mask & (1 << index) != 0 {
            super::super::group_trading::oracle::action(
                &snapshot.markets[index],
                &snapshot.clock,
                false,
            )?;
        }
    }
    Ok(mask)
}

pub fn check(ctx: Context<CheckMarketBackingV3>, start: u16) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    profile(&accounts.venue, &accounts.custody, &accounts.safety)?;
    registry_valid(&accounts.registry)?;
    let snapshot = Snapshot::new([&accounts.btc, &accounts.eth], &Clock::get()?)?;
    let certificate = &mut accounts.certificate;
    let selected = usize::from(certificate.market_index);
    if start == 0 {
        // A valid completed certificate cannot be erased by a permissionless
        // restart. Stale/incomplete scans remain recoverable by any payer.
        require!(
            !certificate.complete
                || stamps(
                    certificate,
                    &accounts.custody,
                    &accounts.safety,
                    &accounts.registry,
                    &snapshot
                )
                .is_err(),
            ClearingError::ExitCohort
        );
        require!(
            certificate.next == 0
                || certificate.complete
                || stamps(
                    certificate,
                    &accounts.custody,
                    &accounts.safety,
                    &accounts.registry,
                    &snapshot
                )
                .is_err()
                || certificate.observations
                    != snapshot
                        .markets
                        .each_ref()
                        .map(|market| market.observation_sequence),
            ClearingError::ExitCohort
        );
        certificate.safety_epoch = accounts.safety.epoch;
        certificate.membership_version = accounts.registry.membership_version;
        certificate.liability_versions = accounts.custody.liability_versions;
        certificate.observations = snapshot
            .markets
            .each_ref()
            .map(|market| market.observation_sequence);
        certificate.funding_bounds = snapshot.bounds;
        certificate.source_deadlines = snapshot
            .markets
            .each_ref()
            .map(|market| market.oracle.source_deadline);
        certificate.required_market_mask = 0;
        certificate.count = accounts.registry.count;
        certificate.next = 0;
        certificate.cash = 0;
        certificate.lots = [0; 2];
        certificate.claim_sum = 0;
        certificate.complete = false;
    }
    stamps(
        certificate,
        &accounts.custody,
        &accounts.safety,
        &accounts.registry,
        &snapshot,
    )?;
    let length = ctx.remaining_accounts.len();
    require!(
        !certificate.complete
            && certificate.next == start
            && (1..=2).contains(&length)
            && usize::from(start) + length <= usize::from(certificate.count),
        ClearingError::ExitCohort
    );
    // Use the frozen funding endpoints for every page, even when current funding
    // has advanced within the same still-valid observation window.
    let bounded = Snapshot {
        bounds: certificate.funding_bounds,
        ..snapshot
    };
    for (offset, info) in ctx.remaining_accounts.iter().enumerate() {
        let root = member(info, &accounts.registry, usize::from(start) + offset)?;
        certificate.required_market_mask |= debtor_mask(&root, &bounded, selected)?;
        stamps(
            certificate,
            &accounts.custody,
            &accounts.safety,
            &accounts.registry,
            &bounded,
        )?;
        if root.positions[selected].lots != 0 || root.positions[selected].virtual_scaled != 0 {
            certificate.cash = certificate
                .cash
                .checked_add(root.cash)
                .ok_or(ClearingError::Arithmetic)?;
        }
        for index in 0..2 {
            certificate.lots[index] = add(
                certificate.lots[index],
                i128::from(root.positions[index].lots),
            )?;
        }
        let position = root.positions[selected];
        let fixed_claim = add(
            position.virtual_scaled,
            i128::from(position.lots)
                .checked_mul(position.funding_checkpoint_scaled)
                .ok_or(ClearingError::Arithmetic)?,
        )?;
        certificate.claim_sum = add(certificate.claim_sum, fixed_claim)?;
    }
    certificate.next += length as u16;
    if certificate.next == certificate.count {
        require!(
            certificate.lots[selected] == 0
                && certificate.claim_sum == checked(math::scaled(accounts.ledger.settlement))?,
            ClearingError::Reconciliation
        );
        certificate.complete = true;
    }
    increment(&mut accounts.custody.sequence)?;
    emit_certificate(
        certificate,
        accounts.custody.sequence,
        accounts.event_authority.to_account_info(),
    )
}

#[inline(never)]
fn emit_certificate<'info>(
    certificate: &Account<SettlementCertificateV3>,
    sequence: u64,
    authority: AccountInfo<'info>,
) -> Result<()> {
    crate::event_cpi::emit(
        &crate::events::AccountBackingChangedV3 {
            venue: certificate.venue,
            sequence,
            slot: Clock::get()?.slot,
            certificate: certificate.key(),
            state: crate::events::BackingSnapshotV3::from(&**certificate),
        },
        authority,
    )
}
