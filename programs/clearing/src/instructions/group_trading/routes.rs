//! One/two-maker atomic routes. Pure candidates are admitted before any root is committed.
use super::*;
use crate::instructions::{OrderExecution, OrderTerms, RouteIntent};
use anchor_spl::token::TokenAccount;
use maker_interface::QuoteResponse;

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteGroupRoute<'info> {
    pub actor: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", &group.domain], bump = group.bump, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[market.index]], bump = market.bump, has_one = group)]
    pub market: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        constraint = vault.owner == group.key() && vault.mint == group.quote_mint @ ClearingError::Reconciliation)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"margin-v2", trader.portfolio.as_ref(), &trader.subaccount_index.to_le_bytes()], bump = trader.bump, has_one = group)]
    pub trader: Box<Account<'info, MarginAccountV2>>,
    #[account(mut)]
    pub first_capital: Box<Account<'info, MarginAccountV2>>,
    #[account(mut)]
    pub first_registration: Box<Account<'info, MakerRegistrationV2>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: authenticated read-only config is the sole maker CPI account.
    pub first_config: UncheckedAccount<'info>,
    #[account(mut)]
    pub second_capital: Option<Box<Account<'info, MarginAccountV2>>>,
    #[account(mut)]
    pub second_registration: Option<Box<Account<'info, MakerRegistrationV2>>>,
    pub second_program: Option<Program<'info>>,
    pub second_program_data: Option<Box<Account<'info, ProgramData>>>,
    /// CHECK: authenticated read-only config is the sole maker CPI account.
    pub second_config: Option<UncheckedAccount<'info>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ManageGroupOrder<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", &group.domain], bump = group.bump)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[market.index]], bump = market.bump, has_one = group)]
    pub market: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"margin-v2", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = group, has_one = owner)]
    pub margin: Box<Account<'info, MarginAccountV2>>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum GroupOrderAction {
    Place {
        expected_id: u64,
        terms: OrderTerms,
    },
    Replace {
        id: u64,
        version: u64,
        terms: OrderTerms,
    },
    Protect {
        expected_id: u64,
        take_profit: OrderTerms,
        stop_loss: OrderTerms,
    },
    Cancel {
        id: u64,
        version: u64,
        protection_group: bool,
    },
    Cleanup,
}

pub fn manage(ctx: Context<ManageGroupOrder>, operation: GroupOrderAction) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    activated(&ctx.accounts.group)?;
    let accounts = &mut *ctx.accounts;
    let clock = Clock::get()?;
    let funding = oracle::effective(accounts.group.mode, &accounts.market, &clock)?;
    let next = match operation {
        GroupOrderAction::Place { expected_id, terms } => {
            oracle::action(&accounts.market, &clock, !terms.reduce_only)?;
            book::place(
                &accounts.margin,
                &accounts.market,
                funding,
                clock.slot,
                expected_id,
                terms,
            )?
        }
        GroupOrderAction::Replace { id, version, terms } => {
            oracle::action(&accounts.market, &clock, !terms.reduce_only)?;
            book::replace(
                &accounts.margin,
                &accounts.market,
                funding,
                clock.slot,
                id,
                version,
                terms,
            )?
        }
        GroupOrderAction::Protect {
            expected_id,
            take_profit,
            stop_loss,
        } => {
            oracle::action(&accounts.market, &clock, false)?;
            book::protect(
                &accounts.margin,
                &accounts.market,
                funding,
                clock.slot,
                expected_id,
                take_profit,
                stop_loss,
            )?
        }
        GroupOrderAction::Cancel {
            id,
            version,
            protection_group,
        } => book::cancel(
            &accounts.margin,
            &accounts.market,
            clock.slot,
            id,
            version,
            protection_group,
            oracle::action(&accounts.market, &clock, false).is_ok(),
        )?,
        GroupOrderAction::Cleanup => {
            let mut next = (**accounts.margin).clone();
            book::validate(&next)?;
            book::refresh(
                &mut next,
                &accounts.market,
                clock.slot,
                oracle::action(&accounts.market, &clock, false).is_ok(),
            )?;
            advance(&mut next)?;
            next
        }
    };
    accounts.margin.set_inner(next);
    oracle::materialize(accounts.group.mode, &mut accounts.market, &clock)?;
    accounts.group.sequence = accounts
        .group
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    let emitted = order_event(
        &accounts.group,
        &accounts.market,
        &accounts.margin,
        clock.slot,
    );
    emit_cpi!(*emitted);
    Ok(())
}

