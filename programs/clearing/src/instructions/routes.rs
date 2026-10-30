//! Immediate FOK execution under an explicitly synthetic, expiring local observation.

use crate::error::ClearingError;
use crate::events::{ExecutedLeg, RouteExecuted, TestRiskPublished};
use crate::instructions::makers::PreviewArgs;
use crate::instructions::{custody, makers, oracle};
use crate::state::{LegacyMakerRegistration, MarketState, Participant, TestRouteState};

pub use crate::constants::routes::*;

use anchor_lang::prelude::*;

use anchor_spl::token::TokenAccount;

use financial_core as math;

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeTestRoutes<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        init,
        payer = authority,
        space = 8 + TestRouteState::INIT_SPACE,
        seeds = [b"test-routes", market.key().as_ref()],
        bump,
    )]
    pub route_state: Account<'info, TestRouteState>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct PublishTestRisk<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"test-routes", market.key().as_ref()],
        bump = route_state.bump,
        has_one = market,
    )]
    pub route_state: Account<'info, TestRouteState>,
}

fn publish(
    market: &mut Account<MarketState>,
    route_state: &mut Account<TestRouteState>,
    reference: u64,
    duration: u64,
) -> Result<TestRiskPublished> {
    require!(cfg!(feature = "local-test-profile"), ClearingError::Profile);
    custody::profile(market)?;
    require!(market.mode == 1 && !market.paused, ClearingError::Profile);
    require!(
        (10_000..=100_000).contains(&reference) && (64..=3_600).contains(&duration),
        ClearingError::RiskObservation
    );
    let slot = Clock::get()?.slot;
    route_state.reference_price = reference;
    route_state.lower = reference * 99 / 100;
    route_state.upper = (reference * 101).div_ceil(100);
    route_state.valid_from = slot;
    route_state.valid_until = slot
        .checked_add(duration)
        .ok_or(ClearingError::Arithmetic)?;
    route_state.observation_sequence = route_state
        .observation_sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    market.sequence = market
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(TestRiskPublished {
        version: 1,
        terms_epoch: market.terms_epoch,
        domain: market.domain,
        market: market.key(),
        sequence: market.sequence,
        config_epoch: market.config_epoch,
        observation_sequence: route_state.observation_sequence,
        reference_price: reference,
        lower: route_state.lower,
        upper: route_state.upper,
        valid_from: slot,
        valid_until: route_state.valid_until,
    })
}

