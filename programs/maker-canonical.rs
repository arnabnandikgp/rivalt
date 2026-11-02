// Canonical implementation shared by both maker deployments. Instance != strategy.
use maker_interface::canonical::{
    self, CurveControl, CurveState, LiquidityShape, MakerQuoteRequest, MakerQuoteResponse,
    PriceState,
};

#[account(borsh)]
#[derive(InitSpace, Clone)]
pub struct MakerCurve {
    pub state: CurveState,
}

#[account(borsh)]
#[derive(InitSpace, Clone)]
pub struct MakerPrice {
    pub state: PriceState,
}

#[event]
pub struct MakerPriceUpdated {
    pub config: Address,
    pub control: u64,
    pub sequence: u64,
    pub anchor: u64,
    pub slot: u64,
    pub time: i64,
}

#[event]
pub struct MakerShapeUpdated {
    pub config: Address,
    pub state: CurveState,
    pub action: u8,
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeCurve {
    #[account(mut)]
    pub owner: Signer,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, seeds::program = CLEARING_ID)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"market-v3", venue.address().as_ref(), &[market.index]], bump = market.bump,
        seeds::program = CLEARING_ID, constraint = market.venue == venue.address().to_owned() @ MakerError::Binding)]
    pub market: Box<BorshAccount<Market>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, seeds::program = CLEARING_ID,
        constraint = capital.owner == owner.address().to_owned() @ MakerError::Authority,
        constraint = capital.venue == venue.address().to_owned() @ MakerError::Binding)]
    pub capital: Box<BorshAccount<MarginAccount>>,
    #[account(init, payer = owner, space = 8 + MakerCurve::INIT_SPACE,
        seeds = [b"curve-v4", capital.address().as_ref()], bump)]
    pub config: Box<BorshAccount<MakerCurve>>,
    #[account(init, payer = owner, space = 8 + MakerPrice::INIT_SPACE,
        seeds = [b"price-v4", config.address().as_ref()], bump)]
    pub price: Box<BorshAccount<MakerPrice>>,
    pub system_program: Program<System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RepriceCurve {
    pub actor: Signer,
    #[account(seeds = [b"curve-v4", config.state.capital.as_ref()], bump = config.state.bump)]
    pub config: Box<BorshAccount<MakerCurve>>,
    #[account(mut, seeds = [b"price-v4", config.address().as_ref()], bump = price.state.bump,
        constraint = price.state.config == config.address().to_owned() @ MakerError::Binding)]
    pub price: Box<BorshAccount<MakerPrice>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ControlCurve {
    #[account(address = config.state.controller @ MakerError::Authority)]
    pub controller: Signer,
    #[account(mut, seeds = [b"curve-v4", config.state.capital.as_ref()], bump = config.state.bump)]
    pub config: Box<BorshAccount<MakerCurve>>,
    #[account(seeds = [b"price-v4", config.address().as_ref()], bump = price.state.bump,
        constraint = price.state.config == config.address().to_owned() @ MakerError::Binding)]
    pub price: Box<BorshAccount<MakerPrice>>,
}

#[derive(Accounts)]
pub struct ReadCurve {
    #[account(seeds = [b"curve-v4", config.state.capital.as_ref()], bump = config.state.bump)]
    pub config: Box<BorshAccount<MakerCurve>>,
    #[account(seeds = [b"price-v4", config.address().as_ref()], bump = price.state.bump,
        constraint = price.state.config == config.address().to_owned() @ MakerError::Binding)]
    pub price: Box<BorshAccount<MakerPrice>>,
}

fn canonical_profile() -> Result<()> {
    require!(
        cfg!(feature = "maker-liquidity-qualification"),
        MakerError::Binding
    );
    Ok(())
}

