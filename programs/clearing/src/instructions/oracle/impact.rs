//! Complete-maker impact sampling with conservative funded capacity and bounded search.
use super::*;
use crate::instructions::{makers::PreviewArgs, routes};

fn quote<'info>(
    accounts: &SampleOracle<'info>,
    id: usize,
    side: u8,
    lots: u64,
    reference: u64,
) -> Result<maker_interface::QuoteResponse> {
    let (capital, registration, program, data, config) = if id == 0 {
        (
            &accounts.first_capital,
            &accounts.first_registration,
            &accounts.first_program,
            &accounts.first_program_data,
            &accounts.first_config,
        )
    } else {
        (
            &accounts.second_capital,
            &accounts.second_registration,
            &accounts.second_program,
            &accounts.second_program_data,
            &accounts.second_config,
        )
    };
    require!(
        registration.pricing_program == program.key()
            && program.programdata_address()? == Some(data.key())
            && registration.owner == capital.owner,
        ClearingError::MakerBinding
    );
    makers::quote_checked(
        &accounts.market,
        capital,
        registration,
        program,
        data,
        config,
        PreviewArgs {
            side,
            lots,
            reference_price: reference,
            quote_epoch: registration.quote_epoch,
            authority_epoch: registration.authority_epoch,
            terms_epoch: accounts.market.terms_epoch,
            config_epoch: accounts.market.config_epoch,
        },
    )
}