pub fn initialize(ctx: Context<InitializeTestRoutes>, reference: u64, duration: u64) -> Result<()> {
    require!(crate::financial_profile(), ClearingError::Profile);
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
        oracle: crate::state::OracleState::default(),
    });
    #[cfg(not(feature = "devnet-test-profile"))]
    emit_cpi!(publish(
        &mut ctx.accounts.market,
        &mut ctx.accounts.route_state,
        reference,
        duration
    )?);
    #[cfg(feature = "devnet-test-profile")]
    {
        // Allocate coordination state without any ad hoc executable risk price.
        // initialize_oracle must bind real sources before financial execution.
        require!(reference == 0 && duration == 0, ClearingError::Profile);
        let market = &mut ctx.accounts.market;
        market.sequence = market
            .sequence
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?;
        emit_cpi!(TestRiskPublished {
            version: 1,
            terms_epoch: market.terms_epoch,
            domain: market.domain,
            market: market.key(),
            sequence: market.sequence,
            config_epoch: market.config_epoch,
            observation_sequence: 0,
            reference_price: 0,
            lower: 0,
            upper: 0,
            valid_from: 0,
            valid_until: 0,
        });
    }
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
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = vault,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"participant", market.key().as_ref(), owner.key().as_ref()],
        bump = trader.bump,
        has_one = owner,
        has_one = market,
    )]
    pub trader: Box<Account<'info, Participant>>,
    #[account(
        mut,
        seeds = [b"test-routes", market.key().as_ref()],
        bump = route_state.bump,
        has_one = market,
    )]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        constraint = vault.mint == market.quote_mint @ ClearingError::Mint,
        constraint = vault.owner == market.key() @ ClearingError::Authority,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub first_capital: Box<Account<'info, Participant>>,
    #[account(mut)]
    pub first_registration: Box<Account<'info, LegacyMakerRegistration>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: Validated by bound_quote before CPI.
    pub first_config: UncheckedAccount<'info>,
    #[account(mut)]
    pub second_capital: Option<Box<Account<'info, Participant>>>,
    #[account(mut)]
    pub second_registration: Option<Box<Account<'info, LegacyMakerRegistration>>>,
    pub second_program: Option<Program<'info>>,
    pub second_program_data: Option<Box<Account<'info, ProgramData>>>,
    /// CHECK: Validated by bound_quote before CPI.
    pub second_config: Option<UncheckedAccount<'info>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteOrder<'info> {
    pub keeper: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market".as_ref(), b"BTC".as_ref()],
        bump = market.bump,
        has_one = vault,
    )]
    pub market: Box<Account<'info, MarketState>>,
    #[account(
        mut,
        seeds = [b"participant", market.key().as_ref(), trader.owner.as_ref()],
        bump = trader.bump,
        has_one = market,
    )]
    pub trader: Box<Account<'info, Participant>>,
    #[account(
        mut,
        seeds = [b"test-routes", market.key().as_ref()],
        bump = route_state.bump,
        has_one = market,
    )]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        constraint = vault.mint == market.quote_mint @ ClearingError::Mint,
        constraint = vault.owner == market.key() @ ClearingError::Authority,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub first_capital: Box<Account<'info, Participant>>,
    #[account(mut)]
    pub first_registration: Box<Account<'info, LegacyMakerRegistration>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: Validated by bound_quote before CPI.
    pub first_config: UncheckedAccount<'info>,
    #[account(mut)]
    pub second_capital: Option<Box<Account<'info, Participant>>>,
    #[account(mut)]
    pub second_registration: Option<Box<Account<'info, LegacyMakerRegistration>>>,
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
    pub first_registration: &'a mut Account<'info, LegacyMakerRegistration>,
    pub first_program: &'a Program<'info>,
    pub first_program_data: &'a Account<'info, ProgramData>,
    pub first_config: &'a UncheckedAccount<'info>,
    pub second_capital: &'a mut Option<Box<Account<'info, Participant>>>,
    pub second_registration: &'a mut Option<Box<Account<'info, LegacyMakerRegistration>>>,
    pub second_program: &'a Option<Program<'info>>,
    pub second_program_data: &'a Option<Box<Account<'info, ProgramData>>>,
    pub second_config: &'a Option<UncheckedAccount<'info>>,
}