#[inline(never)]
fn order_event(
    group: &Account<ClearingGroupV2>,
    market: &Account<GroupMarketV2>,
    margin: &Account<MarginAccountV2>,
    slot: u64,
) -> Box<crate::events::GroupOrderChangedV2> {
    Box::new(crate::events::GroupOrderChangedV2 {
        group: group.key(),
        sequence: group.sequence,
        slot,
        market: market.key(),
        market_state: crate::events::GroupMarketSnapshotV2::from(&**market),
        margin: margin.key(),
        state: crate::events::MarginAccountSnapshotV2::from(&**margin),
    })
}

pub(crate) fn stored_intent(
    group: &ClearingGroupV2,
    market: &GroupMarketV2,
    trader: &MarginAccountV2,
    args: OrderExecution,
    clock: &Clock,
) -> Result<(RouteIntent, usize)> {
    book::validate(trader)?;
    require!(
        trader.group == market.group && trader.isolated_market_index == market.index,
        ClearingError::OrderState
    );
    let index = book::find(trader, args.id, args.version)?;
    let order = trader.book.orders[index].order;
    require!(
        order.filled == args.filled
            && order.terms_epoch == market.terms_epoch
            && clock.slot >= order.start_slot
            && clock.slot < order.expiry_slot
            && args.lots > 0
            && args.lots <= book::eligible(trader, &order)?,
        ClearingError::OrderState
    );
    require!(
        order.trigger == 0
            || (order.trigger == 1 && market.reference_price >= order.threshold)
            || (order.trigger == 2 && market.reference_price <= order.threshold),
        ClearingError::OrderTrigger
    );
    Ok((
        RouteIntent {
            domain: group.domain,
            terms_epoch: order.terms_epoch,
            config_epoch: market.config_epoch,
            observation_sequence: args.observation_sequence,
            nonce: trader.nonce,
            start_slot: args.start_slot,
            expiry_slot: args.expiry_slot,
            side: order.side,
            lots: args.lots,
            all_in_limit: order
                .limit
                .checked_mul(args.lots)
                .ok_or(ClearingError::Arithmetic)?,
            max_fee: order.fee_budget - order.fee_charged,
            reduce_only: order.reduce_only,
            generation: if order.reduce_only {
                Some(order.generation)
            } else {
                None
            },
            legs: args.legs,
        },
        index,
    ))
}

pub(crate) struct Candidate {
    pub trader: Box<MarginAccountV2>,
    pub makers: Vec<MarginAccountV2>,
    pub fee: u64,
    pub gross: u64,
    pub gross_lots: u64,
}

