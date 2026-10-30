//! Atomic one/two-maker execution with root/safety authority and current relevant risk.
use super::super::group_trading::routes as candidates;
use super::super::{OrderExecution, RouteIntent, RouteLeg};
use super::authority::AccountGuard;
use super::*;
use anchor_spl::token::TokenAccount;
use maker_interface::QuoteResponse;

#[derive(Accounts)]
pub struct AccountRouteIdentity<'info> {
    pub actor: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = vault)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[other_market.index]], bump = other_market.bump,
        has_one = venue, constraint = other_market.key() != market.key() @ ClearingError::Alias)]
    pub other_market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [b"ledger-v3", market.key().as_ref()], bump = ledger.bump, has_one = venue, has_one = market)]
    pub ledger: Box<Account<'info, MarketLedger>>,
    #[account(seeds = [b"ledger-v3", other_market.key().as_ref()], bump = other_ledger.bump, has_one = venue,
        constraint = other_ledger.market == other_market.key() @ ClearingError::Profile)]
    pub other_ledger: Box<Account<'info, MarketLedger>>,
    #[account(seeds = [b"vault-v3", venue.key().as_ref()], bump = venue.vault_bump,
        constraint = vault.owner == venue.key() && vault.mint == venue.quote_mint @ ClearingError::Reconciliation)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"margin-v3", trader.portfolio.as_ref(), &trader.subaccount_index.to_le_bytes()], bump = trader.bump, has_one = venue)]
    pub trader: Box<Account<'info, MarginAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteAccountRoute<'info> {
    pub identity: AccountRouteIdentity<'info>,
    #[account(mut)]
    pub first_capital: Box<Account<'info, MarginAccount>>,
    #[account(mut)]
    pub first_registration: Box<Account<'info, FixedMakerRegistration>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: authenticated read-only config is the sole maker CPI account.
    pub first_config: UncheckedAccount<'info>,
    #[account(mut)]
    pub second_capital: Option<Box<Account<'info, MarginAccount>>>,
    #[account(mut)]
    pub second_registration: Option<Box<Account<'info, FixedMakerRegistration>>>,
    pub second_program: Option<Program<'info>>,
    pub second_program_data: Option<Box<Account<'info, ProgramData>>>,
    /// CHECK: authenticated read-only config is the sole maker CPI account.
    pub second_config: Option<UncheckedAccount<'info>>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AccountRouteLeg {
    pub lots: u64,
    pub quote_epoch: u64,
    pub authority_epoch: u64,
    pub expected_consumed: u64,
}
fn shared_legs(legs: &[AccountRouteLeg]) -> Vec<RouteLeg> {
    legs.iter()
        .map(|leg| RouteLeg {
            lots: leg.lots,
            quote_epoch: leg.quote_epoch,
            authority_epoch: leg.authority_epoch,
        })
        .collect()
}

/// No historical observation or venue event sequence is signed. Landed relevant
/// sources, account health, maker epochs and every user limit are checked afresh.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AccountRouteIntent {
    pub guard: AccountGuard,
    pub domain: [u8; 32],
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub side: u8,
    pub lots: u64,
    pub all_in_limit: u64,
    pub max_fee: u64,
    pub reduce_only: bool,
    pub generation: Option<u64>,
    pub legs: Vec<AccountRouteLeg>,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AccountOrderExecution {
    pub guard: AccountGuard,
    pub id: u64,
    pub version: u64,
    pub filled: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub lots: u64,
    pub legs: Vec<AccountRouteLeg>,
}

pub fn execute(ctx: Context<ExecuteAccountRoute>, args: AccountRouteIntent) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    args.guard.check(
        &ctx.accounts.identity.venue,
        &ctx.accounts.identity.safety,
        &ctx.accounts.identity.trader,
    )?;
    let clock = Clock::get()?;
    super::super::group_margin::trade_authority(
        &*root_view(&ctx.accounts.identity.trader)?,
        ctx.accounts.identity.actor.key(),
        clock.slot,
    )?;
    let intent = RouteIntent {
        domain: args.domain,
        terms_epoch: args.terms_epoch,
        config_epoch: args.config_epoch,
        observation_sequence: ctx.accounts.identity.market.observation_sequence,
        nonce: args.guard.nonce,
        start_slot: args.start_slot,
        expiry_slot: args.expiry_slot,
        side: args.side,
        lots: args.lots,
        all_in_limit: args.all_in_limit,
        max_fee: args.max_fee,
        reduce_only: args.reduce_only,
        generation: args.generation,
        legs: shared_legs(&args.legs),
    };
    execute_core(ctx.accounts, intent, None, &clock, &args.legs)
}

