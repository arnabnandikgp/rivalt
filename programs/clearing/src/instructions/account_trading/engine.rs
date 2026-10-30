//! Candidate snapshots and checked commits for current account records.
//! Contexts authenticate PDAs; commits cannot change immutable account identity.
use super::*;
pub(crate) use crate::engine::account::model;

#[inline(never)]
pub(crate) fn root_view(root: &MarginAccount) -> Result<Box<MarginAccount>> {
    Ok(Box::new(root_view_value(root)?))
}

/// Copy a validated current root in a separate bounded SBF frame.
#[inline(never)]
pub(crate) fn root_view_value(root: &MarginAccount) -> Result<MarginAccount> {
    model(root)?;
    Ok(root.clone())
}

pub(crate) fn commit_root(root: &mut MarginAccount, candidate: &MarginAccount) -> Result<()> {
    model(root)?;
    require!(
        candidate.schema_version == SCHEMA_VERSION
            && candidate.venue == root.venue
            && candidate.portfolio == root.portfolio
            && candidate.owner == root.owner
            && candidate.subaccount_index == root.subaccount_index
            && candidate.id == root.id
            && candidate.mode == root.mode
            && candidate.isolated_market_index == root.isolated_market_index
            && candidate.role == root.role
            && candidate.bump == root.bump,
        ClearingError::Profile
    );
    crate::engine::account::model(candidate)?;
    book::validate(candidate)?;
    root.cash = candidate.cash;
    root.positions = candidate.positions;
    root.nonce = candidate.nonce;
    root.state_version = candidate.state_version;
    root.delegate = candidate.delegate;
    root.delegate_expiry_slot = candidate.delegate_expiry_slot;
    root.delegate_epoch = candidate.delegate_epoch;
    root.reserved = candidate.reserved;
    root.book = candidate.book;
    Ok(())
}

pub(crate) fn market_view(market: &Market) -> Result<Market> {
    validate_market(market)?;
    Ok(market.clone())
}

fn validate_market(market: &Market) -> Result<()> {
    require!(
        market.schema_version == SCHEMA_VERSION
            && market.index < 2
            && market.cross_eligible
            && market.lots_per_unit == [1_000_000, 100_000][usize::from(market.index)],
        ClearingError::Profile
    );
    Ok(())
}

pub(crate) fn commit_market(market: &mut Market, candidate: &Market) -> Result<()> {
    require!(
        candidate.schema_version == SCHEMA_VERSION
            && candidate.venue == market.venue
            && candidate.index == market.index
            && candidate.symbol == market.symbol
            && candidate.lots_per_unit == market.lots_per_unit
            && candidate.cross_eligible == market.cross_eligible
            && candidate.bump == market.bump
            && candidate.terms_epoch == market.terms_epoch,
        ClearingError::Profile
    );
    market.config_epoch = candidate.config_epoch;
    market.funding_index_scaled = candidate.funding_index_scaled;
    market.funding_time = candidate.funding_time;
    market.gross_lots = candidate.gross_lots;
    market.observation_sequence = candidate.observation_sequence;
    market.reference_price = candidate.reference_price;
    market.lower = candidate.lower;
    market.upper = candidate.upper;
    market.valid_from = candidate.valid_from;
    market.valid_until = candidate.valid_until;
    market.oracle = candidate.oracle;
    Ok(())
}

/// Event order does not authorize actions. Only economic dependencies invalidate
/// payment certificates, including cross-market cash changes with an existing debt.
pub(crate) fn invalidate(
    custody: &mut Custody,
    before: [crate::state::Position; 2],
    after: [crate::state::Position; 2],
) -> Result<()> {
    for index in 0..2 {
        if [before[index], after[index]]
            .iter()
            .any(|position| position.lots != 0 || position.virtual_scaled != 0)
        {
            increment(&mut custody.liability_versions[index])?;
        }
    }
    Ok(())
}

pub(crate) fn environment<'a>(
    markets: &'a [Market; 2],
    selected: usize,
    clock: &Clock,
) -> Result<book::Environment<'a>> {
    require!(
        selected < 2
            && markets[0].venue == markets[1].venue
            && markets[0].index == 0
            && markets[1].index == 1,
        ClearingError::Profile
    );
    optional_environment(markets.each_ref().map(Some), selected, clock)
}

pub(crate) fn optional_environment<'a>(
    markets: [Option<&'a Market>; 2],
    selected: usize,
    clock: &Clock,
) -> Result<book::Environment<'a>> {
    require!(selected <= 2, ClearingError::Profile);
    if let [Some(btc), Some(eth)] = markets {
        require!(btc.venue == eth.venue, ClearingError::Profile);
    }
    let mut funding = [0; 2];
    let mut credible = [false; 2];
    for (index, market) in markets.iter().enumerate() {
        if let Some(market) = market {
            validate_market(market)?;
            require!(market.index as usize == index, ClearingError::Profile);
            funding[index] = shared_oracle::effective(2, market, clock)?;
            credible[index] = shared_oracle::action(market, clock, false).is_ok();
        }
    }
    Ok(book::Environment {
        markets,
        selected,
        funding,
        slot: clock.slot,
        credible,
    })
}

/// Every consumed prefix persists even if a later sample is lost or held coverage
/// expires. Complete default still supplies both markets; ordinary actions supply
/// only their validated dependency union (and any explicit canonical extras).
pub(crate) fn materialize(markets: [&mut Market; 2], clock: &Clock) -> Result<()> {
    materialize_optional(markets.map(Some), clock)
}

pub(crate) fn materialize_optional(markets: [Option<&mut Market>; 2], clock: &Clock) -> Result<()> {
    for market in markets.into_iter().flatten() {
        let mut view = market_view(market)?;
        shared_oracle::materialize(2, &mut view, clock)?;
        commit_market(market, &view)?;
    }
    Ok(())
}

pub(crate) fn split_fee(
    custody: &mut Custody,
    ledger: &mut MarketLedger,
    fee: u64,
) -> Result<(u64, u64, u8)> {
    require!(
        ledger.schema_version == SCHEMA_VERSION && ledger.insurance_fee_remainder < 4,
        ClearingError::Profile
    );
    let before = ledger.insurance_fee_remainder;
    let numerator = u128::from(fee) + u128::from(before);
    let insurance = u64::try_from(numerator / 4).map_err(|_| error!(ClearingError::Arithmetic))?;
    let retained = fee
        .checked_sub(insurance)
        .ok_or(ClearingError::Arithmetic)?;
    custody.total_cash = checked(math::cash_sub(custody.total_cash, fee))?;
    ledger.insurance = checked(math::cash_add(ledger.insurance, insurance))?;
    ledger.fees = checked(math::cash_add(ledger.fees, retained))?;
    ledger.insurance_fee_remainder = (numerator % 4) as u8;
    increment(&mut ledger.version)?;
    increment(&mut custody.liability_versions[usize::from(ledger.market_index)])?;
    Ok((insurance, retained, before))
}
