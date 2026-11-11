use super::*;
use anchor_spl::token::TokenAccount;

#[derive(Accounts)]
pub struct PreparedSourceIdentity {
    #[account(seeds=[b"venue-v3",&venue.domain],bump=venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"custody-v3",venue.address().as_ref()],bump=custody.bump,has_one=venue)]
    pub custody: Box<BorshAccount<Custody>>,
    #[account(seeds=[b"safety-v3",venue.address().as_ref()],bump=safety.bump,has_one=venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(seeds=[b"registry-v3",venue.address().as_ref()],bump=registry.bump,has_one=venue)]
    pub registry: Box<crate::state::records::RegistryAccount>,
    #[account(seeds=[b"resolution-v3",venue.address().as_ref()],bump=resolution.bump,has_one=venue)]
    pub resolution: Box<BorshAccount<Resolution>>,
    #[account(seeds=[b"market-v3",venue.address().as_ref(),&[0]],bump=btc.bump,has_one=venue,
        constraint=*btc.address() == venue.markets[0] @ ClearingError::Resolution)]
    pub btc: Box<BorshAccount<Market>>,
    #[account(seeds=[b"market-v3",venue.address().as_ref(),&[1]],bump=eth.bump,has_one=venue,
        constraint=*eth.address() == venue.markets[1] @ ClearingError::Resolution)]
    pub eth: Box<BorshAccount<Market>>,
    #[account(seeds=[b"ledger-v3",btc.address().as_ref()],bump=btc_ledger.bump,has_one=venue)]
    pub btc_ledger: Box<BorshAccount<MarketLedger>>,
    #[account(seeds=[b"ledger-v3",eth.address().as_ref()],bump=eth_ledger.bump,has_one=venue)]
    pub eth_ledger: Box<BorshAccount<MarketLedger>>,
    #[account(seeds=[b"vault-v3",venue.address().as_ref()],bump=venue.vault_bump,
        constraint=*vault.owner() == *venue.address() && *vault.mint() == venue.quote_mint
            && *vault.address() == venue.vault @ ClearingError::Mint)]
    pub vault: Box<Account<TokenAccount>>,
}
impl PreparedSourceIdentity {
    pub(crate) fn frozen(&self) -> FrozenSource<'_> {
        FrozenSource {
            venue_key: *self.venue.address(),
            source_key: *self.resolution.address(),
            venue: &self.venue,
            custody: &self.custody,
            safety: &self.safety,
            registry: &self.registry,
            source: &self.resolution,
            markets: [&self.btc, &self.eth],
            ledgers: [&self.btc_ledger, &self.eth_ledger],
            actual_vault: self.vault.amount(),
        }
    }
}
#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct InitializePreparedSettlement {
    #[account(mut)]
    pub payer: Signer,
    pub source: Nested<PreparedSourceIdentity>,
    #[account(init,payer=payer,space=8+PreparedSettlement::INIT_SPACE,
        seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    pub system_program: Program<System>,
}
#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64,level:u8)]
pub struct InitializePreparedIndexNode {
    #[account(mut)]
    pub payer: Signer,
    pub source: Nested<PreparedSourceIdentity>,
    #[account(mut,seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(init,payer=payer,space=8+MemberIndexNode::INIT_SPACE,
        seeds=[b"member-index",source.venue.address().as_ref(),&[level],&0u64.to_le_bytes()],bump)]
    pub node: Box<BorshAccount<MemberIndexNode>>,
    pub system_program: Program<System>,
}
#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct InitializePreparedMembers {
    #[account(mut)]
    pub payer: Signer,
    pub source: Nested<PreparedSourceIdentity>,
    #[account(mut,seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(init,payer=payer,space=8+MemberPage::INIT_SPACE,
        seeds=[b"member-page",source.venue.address().as_ref(),&0u64.to_le_bytes()],bump)]
    pub page: Box<BorshAccount<MemberPage>>,
    pub system_program: Program<System>,
}
#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64,page_index:u64)]
pub struct InitializeFrozenMarginPage {
    #[account(mut)]
    pub payer: Signer,
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(init,payer=payer,space=8+FrozenMarginPage::INIT_SPACE,
        seeds=[b"frozen-margin-page",source.venue.address().as_ref(),&epoch.to_le_bytes(),&page_index.to_le_bytes()],bump)]
    pub page: Box<BorshAccount<FrozenMarginPage>>,
    pub system_program: Program<System>,
}
#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct AdvancePreparedMembership {
    pub source: Nested<PreparedSourceIdentity>,
    #[account(mut,seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    /// CHECK: stage-derived MemberIndexNode/MemberPage discriminator, owner,
    /// venue and canonical level/prefix/index PDA are authenticated by handler.
    pub index: UncheckedAccount,
}
#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct ValuePreparedMember {
    pub source: Nested<PreparedSourceIdentity>,
    #[account(mut,seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(seeds=[b"member-page",source.venue.address().as_ref(),&members.page_index.to_le_bytes()],bump=members.bump,
        constraint=members.venue == *source.venue.address() @ ClearingError::Resolution)]
    pub members: Box<BorshAccount<MemberPage>>,
    #[account(seeds=[b"margin-v3",margin.portfolio.as_ref(),&margin.subaccount_index.to_le_bytes()],bump=margin.bump,
        constraint=margin.venue == *source.venue.address() @ ClearingError::Resolution)]
    pub margin: Box<BorshAccount<MarginAccount>>,
    #[account(mut,seeds=[b"frozen-margin-page",source.venue.address().as_ref(),&epoch.to_le_bytes(),&page.page_index.to_le_bytes()],bump=page.bump,
        constraint=page.venue == *source.venue.address() && page.epoch == epoch @ ClearingError::Resolution)]
    pub page: Box<BorshAccount<FrozenMarginPage>>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64,register:u32,page_index:u64)]