pub fn execute_order(
    ctx: Context<ExecuteAccountRoute>,
    args: AccountOrderExecution,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    args.guard.check(
        &ctx.accounts.identity.venue,
        &ctx.accounts.identity.safety,
        &ctx.accounts.identity.trader,
    )?;
    let clock = Clock::get()?;
    // The stored order, not this permissionless payer, supplies trade authority.
    let domain = Box::new(v2::ClearingGroupV2 {
        domain: ctx.accounts.identity.venue.domain,
        ..Default::default()
    });
    let request = OrderExecution {
        id: args.id,
        version: args.version,
        filled: args.filled,
        observation_sequence: ctx.accounts.identity.market.observation_sequence,
        start_slot: args.start_slot,
        expiry_slot: args.expiry_slot,
        lots: args.lots,
        legs: shared_legs(&args.legs),
    };
    let (intent, index) = candidates::stored_intent(
        &domain,
        &market_view(&ctx.accounts.identity.market)?,
        &*root_view(&ctx.accounts.identity.trader)?,
        request,
        &clock,
    )?;
    execute_core(ctx.accounts, intent, Some(index), &clock, &args.legs)
}

fn execute_core(
    accounts: &mut ExecuteAccountRoute,
    intent: RouteIntent,
    order_index: Option<usize>,
    clock: &Clock,
    signed_legs: &[AccountRouteLeg],
) -> Result<()> {
    activated(
        &accounts.identity.venue,
        &accounts.identity.custody,
        &accounts.identity.safety,
    )?;
    super::super::account_custody::reconciled(
        &accounts.identity.custody,
        [&accounts.identity.ledger, &accounts.identity.other_ledger],
        accounts.identity.vault.amount,
    )?;
    let selected_index = usize::from(accounts.identity.market.index);
    require!(
        selected_index < 2
            && accounts.identity.venue.markets[selected_index] == accounts.identity.market.key()
            && accounts.identity.venue.markets[1 - selected_index]
                == accounts.identity.other_market.key()
            && accounts.identity.ledger.market_index == accounts.identity.market.index
            && accounts.identity.other_ledger.market_index == accounts.identity.other_market.index,
        ClearingError::Profile
    );
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
    let market_views = if selected_index == 0 {
        [
            market_view(&accounts.identity.market)?,
            market_view(&accounts.identity.other_market)?,
        ]
    } else {
        [
            market_view(&accounts.identity.other_market)?,
            market_view(&accounts.identity.market)?,
        ]
    };
    let environment = environment(&market_views, selected_index, clock)?;
    let trader = root_view(&accounts.identity.trader)?;
    // The shared candidate validates all relevant sources once before admission.
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
    for ((view, leg), signed_leg) in views.iter().zip(&intent.legs).zip(signed_legs) {
        let consumed = if intent.side == 0 {
            view.registration.buy_consumed
        } else {
            view.registration.sell_consumed
        };
        require!(
            signed_leg.expected_consumed == consumed,
            ClearingError::MakerEpoch
        );
        let state = view.authenticate(&accounts.identity.venue, &accounts.identity.market)?;
        let request = view.request(
            &accounts.identity.venue,
            &accounts.identity.market,
            intent.side,
            leg.lots,
            accounts.identity.market.reference_price,
            clock.slot,
        );
        quotes.push(view.quote(&state, &request)?);
        roots.push(*root_view(view.capital)?);
    }
    let domain = Box::new(v2::ClearingGroupV2 {
        domain: accounts.identity.venue.domain,
        ..Default::default()
    });
    let next = candidates::candidate_for_version(
        &domain,
        &trader,
        &roots,
        &quotes,
        &intent,
        order_index,
        &environment,
        clock,
        maker_interface::ACCOUNT_VERSION,
    )?;
    for (view, root) in views.iter().zip(&next.makers) {
        require!(
            root.positions[usize::from(accounts.identity.market.index)]
                .lots
                .unsigned_abs()
                <= view.registration.inventory_limit,
            ClearingError::RouteHealth
        );
    }
    drop(views);
    commit_route(accounts, &intent, order_index, clock, &next, &quotes)
}

