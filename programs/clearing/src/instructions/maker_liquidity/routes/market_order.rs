//! Ordinary trader instructions sign economic limits and structural maker epochs.
//! Price selection and financial admission use the accounts locked at execution.
use super::*;
use crate::engine::{account, book};
use crate::instructions::account_trading::authority::AccountGuard;
use maker_interface::routing::{self, Allocation};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, IdlType)]
pub struct MakerEpochs {
    pub authority: u64,
    pub control: u64,
    pub shape: u64,
    pub depth: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, IdlType)]
pub struct BestRouteIntent {
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
    pub maker_epochs: [MakerEpochs; 3],
}

impl BestRouteIntent {
    fn terms(&self, market: &Market, lots: [u64; 3]) -> RouteIntent {
        let legs = lots
            .into_iter()
            .zip(&self.maker_epochs)
            .filter(|(quantity, _)| *quantity > 0)
            .map(|(lots, epoch)| RouteLeg {
                lots,
                quote_epoch: epoch.control,
                authority_epoch: epoch.authority,
            })
            .collect();
        RouteIntent {
            domain: self.domain,
            terms_epoch: self.terms_epoch,
            config_epoch: self.config_epoch,
            observation_sequence: market.observation_sequence,
            nonce: self.guard.nonce,
            start_slot: self.start_slot,
            expiry_slot: self.expiry_slot,
            side: self.side,
            lots: self.lots,
            all_in_limit: self.all_in_limit,
            max_fee: self.max_fee,
            reduce_only: self.reduce_only,
            generation: self.generation,
            legs,
        }
    }
}

struct Winner {
    allocation: Allocation,
    next: candidates::Candidate,
    quotes: Vec<canonical::MakerQuoteResponse>,
}

pub fn execute_best(ctx: &mut Context<ExecuteBestRoute>, args: BestRouteIntent) -> Result<()> {
    require!(
        cfg!(feature = "execution-router-qualification") && ctx.remaining_accounts()?.is_empty(),
        ClearingError::Profile
    );
    let clock = Clock::get()?;
    let winner = choose(&ctx.accounts, &args, &clock)?;
    let quantities = winner.allocation.lots;
    let intent = args.terms(&ctx.accounts.identity.market, quantities);
    crate::scoped_history::run_selected_route(
        ctx,
        [142, 199, 100, 123, 91, 206, 46, 151],
        quantities,
        |ctx, events| {
            commit::apply(
                &mut ctx.accounts.selected(quantities)?,
                events,
                &intent,
                None,
                &clock,
                &winner.next,
                &winner.quotes,
                RoutePath::Serial,
            )
        },
    )
}

