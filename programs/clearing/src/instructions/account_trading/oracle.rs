//! Six authenticated local sources: BTC(1,3), collateral(2,4), ETH(5,6).
use super::*;
use financial_core::oracle as policy;

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeAccountOracle<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<Account<'info, MarketV3>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SampleAccountOracle<'info> {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<Account<'info, MarketV3>>,
    /// CHECK: fixed source identity/owner/schema/sequence verified before sampling policy.
    pub primary_asset: UncheckedAccount<'info>,
    /// CHECK: fixed source identity/owner/schema/sequence verified before sampling policy.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: fixed source identity/owner/schema/sequence verified before sampling policy.
    pub guard_asset: UncheckedAccount<'info>,
    /// CHECK: fixed source identity/owner/schema/sequence verified before sampling policy.
    pub guard_collateral: UncheckedAccount<'info>,
    pub first_capital: Box<Account<'info, MarginAccountV3>>,
    pub first_registration: Box<Account<'info, MakerRegistrationV3>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: complete registered module authentication and read-only CPI.
    pub first_config: UncheckedAccount<'info>,
    pub second_capital: Box<Account<'info, MarginAccountV3>>,
    pub second_registration: Box<Account<'info, MakerRegistrationV3>>,
    pub second_program: Program<'info>,
    pub second_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: complete registered module authentication and read-only CPI.
    pub second_config: UncheckedAccount<'info>,
}

pub(crate) fn feed_indexes(market: u8) -> Result<[usize; 4]> {
    match market {
        0 => Ok([0, 1, 2, 3]),
        1 => Ok([4, 1, 5, 3]),
        _ => err!(ClearingError::OracleSource),
    }
}

fn event(
    venue: &Account<VenueV3>,
    custody: &mut Account<CustodyV3>,
    market: &mut Account<MarketV3>,
) -> Result<crate::events::AccountOracleChangedV3> {
    increment(&mut custody.sequence)?;
    increment(&mut market.observation_sequence)?;
    Ok(crate::events::AccountOracleChangedV3 {
        venue: venue.key(),
        sequence: custody.sequence,
        slot: Clock::get()?.slot,
        market: market.key(),
        state: crate::events::MarketSnapshotV3::from(&**market),
    })
}