pub struct InitializeSettlementLimbPage {
    #[account(mut)]
    pub payer: Signer,
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(init,payer=payer,space=8+SettlementLimbPage::INIT_SPACE,
        seeds=[b"resolution-limbs",source.venue.address().as_ref(),&epoch.to_le_bytes(),&register.to_le_bytes(),&page_index.to_le_bytes()],bump)]
    pub page: Box<BorshAccount<SettlementLimbPage>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct AcceptDenominatorRow {
    pub source: Nested<PreparedSourceIdentity>,
    #[account(mut,seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(seeds=[b"frozen-margin-page",source.venue.address().as_ref(),&epoch.to_le_bytes(),&page.page_index.to_le_bytes()],bump=page.bump,
        constraint=page.venue == *source.venue.address() && page.epoch == epoch @ ClearingError::Resolution)]
    pub page: Box<BorshAccount<FrozenMarginPage>>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct ContinueSettlementDenominator {
    pub source: Nested<PreparedSourceIdentity>,
    #[account(mut,seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    // Remaining accounts are exactly the stage-derived sorted limb-page plan.
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct InitializeSettlementRates {
    #[account(mut)]
    pub payer: Signer,
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(init,payer=payer,space=8+SettlementRates::INIT_SPACE,
        seeds=[b"settlement-rates",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump)]
    pub rates: Box<BorshAccount<SettlementRates>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct ManageSettlementProposal {
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(mut,seeds=[b"settlement-rates",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=rates.bump,
        constraint=rates.venue == *source.venue.address() && rates.epoch == epoch @ ClearingError::Resolution)]
    pub rates: Box<BorshAccount<SettlementRates>>,
    pub actor: Signer,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct UploadSettlementRate {
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(mut,seeds=[b"settlement-rates",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=rates.bump,
        constraint=rates.venue == *source.venue.address() && rates.epoch == epoch @ ClearingError::Resolution)]
    pub rates: Box<BorshAccount<SettlementRates>>,
    #[account(mut,seeds=[b"resolution-limbs",source.venue.address().as_ref(),&epoch.to_le_bytes(),&page.register.to_le_bytes(),&page.page_index.to_le_bytes()],bump=page.bump,
        constraint=page.venue == *source.venue.address() && page.epoch == epoch @ ClearingError::Resolution)]
    pub page: Box<BorshAccount<SettlementLimbPage>>,
    pub proposer: Signer,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct PrepareRateScratch {
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(seeds=[b"settlement-rates",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=rates.bump,
        constraint=rates.venue == *source.venue.address() && rates.epoch == epoch @ ClearingError::Resolution)]
    pub rates: Box<BorshAccount<SettlementRates>>,
    #[account(mut,seeds=[b"resolution-limbs",source.venue.address().as_ref(),&epoch.to_le_bytes(),&page.register.to_le_bytes(),&page.page_index.to_le_bytes()],bump=page.bump,
        constraint=page.venue == *source.venue.address() && page.epoch == epoch @ ClearingError::Resolution)]
    pub page: Box<BorshAccount<SettlementLimbPage>>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct AcceptSettlementRateRow {
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(mut,seeds=[b"settlement-rates",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=rates.bump,
        constraint=rates.venue == *source.venue.address() && rates.epoch == epoch @ ClearingError::Resolution)]
    pub rates: Box<BorshAccount<SettlementRates>>,
    #[account(seeds=[b"frozen-margin-page",source.venue.address().as_ref(),&epoch.to_le_bytes(),&page.page_index.to_le_bytes()],bump=page.bump,
        constraint=page.venue == *source.venue.address() && page.epoch == epoch @ ClearingError::Resolution)]
    pub page: Box<BorshAccount<FrozenMarginPage>>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct ContinueSettlementRates {
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(mut,seeds=[b"settlement-rates",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=rates.bump,
        constraint=rates.venue == *source.venue.address() && rates.epoch == epoch @ ClearingError::Resolution)]
    pub rates: Box<BorshAccount<SettlementRates>>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct InitializeSettlementPlan {
    #[account(mut)]
    pub payer: Signer,
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(seeds=[b"settlement-rates",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=rates.bump,
        constraint=rates.venue == *source.venue.address() && rates.epoch == epoch @ ClearingError::Resolution)]
    pub rates: Box<BorshAccount<SettlementRates>>,
    #[account(init,payer=payer,space=8+SettlementPlan::INIT_SPACE,
        seeds=[b"settlement-plan",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump)]
    pub plan: Box<BorshAccount<SettlementPlan>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64,register:u32,page_index:u64)]