macro_rules! route_accounts {
    ($accounts:expr) => {
        RouteAccounts {
            market: &mut $accounts.market,
            trader: &mut $accounts.trader,
            route_state: &mut $accounts.route_state,
            vault: &$accounts.vault,
            first_capital: &mut $accounts.first_capital,
            first_registration: &mut $accounts.first_registration,
            first_program: &$accounts.first_program,
            first_program_data: &$accounts.first_program_data,
            first_config: &$accounts.first_config,
            second_capital: &mut $accounts.second_capital,
            second_registration: &mut $accounts.second_registration,
            second_program: &$accounts.second_program,
            second_program_data: &$accounts.second_program_data,
            second_config: &$accounts.second_config,
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

pub(crate) fn participant_model(participant: &Participant) -> Result<math::Participant> {
    require!(
        participant.schema_version == 1 && crate::orders::validate(participant).is_ok(),
        ClearingError::Profile
    );
    let model = math::Participant {
        id: participant.id,
        cash: participant.cash,
        lots: participant.lots,
        virtual_scaled: participant.virtual_scaled,
        funding_checkpoint: participant.funding_checkpoint_scaled,
        generation: participant.generation,
        reserved: participant.reserved,
    };
    model
        .validate()
        .map_err(|_| error!(ClearingError::Arithmetic))?;
    Ok(model)
}

pub(crate) fn commit(participant: &mut Participant, model: math::Participant) {
    participant.cash = model.cash;
    participant.lots = model.lots;
    participant.virtual_scaled = model.virtual_scaled;
    participant.funding_checkpoint_scaled = model.funding_checkpoint;
    participant.generation = model.generation;
}

fn bound_quote<'info>(
    market: &Account<'info, MarketState>,
    participant: &Account<'info, Participant>,
    registration: &Account<'info, LegacyMakerRegistration>,
    program: &Program<'info>,
    data: &Account<'info, ProgramData>,
    config: &UncheckedAccount<'info>,
    intent: &RouteIntent,
    leg: &RouteLeg,
    reference: u64,
) -> Result<maker_interface::QuoteResponse> {
    require!(
        participant.market == market.key()
            && registration.market == market.key()
            && registration.capital == participant.key()
            && registration.owner == participant.owner
            && registration.pricing_program == program.key()
            && registration.program_data == data.key()
            && registration.config == config.key(),
        ClearingError::MakerBinding
    );
    require_keys_eq!(
        Pubkey::create_program_address(
            &[
                b"participant",
                market.key().as_ref(),
                participant.owner.as_ref(),
                &[participant.bump]
            ],
            &crate::ID
        )
        .map_err(|_| error!(ClearingError::MakerBinding))?,
        participant.key(),
        ClearingError::MakerBinding
    );
    require_keys_eq!(
        Pubkey::create_program_address(
            &[
                b"maker",
                market.key().as_ref(),
                &[registration.maker_id],
                &[registration.bump]
            ],
            &crate::ID
        )
        .map_err(|_| error!(ClearingError::MakerBinding))?,
        registration.key(),
        ClearingError::MakerBinding
    );
    require!(
        program.programdata_address()? == Some(data.key()),
        ClearingError::MakerBinding
    );
    makers::quote_checked(
        market,
        participant,
        registration,
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
    registration: &mut LegacyMakerRegistration,
    quote: &maker_interface::QuoteResponse,
    participant: &Participant,
) -> Result<ExecutedLeg> {
    let counter = if quote.side == 0 {
        &mut registration.buy_consumed
    } else {
        &mut registration.sell_consumed
    };
    *counter =
        maker_interface::consume(*counter, quote).map_err(|_| error!(ClearingError::MakerQuote))?;
    Ok(ExecutedLeg {
        maker_id: registration.maker_id,
        capital: registration.capital,
        lots: quote.lots,
        gross_quote: quote.gross_quote,
        quote_epoch: registration.quote_epoch,
        authority_epoch: registration.authority_epoch,
        consumed_after: *counter,
        position_after: participant.lots,
        virtual_after: participant.virtual_scaled,
        generation_after: participant.generation,
        reserved_after: participant.reserved,
        order_ids_after: participant.order_ids,
        book_after: participant.book,
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
        crate::financial_profile() && ctx.accounts.market.mode == 2,
        ClearingError::Profile
    );
    require!(
        ctx.remaining_accounts.is_empty(),
        ClearingError::RouteIntent
    );
    let accounts = &mut *ctx.accounts;
    crate::orders::validate(&accounts.trader)?;
    let index = crate::orders::find(&accounts.trader, args.id, args.version)?;
    let order = accounts.trader.book.orders[index];
    let slot = Clock::get()?.slot;
    require!(
        order.filled == args.filled
            && order.terms_epoch == accounts.market.terms_epoch
            && slot >= order.start_slot
            && slot < order.expiry_slot
            && args.lots > 0
            && args.lots
                <= crate::orders::eligible(&accounts.trader.book, &order, accounts.trader.lots)?,
        ClearingError::OrderState
    );
    oracle::action(&accounts.market, &accounts.route_state, !order.reduce_only)?;
    require!(
        order.trigger == 0
            || (order.trigger == 1 && accounts.route_state.reference_price >= order.threshold)
            || (order.trigger == 2 && accounts.route_state.reference_price <= order.threshold),
        ClearingError::OrderTrigger
    );
    let intent = RouteIntent {
        domain: accounts.market.domain,
        terms_epoch: order.terms_epoch,
        config_epoch: accounts.market.config_epoch,
        observation_sequence: args.observation_sequence,
        nonce: accounts.trader.nonce,
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
    };
    let event = execute_core(route_accounts!(accounts), intent, Some(index))?;
    emit_cpi!(event);
    Ok(())
}

fn execute_core(
    mut accounts: RouteAccounts,
    intent: RouteIntent,
    order_index: Option<usize>,
) -> Result<RouteExecuted> {
    require!(crate::financial_profile(), ClearingError::Profile);
    custody::profile(&accounts.market)?;
    require!(
        (accounts.market.mode == 1 && !cfg!(feature = "devnet-test-profile"))
            || accounts.market.mode == 2,
        ClearingError::Profile
    );
    crate::oracle::action(&accounts.market, &accounts.route_state, !intent.reduce_only)?;
    crate::oracle::materialize(&mut accounts.market, &accounts.route_state)?;
    require!(!accounts.market.paused, ClearingError::Paused);
    custody::reconciled(&accounts.market, accounts.vault.amount)?;
    let slot = Clock::get()?.slot;
    require!(
        slot >= accounts.route_state.valid_from
            && slot < accounts.route_state.valid_until
            && intent.observation_sequence == accounts.route_state.observation_sequence,
        ClearingError::RiskObservation
    );
    require!(
        intent.domain == accounts.market.domain
            && intent.terms_epoch == accounts.market.terms_epoch
            && intent.config_epoch == accounts.market.config_epoch
            && intent.nonce == accounts.trader.nonce
            && intent.side <= 1
            && (1..=MAX_ROUTE_LOTS).contains(&intent.lots)
            && slot >= intent.start_slot
            && slot < intent.expiry_slot
            && intent
                .expiry_slot
                .checked_sub(intent.start_slot)
                .is_some_and(|lifetime_slots| lifetime_slots <= MAX_INTENT_SLOTS)
            && (1..=2).contains(&intent.legs.len()),
        ClearingError::RouteIntent
    );
    let count = intent.legs.len();
    require!(
        [
            accounts.second_capital.is_some(),
            accounts.second_registration.is_some(),
            accounts.second_program.is_some(),
            accounts.second_program_data.is_some(),
            accounts.second_config.is_some()
        ]
        .iter()
        .all(|value| *value == (count == 2)),
        ClearingError::RouteIntent
    );
    let quantity = intent
        .legs
        .iter()
        .try_fold(0u64, |sum, leg| sum.checked_add(leg.lots))
        .ok_or(ClearingError::Arithmetic)?;
    require!(
        quantity == intent.lots && intent.legs.iter().all(|leg| leg.lots > 0),
        ClearingError::RouteIntent
    );
    require_keys_neq!(
        accounts.trader.key(),
        accounts.first_capital.key(),
        ClearingError::Alias
    );
    if let (Some(participant), Some(registration)) =
        (&accounts.second_capital, &accounts.second_registration)
    {
        require!(
            participant.key() != accounts.trader.key()
                && participant.key() != accounts.first_capital.key()
                && registration.maker_id != accounts.first_registration.maker_id,
            ClearingError::Alias
        );
    }
    let trader = participant_model(&accounts.trader)?;
    if let Some(generation) = intent.generation {
        require!(generation == trader.generation, ClearingError::RouteIntent);
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
    let mut makers = vec![participant_model(&accounts.first_capital)?];
    let mut quotes = vec![bound_quote(
        &accounts.market,
        &accounts.first_capital,
        &accounts.first_registration,
        &accounts.first_program,
        &accounts.first_program_data,
        &accounts.first_config,
        &intent,
        &intent.legs[0],
        accounts.route_state.reference_price,
    )?];
    if count == 2 {
        makers.push(participant_model(
            accounts.second_capital.as_ref().unwrap(),
        )?);
        quotes.push(bound_quote(
            &accounts.market,
            accounts.second_capital.as_ref().unwrap(),
            accounts.second_registration.as_ref().unwrap(),
            accounts.second_program.as_ref().unwrap(),
            accounts.second_program_data.as_ref().unwrap(),
            accounts.second_config.as_ref().unwrap(),
            &intent,
            &intent.legs[1],
            accounts.route_state.reference_price,
        )?);
    }
    let legs: Vec<_> = quotes
        .iter()
        .map(|quote| (quote.lots, quote.gross_quote))
        .collect();
    let gross = quotes
        .iter()
        .try_fold(0u64, |sum, quote| sum.checked_add(quote.gross_quote))
        .ok_or(ClearingError::Arithmetic)?;
    // Each leg VWAP must lie within the synthetic index-derived +/-10% execution band.
    for quote in &quotes {
        require!(
            u128::from(quote.gross_quote) * 10
                >= u128::from(quote.lots) * u128::from(accounts.route_state.reference_price) * 9
                && u128::from(quote.gross_quote) * 10
                    <= u128::from(quote.lots)
                        * u128::from(accounts.route_state.reference_price)
                        * 11,
            ClearingError::RouteLimit
        );
    }
    let prefix = order_index
        .map(|slot_index| accounts.trader.book.orders[slot_index].notional)
        .unwrap_or(0);
    let (next, maker_next, fee) = math::route::candidate(
        trader,
        &makers,
        &legs,
        intent.side,
        accounts.market.funding_index_scaled,
        prefix,
    )
    .map_err(|_| error!(ClearingError::RouteHealth))?;
    require!(
        fee <= intent.max_fee
            && if intent.side == 0 {
                gross
                    .checked_add(fee)
                    .is_some_and(|value| value <= intent.all_in_limit)
            } else {
                gross
                    .checked_sub(fee)
                    .is_some_and(|value| value >= intent.all_in_limit)
            },
        ClearingError::RouteLimit
    );
    require!(
        maker_next[0].lots.unsigned_abs() <= accounts.first_registration.inventory_limit
            && (count == 1
                || maker_next[1].lots.unsigned_abs()
                    <= accounts
                        .second_registration
                        .as_ref()
                        .unwrap()
                        .inventory_limit),
        ClearingError::RouteHealth
    );
    let before = makers
        .iter()
        .map(|participant| participant.lots.unsigned_abs())
        .sum::<u64>()
        + trader.lots.unsigned_abs();
    let after = maker_next
        .iter()
        .map(|participant| participant.lots.unsigned_abs())
        .sum::<u64>()
        + next.lots.unsigned_abs();
    let gross_lots = accounts
        .route_state
        .gross_lots
        .checked_sub(before)
        .and_then(|value| value.checked_add(after))
        .ok_or(ClearingError::Arithmetic)?;
    require!(
        gross_lots <= math::MAX_GROSS_LOTS,
        ClearingError::RouteHealth
    );
    finish(
        accounts,
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
fn finish(mut accounts: RouteAccounts, plan: FillPlan) -> Result<RouteExecuted> {
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
    let (order_id, order_version) = if let Some(slot_index) = order_index {
        let order = &mut accounts.trader.book.orders[slot_index];
        order.filled = order
            .filled
            .checked_add(intent.lots)
            .ok_or(ClearingError::Arithmetic)?;
        order.notional = order
            .notional
            .checked_add(gross)
            .ok_or(ClearingError::Arithmetic)?;
        order.fee_charged = order
            .fee_charged
            .checked_add(fee)
            .ok_or(ClearingError::Arithmetic)?;
        require!(
            order.filled <= order.lots && order.fee_charged <= order.fee_budget,
            ClearingError::OrderState
        );
        if order.filled == order.lots {
            order.state = crate::orders::FILLED;
        } else {
            order.state = crate::orders::PARTIAL;
        }
        let (id, version, group_id) = (order.id, order.version, order.group_id);
        if group_id > 0 {
            let group = accounts
                .trader
                .book
                .groups
                .iter_mut()
                .find(|group| group.id == group_id)
                .ok_or(ClearingError::OrderState)?;
            group.remaining = group
                .remaining
                .checked_sub(intent.lots)
                .ok_or(ClearingError::OrderState)?;
        }
        (id, version)
    } else {
        (0, 0)
    };
    accounts.trader.nonce = accounts
        .trader
        .nonce
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    commit(&mut accounts.trader, next);
    crate::orders::refresh(
        &mut accounts.trader,
        &accounts.market,
        &accounts.route_state,
    )?;
    participant_model(&accounts.trader)?
        .admissible(
            accounts.route_state.lower,
            accounts.route_state.upper,
            accounts.market.funding_index_scaled,
        )
        .map_err(|_| error!(ClearingError::RouteHealth))?;
    commit(&mut accounts.first_capital, maker_next[0]);
    crate::orders::refresh(
        &mut accounts.first_capital,
        &accounts.market,
        &accounts.route_state,
    )?;
    participant_model(&accounts.first_capital)?
        .admissible(
            accounts.route_state.lower,
            accounts.route_state.upper,
            accounts.market.funding_index_scaled,
        )
        .map_err(|_| error!(ClearingError::RouteHealth))?;
    let mut events = vec![consume(
        &mut accounts.first_registration,
        &quotes[0],
        &accounts.first_capital,
    )?];
    if count == 2 {
        let participant = accounts.second_capital.as_mut().unwrap();
        commit(participant, maker_next[1]);
        crate::orders::refresh(participant, &accounts.market, &accounts.route_state)?;
        participant_model(participant)?
            .admissible(
                accounts.route_state.lower,
                accounts.route_state.upper,
                accounts.market.funding_index_scaled,
            )
            .map_err(|_| error!(ClearingError::RouteHealth))?;
        events.push(consume(
            accounts.second_registration.as_mut().unwrap(),
            &quotes[1],
            participant,
        )?);
    }
    accounts.route_state.gross_lots = gross_lots;
    accounts.market.total_cash = math::cash_sub(accounts.market.total_cash, fee)
        .map_err(|_| error!(ClearingError::Arithmetic))?;
    accounts.market.fees =
        math::cash_add(accounts.market.fees, fee).map_err(|_| error!(ClearingError::Arithmetic))?;
    accounts.market.sequence = accounts
        .market
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    custody::reconciled(&accounts.market, accounts.vault.amount)?;
    let event = RouteExecuted {
        version: 1,
        domain: accounts.market.domain,
        market: accounts.market.key(),
        terms_epoch: accounts.market.terms_epoch,
        config_epoch: accounts.market.config_epoch,
        sequence: accounts.market.sequence,
        slot,
        observation_sequence: accounts.route_state.observation_sequence,
        trader: accounts.trader.key(),
        nonce: intent.nonce,
        side: intent.side,
        lots: intent.lots,
        gross_quote: gross,
        fee,
        trader_cash: next.cash,
        trader_lots: next.lots,
        trader_virtual: next.virtual_scaled,
        trader_generation: next.generation,
        trader_reserved: accounts.trader.reserved,
        trader_order_ids: accounts.trader.order_ids,
        trader_book: accounts.trader.book,
        order_id,
        order_version,
        funding_index_scaled: accounts.market.funding_index_scaled,
        funding_time: accounts.market.funding_time,
        total_cash: accounts.market.total_cash,
        total_fees: accounts.market.fees,
        gross_lots,
        legs: events,
    };
    Ok(event)
}
