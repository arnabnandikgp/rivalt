//! Complete market backing, scoped independently from funded-cash exit authority.
use super::*;
use financial_core::clearing::scalable::membership::{MembershipCursor, Request};

#[event_cpi]
#[derive(Accounts)]
#[instruction(market_index: u8)]
pub struct InitializeMarketBacking {
    #[account(mut)]
    pub payer: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(init, payer = payer, space = 8 + SettlementCertificate::INIT_SPACE,
        seeds = [b"settlement-v3", venue.address().as_ref(), &[market_index]], bump)]
    pub certificate: Box<BorshAccount<SettlementCertificate>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CheckMarketBacking {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(seeds = [b"registry-v3", venue.address().as_ref()], bump = registry.bump, has_one = venue)]
    pub registry: Box<crate::state::records::RegistryAccount>,
    #[account(seeds = [b"market-v3", venue.address().as_ref(), &[0]], bump = btc.bump, has_one = venue,
        constraint = venue.markets[0] == btc.address().to_owned() @ ClearingError::Profile)]
    pub btc: Box<BorshAccount<Market>>,
    #[account(seeds = [b"market-v3", venue.address().as_ref(), &[1]], bump = eth.bump, has_one = venue,
        constraint = venue.markets[1] == eth.address().to_owned() @ ClearingError::Profile)]
    pub eth: Box<BorshAccount<Market>>,
    #[account(seeds = [b"ledger-v3", ledger.market.as_ref()], bump = ledger.bump, has_one = venue,
        constraint = ledger.market_index < 2 && venue.markets[usize::from(ledger.market_index)] == ledger.market @ ClearingError::Profile)]
    pub ledger: Box<BorshAccount<MarketLedger>>,
    #[account(mut, seeds = [b"settlement-v3", venue.address().as_ref(), &[certificate.market_index]],
        bump = certificate.bump, has_one = venue,
        constraint = certificate.market_index == ledger.market_index @ ClearingError::Profile)]
    pub certificate: Box<BorshAccount<SettlementCertificate>>,
}

pub fn initialize(
    ctx: &mut Context<InitializeMarketBacking>,
    events: &mut crate::event_cpi::Payloads,
    market_index: u8,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    require!(
        remaining_accounts.is_empty() && market_index < 2,
        ClearingError::Profile
    );
    profile(&ctx.accounts.venue, &ctx.accounts.safety)?;
    **ctx.accounts.certificate = SettlementCertificate {
        schema_version: SCHEMA_VERSION,
        venue: ctx.accounts.venue.address().to_owned(),
        market_index,
        bump: ctx.bumps.certificate,
        ..Default::default()
    };

    emit_certificate(
        &ctx.accounts.certificate,
        events,
        ctx.accounts.event_authority.account().clone(),
    )
}

fn registry_valid(registry: &VenueRegistry) -> Result<()> {
    crate::instructions::account_membership::members::registry(registry)?;
    require!(registry.financial_count > 0, ClearingError::ExitCohort);
    Ok(())
}

fn stamps(
    certificate: &SettlementCertificate,
    ledger: &MarketLedger,
    safety: &VenueSafety,
    registry: &VenueRegistry,
    snapshot: &Snapshot,
) -> Result<()> {
    registry_valid(registry)?;
    let selected = usize::from(certificate.market_index);
    require!(
        certificate.schema_version == SCHEMA_VERSION
            && selected < 2
            && ledger.schema_version == SCHEMA_VERSION
            && ledger.venue == certificate.venue
            && ledger.market_index as usize == selected
            && certificate.safety_epoch == safety.epoch
            && certificate.membership_version == registry.membership_epoch
            && certificate.count == registry.financial_count
            && certificate.liability_version == ledger.liability_version
            && certificate.required_market_mask < 4,
        ClearingError::ExitCohort
    );
    for index in 0..2 {
        if certificate.required_market_mask & (1 << index) != 0 {
            require!(
                certificate.observations[index] == snapshot.market(index)?.observation_sequence
                    && snapshot.clock.unix_timestamp < certificate.source_deadlines[index]
                    && certificate.funding_bounds[index][0] <= snapshot.risks[index].funding
                    && snapshot.risks[index].funding <= certificate.funding_bounds[index][1],
                ClearingError::ExitCohort
            );
            crate::engine::oracle::action(snapshot.market(index)?, &snapshot.clock, false)?;
        }
    }
    Ok(())
}

pub(crate) fn certified(
    certificate: &BorshAccount<SettlementCertificate>,
    identity: &AccountFinancialIdentity,
    registry: &VenueRegistry,
    snapshot: &Snapshot,
    ledger: &MarketLedger,
    selected: usize,
) -> Result<()> {
    require!(
        selected < 2
            && certificate.market_index as usize == selected
            && certificate.venue == identity.venue.address().to_owned()
            && certificate.complete
            && certificate.next == certificate.count,
        ClearingError::ExitCohort
    );
    let expected = create_program_address(
        &[
            b"settlement-v3",
            identity.venue.address().as_ref(),
            &[selected as u8],
            &[certificate.bump],
        ],
        &crate::ID,
    )
    .map_err(|_| ProgramError::from(ClearingError::ExitCohort))?;
    require_keys_eq!(
        certificate.address().to_owned(),
        expected,
        ClearingError::ExitCohort
    );
    stamps(certificate, ledger, &identity.safety, registry, snapshot)
}