pub struct InitializeSettlementPlanPage {
    #[account(mut)]
    pub payer: Signer,
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(seeds=[b"settlement-rates",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=rates.bump,
        constraint=rates.venue == *source.venue.address() && rates.epoch == epoch @ ClearingError::Resolution)]
    pub rates: Box<BorshAccount<SettlementRates>>,
    #[account(seeds=[b"settlement-plan",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=plan.bump,
        constraint=plan.venue == *source.venue.address() && plan.epoch == epoch @ ClearingError::Resolution)]
    pub plan: Box<BorshAccount<SettlementPlan>>,
    #[account(init,payer=payer,space=8+SettlementLimbPage::INIT_SPACE,
        seeds=[b"resolution-limbs",source.venue.address().as_ref(),&epoch.to_le_bytes(),&register.to_le_bytes(),&page_index.to_le_bytes()],bump)]
    pub page: Box<BorshAccount<SettlementLimbPage>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct AcceptSettlementPlanRow {
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(seeds=[b"settlement-rates",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=rates.bump,
        constraint=rates.venue == *source.venue.address() && rates.epoch == epoch @ ClearingError::Resolution)]
    pub rates: Box<BorshAccount<SettlementRates>>,
    #[account(mut,seeds=[b"settlement-plan",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=plan.bump,
        constraint=plan.venue == *source.venue.address() && plan.epoch == epoch @ ClearingError::Resolution)]
    pub plan: Box<BorshAccount<SettlementPlan>>,
    #[account(seeds=[b"frozen-margin-page",source.venue.address().as_ref(),&epoch.to_le_bytes(),&page.page_index.to_le_bytes()],bump=page.bump,
        constraint=page.venue == *source.venue.address() && page.epoch == epoch @ ClearingError::Resolution)]
    pub page: Box<BorshAccount<FrozenMarginPage>>,
    pub actor: Signer,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct ManageSettlementPlan {
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(seeds=[b"settlement-rates",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=rates.bump,
        constraint=rates.venue == *source.venue.address() && rates.epoch == epoch @ ClearingError::Resolution)]
    pub rates: Box<BorshAccount<SettlementRates>>,
    #[account(mut,seeds=[b"settlement-plan",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=plan.bump,
        constraint=plan.venue == *source.venue.address() && plan.epoch == epoch @ ClearingError::Resolution)]
    pub plan: Box<BorshAccount<SettlementPlan>>,
    pub actor: Signer,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(epoch:u64)]
pub struct ContinueSettlementPlan {
    pub source: Nested<PreparedSourceIdentity>,
    #[account(seeds=[b"prepared-settlement",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=prepared.bump,
        constraint=prepared.venue == *source.venue.address() && prepared.epoch == epoch @ ClearingError::Resolution)]
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    #[account(seeds=[b"settlement-rates",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=rates.bump,
        constraint=rates.venue == *source.venue.address() && rates.epoch == epoch @ ClearingError::Resolution)]
    pub rates: Box<BorshAccount<SettlementRates>>,
    #[account(mut,seeds=[b"settlement-plan",source.venue.address().as_ref(),&epoch.to_le_bytes()],bump=plan.bump,
        constraint=plan.venue == *source.venue.address() && plan.epoch == epoch @ ClearingError::Resolution)]
    pub plan: Box<BorshAccount<SettlementPlan>>,
}
