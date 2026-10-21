//! G08 controlled local dependencies, causal funding, and action policy.
use crate::{
    custody, makers, routes, ClearingError, MakerRegistration, MarketState, Participant,
    PreviewArgs, TestRouteState,
};
use anchor_lang::prelude::*;
use financial_core::{self as math, oracle as policy};
use oracle_fixture::{Feed, ID as FIXTURE};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct OracleState {
    pub sources: [Pubkey; 4],
    pub source_sequences: [u64; 4],
    pub sampled_at: i64,
    pub source_deadline: i64,
    /// 0 no credible bounds, 1 degraded, 2 normal (subject to live clock checks).
    pub status: u8,
    pub outcome: u8,
    pub valid_since: i64,
    pub last_qualified: i64,
    pub held_until: i64,
    pub held_slot: u64,
    pub held_epoch: u64,
    pub funding_base: i128,
    pub premium_scaled: i128,
    pub quantity: u64,
    pub bid: u64,
    pub ask: u64,
    pub covered_seconds: u64,
    pub skipped_seconds: u64,
}
#[event_cpi]
#[derive(Accounts)]
pub struct InitializeOracle<'info> {
    pub authority: Signer<'info>,
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=authority)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Box<Account<'info, TestRouteState>>,
}
#[event_cpi]
#[derive(Accounts)]
pub struct SampleOracle<'info> {
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Box<Account<'info, TestRouteState>>,
    /// CHECK: exact configured PDA, fixture owner, discriminator and signed schema below.
    pub primary_btc: UncheckedAccount<'info>,
    /// CHECK: same checks, distinct collateral feed ID.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: independent fixture key, not claimed independent upstream economics.
    pub guard_btc: UncheckedAccount<'info>,
    /// CHECK: same checks, guard collateral feed ID.
    pub guard_collateral: UncheckedAccount<'info>,
    #[account(seeds=[b"participant",market.key().as_ref(),first_capital.owner.as_ref()],bump=first_capital.bump,has_one=market)]
    pub first_capital: Box<Account<'info, Participant>>,
    #[account(seeds=[b"maker",market.key().as_ref(),&[0]],bump=first_registration.bump,has_one=market,
        constraint=first_registration.capital==first_capital.key() @ ClearingError::MakerBinding)]
    pub first_registration: Box<Account<'info, MakerRegistration>>,
    #[account(address=makers::MAKER_A)]
    pub first_program: Program<'info>,
    #[account(address=first_registration.program_data)]
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: quote_checked validates exact registration/config/program bindings.
    #[account(address=first_registration.config)]
    pub first_config: UncheckedAccount<'info>,
    #[account(seeds=[b"participant",market.key().as_ref(),second_capital.owner.as_ref()],bump=second_capital.bump,has_one=market)]
    pub second_capital: Box<Account<'info, Participant>>,
    #[account(seeds=[b"maker",market.key().as_ref(),&[1]],bump=second_registration.bump,has_one=market,
        constraint=second_registration.capital==second_capital.key() @ ClearingError::MakerBinding)]
    pub second_registration: Box<Account<'info, MakerRegistration>>,
    #[account(address=makers::MAKER_B)]
    pub second_program: Program<'info>,
    #[account(address=second_registration.program_data)]
    pub second_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: quote_checked validates exact registration/config/program bindings.
    #[account(address=second_registration.config)]
    pub second_config: UncheckedAccount<'info>,
}
#[event]
pub struct OracleObserved {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub sequence: u64,
    pub slot: u64,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub observation_sequence: u64,
    pub reference_price: u64,
    pub lower: u64,
    pub upper: u64,
    pub valid_from: u64,
    pub valid_until: u64,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub oracle: OracleState,
}
fn event(m: &mut Account<MarketState>, r: &mut TestRouteState) -> Result<OracleObserved> {
    m.sequence = m.sequence.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    r.observation_sequence = r
        .observation_sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(OracleObserved {
        version: 1,
        domain: m.domain,
        market: m.key(),
        sequence: m.sequence,
        slot: Clock::get()?.slot,
        terms_epoch: m.terms_epoch,
        config_epoch: m.config_epoch,
        observation_sequence: r.observation_sequence,
        reference_price: r.reference_price,
        lower: r.lower,
        upper: r.upper,
        valid_from: r.valid_from,
        valid_until: r.valid_until,
        funding_index_scaled: m.funding_index_scaled,
        funding_time: m.funding_time,
        oracle: r.oracle,
    })
}
pub fn initialize(ctx: Context<InitializeOracle>, primary: Pubkey, guard: Pubkey) -> Result<()> {
    require!(cfg!(feature = "local-test-profile"), ClearingError::Profile);
    let a = &mut *ctx.accounts;
    custody::profile(&a.market)?;
    require!(
        a.market.mode == 1
            && !a.market.paused
            && primary != guard
            && primary != Pubkey::default()
            && guard != Pubkey::default(),
        ClearingError::OraclePolicy
    );
    let mut sources = [Pubkey::default(); 4];
    for (i, source) in sources.iter_mut().enumerate() {
        let authority = if i < 2 { primary } else { guard };
        *source = Pubkey::find_program_address(
            &[b"feed", authority.as_ref(), &[i as u8 + 1; 32]],
            &FIXTURE,
        )
        .0;
    }
    a.market.mode = 2;
    a.market.config_epoch = a
        .market
        .config_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    a.route_state.oracle = OracleState {
        sources,
        ..OracleState::default()
    };
    a.route_state.valid_until = 0;
    let ev = event(&mut a.market, &mut a.route_state)?;
    emit_cpi!(ev);
    Ok(())
}
pub(crate) fn source(
    info: &AccountInfo,
    expected: Pubkey,
    index: usize,
    sequence: u64,
) -> Result<(policy::Price, u64)> {
    require!(
        info.key == &expected && info.owner == &FIXTURE && !info.is_writable,
        ClearingError::OracleSource
    );
    let bytes = info.try_borrow_data()?;
    require!(
        bytes.len() == 8 + Feed::INIT_SPACE,
        ClearingError::OracleSource
    );
    let feed = Feed::try_deserialize(&mut &bytes[..])?;
    require!(
        feed.feed_id == [index as u8 + 1; 32]
            && feed.value.verifier == FIXTURE
            && feed.value.level == 2
            && feed.sequence > 0
            && feed.sequence >= sequence,
        ClearingError::OracleSource
    );
    Ok((
        policy::Price {
            value: feed.value.price,
            confidence: feed.value.confidence,
            exponent: feed.value.exponent,
            published: feed.value.published,
        },
        feed.sequence,
    ))
}
/// Prefix evaluation is independent of the number of accruals/trades in the hold.
pub fn funding(m: &MarketState, r: &TestRouteState, now: i64, slot: u64) -> Result<i128> {
    if m.mode != 2 {
        return Ok(m.funding_index_scaled);
    }
    let o = &r.oracle;
    if o.held_epoch != m.config_epoch
        || o.held_until <= o.sampled_at
        || slot >= o.held_slot
        || now < o.sampled_at
        || now - o.sampled_at > policy::MAX_CATCHUP
    {
        return Ok(m.funding_index_scaled);
    }
    policy::endpoint(
        o.funding_base,
        o.premium_scaled,
        o.sampled_at,
        o.held_until,
        now,
    )
    .map_err(|_| error!(ClearingError::Arithmetic))
}
pub fn materialize(m: &mut MarketState, r: &TestRouteState) -> Result<()> {
    let c = Clock::get()?;
    m.funding_index_scaled = funding(m, r, c.unix_timestamp, c.slot)?;
    let o = &r.oracle;
    if m.mode == 2
        && o.held_epoch == m.config_epoch
        && o.held_until > o.sampled_at
        && c.slot < o.held_slot
        && c.unix_timestamp >= o.sampled_at
        && c.unix_timestamp - o.sampled_at <= policy::MAX_CATCHUP
    {
        m.funding_time = c.unix_timestamp.min(o.held_until);
    }
    Ok(())
}
pub fn effective(m: &MarketState, r: &TestRouteState) -> Result<i128> {
    let c = Clock::get()?;
    funding(m, r, c.unix_timestamp, c.slot)
}
/// Conservative endpoint for a cohort certificate; no participant is valued with a different aggregate F.
pub fn funding_bounds(m: &MarketState, r: &TestRouteState) -> Result<[i128; 2]> {
    let current = effective(m, r)?;
    let o = &r.oracle;
    let end = if m.mode == 2 && o.held_epoch == m.config_epoch && o.held_until > o.sampled_at {
        policy::endpoint(
            o.funding_base,
            o.premium_scaled,
            o.sampled_at,
            o.held_until,
            o.held_until,
        )
        .map_err(|_| error!(ClearingError::Arithmetic))?
    } else {
        current
    };
    Ok([
        current.min(end).min(m.funding_index_scaled),
        current.max(end).max(m.funding_index_scaled),
    ])
}
pub fn action(m: &MarketState, r: &TestRouteState, increase: bool) -> Result<()> {
    let c = Clock::get()?;
    require!(
        c.slot >= r.valid_from && c.slot < r.valid_until,
        ClearingError::RiskObservation
    );
    if m.mode == 2 {
        let o = &r.oracle;
        require!(
            o.status > 0
                && c.unix_timestamp >= o.sampled_at
                && c.unix_timestamp < o.source_deadline,
            ClearingError::OraclePolicy
        );
        if increase {
            require!(
                o.status == 2
                    && o.held_epoch == m.config_epoch
                    && c.unix_timestamp - o.last_qualified < policy::FUNDING_OUTAGE,
                ClearingError::OraclePolicy
            );
        }
    }
    Ok(())
}
fn quote<'info>(
    a: &SampleOracle<'info>,
    id: usize,
    side: u8,
    lots: u64,
    reference: u64,
) -> Result<maker_interface::QuoteResponse> {
    let (p, r, program, data, config) = if id == 0 {
        (
            &a.first_capital,
            &a.first_registration,
            &a.first_program,
            &a.first_program_data,
            &a.first_config,
        )
    } else {
        (
            &a.second_capital,
            &a.second_registration,
            &a.second_program,
            &a.second_program_data,
            &a.second_config,
        )
    };
    require!(
        r.pricing_program == program.key()
            && program.programdata_address()? == Some(data.key())
            && r.owner == p.owner,
        ClearingError::MakerBinding
    );
    makers::quote_checked(
        &a.market,
        p,
        r,
        program,
        data,
        config,
        PreviewArgs {
            side,
            lots,
            reference_price: reference,
            quote_epoch: r.quote_epoch,
            authority_epoch: r.authority_epoch,
            terms_epoch: a.market.terms_epoch,
            config_epoch: a.market.config_epoch,
        },
    )
}
fn impact(a: &SampleOracle, b: policy::Bounds, f: i128) -> Result<(u64, u64, u64)> {
    let quantity = policy::REFERENCE_NOTIONAL.div_ceil(b.reference);
    let slot = Clock::get()?.slot;
    // Full ProgramData hash and standing-authority validation once per module.
    // Every supplied config/capital/registration remains read-only for this sample.
    quote(a, 0, 0, 1, b.reference)?;
    quote(a, 1, 0, 1, b.reference)?;
    let mut totals = [0u64; 2];
    for side in 0..2u8 {
        let mut states = Vec::with_capacity(2);
        let mut requests = Vec::with_capacity(2);
        let mut models = Vec::with_capacity(2);
        let mut capacities = [0u64; 2];
        for id in 0..2 {
            // Bind the complete module set and prove positive depth in both directions.

            let (p, r, program, config) = if id == 0 {
                (
                    &a.first_capital,
                    &a.first_registration,
                    &a.first_program,
                    &a.first_config,
                )
            } else {
                (
                    &a.second_capital,
                    &a.second_registration,
                    &a.second_program,
                    &a.second_config,
                )
            };
            states.push(makers::config_state(
                config,
                program.key(),
                r.maker_id,
                &a.market,
                p,
            )?);
            let mut model = routes::participant_model(p)?
                .accrued(f)
                .map_err(|_| error!(ClearingError::Arithmetic))?;
            model.reserved =
                crate::orders::required_at(p, a.market.terms_epoch, b.lower, b.upper, slot)?;
            models.push(model);
            requests.push(maker_interface::QuoteRequest {
                version: 1,
                domain: a.market.domain,
                market: a.market.key(),
                capital: p.key(),
                quote_epoch: r.quote_epoch,
                authority_epoch: r.authority_epoch,
                terms_epoch: a.market.terms_epoch,
                market_config_epoch: a.market.config_epoch,
                side,
                lots: 1,
                inventory: p.lots,
                cash: p.cash,
                inventory_limit: r.inventory_limit,
                consumed: if side == 0 {
                    r.buy_consumed
                } else {
                    r.sell_consumed
                },
                reference_price: b.reference,
                slot,
            });
        }
        let priced = |id: usize, lots: u64| -> Option<u64> {
            if lots == 0 {
                return Some(0);
            }
            let mut req = requests[id].clone();
            req.lots = lots;
            let q = maker_interface::quote(&states[id], &req).ok()?;
            let mut next = models[id];
            next.lots = next.lots.checked_add(if side == 0 {
                -(lots as i64)
            } else {
                lots as i64
            })?;
            next.virtual_scaled = next.virtual_scaled.checked_add(if side == 0 {
                i128::from(q.gross_quote) * math::SCALE
            } else {
                -i128::from(q.gross_quote) * math::SCALE
            })?;
            next.admissible(b.lower, b.upper, f).ok()?;
            Some(q.gross_quote)
        };
        for id in 0..2 {
            if side == 1 {
                let expected = maker_interface::quote(&states[id], &requests[id])
                    .map_err(|_| error!(ClearingError::MakerQuote))?;
                let (config, program) = if id == 0 {
                    (&a.first_config, &a.first_program)
                } else {
                    (&a.second_config, &a.second_program)
                };
                makers::invoke_quote(config, program, &requests[id], &expected)?;
            }
            let p = models[id];
            let equity = p
                .risk_equity(b.lower, b.upper, f)
                .map_err(|_| error!(ClearingError::MakerCapital))?;
            let initial =
                (u128::from(p.lots.unsigned_abs()) * u128::from(b.upper)).div_ceil(10) as i128;
            let free = (equity / math::SCALE - initial - i128::from(p.reserved)).max(0);
            // Every included marginal execution lies in the same +/-10% band as routes.
            // A lot can add at most ceil(upper/10) IM and this adverse execution loss.
            // Positive unpaid profit supplies no capacity. This bound is deliberately
            // conservative, and guarantees every quantity from zero through the cap.
            let (price_low, price_high) = policy::execution_band(b.reference)
                .map_err(|_| error!(ClearingError::OraclePolicy))?;
            let loss = (price_high.saturating_sub(b.lower)).max(b.upper.saturating_sub(price_low));
            let per_lot = b.upper.div_ceil(10) + loss;
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
            let marginal = |n: u64| -> Result<u64> {
                let mut req = requests[id].clone();
                req.lots = n;
                let total = maker_interface::quote(&states[id], &req)
                    .map_err(|_| error!(ClearingError::MakerQuote))?
                    .gross_quote;
                let previous = if n == 1 {
                    0
                } else {
                    req.lots = n - 1;
                    maker_interface::quote(&states[id], &req)
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
        let cost = |n: u64| -> Result<u64> {
            priced(0, n)
                .and_then(|x| priced(1, quantity - n).and_then(|y| x.checked_add(y)))
                .ok_or_else(|| error!(ClearingError::MakerQuote))
        };
        // Ask cost is convex; bid proceeds concave. Discrete first differences
        // select the exact optimum without enumerating every lot on chain.
        while low < high {
            let mid = (low + high) / 2;
            let x = cost(mid)?;
            let y = cost(mid + 1)?;
            if if side == 0 { y < x } else { y > x } {
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
                    (&a.first_config, &a.first_program)
                } else {
                    (&a.second_config, &a.second_program)
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
pub fn sample(ctx: Context<SampleOracle>) -> Result<()> {
    require!(
        cfg!(feature = "local-test-profile") && ctx.remaining_accounts.is_empty(),
        ClearingError::Profile
    );
    let a = &mut *ctx.accounts;
    custody::profile(&a.market)?;
    require!(
        a.market.mode == 2 && !a.market.paused,
        ClearingError::Profile
    );
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let old = a.route_state.oracle;
    require!(
        now > 0 && (old.sampled_at == 0 || now - old.sampled_at >= policy::SAMPLE_INTERVAL),
        ClearingError::OraclePolicy
    );
    let sources = [
        &a.primary_btc,
        &a.primary_collateral,
        &a.guard_btc,
        &a.guard_collateral,
    ];
    let mut values = [None; 4];
    let mut sequences = old.source_sequences;
    for i in 0..4 {
        // Bad account selection is a rejected caller attempt, never evidence that a
        // configured authenticated source failed (which would permit griefing).
        require!(
            sources[i].key() == old.sources[i]
                && sources[i].owner == &FIXTURE
                && !sources[i].is_writable,
            ClearingError::OracleSource
        );
        if let Ok((p, s)) = source(sources[i], old.sources[i], i, sequences[i]) {
            values[i] = Some(p);
            sequences[i] = s;
        }
    }
    let bounds = values[0].zip(values[1]).and_then(|(p, c)| {
        policy::bounds([p, c], values[2].zip(values[3]).map(|(p, c)| [p, c]), now).ok()
    });
    let gap = old.sampled_at > 0 && now - old.sampled_at > policy::MAX_CATCHUP;
    let changed = old.held_epoch != a.market.config_epoch;
    let current = effective(&a.market, &a.route_state)?;
    let sampled = if let Some(b) = bounds.filter(|b| b.normal) {
        impact(a, b, current).ok()
    } else {
        None
    };
    // If required maker terms cannot be revalidated, preserve materialized charges
    // and explicitly discard unverified pending coverage. Never rewrite old participants.
    let preserve = !gap && !changed && sampled.is_some();
    let f = if preserve {
        current
    } else {
        a.market.funding_index_scaled
    };
    let elapsed = if old.sampled_at > 0 {
        (now - old.sampled_at) as u64
    } else {
        0
    };
    let covered = if preserve {
        (now.min(old.held_until) - old.sampled_at).max(0) as u64
    } else if old.held_until > old.sampled_at {
        (a.market.funding_time.min(old.held_until) - old.sampled_at).max(0) as u64
    } else {
        0
    };
    let mut o = OracleState {
        sources: old.sources,
        source_sequences: sequences,
        sampled_at: now,
        // A restrictive sample must not erase the last credible deadline and
        // indefinitely prevent the authority's source-emergency grace proof.
        // status=0 and valid_until=0 still prohibit every priced action.
        source_deadline: old.source_deadline,
        funding_base: f,
        held_epoch: a.market.config_epoch,
        covered_seconds: old
            .covered_seconds
            .checked_add(covered)
            .ok_or(ClearingError::Arithmetic)?,
        skipped_seconds: old
            .skipped_seconds
            .checked_add(elapsed.saturating_sub(covered))
            .ok_or(ClearingError::Arithmetic)?,
        outcome: if gap {
            3
        } else if changed && old.sampled_at > 0 {
            4
        } else if bounds.is_none() {
            1
        } else if sampled.is_none() {
            2
        } else {
            0
        },
        last_qualified: old.last_qualified,
        ..OracleState::default()
    };
    if let Some(b) = bounds {
        a.route_state.reference_price = b.reference;
        a.route_state.lower = b.lower;
        a.route_state.upper = b.upper;
        a.route_state.valid_from = clock.slot;
        a.route_state.valid_until = clock
            .slot
            .checked_add(3600)
            .ok_or(ClearingError::Arithmetic)?;
        o.source_deadline = b.deadline;
        o.status = 1;
        if let Some((quantity, bid, ask)) = sampled {
            o.quantity = quantity;
            o.bid = bid;
            o.ask = ask;
            o.premium_scaled = policy::premium(b.reference, quantity, bid, ask)
                .map_err(|_| error!(ClearingError::OraclePolicy))?;
            o.held_until = (now + policy::HOLD).min(b.deadline);
            o.held_slot = a
                .first_registration
                .expiry_slot
                .min(a.second_registration.expiry_slot);
            o.last_qualified = now;
            o.valid_since = if old.valid_since > 0
                && now - old.sampled_at <= policy::HOLD
                && old.held_epoch == a.market.config_epoch
            {
                old.valid_since
            } else {
                now
            };
            if now - o.valid_since >= policy::RECOVERY {
                o.status = 2;
            }
        }
    } else {
        a.route_state.valid_until = 0;
    }
    a.market.funding_index_scaled = f;
    a.market.funding_time = now;
    a.route_state.oracle = o;
    let ev = event(&mut a.market, &mut a.route_state)?;
    emit_cpi!(ev);
    Ok(())
}
