//! Immediate FOK execution under an explicitly synthetic, expiring local observation.
use crate::{
    custody, makers, oracle, ClearingError, MakerRegistration, MarketState, Participant,
    PreviewArgs,
};
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use financial_core as math;

pub const MAX_ROUTE_LOTS: u64 = 4_608;
pub const MAX_INTENT_SLOTS: u64 = 150;

#[account]
#[derive(InitSpace)]
pub struct TestRouteState {
    pub market: Pubkey,
    pub observation_sequence: u64,
    pub reference_price: u64,
    pub lower: u64,
    pub upper: u64,
    pub valid_from: u64,
    pub valid_until: u64,
    pub gross_lots: u64,
    pub bump: u8,
    pub oracle: crate::oracle::OracleState,
}
#[event_cpi]
#[derive(Accounts)]
pub struct InitializeTestRoutes<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=authority)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(init,payer=authority,space=8+TestRouteState::INIT_SPACE,seeds=[b"test-routes",market.key().as_ref()],bump)]
    pub route_state: Account<'info, TestRouteState>,
    pub system_program: Program<'info, System>,
}
#[event_cpi]
#[derive(Accounts)]
pub struct PublishTestRisk<'info> {
    pub authority: Signer<'info>,
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=authority)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Account<'info, TestRouteState>,
}
#[event]
pub struct TestRiskPublished {
    pub version: u16,
    pub terms_epoch: u64,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub sequence: u64,
    pub config_epoch: u64,
    pub observation_sequence: u64,
    pub reference_price: u64,
    pub lower: u64,
    pub upper: u64,
    pub valid_from: u64,
    pub valid_until: u64,
}
fn publish(
    m: &mut Account<MarketState>,
    r: &mut Account<TestRouteState>,
    reference: u64,
    duration: u64,
) -> Result<TestRiskPublished> {
    require!(cfg!(feature = "local-test-profile"), ClearingError::Profile);
    custody::profile(m)?;
    require!(m.mode == 1 && !m.paused, ClearingError::Profile);
    require!(
        (10_000..=100_000).contains(&reference) && (64..=3_600).contains(&duration),
        ClearingError::RiskObservation
    );
    let slot = Clock::get()?.slot;
    r.reference_price = reference;
    r.lower = reference * 99 / 100;
    r.upper = (reference * 101).div_ceil(100);
    r.valid_from = slot;
    r.valid_until = slot
        .checked_add(duration)
        .ok_or(ClearingError::Arithmetic)?;
    r.observation_sequence = r
        .observation_sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    m.sequence = m.sequence.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    Ok(TestRiskPublished {
        version: 1,
        terms_epoch: m.terms_epoch,
        domain: m.domain,
        market: m.key(),
        sequence: m.sequence,
        config_epoch: m.config_epoch,
        observation_sequence: r.observation_sequence,
        reference_price: reference,
        lower: r.lower,
        upper: r.upper,
        valid_from: slot,
        valid_until: r.valid_until,
    })
}
pub fn initialize(ctx: Context<InitializeTestRoutes>, reference: u64, duration: u64) -> Result<()> {
    require!(cfg!(feature = "local-test-profile"), ClearingError::Profile);
    custody::profile(&ctx.accounts.market)?;
    require!(ctx.accounts.market.mode == 0, ClearingError::Profile);
    ctx.accounts.market.mode = 1;
    ctx.accounts.market.config_epoch = ctx
        .accounts
        .market
        .config_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    ctx.accounts.route_state.set_inner(TestRouteState {
        market: ctx.accounts.market.key(),
        observation_sequence: 0,
        reference_price: 0,
        lower: 0,
        upper: 0,
        valid_from: 0,
        valid_until: 0,
        gross_lots: 0,
        bump: ctx.bumps.route_state,
        oracle: crate::oracle::OracleState::default(),
    });
    emit_cpi!(publish(
        &mut ctx.accounts.market,
        &mut ctx.accounts.route_state,
        reference,
        duration
    )?);
    Ok(())
}
pub fn publish_risk(ctx: Context<PublishTestRisk>, reference: u64, duration: u64) -> Result<()> {
    emit_cpi!(publish(
        &mut ctx.accounts.market,
        &mut ctx.accounts.route_state,
        reference,
        duration
    )?);
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteRoute<'info> {
    pub owner: Signer<'info>,
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=vault)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"participant",market.key().as_ref(),owner.key().as_ref()],bump=trader.bump,has_one=owner,has_one=market)]
    pub trader: Box<Account<'info, Participant>>,
    #[account(mut,seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(seeds=[b"vault",market.key().as_ref()],bump=market.vault_bump,
        constraint=vault.mint == market.quote_mint @ ClearingError::Mint,
        constraint=vault.owner == market.key() @ ClearingError::Authority)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub first_capital: Box<Account<'info, Participant>>,
    #[account(mut)]
    pub first_registration: Box<Account<'info, MakerRegistration>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: Validated by bound_quote before CPI.
    pub first_config: UncheckedAccount<'info>,
    #[account(mut)]
    pub second_capital: Option<Box<Account<'info, Participant>>>,
    #[account(mut)]
    pub second_registration: Option<Box<Account<'info, MakerRegistration>>>,
    pub second_program: Option<Program<'info>>,
    pub second_program_data: Option<Box<Account<'info, ProgramData>>>,
    /// CHECK: Validated by bound_quote before CPI.
    pub second_config: Option<UncheckedAccount<'info>>,
}
#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteOrder<'info> {
    pub keeper: Signer<'info>,
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=vault)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"participant",market.key().as_ref(),trader.owner.as_ref()],bump=trader.bump,has_one=market)]
    pub trader: Box<Account<'info, Participant>>,
    #[account(mut,seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(seeds=[b"vault",market.key().as_ref()],bump=market.vault_bump,
        constraint=vault.mint == market.quote_mint @ ClearingError::Mint,
        constraint=vault.owner == market.key() @ ClearingError::Authority)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub first_capital: Box<Account<'info, Participant>>,
    #[account(mut)]
    pub first_registration: Box<Account<'info, MakerRegistration>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: Validated by bound_quote before CPI.
    pub first_config: UncheckedAccount<'info>,
    #[account(mut)]
    pub second_capital: Option<Box<Account<'info, Participant>>>,
    #[account(mut)]
    pub second_registration: Option<Box<Account<'info, MakerRegistration>>>,
    pub second_program: Option<Program<'info>>,
    pub second_program_data: Option<Box<Account<'info, ProgramData>>>,
    /// CHECK: Validated by bound_quote before CPI.
    pub second_config: Option<UncheckedAccount<'info>>,
}
pub struct RouteAccounts<'a, 'info> {
    pub market: &'a mut Account<'info, MarketState>,
    pub trader: &'a mut Account<'info, Participant>,
    pub route_state: &'a mut Account<'info, TestRouteState>,
    pub vault: &'a Account<'info, TokenAccount>,
    pub first_capital: &'a mut Account<'info, Participant>,
    pub first_registration: &'a mut Account<'info, MakerRegistration>,
    pub first_program: &'a Program<'info>,
    pub first_program_data: &'a Account<'info, ProgramData>,
    pub first_config: &'a UncheckedAccount<'info>,
    pub second_capital: &'a mut Option<Box<Account<'info, Participant>>>,
    pub second_registration: &'a mut Option<Box<Account<'info, MakerRegistration>>>,
    pub second_program: &'a Option<Program<'info>>,
    pub second_program_data: &'a Option<Box<Account<'info, ProgramData>>>,
    pub second_config: &'a Option<UncheckedAccount<'info>>,
}
macro_rules! route_accounts {
    ($a:expr) => {
        RouteAccounts {
            market: &mut $a.market,
            trader: &mut $a.trader,
            route_state: &mut $a.route_state,
            vault: &$a.vault,
            first_capital: &mut $a.first_capital,
            first_registration: &mut $a.first_registration,
            first_program: &$a.first_program,
            first_program_data: &$a.first_program_data,
            first_config: &$a.first_config,
            second_capital: &mut $a.second_capital,
            second_registration: &mut $a.second_registration,
            second_program: &$a.second_program,
            second_program_data: &$a.second_program_data,
            second_config: &$a.second_config,
        }
    };
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OrderExecution {
    pub id: u64,
    pub version: u64,
    pub filled: u64,
    pub observation_sequence: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub lots: u64,
    pub legs: Vec<RouteLeg>,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RouteLeg {
    pub lots: u64,
    pub quote_epoch: u64,
    pub authority_epoch: u64,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RouteIntent {
    pub domain: [u8; 32],
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub observation_sequence: u64,
    pub nonce: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub side: u8,
    pub lots: u64,
    /// Buy: maximum gross+fee. Sell: minimum gross-fee.
    pub all_in_limit: u64,
    pub max_fee: u64,
    pub reduce_only: bool,
    pub generation: Option<u64>,
    pub legs: Vec<RouteLeg>,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecutedLeg {
    pub maker_id: u8,
    pub capital: Pubkey,
    pub lots: u64,
    pub gross_quote: u64,
    pub quote_epoch: u64,
    pub authority_epoch: u64,
    pub consumed_after: u64,
    pub position_after: i64,
    pub virtual_after: i128,
    pub generation_after: u64,
    pub reserved_after: u64,
    pub order_ids_after: [u64; 4],
    pub book_after: crate::orders::OrderBook,
}
#[event]
pub struct RouteExecuted {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub sequence: u64,
    pub slot: u64,
    pub observation_sequence: u64,
    pub trader: Pubkey,
    pub nonce: u64,
    pub side: u8,
    pub lots: u64,
    pub gross_quote: u64,
    pub fee: u64,
    pub trader_cash: u64,
    pub trader_lots: i64,
    pub trader_virtual: i128,
    pub trader_generation: u64,
    pub trader_reserved: u64,
    pub trader_order_ids: [u64; 4],
    pub trader_book: crate::orders::OrderBook,
    pub order_id: u64,
    pub order_version: u64,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub total_cash: u64,
    pub total_fees: u64,
    pub gross_lots: u64,
    pub legs: Vec<ExecutedLeg>,
}
pub(crate) fn participant_model(p: &Participant) -> Result<math::Participant> {
    require!(
        p.schema_version == 1 && crate::orders::validate(p).is_ok(),
        ClearingError::Profile
    );
    let model = math::Participant {
        id: p.id,
        cash: p.cash,
        lots: p.lots,
        virtual_scaled: p.virtual_scaled,
        funding_checkpoint: p.funding_checkpoint_scaled,
        generation: p.generation,
        reserved: p.reserved,
    };
    model
        .validate()
        .map_err(|_| error!(ClearingError::Arithmetic))?;
    Ok(model)
}
fn commit(p: &mut Participant, m: math::Participant) {
    p.cash = m.cash;
    p.lots = m.lots;
    p.virtual_scaled = m.virtual_scaled;
    p.funding_checkpoint_scaled = m.funding_checkpoint;
    p.generation = m.generation;
}
fn bound_quote<'info>(
    m: &Account<'info, MarketState>,
    p: &Account<'info, Participant>,
    r: &Account<'info, MakerRegistration>,
    program: &Program<'info>,
    data: &Account<'info, ProgramData>,
    config: &UncheckedAccount<'info>,
    intent: &RouteIntent,
    leg: &RouteLeg,
    reference: u64,
) -> Result<maker_interface::QuoteResponse> {
    require!(
        p.market == m.key()
            && r.market == m.key()
            && r.capital == p.key()
            && r.owner == p.owner
            && r.pricing_program == program.key()
            && r.program_data == data.key()
            && r.config == config.key(),
        ClearingError::MakerBinding
    );
    require_keys_eq!(
        Pubkey::create_program_address(
            &[
                b"participant",
                m.key().as_ref(),
                p.owner.as_ref(),
                &[p.bump]
            ],
            &crate::ID
        )
        .map_err(|_| error!(ClearingError::MakerBinding))?,
        p.key(),
        ClearingError::MakerBinding
    );
    require_keys_eq!(
        Pubkey::create_program_address(
            &[b"maker", m.key().as_ref(), &[r.maker_id], &[r.bump]],
            &crate::ID
        )
        .map_err(|_| error!(ClearingError::MakerBinding))?,
        r.key(),
        ClearingError::MakerBinding
    );
    require!(
        program.programdata_address()? == Some(data.key()),
        ClearingError::MakerBinding
    );
    makers::quote_checked(
        m,
        p,
        r,
        program,
        data,
        config,
        PreviewArgs {
            side: intent.side,
            lots: leg.lots,
            reference_price: reference,
            quote_epoch: leg.quote_epoch,
            authority_epoch: leg.authority_epoch,
            terms_epoch: intent.terms_epoch,
            config_epoch: intent.config_epoch,
        },
    )
}
fn consume(
    r: &mut MakerRegistration,
    quote: &maker_interface::QuoteResponse,
    p: &Participant,
) -> Result<ExecutedLeg> {
    let counter = if quote.side == 0 {
        &mut r.buy_consumed
    } else {
        &mut r.sell_consumed
    };
    *counter =
        maker_interface::consume(*counter, quote).map_err(|_| error!(ClearingError::MakerQuote))?;
    Ok(ExecutedLeg {
        maker_id: r.maker_id,
        capital: r.capital,
        lots: quote.lots,
        gross_quote: quote.gross_quote,
        quote_epoch: r.quote_epoch,
        authority_epoch: r.authority_epoch,
        consumed_after: *counter,
        position_after: p.lots,
        virtual_after: p.virtual_scaled,
        generation_after: p.generation,
        reserved_after: p.reserved,
        order_ids_after: p.order_ids,
        book_after: p.book,
    })
}
pub fn execute(ctx: Context<ExecuteRoute>, intent: RouteIntent) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        ClearingError::RouteIntent
    );
    let event = execute_core(route_accounts!(ctx.accounts), intent, None)?;
    emit_cpi!(event);
    Ok(())
}
pub fn execute_order(ctx: Context<ExecuteOrder>, args: OrderExecution) -> Result<()> {
    require!(
        cfg!(feature = "local-test-profile") && ctx.accounts.market.mode == 2,
        ClearingError::Profile
    );
    require!(
        ctx.remaining_accounts.is_empty(),
        ClearingError::RouteIntent
    );
    let a = &mut *ctx.accounts;
    crate::orders::validate(&a.trader)?;
    let index = crate::orders::find(&a.trader, args.id, args.version)?;
    let o = a.trader.book.orders[index];
    let slot = Clock::get()?.slot;
    require!(
        o.filled == args.filled
            && o.terms_epoch == a.market.terms_epoch
            && slot >= o.start_slot
            && slot < o.expiry_slot
            && args.lots > 0
            && args.lots <= crate::orders::eligible(&a.trader.book, &o, a.trader.lots)?,
        ClearingError::OrderState
    );
    oracle::action(&a.market, &a.route_state, !o.reduce_only)?;
    require!(
        o.trigger == 0
            || (o.trigger == 1 && a.route_state.reference_price >= o.threshold)
            || (o.trigger == 2 && a.route_state.reference_price <= o.threshold),
        ClearingError::OrderTrigger
    );
    let intent = RouteIntent {
        domain: a.market.domain,
        terms_epoch: o.terms_epoch,
        config_epoch: a.market.config_epoch,
        observation_sequence: args.observation_sequence,
        nonce: a.trader.nonce,
        start_slot: args.start_slot,
        expiry_slot: args.expiry_slot,
        side: o.side,
        lots: args.lots,
        all_in_limit: o
            .limit
            .checked_mul(args.lots)
            .ok_or(ClearingError::Arithmetic)?,
        max_fee: o.fee_budget - o.fee_charged,
        reduce_only: o.reduce_only,
        generation: if o.reduce_only {
            Some(o.generation)
        } else {
            None
        },
        legs: args.legs,
    };
    let event = execute_core(route_accounts!(a), intent, Some(index))?;
    emit_cpi!(event);
    Ok(())
}
fn execute_core(
    mut a: RouteAccounts,
    intent: RouteIntent,
    order_index: Option<usize>,
) -> Result<RouteExecuted> {
    require!(cfg!(feature = "local-test-profile"), ClearingError::Profile);
    custody::profile(&a.market)?;
    require!(
        a.market.mode == 1 || a.market.mode == 2,
        ClearingError::Profile
    );
    crate::oracle::action(&a.market, &a.route_state, !intent.reduce_only)?;
    crate::oracle::materialize(&mut a.market, &a.route_state)?;
    require!(!a.market.paused, ClearingError::Paused);
    custody::reconciled(&a.market, a.vault.amount)?;
    let slot = Clock::get()?.slot;
    require!(
        slot >= a.route_state.valid_from
            && slot < a.route_state.valid_until
            && intent.observation_sequence == a.route_state.observation_sequence,
        ClearingError::RiskObservation
    );
    require!(
        intent.domain == a.market.domain
            && intent.terms_epoch == a.market.terms_epoch
            && intent.config_epoch == a.market.config_epoch
            && intent.nonce == a.trader.nonce
            && intent.side <= 1
            && (1..=MAX_ROUTE_LOTS).contains(&intent.lots)
            && slot >= intent.start_slot
            && slot < intent.expiry_slot
            && intent
                .expiry_slot
                .checked_sub(intent.start_slot)
                .is_some_and(|n| n <= MAX_INTENT_SLOTS)
            && (1..=2).contains(&intent.legs.len()),
        ClearingError::RouteIntent
    );
    let count = intent.legs.len();
    require!(
        [
            a.second_capital.is_some(),
            a.second_registration.is_some(),
            a.second_program.is_some(),
            a.second_program_data.is_some(),
            a.second_config.is_some()
        ]
        .iter()
        .all(|v| *v == (count == 2)),
        ClearingError::RouteIntent
    );
    let quantity = intent
        .legs
        .iter()
        .try_fold(0u64, |sum, l| sum.checked_add(l.lots))
        .ok_or(ClearingError::Arithmetic)?;
    require!(
        quantity == intent.lots && intent.legs.iter().all(|l| l.lots > 0),
        ClearingError::RouteIntent
    );
    require_keys_neq!(a.trader.key(), a.first_capital.key(), ClearingError::Alias);
    if let (Some(p), Some(r)) = (&a.second_capital, &a.second_registration) {
        require!(
            p.key() != a.trader.key()
                && p.key() != a.first_capital.key()
                && r.maker_id != a.first_registration.maker_id,
            ClearingError::Alias
        );
    }
    let trader = participant_model(&a.trader)?;
    if let Some(g) = intent.generation {
        require!(g == trader.generation, ClearingError::RouteIntent);
    }
    if intent.reduce_only {
        require!(
            intent.generation == Some(trader.generation)
                && trader.lots != 0
                && intent.lots <= trader.lots.unsigned_abs()
                && ((intent.side == 1 && trader.lots > 0) || (intent.side == 0 && trader.lots < 0)),
            ClearingError::RouteIntent
        );
    }
    let mut makers = vec![participant_model(&a.first_capital)?];
    let mut quotes = vec![bound_quote(
        &a.market,
        &a.first_capital,
        &a.first_registration,
        &a.first_program,
        &a.first_program_data,
        &a.first_config,
        &intent,
        &intent.legs[0],
        a.route_state.reference_price,
    )?];
    if count == 2 {
        makers.push(participant_model(a.second_capital.as_ref().unwrap())?);
        quotes.push(bound_quote(
            &a.market,
            a.second_capital.as_ref().unwrap(),
            a.second_registration.as_ref().unwrap(),
            a.second_program.as_ref().unwrap(),
            a.second_program_data.as_ref().unwrap(),
            a.second_config.as_ref().unwrap(),
            &intent,
            &intent.legs[1],
            a.route_state.reference_price,
        )?);
    }
    let legs: Vec<_> = quotes.iter().map(|q| (q.lots, q.gross_quote)).collect();
    let gross = quotes
        .iter()
        .try_fold(0u64, |sum, q| sum.checked_add(q.gross_quote))
        .ok_or(ClearingError::Arithmetic)?;
    // Each leg VWAP must lie within the synthetic index-derived +/-10% execution band.
    for q in &quotes {
        require!(
            u128::from(q.gross_quote) * 10
                >= u128::from(q.lots) * u128::from(a.route_state.reference_price) * 9
                && u128::from(q.gross_quote) * 10
                    <= u128::from(q.lots) * u128::from(a.route_state.reference_price) * 11,
            ClearingError::RouteLimit
        );
    }
    let prefix = order_index
        .map(|i| a.trader.book.orders[i].notional)
        .unwrap_or(0);
    let (next, maker_next, fee) = math::route::candidate(
        trader,
        &makers,
        &legs,
        intent.side,
        a.market.funding_index_scaled,
        prefix,
    )
    .map_err(|_| error!(ClearingError::RouteHealth))?;
    require!(
        fee <= intent.max_fee
            && if intent.side == 0 {
                gross
                    .checked_add(fee)
                    .is_some_and(|v| v <= intent.all_in_limit)
            } else {
                gross
                    .checked_sub(fee)
                    .is_some_and(|v| v >= intent.all_in_limit)
            },
        ClearingError::RouteLimit
    );
    require!(
        maker_next[0].lots.unsigned_abs() <= a.first_registration.inventory_limit
            && (count == 1
                || maker_next[1].lots.unsigned_abs()
                    <= a.second_registration.as_ref().unwrap().inventory_limit),
        ClearingError::RouteHealth
    );
    let before =
        makers.iter().map(|p| p.lots.unsigned_abs()).sum::<u64>() + trader.lots.unsigned_abs();
    let after = maker_next
        .iter()
        .map(|p| p.lots.unsigned_abs())
        .sum::<u64>()
        + next.lots.unsigned_abs();
    let gross_lots = a
        .route_state
        .gross_lots
        .checked_sub(before)
        .and_then(|v| v.checked_add(after))
        .ok_or(ClearingError::Arithmetic)?;
    require!(
        gross_lots <= math::MAX_GROSS_LOTS,
        ClearingError::RouteHealth
    );
    finish(
        a,
        FillPlan {
            intent,
            order_index,
            quotes,
            next,
            maker_next,
            fee,
            gross,
            gross_lots,
            slot,
        },
    )
}
struct FillPlan {
    intent: RouteIntent,
    order_index: Option<usize>,
    quotes: Vec<maker_interface::QuoteResponse>,
    next: math::Participant,
    maker_next: Vec<math::Participant>,
    fee: u64,
    gross: u64,
    gross_lots: u64,
    slot: u64,
}
#[inline(never)]
fn finish(mut a: RouteAccounts, plan: FillPlan) -> Result<RouteExecuted> {
    let FillPlan {
        intent,
        order_index,
        quotes,
        next,
        maker_next,
        fee,
        gross,
        gross_lots,
        slot,
    } = plan;
    let count = quotes.len();
    let (order_id, order_version) = if let Some(i) = order_index {
        let o = &mut a.trader.book.orders[i];
        o.filled = o
            .filled
            .checked_add(intent.lots)
            .ok_or(ClearingError::Arithmetic)?;
        o.notional = o
            .notional
            .checked_add(gross)
            .ok_or(ClearingError::Arithmetic)?;
        o.fee_charged = o
            .fee_charged
            .checked_add(fee)
            .ok_or(ClearingError::Arithmetic)?;
        require!(
            o.filled <= o.lots && o.fee_charged <= o.fee_budget,
            ClearingError::OrderState
        );
        if o.filled == o.lots {
            o.state = crate::orders::FILLED;
        } else {
            o.state = crate::orders::PARTIAL;
        }
        let (id, version, group) = (o.id, o.version, o.group_id);
        if group > 0 {
            let g = a
                .trader
                .book
                .groups
                .iter_mut()
                .find(|g| g.id == group)
                .ok_or(ClearingError::OrderState)?;
            g.remaining = g
                .remaining
                .checked_sub(intent.lots)
                .ok_or(ClearingError::OrderState)?;
        }
        (id, version)
    } else {
        (0, 0)
    };
    a.trader.nonce = a
        .trader
        .nonce
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    commit(&mut a.trader, next);
    crate::orders::refresh(&mut a.trader, &a.market, &a.route_state)?;
    participant_model(&a.trader)?
        .admissible(
            a.route_state.lower,
            a.route_state.upper,
            a.market.funding_index_scaled,
        )
        .map_err(|_| error!(ClearingError::RouteHealth))?;
    commit(&mut a.first_capital, maker_next[0]);
    crate::orders::refresh(&mut a.first_capital, &a.market, &a.route_state)?;
    participant_model(&a.first_capital)?
        .admissible(
            a.route_state.lower,
            a.route_state.upper,
            a.market.funding_index_scaled,
        )
        .map_err(|_| error!(ClearingError::RouteHealth))?;
    let mut events = vec![consume(
        &mut a.first_registration,
        &quotes[0],
        &a.first_capital,
    )?];
    if count == 2 {
        let p = a.second_capital.as_mut().unwrap();
        commit(p, maker_next[1]);
        crate::orders::refresh(p, &a.market, &a.route_state)?;
        participant_model(p)?
            .admissible(
                a.route_state.lower,
                a.route_state.upper,
                a.market.funding_index_scaled,
            )
            .map_err(|_| error!(ClearingError::RouteHealth))?;
        events.push(consume(
            a.second_registration.as_mut().unwrap(),
            &quotes[1],
            p,
        )?);
    }
    a.route_state.gross_lots = gross_lots;
    a.market.total_cash =
        math::cash_sub(a.market.total_cash, fee).map_err(|_| error!(ClearingError::Arithmetic))?;
    a.market.fees =
        math::cash_add(a.market.fees, fee).map_err(|_| error!(ClearingError::Arithmetic))?;
    a.market.sequence = a
        .market
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    custody::reconciled(&a.market, a.vault.amount)?;
    let event = RouteExecuted {
        version: 1,
        domain: a.market.domain,
        market: a.market.key(),
        terms_epoch: a.market.terms_epoch,
        config_epoch: a.market.config_epoch,
        sequence: a.market.sequence,
        slot,
        observation_sequence: a.route_state.observation_sequence,
        trader: a.trader.key(),
        nonce: intent.nonce,
        side: intent.side,
        lots: intent.lots,
        gross_quote: gross,
        fee,
        trader_cash: next.cash,
        trader_lots: next.lots,
        trader_virtual: next.virtual_scaled,
        trader_generation: next.generation,
        trader_reserved: a.trader.reserved,
        trader_order_ids: a.trader.order_ids,
        trader_book: a.trader.book,
        order_id,
        order_version,
        funding_index_scaled: a.market.funding_index_scaled,
        funding_time: a.market.funding_time,
        total_cash: a.market.total_cash,
        total_fees: a.market.fees,
        gross_lots,
        legs: events,
    };
    Ok(event)
}
