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
    #[account(mut, seeds = [b"ledger-v3", ledger.market.as_ref()], bump = ledger.bump, has_one = venue,
        constraint = ledger.market_index < 2 && venue.markets[usize::from(ledger.market_index)] == ledger.market @ ClearingError::Profile)]
    pub ledger: Box<BorshAccount<MarketLedger>>,
    #[account(mut, seeds = [b"settlement-v3", venue.address().as_ref(), &[certificate.market_index]],
        bump = certificate.bump, has_one = venue,
        constraint = certificate.market_index == ledger.market_index @ ClearingError::Profile)]
    pub certificate: Box<BorshAccount<SettlementCertificate>>,
}

// Only the explicit local qualification build can exercise this candidate.
// Default/devnet payment authority stays disabled; artifact promotion is separate.
const MAINTAINED_BACKING_IMPLEMENTED: bool = TRADING_IMPLEMENTED;

pub fn initialize(ctx: &mut Context<InitializeMarketBacking>, events: &mut crate::event_cpi::Payloads,
    market_index: u8) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty() && market_index < 2, ClearingError::Profile);
    profile(&ctx.accounts.venue, &ctx.accounts.safety)?;
    **ctx.accounts.certificate = SettlementCertificate { schema_version: SCHEMA_VERSION,
        venue: *ctx.accounts.venue.address(), market_index, bump: ctx.bumps.certificate, ..Default::default() };
    emit_certificate(&ctx.accounts.certificate, None, None, events, ctx.accounts.event_authority.account().clone())
}

fn registry_valid(registry: &VenueRegistry) -> Result<()> {
    crate::instructions::account_membership::members::registry(registry)?;
    require!(registry.financial_count > 0, ClearingError::ExitCohort);
    Ok(())
}

fn region_current(backing: &BackingState, snapshot: &Snapshot, mask: u8, fresh: bool) -> Result<()> {
    let prices = snapshot.risks.map(|risk| [risk.lower, risk.upper]);
    require!(checked(backing.region.model().contains(mask, prices, snapshot.bounds))?, ClearingError::ExitCohort);
    for index in 0..2 {
        if mask & (1 << index) != 0 {
            let market = snapshot.market(index)?;
            require!(market.config_epoch == backing.config_epochs[index], ClearingError::ExitCohort);
            if fresh { crate::engine::oracle::action(market, &snapshot.clock, false)?; }
        }
    }
    Ok(())
}

fn stamps(certificate: &SettlementCertificate, ledger: &MarketLedger, venue: &Venue,
    safety: &VenueSafety, registry: &VenueRegistry, snapshot: &Snapshot, fresh: bool) -> Result<()> {
    registry_valid(registry)?;
    let selected = usize::from(certificate.market_index);
    let backing = &ledger.backing;
    require!(certificate.schema_version == SCHEMA_VERSION && selected < 2
        && ledger.schema_version == SCHEMA_VERSION && ledger.venue == certificate.venue
        && ledger.market_index as usize == selected && backing.epoch != 0
        && certificate.backing_epoch == backing.epoch && backing.safety_epoch == safety.epoch
        && backing.terms_epoch == venue.terms_epoch && backing.membership_epoch == registry.membership_epoch
        && certificate.count == registry.financial_count && certificate.next <= certificate.count,
        ClearingError::ExitCohort);
    let totals = backing.totals()?;
    require!(totals.count() == certificate.next, ClearingError::ExitCohort);
    region_current(backing, snapshot, totals.required_mask(), fresh)
}

fn restart_allowed(certificate: &SettlementCertificate, ledger: &MarketLedger, venue: &Venue,
    safety: &VenueSafety, registry: &VenueRegistry, snapshot: &Snapshot) -> bool {
    stamps(certificate, ledger, venue, safety, registry, snapshot, false).is_err()
        || (!certificate.complete && region_current(&ledger.backing, snapshot, 3, false).is_err())
}

pub(crate) fn certified(certificate: &BorshAccount<SettlementCertificate>, identity: &AccountFinancialIdentity,
    registry: &VenueRegistry, snapshot: &Snapshot, ledger: &MarketLedger, selected: usize) -> Result<()> {
    require!(MAINTAINED_BACKING_IMPLEMENTED && selected < 2 && certificate.market_index as usize == selected
        && certificate.venue == *identity.venue.address() && certificate.complete && certificate.next == certificate.count,
        ClearingError::ExitCohort);
    let expected = create_program_address(&[b"settlement-v3", identity.venue.address().as_ref(),
        &[selected as u8], &[certificate.bump]], &crate::ID).map_err(|_| ClearingError::ExitCohort)?;
    require_keys_eq!(*certificate.address(), expected, ClearingError::ExitCohort);
    stamps(certificate, ledger, &identity.venue, &identity.safety, registry, snapshot, true)?;
    require!(checked(ledger.backing.totals()?.arithmetically_ready(certificate.count, ledger.settlement))?, ClearingError::ExitCohort);
    Ok(())
}

