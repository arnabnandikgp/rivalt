use super::*;
use crate::instructions::account_custody;

/// Typed context constraints must authenticate these exact source PDAs/token
/// identities. The helper checks their frozen economic/replay bindings again.
pub(crate) struct FrozenSource<'a> {
    pub venue_key: Address,
    pub source_key: Address,
    pub venue: &'a Venue,
    pub custody: &'a Custody,
    pub safety: &'a VenueSafety,
    pub registry: &'a VenueRegistry,
    pub source: &'a Resolution,
    pub markets: [&'a Market; 2],
    pub ledgers: [&'a MarketLedger; 2],
    pub actual_vault: u64,
}
impl FrozenSource<'_> {
    fn identity(&self, stage: u8) -> Result<()> {
        require!(
            cfg!(feature = "liquidity-execution-qualification")
                && self.venue.schema_version == SCHEMA_VERSION
                && self.venue.profile_version == PROFILE_VERSION
                && self.venue.market_count == 2
                && self.venue.insurance_fee_share_bps == 2500
                && self.custody.schema_version == SCHEMA_VERSION
                && self.custody.venue == self.venue_key
                && self.safety.schema_version == SCHEMA_VERSION
                && self.safety.venue == self.venue_key
                && self.safety.mode == FROZEN
                && self.safety.paused
                && self.source.schema_version == SCHEMA_VERSION
                && self.source.venue == self.venue_key
                && self.source.stage == stage
                && self.source.cursor == 0
                && self.source.revision > 0
                && self.source.epoch == self.safety.resolution_epoch
                && self.source.safety_epoch == self.safety.epoch
                && self.source.terms_epoch == self.venue.terms_epoch
                && self
                    .source
                    .prices
                    .iter()
                    .all(|price| *price > 0 && *price <= financial_core::MAX_PRICE)
                && self.registry.schema_version == SCHEMA_VERSION
                && self.registry.venue == self.venue_key
                && self.registry.revision > 0
                && self.registry.count > 0
                && self.registry.count == self.source.count
                && usize::from(self.registry.count) == self.registry.members.len()
                && self.registry.members.len() <= MAX_MEMBERS,
            ClearingError::Resolution
        );
        for (index, member) in self.registry.members.iter().enumerate() {
            require!(
                *member != Address::default() && !self.registry.members[..index].contains(member),
                ClearingError::Resolution
            );
        }
        // Initial qualification input is the existing bounded source. P55
        // replaces this bridge with the live index's immutable frozen epoch.
        let mut encoded = Vec::with_capacity(VenueRegistry::INIT_SPACE);
        crate::wire::write(self.registry, &mut encoded)?;
        require!(
            solana_sha256_hasher::hash(&encoded).to_bytes() == self.source.registry_hash,
            ClearingError::Resolution
        );
        for index in 0..2 {
            let market = self.markets[index];
            let ledger = self.ledgers[index];
            require!(
                market.schema_version == SCHEMA_VERSION
                    && market.venue == self.venue_key
                    && usize::from(market.index) == index
                    && market.config_epoch == self.source.config_epochs[index]
                    && market.funding_index_scaled == self.source.funding[index]
                    && ledger.schema_version == SCHEMA_VERSION
                    && ledger.venue == self.venue_key
                    && usize::from(ledger.market_index) == index
                    && ledger.market == self.venue.markets[index]
                    && ledger.fees == self.source.fees_before[index],
                ClearingError::Resolution
            );
            crate::instructions::account_trading::market_view(market)?;
        }
        Ok(())
    }
    pub(crate) fn validate(&self) -> Result<()> {
        self.identity(super::super::resolution::VALUE)?;
        self.balances(
            self.source.remaining_gross,
            self.source.pools_before,
            self.source.insurance_before,
        )?;
        require!(
            self.custody.allocated_vault == self.source.allocated_before
                && account_custody::accounted_cash(self.custody, self.ledgers)?
                    == self.source.cash_before,
            ClearingError::Reconciliation
        );
        Ok(())
    }
    pub(crate) fn initialize(&self, header: &mut PreparedSettlement) -> Result<()> {
        self.validate()?;
        require!(
            header.schema_version == 0 && header.revision == 0,
            ClearingError::Resolution
        );
        header.schema_version = SETTLEMENT_SCHEMA;
        header.venue = self.venue_key;
        header.source = self.source_key;
        header.source_revision = self.source.revision;
        header.epoch = self.source.epoch;
        header.registry_revision = self.registry.revision;
        header.membership_epoch = self.registry.membership_version;
        header.registry_hash = self.source.registry_hash;
        header.count = u64::from(self.registry.count);
        header.safety_epoch = self.safety.epoch;
        header.terms_epoch = self.venue.terms_epoch;
        header.config_epochs = self.source.config_epochs;
        header.prices = self.source.prices;
        header.funding = self.source.funding;
        header.allocated = self.source.allocated_before;
        header.pools = self.source.pools_before;
        header.insurance = self.source.insurance_before;
        header.fees = self.source.fees_before;
        header.gross = self.source.remaining_gross;
        header.stage = PREPARE_INDEX;
        Ok(())
    }
    pub(crate) fn matches(&self, header: &PreparedSettlement) -> Result<()> {
        self.validate()?;
        self.header_matches(header, self.source.revision)
    }
    fn header_matches(&self, header: &PreparedSettlement, revision: u64) -> Result<()> {
        require!(
            header.schema_version == SETTLEMENT_SCHEMA
                && header.venue == self.venue_key
                && header.source == self.source_key
                && header.source_revision == revision
                && header.epoch == self.source.epoch
                && header.registry_revision == self.registry.revision
                && header.membership_epoch == self.registry.membership_version
                && header.registry_hash == self.source.registry_hash
                && header.count == u64::from(self.registry.count)
                && header.safety_epoch == self.safety.epoch
                && header.terms_epoch == self.venue.terms_epoch
                && header.config_epochs == self.source.config_epochs
                && header.prices == self.source.prices
                && header.funding == self.source.funding
                && header.allocated == self.source.allocated_before
                && header.pools == self.source.pools_before
                && header.insurance == self.source.insurance_before
                && header.fees == self.source.fees_before
                && header.gross == self.source.remaining_gross,
            ClearingError::Resolution
        );
        Ok(())
    }
    fn balances(&self, gross: [u64; 2], pools: [u64; 2], insurance: [u64; 2]) -> Result<()> {
        for market in 0..2 {
            require!(
                self.markets[market].gross_lots == gross[market]
                    && self.ledgers[market].settlement == pools[market]
                    && self.ledgers[market].insurance == insurance[market],
                ClearingError::Reconciliation
            );
        }
        account_custody::reconciled(self.custody, self.ledgers, self.actual_vault)?;
        require!(
            self.custody.allocated_vault == self.source.allocated_before,
            ClearingError::Reconciliation
        );
        Ok(())
    }
    /// During paged Apply the original header remains immutable. Only the owned
    /// plan's authenticated prefix determines how much original exposure remains.
    pub(crate) fn adopted(
        &self,
        header: &PreparedSettlement,
        plan: &SettlementPlan,
        gross: [u64; 2],
        distributed: bool,
    ) -> Result<()> {
        self.identity(PAGED_APPLY)?;
        self.header_matches(header, header.source_revision)?;
        require!(
            plan.adoption_revision > 0
                && plan.adoption_revision == self.source.revision
                && header.source_revision.checked_add(1) == Some(plan.adoption_revision),
            ClearingError::Resolution
        );
        let mut insurance = header.insurance;
        if distributed {
            for market in 0..2 {
                insurance[market] = insurance[market]
                    .checked_sub(plan.insurance_spent[market])
                    .ok_or(ClearingError::Arithmetic)?;
            }
        }
        self.balances(
            gross,
            if distributed { [0; 2] } else { header.pools },
            insurance,
        )
    }
}