#[inline(never)]
fn choose(accounts: &ExecuteBestRoute, args: &BestRouteIntent, clock: &Clock) -> Result<Winner> {
    let identity = &accounts.identity;
    execution_profile(&identity.venue, &identity.safety, &identity.market)?;
    require!(identity.safety.mode == ACTIVE, ClearingError::Profile);
    args.guard
        .check(&identity.venue, &identity.safety, &identity.trader)?;
    account::trade_authority(&identity.trader, *identity.actor.address(), clock.slot)?;
    let market_index = usize::from(identity.market.index);
    require!(
        market_index < 2
            && identity.venue.markets[market_index] == *identity.market.address()
            && identity.ledger.market_index == identity.market.index
            && identity
                .other_market
                .as_ref()
                .is_none_or(|market| identity.venue.markets[1 - market_index] == *market.address())
            && identity
                .other_ledger
                .as_ref()
                .is_none_or(|ledger| usize::from(ledger.market_index) == 1 - market_index),
        ClearingError::Profile
    );
    let mut markets = [None; 2];
    markets[market_index] = Some(&**identity.market);
    markets[1 - market_index] = identity.other_market.as_deref().map(|market| &**market);
    let environment = optional_environment(markets, market_index, clock)?;
    environment.validate(&identity.trader)?;
    environment.admit_sources(&identity.trader, clock, !args.reduce_only)?;
    let views = [
        accounts.candidate_zero.pricing(),
        accounts.candidate_one.pricing(),
        accounts.candidate_two.pricing(),
    ];
    let mut states = Vec::with_capacity(views.len());
    let mut cache = pricing::CodeApprovalCache::default();
    for (instance, view) in views.iter().enumerate() {
        require!(
            usize::from(view.registration.instance) == instance
                && views[..instance]
                    .iter()
                    .all(|other| other.capital.address() != view.capital.address()
                        && other.capital.id != view.capital.id),
            ClearingError::MakerBinding
        );
        view.bind(&identity.venue, &identity.market, &accounts.registry)?;
        environment.validate(view.capital)?;
        book::validate(view.capital)?;
        account::model(view.capital)?;
        if view.registration.quarantined {
            states.push(None);
            continue;
        }
        let state = match view.authenticate(
            &identity.venue,
            &identity.market,
            &accounts.registry,
            &mut cache,
        ) {
            Ok(state) => state,
            Err(error) if error == ProgramError::from(ClearingError::MakerUpgrade) => {
                states.push(None);
                continue;
            }
            Err(error) => return Err(error),
        };
        let epoch = &args.maker_epochs[instance];
        require!(
            epoch.authority == view.registration.authority_epoch
                && epoch.depth == view.registration.depth_epoch
                && epoch.control == state.config.control_epoch
                && epoch.shape == state.config.shape_epoch,
            ClearingError::MakerEpoch
        );
        if view.capital.owner == identity.trader.owner
            || view.capital.id == identity.trader.id
            || canonical::validate_standing_publication(
                *view.config.address(),
                &state.config,
                &state.price,
                clock.slot,
                clock.unix_timestamp,
            )
            .is_err()
        {
            states.push(None);
        } else {
            states.push(Some(state));
        }
    }
    let mut curves = [None; 3];
    for (instance, state) in states.iter().enumerate() {
        if let Some(state) = state {
            let view = &views[instance];
            let request = view.request(&identity.venue, &identity.market, state, args.side, 1);
            curves[instance] = Some(
                canonical::ExecutionCurve::new(
                    &state.config.shape,
                    state.price.anchor,
                    args.side,
                    request.inventory,
                    request.consumed,
                )
                .map_err(|_| ClearingError::MakerQuote)?,
            );
        }
    }
    let order = routing::Order {
        side: args.side,
        lots: args.lots,
        reference: identity.market.reference_price,
        max_fee: args.max_fee,
        all_in_limit: args.all_in_limit,
    };
    let mut admitted = None;
    let allocation = routing::select(order, curves, |candidate| {
        let next = financial_candidate(
            accounts,
            args,
            &views,
            &states,
            candidate,
            &environment,
            clock,
        );
        match next {
            Ok(next) => {
                admitted = Some(next);
                Ok(true)
            }
            // This is a pure call after the input account validation above.
            // A rejected composition cannot be committed by the ordinary engine.
            Err(_) => Ok(false),
        }
    })
    .map_err(|_: maker_interface::QuoteError| ClearingError::MakerQuote)?
    .ok_or(ClearingError::RouteHealth)?;
    let next = admitted.ok_or(ClearingError::RouteHealth)?;
    require!(
        next.gross == allocation.gross && next.fee == allocation.fee,
        ClearingError::Reconciliation
    );
    let mut quotes = Vec::with_capacity(next.makers.len());
    for (instance, lots) in allocation
        .lots
        .into_iter()
        .enumerate()
        .filter(|(_, lots)| *lots != 0)
    {
        let view = &views[instance];
        let state = states[instance]
            .as_ref()
            .ok_or(ClearingError::MakerBinding)?;
        let mut request = view.request(&identity.venue, &identity.market, state, args.side, lots);
        request.version = canonical::STANDING_TRADE_VERSION;
        let quote = view.quote(state, &request, clock)?;
        require!(
            quote.gross == allocation.amounts[instance],
            ClearingError::MakerResponse
        );
        quotes.push(quote);
    }
    Ok(Winner {
        allocation,
        next,
        quotes,
    })
}

#[inline(never)]
fn financial_candidate(
    accounts: &ExecuteBestRoute,
    args: &BestRouteIntent,
    views: &[pricing::View; 3],
    states: &[Option<pricing::AuthenticatedCurve>],
    allocation: &Allocation,
    environment: &book::Environment,
    clock: &Clock,
) -> Result<candidates::Candidate> {
    let identity = &accounts.identity;
    let intent = args.terms(&identity.market, allocation.lots);
    let mut roots = Vec::with_capacity(intent.legs.len());
    let mut quotes = Vec::with_capacity(intent.legs.len());
    for (instance, lots) in allocation
        .lots
        .into_iter()
        .enumerate()
        .filter(|(_, lots)| *lots != 0)
    {
        let view = &views[instance];
        let state = states[instance]
            .as_ref()
            .ok_or(ClearingError::MakerBinding)?;
        let mut request = view.request(&identity.venue, &identity.market, state, args.side, lots);
        request.version = canonical::STANDING_TRADE_VERSION;
        let quote = canonical::quote(
            *view.config.address(),
            &state.config,
            &state.price,
            &request,
            clock.slot,
            clock.unix_timestamp,
        )
        .map_err(|_| ClearingError::MakerQuote)?;
        require!(
            quote.gross == allocation.amounts[instance],
            ClearingError::MakerResponse
        );
        quotes.push(financial_quote(&quote, &identity.market, clock));
        roots.push(trading::root_view_value(view.capital)?);
    }
    candidates::candidate_for_version(
        &identity.venue,
        &identity.trader,
        &roots,
        &quotes,
        &intent,
        None,
        environment,
        clock,
        canonical::VERSION,
    )
}