pub fn check(ctx: &mut Context<CheckMarketBacking>, events: &mut crate::event_cpi::Payloads,
    revision: u64, restart: bool) -> Result<()> {
    let remaining = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    profile(&accounts.venue, &accounts.safety)?;
    registry_valid(&accounts.registry)?;
    let snapshot = Snapshot::new([&accounts.btc, &accounts.eth], &Clock::get()?)?;
    let certificate = &mut accounts.certificate;
    let ledger = &mut accounts.ledger;
    require!(certificate.revision == revision, ClearingError::ExitCohort);
    if restart {
        // Temporary source unavailability blocks use, but is not permission to
        // erase an otherwise valid arithmetic epoch and its completed coverage.
        require!(restart_allowed(certificate, ledger, &accounts.venue, &accounts.safety, &accounts.registry, &snapshot),
            ClearingError::ExitCohort);
        ledger.backing = BackingState {
            epoch: ledger.backing.epoch.checked_add(1).ok_or(ClearingError::Arithmetic)?,
            safety_epoch: accounts.safety.epoch, membership_epoch: accounts.registry.membership_epoch,
            terms_epoch: accounts.venue.terms_epoch, config_epochs: [accounts.btc.config_epoch, accounts.eth.config_epoch],
            region: BackingRegion::around(snapshot.risks.map(|risk| [risk.lower, risk.upper]), snapshot.bounds)?,
            summary: financial_core::backing::Summary::default().checkpoint(),
        };
        certificate.backing_epoch = ledger.backing.epoch;
        certificate.count = accounts.registry.financial_count;
        certificate.next = 0;
        certificate.complete = false;
        certificate.membership.checkpoint = MembershipCursor::new(certificate.count)
            .map_err(|_| ClearingError::ExitCohort)?.checkpoint();
    }
    stamps(certificate, ledger, &accounts.venue, &accounts.safety, &accounts.registry, &snapshot, true)?;
    require!(!certificate.complete, ClearingError::ExitCohort);
    let changed = scan_certificate(certificate, ledger, &remaining)?;
    stamps(certificate, ledger, &accounts.venue, &accounts.safety, &accounts.registry, &snapshot, true)?;
    emit_certificate(certificate, Some(ledger), changed.as_ref().map(|(key,root)| (*key, &**root)),
        events, accounts.event_authority.account().clone())
}

#[inline(never)]
fn scan_certificate(certificate: &mut SettlementCertificate, ledger: &mut MarketLedger,
    remaining: &[AccountView]) -> Result<Option<(Address, Box<MarginAccount>)>> {
    let selected = usize::from(certificate.market_index);
    let mut cursor = MembershipCursor::from_checkpoint(&certificate.membership.checkpoint, certificate.count)
        .map_err(|_| ClearingError::ExitCohort)?;
    let mut changed = None;
    if let Some(mut root) = crate::instructions::account_membership::scan::step(&mut cursor, &certificate.venue, remaining)? {
        require!(remaining[1].is_writable() && root.backing_epochs[selected] != ledger.backing.epoch, ClearingError::ExitCohort);
        let contribution = checked(ledger.backing.region.model().contribution(&trading::model(&root)?, selected))?;
        ledger.backing.summary = checked(ledger.backing.totals()?.insert(contribution))?.checkpoint();
        root.backing_epochs[selected] = ledger.backing.epoch;
        let mut account = remaining[1].clone();
        crate::wire::write_account(&*root, &mut account.try_borrow_mut()?[..])?;
        certificate.next = certificate.next.checked_add(1).ok_or(ClearingError::Arithmetic)?;
        changed = Some((*remaining[1].address(), root));
    }
    certificate.membership.checkpoint = cursor.checkpoint();
    if cursor.request() == Request::Done {
        require!(certificate.next == certificate.count
            && checked(ledger.backing.totals()?.conserved(certificate.count, ledger.settlement))?, ClearingError::Reconciliation);
        certificate.complete = true;
    }
    Ok(changed)
}

#[inline(never)]
fn emit_certificate(certificate: &BorshAccount<SettlementCertificate>, ledger: Option<&BorshAccount<MarketLedger>>,
    root: Option<(Address, &MarginAccount)>, events: &mut crate::event_cpi::Payloads, authority: AccountView) -> Result<()> {
    let mut event = Box::new(crate::events::AccountBackingChanged {
        venue: certificate.venue, slot: Clock::get()?.slot, certificate: *certificate.address(),
        state: crate::events::BackingSnapshot::from(&**certificate),
        ledger: None, margin: None, root_state: None,
    });
    attach_snapshots(&mut event, ledger, root);
    events.emit(&*event, authority)
}

// Construct the optional 1 KiB root snapshot in a separate SBF frame, after the
// event has moved to the heap. Box::new alone leaves construction temporaries on
// the caller's stack; combining cursor, ledger and root exceeded its 4 KiB frame.
#[inline(never)]
fn attach_snapshots(event: &mut crate::events::AccountBackingChanged,
    ledger: Option<&BorshAccount<MarketLedger>>, root: Option<(Address, &MarginAccount)>) {
    event.ledger = ledger.map(super::super::account_custody::ledger_snapshot);
    if let Some((key, root)) = root {
        event.margin = Some(key);
        event.root_state = Some(crate::events::MarginAccountSnapshot::from(root));
    }
}

#[cfg(test)]
#[path = "certificate_tests.rs"]
mod tests;