pub fn initialize(
    ctx: Context<InitializeAccountOracle>,
    primary: Pubkey,
    guard: Pubkey,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    profile(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    initialize_accounts(ctx, primary, guard)
}

/// Same source authority/state contract; profile-specific callers own activation
/// gates. This does not admit profile4 to the legacy two-maker sampler.
pub(crate) fn initialize_accounts(
    ctx: Context<InitializeAccountOracle>,
    primary: Pubkey,
    guard: Pubkey,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(
        ctx.accounts.safety.mode == CUSTODY
            && market.oracle.sources == [Pubkey::default(); 4]
            && primary != guard
            && primary != Pubkey::default()
            && guard != Pubkey::default(),
        ClearingError::OracleSource
    );
    for (position, feed) in feed_indexes(market.index)?.into_iter().enumerate() {
        let authority = if position < 2 { primary } else { guard };
        market.oracle.sources[position] = Pubkey::find_program_address(
            &[b"feed", authority.as_ref(), &[feed as u8 + 1; 32]],
            &oracle_fixture::ID,
        )
        .0;
    }
    market.config_epoch = market
        .config_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    emit_cpi!(event(
        &ctx.accounts.venue,
        &mut ctx.accounts.custody,
        market
    )?);
    Ok(())
}

pub(crate) fn effective(mode: u8, market: &MarketV3, clock: &Clock) -> Result<i128> {
    shared_oracle::effective(
        if mode == ACTIVE { 2 } else { 0 },
        &market_view(market)?,
        clock,
    )
}

pub(crate) fn action(market: &MarketV3, clock: &Clock, increase: bool) -> Result<()> {
    shared_oracle::action(&market_view(market)?, clock, increase)
}

fn impact(
    accounts: &SampleAccountOracle,
    bounds: policy::Bounds,
    funding: i128,
    clock: &Clock,
) -> Result<(u64, u64, u64, u64)> {
    let views = [
        makers::View {
            capital: &accounts.first_capital,
            registration: &accounts.first_registration,
            program: &accounts.first_program,
            data: &accounts.first_program_data,
            config: &accounts.first_config,
        },
        makers::View {
            capital: &accounts.second_capital,
            registration: &accounts.second_registration,
            program: &accounts.second_program,
            data: &accounts.second_program_data,
            config: &accounts.second_config,
        },
    ];
    require!(
        views[0].registration.maker_id == 0
            && views[1].registration.maker_id == 1
            && views[0].capital.key() != views[1].capital.key(),
        ClearingError::MakerBinding
    );
    let states = [
        views[0].authenticate(&accounts.venue, &accounts.market)?,
        views[1].authenticate(&accounts.venue, &accounts.market)?,
    ];
    let quantity = policy::REFERENCE_NOTIONAL.div_ceil(bounds.reference);
    let mut pricing_market = (**accounts.market).clone();
    pricing_market.lower = bounds.lower;
    pricing_market.upper = bounds.upper;
    let risks = super::super::group_trading::risk(&market_view(&pricing_market)?, funding)?;
    let market_index = usize::from(pricing_market.index);
    let mut totals = [0; 2];
    for side in 0..2u8 {
        let requests = views.each_ref().map(|view| {
            view.request(
                &accounts.venue,
                &accounts.market,
                side,
                1,
                bounds.reference,
                clock.slot,
            )
        });
        let mut models = Vec::with_capacity(2);
        let mut capacities = [0; 2];
        let mut indexes = [0; 2];
        indexes[market_index] = funding;
        for maker_index in 0..2 {
            let mut root = root_view(views[maker_index].capital)?;
            book::refresh(&mut root, &market_view(&pricing_market)?, clock.slot, true)?;
            let model = checked(super::super::group_margin::model(&root)?.accrued(indexes))?;
            let first = views[maker_index].quote(&states[maker_index], &requests[maker_index])?;
            let equity = checked(model.risk_equity(risks))?;
            let initial = checked(model.requirement(risks, math::IM_BPS))?;
            let free =
                (equity / math::SCALE - i128::from(initial) - i128::from(model.reserved)).max(0);
            let (price_low, price_high) = checked(policy::execution_band(bounds.reference))?;
            let loss = price_high
                .saturating_sub(bounds.lower)
                .max(bounds.upper.saturating_sub(price_low));
            let per_lot = bounds.upper.div_ceil(10) + loss;
            let capacity = quantity
                .min(
                    u64::try_from(free / i128::from(per_lot))
                        .map_err(|_| error!(ClearingError::Arithmetic))?,
                )
                .min(first.remaining + 1);
            require!(
                capacity > 0 && (price_low..=price_high).contains(&first.gross_quote),
                ClearingError::MakerCapital
            );
            let quote = |lots: u64| -> Result<u64> {
                if lots == 0 {
                    return Ok(0);
                }
                let mut request = requests[maker_index].clone();
                request.quote.lots = lots;
                Ok(maker_interface::account_quote(
                    accounts.venue.key(),
                    &states[maker_index],
                    &request,
                )
                .map_err(|_| error!(ClearingError::MakerQuote))?
                .gross_quote)
            };
            let (mut low, mut high) = (1, capacity);
            while low < high {
                let middle = (low + high).div_ceil(2);
                let marginal = quote(middle)?
                    .checked_sub(quote(middle - 1)?)
                    .ok_or(ClearingError::Arithmetic)?;
                if (price_low..=price_high).contains(&marginal) {
                    low = middle;
                } else {
                    high = middle - 1;
                }
            }
            capacities[maker_index] = low;
            models.push(model);
        }
        let priced = |maker_index: usize, lots: u64| -> Result<u64> {
            if lots == 0 {
                return Ok(0);
            }
            let mut request = requests[maker_index].clone();
            request.quote.lots = lots;
            let response = maker_interface::account_quote(
                accounts.venue.key(),
                &states[maker_index],
                &request,
            )
            .map_err(|_| error!(ClearingError::MakerQuote))?;
            let mut candidate = models[maker_index];
            let position = &mut candidate.positions[market_index];
            position.lots = position
                .lots
                .checked_add(if side == 0 {
                    -(lots as i64)
                } else {
                    lots as i64
                })
                .ok_or(ClearingError::Arithmetic)?;
            position.virtual_scaled = position
                .virtual_scaled
                .checked_add(if side == 0 {
                    i128::from(response.gross_quote) * math::SCALE
                } else {
                    -i128::from(response.gross_quote) * math::SCALE
                })
                .ok_or(ClearingError::Arithmetic)?;
            checked(candidate.admissible(risks))?;
            Ok(response.gross_quote)
        };
        let cost = |lots: u64| -> Result<u64> {
            checked(math::cash_add(
                priced(0, lots)?,
                priced(1, quantity - lots)?,
            ))
        };
        let (mut low, mut high) = (
            quantity.saturating_sub(capacities[1]),
            quantity.min(capacities[0]),
        );
        require!(low <= high, ClearingError::MakerQuote);
        while low < high {
            let middle = (low + high) / 2;
            let current = cost(middle)?;
            let next = cost(middle + 1)?;
            if if side == 0 {
                next < current
            } else {
                next > current
            } {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        let gross = cost(low)?;
        let mut invoked = 0;
        for (maker_index, lots) in [(0, low), (1, quantity - low)] {
            if lots == 0 {
                continue;
            }
            let mut request = requests[maker_index].clone();
            request.quote.lots = lots;
            invoked = checked(math::cash_add(
                invoked,
                views[maker_index]
                    .quote(&states[maker_index], &request)?
                    .gross_quote,
            ))?;
        }
        require!(invoked == gross, ClearingError::MakerResponse);
        totals[usize::from(side)] = gross;
    }
    Ok((
        quantity,
        totals[1],
        totals[0],
        views[0]
            .registration
            .expiry_slot
            .min(views[1].registration.expiry_slot),
    ))
}

pub fn sample(ctx: Context<SampleAccountOracle>) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    profile(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    let accounts = &mut *ctx.accounts;
    let clock = Clock::get()?;
    let old = accounts.market.oracle;
    // Reject substituted registered accounts, even if source/quote policy would be degraded.
    require!(
        accounts.first_registration.maker_id == 0
            && accounts.second_registration.maker_id == 1
            && accounts.first_registration.market == accounts.market.key()
            && accounts.second_registration.market == accounts.market.key()
            && accounts.first_registration.capital == accounts.first_capital.key()
            && accounts.second_registration.capital == accounts.second_capital.key()
            && accounts.first_registration.config == accounts.first_config.key()
            && accounts.second_registration.config == accounts.second_config.key()
            && accounts.first_registration.pricing_program == accounts.first_program.key()
            && accounts.second_registration.pricing_program == accounts.second_program.key()
            && accounts.first_registration.program_data == accounts.first_program_data.key()
            && accounts.second_registration.program_data == accounts.second_program_data.key(),
        ClearingError::MakerBinding
    );
    let sources = [
        &accounts.primary_asset,
        &accounts.primary_collateral,
        &accounts.guard_asset,
        &accounts.guard_collateral,
    ];
    let mut values = [None; 4];
    let mut sequences = old.source_sequences;
    for (position, feed) in feed_indexes(accounts.market.index)?.into_iter().enumerate() {
        crate::instructions::oracle::binding(sources[position], old.sources[position], feed)?;
        if let Ok((price, sequence)) = crate::instructions::oracle::source(
            sources[position],
            old.sources[position],
            feed,
            sequences[position],
        ) {
            values[position] = Some(price);
            sequences[position] = sequence;
        }
    }
    let bounds = values[0].zip(values[1]).and_then(|(asset, collateral)| {
        policy::market_bounds(
            accounts.market.lots_per_unit,
            [asset, collateral],
            values[2]
                .zip(values[3])
                .map(|(asset, collateral)| [asset, collateral]),
            clock.unix_timestamp,
        )
        .ok()
    });
    let funding = effective(accounts.safety.mode, &accounts.market, &clock)?;
    let prices = bounds
        .filter(|bounds| bounds.normal)
        .and_then(|bounds| impact(accounts, bounds, funding, &clock).ok());
    let next = shared_oracle::sample_candidate(
        if accounts.safety.mode == ACTIVE { 2 } else { 0 },
        &market_view(&accounts.market)?,
        &clock,
        bounds,
        sequences,
        prices,
    )?;
    commit_market(&mut accounts.market, &next)?;
    let emitted = event(&accounts.venue, &mut accounts.custody, &mut accounts.market)?;
    emit_cpi!(emitted);
    Ok(())
}