#[inline(never)]
fn commit_route(
    accounts: &mut ExecuteAccountRoute,
    intent: &RouteIntent,
    order_index: Option<usize>,
    clock: &Clock,
    next: &candidates::Candidate,
    quotes: &[QuoteResponse],
) -> Result<()> {
    let has_second = quotes.len() == 2;
    let consume = |registration: &mut FixedMakerRegistration, quote: &QuoteResponse| -> Result<()> {
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
    let previous = accounts.first_capital.positions;
    commit_root(&mut accounts.first_capital, &next.makers[0])?;
    invalidate(
        &mut accounts.identity.custody,
        previous,
        accounts.first_capital.positions,
    )?;
    if has_second {
        consume(accounts.second_registration.as_mut().unwrap(), &quotes[1])?;
        let capital = accounts.second_capital.as_deref_mut().unwrap();
        let previous = capital.positions;
        commit_root(capital, &next.makers[1])?;
        invalidate(&mut accounts.identity.custody, previous, capital.positions)?;
    }
    let order = order_index.map(|index| accounts.identity.trader.book.orders[index].order);
    let previous = accounts.identity.trader.positions;
    commit_root(&mut accounts.identity.trader, &next.trader)?;
    invalidate(
        &mut accounts.identity.custody,
        previous,
        accounts.identity.trader.positions,
    )?;
    accounts.identity.market.gross_lots = next.gross_lots;
    materialize(
        [
            &mut accounts.identity.market,
            &mut accounts.identity.other_market,
        ],
        clock,
    )?;
    let (insurance_credit, retained_fee, carry_before) = split_fee(
        &mut accounts.identity.custody,
        &mut accounts.identity.ledger,
        next.fee,
    )?;
    increment(&mut accounts.identity.custody.sequence)?;
    super::super::account_custody::reconciled(
        &accounts.identity.custody,
        [&accounts.identity.ledger, &accounts.identity.other_ledger],
        accounts.identity.vault.amount,
    )?;
    emit_route(
        accounts,
        &intent,
        order,
        next.gross,
        next.fee,
        insurance_credit,
        retained_fee,
        carry_before,
        clock.slot,
    )
}

/// Wire-identical to AccountRouteExecuted; references serialize only the scalar
/// account fields, without account discriminators. Verified by a byte-parity test.
#[derive(AnchorSerialize)]
struct RouteEventView<'a> {
    venue: Pubkey,
    sequence: u64,
    slot: u64,
    market: Pubkey,
    market_state: &'a Market,
    other_market_state: &'a Market,
    nonce: u64,
    side: u8,
    lots: u64,
    gross_quote: u64,
    fee: u64,
    insurance_credit: u64,
    retained_fee: u64,
    carry_before: u8,
    carry_after: u8,
    ledger: crate::events::MarketLedgerSnapshot,
    order_id: u64,
    order_version: u64,
    root_states: Vec<&'a MarginAccount>,
    maker_states: Vec<&'a FixedMakerRegistration>,
    total_cash: u64,
    liability_versions: [u64; 2],
}

#[inline(never)]
fn emit_route(
    accounts: &ExecuteAccountRoute,
    intent: &RouteIntent,
    order: Option<crate::state::OrderRecord>,
    gross: u64,
    fee: u64,
    insurance_credit: u64,
    retained_fee: u64,
    carry_before: u8,
    slot: u64,
) -> Result<()> {
    let has_second = accounts.second_capital.is_some();
    let mut root_states: Vec<&MarginAccount> = Vec::with_capacity(if has_second { 3 } else { 2 });
    root_states.push(&accounts.identity.trader);
    root_states.push(&accounts.first_capital);
    let mut maker_states: Vec<&FixedMakerRegistration> =
        Vec::with_capacity(if has_second { 2 } else { 1 });
    maker_states.push(&accounts.first_registration);
    if has_second {
        root_states.push(accounts.second_capital.as_deref().unwrap());
        maker_states.push(accounts.second_registration.as_deref().unwrap());
    }
    let emitted = RouteEventView {
        venue: accounts.identity.venue.key(),
        sequence: accounts.identity.custody.sequence,
        slot,
        market: accounts.identity.market.key(),
        market_state: &accounts.identity.market,
        other_market_state: &accounts.identity.other_market,
        nonce: intent.nonce,
        side: intent.side,
        lots: intent.lots,
        gross_quote: gross,
        fee,
        insurance_credit,
        retained_fee,
        carry_before,
        carry_after: accounts.identity.ledger.insurance_fee_remainder,
        ledger: crate::events::MarketLedgerSnapshot {
            ledger: accounts.identity.ledger.key(),
            market: accounts.identity.market.key(),
            market_index: accounts.identity.market.index,
            settlement: accounts.identity.ledger.settlement,
            insurance: accounts.identity.ledger.insurance,
            fees: accounts.identity.ledger.fees,
            insurance_fee_remainder: accounts.identity.ledger.insurance_fee_remainder,
            version: accounts.identity.ledger.version,
        },
        order_id: order.map(|value| value.id).unwrap_or(0),
        order_version: order.map(|value| value.version).unwrap_or(0),
        root_states,
        maker_states,
        total_cash: accounts.identity.custody.total_cash,
        liability_versions: accounts.identity.custody.liability_versions,
    };
    crate::event_cpi::emit_borrowed::<crate::events::AccountRouteExecuted, _>(
        &emitted,
        accounts.event_authority.to_account_info(),
    )
}