pub(crate) fn candidate(
    group: &ClearingGroupV2,
    market: &GroupMarketV2,
    trader: &MarginAccountV2,
    makers: &[MarginAccountV2],
    quotes: &[QuoteResponse],
    intent: &RouteIntent,
    order_index: Option<usize>,
    funding: i128,
    clock: &Clock,
) -> Result<Candidate> {
    let trader_model = model(trader)?;
    book::validate(trader)?;
    require!(
        trader.group == market.group
            && trader.isolated_market_index == market.index
            && makers.len() == quotes.len()
            && makers.len() == intent.legs.len()
            && (1..=2).contains(&makers.len())
            && intent.domain == group.domain
            && intent.terms_epoch == market.terms_epoch
            && intent.config_epoch == market.config_epoch
            && intent.observation_sequence == market.observation_sequence
            && intent.nonce == trader.nonce
            && intent.side <= 1
            && (1..=4608).contains(&intent.lots)
            && clock.slot >= intent.start_slot
            && clock.slot < intent.expiry_slot
            && intent
                .expiry_slot
                .checked_sub(intent.start_slot)
                .is_some_and(|duration| duration <= 150),
        ClearingError::RouteIntent
    );
    oracle::action(market, clock, !intent.reduce_only)?;
    let position = trader.positions[usize::from(market.index)];
    if let Some(generation) = intent.generation {
        require!(
            generation == position.generation,
            ClearingError::RouteIntent
        );
    }
    if intent.reduce_only {
        require!(
            intent.generation == Some(position.generation)
                && position.lots != 0
                && intent.lots <= position.lots.unsigned_abs()
                && ((intent.side == 0) == (position.lots < 0)),
            ClearingError::RouteIntent
        );
    }
    let mut gross = 0;
    let mut lots = 0u64;
    let mut models = Vec::with_capacity(makers.len());
    let mut legs = Vec::with_capacity(makers.len());
    for (index, ((maker, quote), leg)) in makers.iter().zip(quotes).zip(&intent.legs).enumerate() {
        require!(
            maker.group == trader.group
                && maker.role == ROLE_MAKER
                && maker.owner != trader.owner
                && maker.id != trader.id
                && !makers[..index].iter().any(|other| other.id == maker.id)
                && !quotes[..index]
                    .iter()
                    .any(|other| other.maker_id == quote.maker_id),
            ClearingError::Alias
        );
        book::validate(maker)?;
        models.push(model(maker)?);
        require!(
            quote.version == maker_interface::GROUP_VERSION
                && quote.side == intent.side
                && quote.lots == leg.lots
                && quote.lots > 0
                && quote.quote_epoch == leg.quote_epoch
                && quote.authority_epoch == leg.authority_epoch
                && quote.terms_epoch == intent.terms_epoch
                && quote.market_config_epoch == intent.config_epoch
                && u128::from(quote.gross_quote) * 10
                    >= u128::from(quote.lots) * u128::from(market.reference_price) * 9
                && u128::from(quote.gross_quote) * 10
                    <= u128::from(quote.lots) * u128::from(market.reference_price) * 11,
            ClearingError::RouteLimit
        );
        gross = checked(math::cash_add(gross, quote.gross_quote))?;
        lots = lots
            .checked_add(quote.lots)
            .ok_or(ClearingError::Arithmetic)?;
        legs.push((quote.lots, quote.gross_quote));
    }
    require!(lots == intent.lots, ClearingError::RouteIntent);
    let prefix = order_index
        .map(|index| trader.book.orders[index].order.notional)
        .unwrap_or(0);
    let mut indexes = [0; 2];
    indexes[usize::from(market.index)] = funding;
    let (next, next_makers, fee) = checked(math::margin::route_candidate(
        trader_model,
        &models,
        usize::from(market.index),
        &legs,
        intent.side,
        indexes,
        prefix,
    ))?;
    require!(
        fee <= intent.max_fee
            && if intent.side == 0 {
                gross
                    .checked_add(fee)
                    .is_some_and(|total| total <= intent.all_in_limit)
            } else {
                gross
                    .checked_sub(fee)
                    .is_some_and(|total| total >= intent.all_in_limit)
            },
        ClearingError::RouteLimit
    );
    let mut trader_next = Box::new(trader.clone());
    commit_model(&mut trader_next, next)?;
    if let Some(index) = order_index {
        book::consume(&mut trader_next, index, intent.lots, gross, fee)?;
    }
    trader_next.nonce = trader_next
        .nonce
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    book::refresh(&mut trader_next, market, clock.slot, true)?;
    let risks = risk(market, funding)?;
    model(&trader_next)?
        .admissible(risks)
        .map_err(|_| error!(ClearingError::RouteHealth))?;
    advance(&mut trader_next)?;
    let mut makers_next = Vec::with_capacity(makers.len());
    for (maker, next_model) in makers.iter().zip(next_makers) {
        makers_next.push(*finish_maker(maker, next_model, market, clock.slot, risks)?);
    }
    let market_index = usize::from(market.index);
    let before = trader.positions[market_index].lots.unsigned_abs()
        + makers
            .iter()
            .map(|root| root.positions[market_index].lots.unsigned_abs())
            .sum::<u64>();
    let after = trader_next.positions[market_index].lots.unsigned_abs()
        + makers_next
            .iter()
            .map(|root| root.positions[market_index].lots.unsigned_abs())
            .sum::<u64>();
    let gross_lots = market
        .gross_lots
        .checked_sub(before)
        .and_then(|gross| gross.checked_add(after))
        .ok_or(ClearingError::Arithmetic)?;
    require!(
        gross_lots <= math::MAX_GROSS_LOTS,
        ClearingError::RouteHealth
    );
    Ok(Candidate {
        trader: trader_next,
        makers: makers_next,
        fee,
        gross,
        gross_lots,
    })
}

