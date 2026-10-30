use super::*;

/// Validate signed report identity and time independently of its claimed prices.
pub(super) fn validate_report(
    venue: &Venue,
    market: &Market,
    configuration: &FundingPublisher,
    report: &FundingReport,
    clock: &Clock,
) -> Result<()> {
    require!(
        configuration.schema_version == 4
            && configuration.enabled
            && configuration.publisher != Pubkey::default()
            && configuration.authority_epoch > 0
            && report.version == 1
            && report.domain == venue.domain
            && report.market == configuration.market
            && report.authority_epoch == configuration.authority_epoch
            && configuration.last_sequence.checked_add(1) == Some(report.sequence)
            && report.expected_observation_sequence == market.observation_sequence
            && report.expected_config_epoch == market.config_epoch
            && report.expected_terms_epoch == market.terms_epoch
            && report.observed_slot > configuration.last_observed_slot
            && report.observed_slot <= clock.slot
            && report.observed_time > 0
            && report.observed_time >= configuration.last_observed_time
            && clock
                .unix_timestamp
                .checked_sub(report.observed_time)
                .is_some_and(|age| (0..=2).contains(&age))
            && report.outcome <= 3
            && report.input_digest != [0; 32],
        ClearingError::FundingReport
    );
    if report.outcome == 0 {
        require!(
            report.valid_until_time > clock.unix_timestamp
                && report
                    .observed_time
                    .checked_add(policy::HOLD)
                    .is_some_and(|end| report.valid_until_time <= end)
                && report.valid_until_slot > clock.slot
                && report
                    .observed_slot
                    .checked_add(150)
                    .is_some_and(|end| report.valid_until_slot <= end),
            ClearingError::FundingReport
        );
    } else {
        require!(
            report.reference_price == 0
                && report.quantity == 0
                && report.bid == 0
                && report.ask == 0
                && report.valid_until_time == 0
                && report.valid_until_slot == 0,
            ClearingError::FundingReport
        );
    }
    Ok(())
}

pub(super) fn report_impact(
    report: &FundingReport,
    bounds: Option<policy::Bounds>,
) -> Result<Option<impact::Impact>> {
    if report.outcome != 0 {
        return Ok(None);
    }
    let bounds = bounds.ok_or(ClearingError::OraclePolicy)?;
    require!(
        bounds.normal
            && (10_000..=100_000).contains(&bounds.reference)
            && report.reference_price == bounds.reference
            && report.quantity == policy::REFERENCE_NOTIONAL.div_ceil(bounds.reference)
            && report.bid > 0
            && report.ask >= report.bid,
        ClearingError::OraclePolicy
    );
    let notional = report
        .quantity
        .checked_mul(bounds.reference)
        .ok_or(ClearingError::Arithmetic)?;
    for gross in [report.bid, report.ask] {
        let scaled = gross.checked_mul(10).ok_or(ClearingError::Arithmetic)?;
        require!(
            scaled >= notional.checked_mul(9).ok_or(ClearingError::Arithmetic)?
                && scaled <= notional.checked_mul(11).ok_or(ClearingError::Arithmetic)?,
            ClearingError::OraclePolicy
        );
    }
    Ok(Some(impact::Impact {
        quantity: report.quantity,
        bid: report.bid,
        ask: report.ask,
        expiry_slot: report.valid_until_slot,
        expiry_time: report.valid_until_time,
        bid_legs: Vec::new(),
        ask_legs: Vec::new(),
    }))
}

/// Independent source validation is retained on-chain; maker coverage is attested.
pub(super) fn read_sources(
    market: &Market,
    sources: [&UncheckedAccount; 4],
    clock: &Clock,
) -> Result<(Option<policy::Bounds>, [u64; 4])> {
    let mut values = [None; 4];
    let mut sequences = market.oracle.source_sequences;
    for (position, feed) in account_trading::oracle::feed_indexes(market.index)?
        .into_iter()
        .enumerate()
    {
        crate::instructions::oracle::binding(
            sources[position],
            market.oracle.sources[position],
            feed,
        )?;
        if let Ok((price, sequence)) = crate::instructions::oracle::source(
            sources[position],
            market.oracle.sources[position],
            feed,
            sequences[position],
        ) {
            values[position] = Some(price);
            sequences[position] = sequence;
        }
    }
    let bounds = values[0].zip(values[1]).and_then(|(asset, collateral)| {
        policy::market_bounds(
            market.lots_per_unit,
            [asset, collateral],
            values[2]
                .zip(values[3])
                .map(|(asset, collateral)| [asset, collateral]),
            clock.unix_timestamp,
        )
        .ok()
    });
    Ok((bounds, sequences))
}