/// Returns precisely the market observations needed to establish this root's
/// selected claim and, if it can be a debtor, both gross obligations.
pub(crate) fn debtor_mask(
    root: &MarginAccount,
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
            crate::engine::oracle::action(snapshot.market(index)?, &snapshot.clock, false)?;
        }
    }
    Ok(mask)
}

pub fn check(
    ctx: &mut Context<CheckMarketBacking>, events: &mut crate::event_cpi::Payloads,
    revision: u64, restart: bool,
) -> Result<()> {
    let remaining = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    profile(&accounts.venue, &accounts.safety)?;
    registry_valid(&accounts.registry)?;
    let mut snapshot = Snapshot::new([&accounts.btc, &accounts.eth], &Clock::get()?)?;
    let certificate = &mut accounts.certificate;
    require!(certificate.revision == revision, ClearingError::ExitCohort);
    if restart {
        // An authenticated complete scan cannot be permissionlessly erased while
        // its financial stamps still hold. Node-only progress is progress too.
        let current = stamps(certificate, &accounts.ledger, &accounts.safety, &accounts.registry, &snapshot).is_ok();
        let changed_observation = certificate.observations != [snapshot.market(0)?, snapshot.market(1)?]
            .map(|market| market.observation_sequence);
        require!(!current || (!certificate.complete && changed_observation), ClearingError::ExitCohort);
        certificate.safety_epoch = accounts.safety.epoch;
        certificate.membership_version = accounts.registry.membership_epoch;
        certificate.liability_version = accounts.ledger.liability_version;
        certificate.observations = [snapshot.market(0)?, snapshot.market(1)?].map(|market| market.observation_sequence);
        certificate.funding_bounds = snapshot.bounds;
        certificate.source_deadlines = [snapshot.market(0)?, snapshot.market(1)?].map(|market| market.oracle.source_deadline);
        certificate.required_market_mask = 0;
        certificate.count = accounts.registry.financial_count;
        certificate.next = 0;
        certificate.cash = 0;
        certificate.lots = [0; 2];
        certificate.claim_sum = 0;
        certificate.complete = false;
        certificate.membership.checkpoint = MembershipCursor::new(certificate.count)
            .map_err(|_| ClearingError::ExitCohort)?.checkpoint();
    }
    stamps(certificate, &accounts.ledger, &accounts.safety, &accounts.registry, &snapshot)?;
    require!(!certificate.complete, ClearingError::ExitCohort);
    // Keep one market snapshot. The bounded traversal and its serialized cursor
    // have a separate SBF frame; no second full Snapshot is moved onto this one.
    snapshot.bounds = certificate.funding_bounds;
    scan_certificate(certificate, &accounts.ledger, &accounts.safety, &accounts.registry, &snapshot, &remaining)?;
    emit_certificate(certificate, events, accounts.event_authority.account().clone())
}

#[inline(never)]
fn scan_certificate(
    certificate: &mut SettlementCertificate,
    ledger: &MarketLedger,
    safety: &VenueSafety,
    registry: &VenueRegistry,
    snapshot: &Snapshot,
    remaining: &[AccountView],
) -> Result<()> {
    let selected = usize::from(certificate.market_index);
    let mut cursor = MembershipCursor::from_checkpoint(&certificate.membership.checkpoint, certificate.count)
        .map_err(|_| ClearingError::ExitCohort)?;
    if let Some(root) = crate::instructions::account_membership::scan::step(&mut cursor, &certificate.venue, &remaining)? {
        certificate.required_market_mask |= debtor_mask(&root, snapshot, selected)?;
        stamps(certificate, ledger, safety, registry, snapshot)?;
        if root.positions[selected].lots != 0 || root.positions[selected].virtual_scaled != 0 {
            certificate.cash = certificate.cash.checked_add(root.cash).ok_or(ClearingError::Arithmetic)?;
        }
        for index in 0..2 { certificate.lots[index] = add(certificate.lots[index], i128::from(root.positions[index].lots))?; }
        let position = root.positions[selected];
        let fixed_claim = add(position.virtual_scaled, i128::from(position.lots)
            .checked_mul(position.funding_checkpoint_scaled).ok_or(ClearingError::Arithmetic)?)?;
        certificate.claim_sum = add(certificate.claim_sum, fixed_claim)?;
        certificate.next = certificate.next.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    }
    certificate.membership.checkpoint = cursor.checkpoint();
    if cursor.request() == Request::Done {
        require!(certificate.next == certificate.count && certificate.lots[selected] == 0
            && certificate.claim_sum == checked(math::scaled(ledger.settlement))?, ClearingError::Reconciliation);
        certificate.complete = true;
    }
    Ok(())
}

#[inline(never)]
fn emit_certificate<'info>(
    certificate: &BorshAccount<SettlementCertificate>,
    events: &mut crate::event_cpi::Payloads,
    authority: AccountView,
) -> Result<()> {
    events.emit(
        &crate::events::AccountBackingChanged {
            venue: certificate.venue,
            slot: Clock::get()?.slot,
            certificate: certificate.address().to_owned(),
            state: crate::events::BackingSnapshot::from(&**certificate),
        },
        authority,
    )
}
