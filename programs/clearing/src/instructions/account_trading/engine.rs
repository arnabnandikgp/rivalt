//! Typed adapters to the existing pure book/risk candidates. These are in-memory
//! scalar views only: schema-3 contexts own authentication, no V2 account handler
//! or PDA is invoked, and immutable identity is never copied back from a candidate.
use super::*;

pub(crate) fn root_view(root: &MarginAccountV3) -> Result<Box<v2::MarginAccountV2>> {
    require!(
        root.schema_version == SCHEMA_VERSION,
        ClearingError::Profile
    );
    let view = Box::new(v2::MarginAccountV2 {
        schema_version: v2::SCHEMA_VERSION,
        group: root.venue,
        portfolio: root.portfolio,
        owner: root.owner,
        subaccount_index: root.subaccount_index,
        id: root.id,
        mode: root.mode,
        isolated_market_index: root.isolated_market_index,
        role: root.role,
        cash: root.cash,
        positions: root.positions,
        nonce: root.nonce,
        state_version: root.state_version,
        delegate: root.delegate,
        delegate_expiry_slot: root.delegate_expiry_slot,
        delegate_epoch: root.delegate_epoch,
        reserved: root.reserved,
        book: root.book,
        bump: root.bump,
    });
    super::super::group_margin::model(&view)?;
    Ok(view)
}

pub(crate) fn commit_root(
    root: &mut MarginAccountV3,
    candidate: &v2::MarginAccountV2,
) -> Result<()> {
    model(root)?;
    require!(
        candidate.schema_version == v2::SCHEMA_VERSION
            && candidate.group == root.venue
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
    super::super::group_margin::model(candidate)?;
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

pub(crate) fn market_view(market: &MarketV3) -> Result<v2::GroupMarketV2> {
    require!(
        market.schema_version == SCHEMA_VERSION
            && market.index < 2
            && market.cross_eligible
            && market.lots_per_unit == [1_000_000, 100_000][usize::from(market.index)],
        ClearingError::Profile
    );
    Ok(v2::GroupMarketV2 {
        schema_version: v2::SCHEMA_VERSION,
        group: market.venue,
        index: market.index,
        symbol: market.symbol,
        lots_per_unit: market.lots_per_unit,
        terms_epoch: market.terms_epoch,
        config_epoch: market.config_epoch,
        funding_index_scaled: market.funding_index_scaled,
        funding_time: market.funding_time,
        gross_lots: market.gross_lots,
        observation_sequence: market.observation_sequence,
        reference_price: market.reference_price,
        lower: market.lower,
        upper: market.upper,
        valid_from: market.valid_from,
        valid_until: market.valid_until,
        oracle: market.oracle,
        bump: market.bump,
    })
}

pub(crate) fn commit_market(market: &mut MarketV3, candidate: &v2::GroupMarketV2) -> Result<()> {
    require!(
        candidate.schema_version == v2::SCHEMA_VERSION
            && candidate.group == market.venue
            && candidate.index == market.index
            && candidate.symbol == market.symbol
            && candidate.lots_per_unit == market.lots_per_unit
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

pub(crate) fn model(root: &MarginAccountV3) -> Result<math::margin::Margin> {
    require!(
        root.schema_version == SCHEMA_VERSION
            && valid_identity(
                0,
                root.subaccount_index,
                root.mode,
                root.isolated_market_index,
                root.role
            )
            && root.delegate_epoch > 0
            && ((root.delegate == Pubkey::default()) == (root.delegate_expiry_slot == 0))
            && (root.delegate == Pubkey::default() || root.delegate != root.owner),
        ClearingError::Profile
    );
    let candidate = math::margin::Margin {
        id: root.id,
        mode: if root.mode == MODE_CROSS {
            math::margin::Mode::Cross
        } else {
            math::margin::Mode::Isolated(usize::from(root.isolated_market_index))
        },
        cash: root.cash,
        reserved: root.reserved,
        positions: root.positions.map(|position| math::margin::Position {
            lots: position.lots,
            virtual_scaled: position.virtual_scaled,
            funding_checkpoint: position.funding_checkpoint_scaled,
            generation: position.generation,
        }),
    };
    checked(candidate.validate())?;
    Ok(candidate)
}

/// Event order does not authorize actions. Only economic dependencies invalidate
/// payment certificates, including cross-market cash changes with an existing debt.
pub(crate) fn invalidate(
    custody: &mut CustodyV3,
    before: [v2::PositionV2; 2],
    after: [v2::PositionV2; 2],
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
    markets: &'a [v2::GroupMarketV2; 2],
    selected: usize,
    clock: &Clock,
) -> Result<book::Environment<'a>> {
    require!(
        selected < 2
            && markets[0].group == markets[1].group
            && markets[0].index == 0
            && markets[1].index == 1,
        ClearingError::Profile
    );
    Ok(book::Environment {
        markets: [Some(&markets[0]), Some(&markets[1])],
        selected,
        funding: [
            shared_oracle::effective(2, &markets[0], clock)?,
            shared_oracle::effective(2, &markets[1], clock)?,
        ],
        slot: clock.slot,
        credible: markets
            .each_ref()
            .map(|market| shared_oracle::action(market, clock, false).is_ok()),
    })
}

/// Every consumed prefix persists even if a later sample is lost or held coverage
/// expires. Both canonical market accounts are locked; irrelevant prices need not
/// be fresh and no observation/event counter is a signed-intent dependency.
pub(crate) fn materialize(markets: [&mut MarketV3; 2], clock: &Clock) -> Result<()> {
    for market in markets {
        let mut view = market_view(market)?;
        shared_oracle::materialize(2, &mut view, clock)?;
        commit_market(market, &view)?;
    }
    Ok(())
}

pub(crate) fn split_fee(
    custody: &mut CustodyV3,
    ledger: &mut MarketLedgerV3,
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