#[inline(never)]
fn finish_maker(
    root: &MarginAccountV2,
    candidate: math::margin::Margin,
    market: &GroupMarketV2,
    slot: u64,
    risks: [math::margin::Risk; 2],
) -> Result<Box<MarginAccountV2>> {
    let mut next = Box::new(root.clone());
    commit_model(&mut next, candidate)?;
    book::refresh(&mut next, market, slot, true)?;
    model(&next)?
        .admissible(risks)
        .map_err(|_| error!(ClearingError::RouteHealth))?;
    advance(&mut next)?;
    Ok(next)
}

pub fn execute(ctx: Context<ExecuteGroupRoute>, intent: RouteIntent) -> Result<()> {
    require!(
        ctx.accounts.actor.key() == ctx.accounts.trader.owner,
        ClearingError::Authority
    );
    execute_core(ctx, intent, None)
}

pub fn execute_order(ctx: Context<ExecuteGroupRoute>, args: OrderExecution) -> Result<()> {
    let (intent, index) = stored_intent(
        &ctx.accounts.group,
        &ctx.accounts.market,
        &ctx.accounts.trader,
        args,
        &Clock::get()?,
    )?;
    execute_core(ctx, intent, Some(index))
}

fn execute_core(
    ctx: Context<ExecuteGroupRoute>,
    intent: RouteIntent,
    order_index: Option<usize>,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    activated(&ctx.accounts.group)?;
    let accounts = &mut *ctx.accounts;
    let clock = Clock::get()?;
    crate::instructions::group_custody::reconciled(&accounts.group, accounts.vault.amount)?;
    oracle::action(&accounts.market, &clock, !intent.reduce_only)?;
    let has_second = intent.legs.len() == 2;
    require!(
        (1..=2).contains(&intent.legs.len())
            && [
                accounts.second_capital.is_some(),
                accounts.second_registration.is_some(),
                accounts.second_program.is_some(),
                accounts.second_program_data.is_some(),
                accounts.second_config.is_some()
            ]
            .iter()
            .all(|present| *present == has_second),
        ClearingError::RouteIntent
    );
    let funding = oracle::effective(accounts.group.mode, &accounts.market, &clock)?;
    let mut views = vec![makers::View {
        capital: &accounts.first_capital,
        registration: &accounts.first_registration,
        program: &accounts.first_program,
        data: &accounts.first_program_data,
        config: &accounts.first_config,
    }];
    if has_second {
        views.push(makers::View {
            capital: accounts.second_capital.as_deref().unwrap(),
            registration: accounts.second_registration.as_deref().unwrap(),
            program: accounts.second_program.as_ref().unwrap(),
            data: accounts.second_program_data.as_deref().unwrap(),
            config: accounts.second_config.as_ref().unwrap(),
        });
    }
    let mut quotes = Vec::with_capacity(views.len());
    let mut roots = Vec::with_capacity(views.len());
    for (view, leg) in views.iter().zip(&intent.legs) {
        let state = view.authenticate(&accounts.group, &accounts.market)?;
        let request = view.request(
            &accounts.group,
            &accounts.market,
            intent.side,
            leg.lots,
            accounts.market.reference_price,
            clock.slot,
        );
        quotes.push(view.quote(&state, &request)?);
        roots.push((**view.capital).clone());
    }
    let next = candidate(
        &accounts.group,
        &accounts.market,
        &accounts.trader,
        &roots,
        &quotes,
        &intent,
        order_index,
        funding,
        &clock,
    )?;
    for (view, root) in views.iter().zip(&next.makers) {
        require!(
            root.positions[usize::from(accounts.market.index)]
                .lots
                .unsigned_abs()
                <= view.registration.inventory_limit,
            ClearingError::RouteHealth
        );
    }
    drop(views);
    let consume = |registration: &mut MakerRegistrationV2, quote: &QuoteResponse| -> Result<()> {
        let consumed = if intent.side == 0 {
            &mut registration.buy_consumed
        } else {
            &mut registration.sell_consumed
        };
        *consumed = maker_interface::consume(*consumed, quote)
            .map_err(|_| error!(ClearingError::MakerResponse))?;
        Ok(())
    };
    consume(&mut accounts.first_registration, &quotes[0])?;
    accounts.first_capital.set_inner(next.makers[0].clone());
    if has_second {
        consume(accounts.second_registration.as_mut().unwrap(), &quotes[1])?;
        accounts
            .second_capital
            .as_mut()
            .unwrap()
            .set_inner(next.makers[1].clone());
    }
    let order = order_index.map(|index| accounts.trader.book.orders[index].order);
    accounts.trader.set_inner(*next.trader);
    accounts.market.gross_lots = next.gross_lots;
    oracle::materialize(accounts.group.mode, &mut accounts.market, &clock)?;
    accounts.group.total_cash = checked(math::cash_sub(accounts.group.total_cash, next.fee))?;
    accounts.group.fees = checked(math::cash_add(accounts.group.fees, next.fee))?;
    accounts.group.sequence = accounts
        .group
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    crate::instructions::group_custody::reconciled(&accounts.group, accounts.vault.amount)?;
    let mut root_states = vec![
        crate::events::MarginAccountSnapshotV2::from(&**accounts.trader),
        crate::events::MarginAccountSnapshotV2::from(&**accounts.first_capital),
    ];
    let mut maker_states = vec![crate::events::MakerRegistrationSnapshotV2::from(
        &**accounts.first_registration,
    )];
    if has_second {
        root_states.push(crate::events::MarginAccountSnapshotV2::from(
            &***accounts.second_capital.as_ref().unwrap(),
        ));
        maker_states.push(crate::events::MakerRegistrationSnapshotV2::from(
            &***accounts.second_registration.as_ref().unwrap(),
        ));
    }
    let emitted = crate::events::GroupRouteExecutedV2 {
        group: accounts.group.key(),
        sequence: accounts.group.sequence,
        slot: clock.slot,
        market: accounts.market.key(),
        market_state: crate::events::GroupMarketSnapshotV2::from(&**accounts.market),
        nonce: intent.nonce,
        side: intent.side,
        lots: intent.lots,
        gross_quote: next.gross,
        fee: next.fee,
        order_id: order.map(|value| value.id).unwrap_or(0),
        order_version: order.map(|value| value.version).unwrap_or(0),
        root_states,
        maker_states,
        total_cash: accounts.group.total_cash,
        fees: accounts.group.fees,
    };
    emit_cpi!(emitted);
    Ok(())
}