fn initialize_curve(
    ctx: &mut Context<InitializeCurve>,
    shape: LiquidityShape,
    updater: Address,
    expiry: u64,
    instance: u8,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    canonical_profile()?;
    require!(remaining_accounts.is_empty(), MakerError::Binding);
    shape.validate().map_err(|_| ProgramError::from(MakerError::Quote))?;
    let venue = &ctx.accounts.venue;
    let market = &ctx.accounts.market;
    let capital = &ctx.accounts.capital;
    let clock = Clock::get()?;
    require!(
        venue.schema_version == 8
            && venue.profile_version == 4
            && venue.market_count == 2
            && market.schema_version == 8
            && market.index < 2
            && venue.markets[usize::from(market.index)] == market.address().to_owned()
            && capital.schema_version == 8
            && capital.mode == MODE_ISOLATED
            && capital.role == ROLE_MAKER
            && capital.isolated_market_index == market.index
            && instance < 3,
        MakerError::Binding
    );
    require!(
        (updater == Address::default() && expiry == 0)
            || (updater != Address::default() && expiry > clock.slot),
        MakerError::Lifetime
    );
    let controller = find_program_address(
        &[
            b"liquidity-control-v4",
            venue.address().as_ref(),
            capital.address().as_ref(),
        ],
        &CLEARING_ID,
    )
    .0;
    ctx.accounts.config.state = CurveState {
        schema_version: canonical::ACCOUNT_SCHEMA,
        venue: venue.address().to_owned(),
        market: market.address().to_owned(),
        capital: capital.address().to_owned(),
        controller,
        owner: ctx.accounts.owner.address().to_owned(),
        updater,
        updater_expiry_slot: expiry,
        control_epoch: 1,
        shape_epoch: 1,
        domain: venue.domain,
        instance,
        capability: canonical::CAPABILITY,
        shape,
        bump: ctx.bumps.config,
    };
    ctx.accounts.price.state = PriceState {
        schema_version: canonical::ACCOUNT_SCHEMA,
        config: ctx.accounts.config.address().to_owned(),
        control_epoch: 1,
        sequence: 0,
        anchor: 0,
        updated_slot: 0,
        updated_time: 0,
        bump: ctx.bumps.price,
    };
    emit_cpi!(MakerShapeUpdated {
        config: ctx.accounts.config.address().to_owned(),
        state: ctx.accounts.config.state.clone(),
        action: 4
    });
    emit_cpi!(price_event(
        ctx.accounts.config.address().to_owned(),
        &ctx.accounts.price.state
    ));
    Ok(())
}

fn price_event(config: Address, price: &PriceState) -> MakerPriceUpdated {
    MakerPriceUpdated {
        config,
        control: price.control_epoch,
        sequence: price.sequence,
        anchor: price.anchor,
        slot: price.updated_slot,
        time: price.updated_time,
    }
}

fn reprice_curve(
    ctx: &mut Context<RepriceCurve>,
    expected_control: u64,
    expected_sequence: u64,
    anchor: u64,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    canonical_profile()?;
    require!(remaining_accounts.is_empty(), MakerError::Binding);
    let clock = Clock::get()?;
    let next = canonical::reprice(
        ctx.accounts.config.address().to_owned(),
        &ctx.accounts.config.state,
        &ctx.accounts.price.state,
        ctx.accounts.actor.address().to_owned(),
        expected_control,
        expected_sequence,
        anchor,
        clock.slot,
        clock.unix_timestamp,
    )
    .map_err(|_| ProgramError::from(MakerError::Quote))?;
    ctx.accounts.price.state = next;
    emit_cpi!(price_event(
        ctx.accounts.config.address().to_owned(),
        &ctx.accounts.price.state
    ));
    Ok(())
}

fn control_curve(
    ctx: &mut Context<ControlCurve>,
    expected_control: u64,
    expected_shape: u64,
    action: CurveControl,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    canonical_profile()?;
    require!(remaining_accounts.is_empty(), MakerError::Binding);
    let controller = find_program_address(
        &[
            b"liquidity-control-v4",
            ctx.accounts.config.state.venue.as_ref(),
            ctx.accounts.config.state.capital.as_ref(),
        ],
        &CLEARING_ID,
    )
    .0;
    require_keys_eq!(
        controller,
        ctx.accounts.controller.address().to_owned(),
        MakerError::Authority
    );
    let operation = action.operation();
    let next = canonical::control(
        &ctx.accounts.config.state,
        expected_control,
        expected_shape,
        action,
        Clock::get()?.slot,
    )
    .map_err(|_| ProgramError::from(MakerError::Quote))?;
    ctx.accounts.config.state = next;
    emit_cpi!(MakerShapeUpdated {
        config: ctx.accounts.config.address().to_owned(),
        state: ctx.accounts.config.state.clone(),
        action: operation
    });
    Ok(())
}

fn read_curve(ctx: &mut Context<ReadCurve>, request: MakerQuoteRequest) -> Result<MakerQuoteResponse> {
    let mut remaining_accounts = ctx.remaining_accounts()?;
    canonical_profile()?;
    require!(remaining_accounts.is_empty(), MakerError::Binding);
    let clock = Clock::get()?;
    canonical::quote(
        ctx.accounts.config.address().to_owned(),
        &ctx.accounts.config.state,
        &ctx.accounts.price.state,
        &request,
        clock.slot,
        clock.unix_timestamp,
    )
    .map_err(|_| ProgramError::from(MakerError::Quote))
}