pub(super) fn impact(
    accounts: &SampleOracle,
    bounds: policy::Bounds,
    funding_index: i128,
) -> Result<(u64, u64, u64)> {
    let quantity = policy::REFERENCE_NOTIONAL.div_ceil(bounds.reference);
    let slot = Clock::get()?.slot;
    // Full ProgramData hash and standing-authority validation once per module.
    // Every supplied config/capital/registration remains read-only for this sample.
    quote(accounts, 0, 0, 1, bounds.reference)?;
    quote(accounts, 1, 0, 1, bounds.reference)?;
    let mut totals = [0u64; 2];
    for side in 0..2u8 {
        let mut states = Vec::with_capacity(2);
        let mut requests = Vec::with_capacity(2);
        let mut models = Vec::with_capacity(2);
        let mut capacities = [0u64; 2];
        for id in 0..2 {
            // Bind the complete module set and prove positive depth in both directions.

            let (participant, registration, program, config) = if id == 0 {
                (
                    &accounts.first_capital,
                    &accounts.first_registration,
                    &accounts.first_program,
                    &accounts.first_config,
                )
            } else {
                (
                    &accounts.second_capital,
                    &accounts.second_registration,
                    &accounts.second_program,
                    &accounts.second_config,
                )
            };
            states.push(makers::config_state(
                config,
                program.key(),
                registration.maker_id,
                &accounts.market,
                participant,
            )?);
            let mut model = routes::participant_model(participant)?
                .accrued(funding_index)
                .map_err(|_| error!(ClearingError::Arithmetic))?;
            model.reserved = crate::orders::required_at(
                participant,
                accounts.market.terms_epoch,
                bounds.lower,
                bounds.upper,
                slot,
            )?;
            models.push(model);
            requests.push(maker_interface::QuoteRequest {
                version: 1,
                domain: accounts.market.domain,
                market: accounts.market.key(),
                capital: participant.key(),
                quote_epoch: registration.quote_epoch,
                authority_epoch: registration.authority_epoch,
                terms_epoch: accounts.market.terms_epoch,
                market_config_epoch: accounts.market.config_epoch,
                side,
                lots: 1,
                inventory: participant.lots,
                cash: participant.cash,
                inventory_limit: registration.inventory_limit,
                consumed: if side == 0 {
                    registration.buy_consumed
                } else {
                    registration.sell_consumed
                },
                reference_price: bounds.reference,
                slot,
            });
        }
        let priced = |id: usize, lots: u64| -> Option<u64> {
            if lots == 0 {
                return Some(0);
            }
            let mut request = requests[id].clone();
            request.lots = lots;
            let quote_result = maker_interface::quote(&states[id], &request).ok()?;
            let mut next = models[id];
            next.lots = next.lots.checked_add(if side == 0 {
                -(lots as i64)
            } else {
                lots as i64
            })?;
            next.virtual_scaled = next.virtual_scaled.checked_add(if side == 0 {
                i128::from(quote_result.gross_quote) * math::SCALE
            } else {
                -i128::from(quote_result.gross_quote) * math::SCALE
            })?;
            next.admissible(bounds.lower, bounds.upper, funding_index)
                .ok()?;
            Some(quote_result.gross_quote)
        };
        for id in 0..2 {
            if side == 1 {
                let expected = maker_interface::quote(&states[id], &requests[id])
                    .map_err(|_| error!(ClearingError::MakerQuote))?;
                let (config, program) = if id == 0 {
                    (&accounts.first_config, &accounts.first_program)
                } else {
                    (&accounts.second_config, &accounts.second_program)
                };
                makers::invoke_quote(config, program, &requests[id], &expected)?;
            }
            let participant = models[id];
            let equity = participant
                .risk_equity(bounds.lower, bounds.upper, funding_index)
                .map_err(|_| error!(ClearingError::MakerCapital))?;
            let initial = (u128::from(participant.lots.unsigned_abs()) * u128::from(bounds.upper))
                .div_ceil(10) as i128;
            let free = (equity / math::SCALE - initial - i128::from(participant.reserved)).max(0);
            // Every included marginal execution lies in the same +/-10% band as routes.
            // A lot can add at most ceil(upper/10) IM and this adverse execution loss.
            // Positive unpaid profit supplies no capacity. This bound is deliberately
            // conservative, and guarantees every quantity from zero through the cap.
            let (price_low, price_high) = policy::execution_band(bounds.reference)
                .map_err(|_| error!(ClearingError::OraclePolicy))?;
            let loss = (price_high.saturating_sub(bounds.lower))
                .max(bounds.upper.saturating_sub(price_low));
            let per_lot = bounds.upper.div_ceil(10) + loss;
            let mut cap = quantity.min(
                u64::try_from(free / i128::from(per_lot))
                    .map_err(|_| error!(ClearingError::Arithmetic))?,
            );
            let first = maker_interface::quote(&states[id], &requests[id])
                .map_err(|_| error!(ClearingError::MakerQuote))?;
            cap = cap.min(first.remaining + 1);
            require!(
                cap > 0 && first.gross_quote >= price_low && first.gross_quote <= price_high,
                ClearingError::MakerCapital
            );
            let marginal = |lot_count: u64| -> Result<u64> {
                let mut request = requests[id].clone();
                request.lots = lot_count;
                let total = maker_interface::quote(&states[id], &request)
                    .map_err(|_| error!(ClearingError::MakerQuote))?
                    .gross_quote;
                let previous = if lot_count == 1 {
                    0
                } else {
                    request.lots = lot_count - 1;
                    maker_interface::quote(&states[id], &request)
                        .map_err(|_| error!(ClearingError::MakerQuote))?
                        .gross_quote
                };
                total
                    .checked_sub(previous)
                    .ok_or_else(|| error!(ClearingError::Arithmetic))
            };
            let (mut low, mut high) = (1, cap);
            while low < high {
                let mid = (low + high).div_ceil(2);
                let last = marginal(mid)?;
                if (price_low..=price_high).contains(&last) {
                    low = mid
                } else {
                    high = mid - 1
                }
            }
            capacities[id] = low;
        }
        let (mut low, mut high) = (
            quantity.saturating_sub(capacities[1]),
            quantity.min(capacities[0]),
        );
        require!(low <= high, ClearingError::MakerQuote);
        let cost = |lot_count: u64| -> Result<u64> {
            priced(0, lot_count)
                .and_then(|current_cost| {
                    priced(1, quantity - lot_count)
                        .and_then(|next_cost| current_cost.checked_add(next_cost))
                })
                .ok_or_else(|| error!(ClearingError::MakerQuote))
        };
        // Ask cost is convex; bid proceeds concave. Discrete first differences
        // select the exact optimum without enumerating every lot on chain.
        while low < high {
            let mid = (low + high) / 2;
            let current_cost = cost(mid)?;
            let next_cost = cost(mid + 1)?;
            if if side == 0 {
                next_cost < current_cost
            } else {
                next_cost > current_cost
            } {
                low = mid + 1
            } else {
                high = mid
            }
        }
        let gross = cost(low)?;
        let mut checked = 0u64;
        for (id, lots) in [(0, low), (1, quantity - low)] {
            if lots > 0 {
                let mut request = requests[id].clone();
                request.lots = lots;
                let expected = maker_interface::quote(&states[id], &request)
                    .map_err(|_| error!(ClearingError::MakerQuote))?;
                let (config, program) = if id == 0 {
                    (&accounts.first_config, &accounts.first_program)
                } else {
                    (&accounts.second_config, &accounts.second_program)
                };
                checked = checked
                    .checked_add(
                        makers::invoke_quote(config, program, &request, &expected)?.gross_quote,
                    )
                    .ok_or(ClearingError::Arithmetic)?;
            }
        }
        require!(checked == gross, ClearingError::MakerResponse);
        totals[side as usize] = gross;
    }
    Ok((quantity, totals[1], totals[0]))
}