#[cfg(test)]
mod event_tests {
    use super::*;
    // Wire markers deliberately need not be valid financial state. Every scalar
    // has a nonzero marker, including nested books/oracles, so reordered fields
    // cannot hide behind Default's identical zeros.
    struct Markers(u64);
    impl Markers {
        fn next(&mut self) -> u64 {
            self.0 += 1;
            self.0
        }
        fn byte(&mut self) -> u8 {
            u8::try_from(self.next()).unwrap()
        }
        fn root(&mut self) -> MarginAccount {
            MarginAccount {
                schema_version: self.next() as u16,
                venue: Pubkey::new_unique(),
                portfolio: Pubkey::new_unique(),
                owner: Pubkey::new_unique(),
                subaccount_index: self.next() as u16,
                id: self.next() as u16,
                mode: self.byte(),
                isolated_market_index: self.byte(),
                role: self.byte(),
                cash: self.next(),
                positions: std::array::from_fn(|_| v2::Position {
                    lots: -(self.next() as i64),
                    virtual_scaled: self.next() as i128,
                    funding_checkpoint_scaled: -(self.next() as i128),
                    generation: self.next(),
                }),
                nonce: self.next(),
                state_version: self.next(),
                delegate: Pubkey::new_unique(),
                delegate_expiry_slot: self.next(),
                delegate_epoch: self.next(),
                reserved: self.next(),
                book: v2::OrderBook {
                    last_order_id: self.next(),
                    last_group_id: self.next(),
                    reserve_observations: std::array::from_fn(|_| self.next()),
                    orders: std::array::from_fn(|_| v2::StoredOrder {
                        market_index: self.byte(),
                        delegate_epoch: self.next(),
                        order: crate::state::OrderRecord {
                            id: self.next(),
                            version: self.next(),
                            state: self.byte(),
                            side: self.byte(),
                            original_lots: self.next(),
                            lots: self.next(),
                            filled: self.next(),
                            notional: self.next(),
                            fee_charged: self.next(),
                            fee_budget: self.next(),
                            limit: self.next(),
                            start_slot: self.next(),
                            expiry_slot: self.next(),
                            trigger: self.byte(),
                            threshold: self.next(),
                            reduce_only: true,
                            generation: self.next(),
                            group_id: self.next(),
                            terms_epoch: self.next(),
                            reserve: self.next(),
                        },
                    }),
                    protections: std::array::from_fn(|_| v2::Protection {
                        market_index: self.byte(),
                        protection: crate::state::ProtectiveGroup {
                            id: self.next(),
                            version: self.next(),
                            original: self.next(),
                            remaining: self.next(),
                            generation: self.next(),
                            side: self.byte(),
                        },
                    }),
                },
                bump: self.byte(),
            }
        }
        fn market(&mut self) -> Market {
            Market {
                schema_version: self.next() as u16,
                venue: Pubkey::new_unique(),
                index: self.byte(),
                symbol: std::array::from_fn(|_| self.byte()),
                lots_per_unit: self.next(),
                cross_eligible: true,
                terms_epoch: self.next(),
                config_epoch: self.next(),
                funding_index_scaled: -(self.next() as i128),
                funding_time: self.next() as i64,
                gross_lots: self.next(),
                observation_sequence: self.next(),
                reference_price: self.next(),
                lower: self.next(),
                upper: self.next(),
                valid_from: self.next(),
                valid_until: self.next(),
                oracle: crate::state::OracleState {
                    sources: std::array::from_fn(|_| Pubkey::new_unique()),
                    source_sequences: std::array::from_fn(|_| self.next()),
                    sampled_at: self.next() as i64,
                    source_deadline: self.next() as i64,
                    status: self.byte(),
                    outcome: self.byte(),
                    valid_since: self.next() as i64,
                    last_qualified: self.next() as i64,
                    held_until: self.next() as i64,
                    held_slot: self.next(),
                    held_epoch: self.next(),
                    funding_base: -(self.next() as i128),
                    premium_scaled: self.next() as i128,
                    quantity: self.next(),
                    bid: self.next(),
                    ask: self.next(),
                    covered_seconds: self.next(),
                    skipped_seconds: self.next(),
                },
                bump: self.byte(),
            }
        }
        fn maker(&mut self) -> FixedMakerRegistration {
            FixedMakerRegistration {
                schema_version: self.next() as u16,
                venue: Pubkey::new_unique(),
                market: Pubkey::new_unique(),
                market_index: self.byte(),
                maker_id: self.byte(),
                capital: Pubkey::new_unique(),
                owner: Pubkey::new_unique(),
                pricing_program: Pubkey::new_unique(),
                program_data: Pubkey::new_unique(),
                config: Pubkey::new_unique(),
                approved_hash: [self.byte(); 32],
                authority_epoch: self.next(),
                quote_epoch: self.next(),
                start_slot: self.next(),
                expiry_slot: self.next(),
                inventory_limit: self.next(),
                buy_consumed: self.next(),
                sell_consumed: self.next(),
                quarantined: true,
                bump: self.byte(),
            }
        }
    }
    #[test]
    fn borrowed_route_event_matches_owned_idl_wire_exactly() {
        let mut markers = Markers(0);
        let root = markers.root();
        let market = markers.market();
        let other_market = markers.market();
        let maker = markers.maker();
        let ledger = crate::events::MarketLedgerSnapshot {
            ledger: Pubkey::new_unique(),
            market: Pubkey::new_unique(),
            market_index: 0,
            settlement: 9,
            insurance: 3,
            fees: 10,
            insurance_fee_remainder: 1,
            version: 2,
        };
        let owned = crate::events::AccountRouteExecuted {
            venue: root.venue,
            sequence: 12,
            slot: 56,
            market: ledger.market,
            market_state: crate::events::MarketSnapshot::from(&market),
            other_market_state: crate::events::MarketSnapshot::from(&other_market),
            nonce: 8,
            side: 1,
            lots: 2,
            gross_quote: 120_123,
            fee: 25,
            insurance_credit: 6,
            retained_fee: 19,
            carry_before: 0,
            carry_after: 1,
            ledger: ledger.clone(),
            order_id: 8,
            order_version: 3,
            root_states: vec![crate::events::MarginAccountSnapshot::from(&root); 3],
            maker_states: vec![crate::events::MakerRegistrationSnapshot::from(&maker); 2],
            total_cash: 90,
            liability_versions: [12, 13],
        };
        let view = RouteEventView {
            venue: owned.venue,
            sequence: owned.sequence,
            slot: owned.slot,
            market: owned.market,
            market_state: &market,
            other_market_state: &other_market,
            nonce: owned.nonce,
            side: owned.side,
            lots: owned.lots,
            gross_quote: owned.gross_quote,
            fee: owned.fee,
            insurance_credit: owned.insurance_credit,
            retained_fee: owned.retained_fee,
            carry_before: owned.carry_before,
            carry_after: owned.carry_after,
            ledger,
            order_id: owned.order_id,
            order_version: owned.order_version,
            root_states: vec![&root; 3],
            maker_states: vec![&maker; 2],
            total_cash: owned.total_cash,
            liability_versions: owned.liability_versions,
        };
        let mut expected = Vec::new();
        owned.serialize(&mut expected).unwrap();
        let mut actual = Vec::new();
        view.serialize(&mut actual).unwrap();
        assert_eq!(actual, expected);
        let swapped = RouteEventView {
            market_state: &other_market,
            other_market_state: &market,
            ..view
        };
        let mut wrong_order = Vec::new();
        swapped.serialize(&mut wrong_order).unwrap();
        assert_ne!(wrong_order, expected);
    }
}
