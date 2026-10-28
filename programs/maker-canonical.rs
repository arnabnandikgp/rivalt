// Canonical implementation shared by both maker deployments. Instance != strategy.
use maker_interface::canonical::{
    self, CurveControlV4, CurveStateV4, PriceStateV4, QuoteRequestV4, QuoteResponseV4, ShapeV4,
};

#[account]
#[derive(InitSpace)]
pub struct MakerCurveV4 {
    pub state: CurveStateV4,
}

#[account]
#[derive(InitSpace)]
pub struct MakerPriceV4 {
    pub state: PriceStateV4,
}

#[event]
pub struct LiquidityPriceV4 {
    pub config: Pubkey,
    pub control: u64,
    pub sequence: u64,
    pub anchor: u64,
    pub slot: u64,
    pub time: i64,
}

#[event]
pub struct LiquidityShapeV4 {
    pub config: Pubkey,
    pub state: CurveStateV4,
    pub action: u8,
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeCurveV4<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, seeds::program = CLEARING_ID)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump,
        seeds::program = CLEARING_ID, constraint = market.venue == venue.key() @ MakerError::Binding)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, seeds::program = CLEARING_ID,
        constraint = capital.owner == owner.key() @ MakerError::Authority,
        constraint = capital.venue == venue.key() @ MakerError::Binding)]
    pub capital: Box<Account<'info, MarginAccountV3>>,
    #[account(init, payer = owner, space = 8 + MakerCurveV4::INIT_SPACE,
        seeds = [b"curve-v4", capital.key().as_ref()], bump)]
    pub config: Box<Account<'info, MakerCurveV4>>,
    #[account(init, payer = owner, space = 8 + MakerPriceV4::INIT_SPACE,
        seeds = [b"price-v4", config.key().as_ref()], bump)]
    pub price: Box<Account<'info, MakerPriceV4>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RepriceCurveV4<'info> {
    pub actor: Signer<'info>,
    #[account(seeds = [b"curve-v4", config.state.capital.as_ref()], bump = config.state.bump)]
    pub config: Box<Account<'info, MakerCurveV4>>,
    #[account(mut, seeds = [b"price-v4", config.key().as_ref()], bump = price.state.bump,
        constraint = price.state.config == config.key() @ MakerError::Binding)]
    pub price: Box<Account<'info, MakerPriceV4>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ControlCurveV4<'info> {
    #[account(address = config.state.controller @ MakerError::Authority)]
    pub controller: Signer<'info>,
    #[account(mut, seeds = [b"curve-v4", config.state.capital.as_ref()], bump = config.state.bump)]
    pub config: Box<Account<'info, MakerCurveV4>>,
    #[account(seeds = [b"price-v4", config.key().as_ref()], bump = price.state.bump,
        constraint = price.state.config == config.key() @ MakerError::Binding)]
    pub price: Box<Account<'info, MakerPriceV4>>,
}

#[derive(Accounts)]
pub struct ReadCurveV4<'info> {
    #[account(seeds = [b"curve-v4", config.state.capital.as_ref()], bump = config.state.bump)]
    pub config: Box<Account<'info, MakerCurveV4>>,
    #[account(seeds = [b"price-v4", config.key().as_ref()], bump = price.state.bump,
        constraint = price.state.config == config.key() @ MakerError::Binding)]
    pub price: Box<Account<'info, MakerPriceV4>>,
}

fn canonical_profile() -> Result<()> {
    require!(
        cfg!(feature = "maker-liquidity-qualification"),
        MakerError::Binding
    );
    Ok(())
}

fn initialize_curve(
    ctx: Context<InitializeCurveV4>,
    shape: ShapeV4,
    updater: Pubkey,
    expiry: u64,
    instance: u8,
) -> Result<()> {
    canonical_profile()?;
    require!(ctx.remaining_accounts.is_empty(), MakerError::Binding);
    shape.validate().map_err(|_| error!(MakerError::Quote))?;
    let venue = &ctx.accounts.venue;
    let market = &ctx.accounts.market;
    let capital = &ctx.accounts.capital;
    let clock = Clock::get()?;
    require!(
        venue.schema_version == 3
            && venue.profile_version == 4
            && venue.market_count == 2
            && market.schema_version == 3
            && market.index < 2
            && venue.markets[usize::from(market.index)] == market.key()
            && capital.schema_version == 3
            && capital.mode == MODE_ISOLATED
            && capital.role == ROLE_MAKER
            && capital.isolated_market_index == market.index
            && instance < 3,
        MakerError::Binding
    );
    require!(
        (updater == Pubkey::default() && expiry == 0)
            || (updater != Pubkey::default() && expiry > clock.slot),
        MakerError::Lifetime
    );
    let controller = Pubkey::find_program_address(
        &[
            b"liquidity-control-v4",
            venue.key().as_ref(),
            capital.key().as_ref(),
        ],
        &CLEARING_ID,
    )
    .0;
    ctx.accounts.config.state = CurveStateV4 {
        schema_version: canonical::VERSION,
        venue: venue.key(),
        market: market.key(),
        capital: capital.key(),
        controller,
        owner: ctx.accounts.owner.key(),
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
    ctx.accounts.price.state = PriceStateV4 {
        schema_version: canonical::VERSION,
        config: ctx.accounts.config.key(),
        control_epoch: 1,
        sequence: 0,
        anchor: 0,
        updated_slot: 0,
        updated_time: 0,
        bump: ctx.bumps.price,
    };
    emit_cpi!(LiquidityShapeV4 {
        config: ctx.accounts.config.key(),
        state: ctx.accounts.config.state.clone(),
        action: 4
    });
    emit_cpi!(price_event(
        ctx.accounts.config.key(),
        &ctx.accounts.price.state
    ));
    Ok(())
}

fn price_event(config: Pubkey, price: &PriceStateV4) -> LiquidityPriceV4 {
    LiquidityPriceV4 {
        config,
        control: price.control_epoch,
        sequence: price.sequence,
        anchor: price.anchor,
        slot: price.updated_slot,
        time: price.updated_time,
    }
}

fn reprice_curve(
    ctx: Context<RepriceCurveV4>,
    expected_control: u64,
    expected_sequence: u64,
    anchor: u64,
) -> Result<()> {
    canonical_profile()?;
    require!(ctx.remaining_accounts.is_empty(), MakerError::Binding);
    let clock = Clock::get()?;
    let next = canonical::reprice(
        ctx.accounts.config.key(),
        &ctx.accounts.config.state,
        &ctx.accounts.price.state,
        ctx.accounts.actor.key(),
        expected_control,
        expected_sequence,
        anchor,
        clock.slot,
        clock.unix_timestamp,
    )
    .map_err(|_| error!(MakerError::Quote))?;
    ctx.accounts.price.state = next;
    emit_cpi!(price_event(
        ctx.accounts.config.key(),
        &ctx.accounts.price.state
    ));
    Ok(())
}

fn control_curve(
    ctx: Context<ControlCurveV4>,
    expected_control: u64,
    expected_shape: u64,
    action: CurveControlV4,
) -> Result<()> {
    canonical_profile()?;
    require!(ctx.remaining_accounts.is_empty(), MakerError::Binding);
    let controller = Pubkey::find_program_address(
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
        ctx.accounts.controller.key(),
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
    .map_err(|_| error!(MakerError::Quote))?;
    ctx.accounts.config.state = next;
    emit_cpi!(LiquidityShapeV4 {
        config: ctx.accounts.config.key(),
        state: ctx.accounts.config.state.clone(),
        action: operation
    });
    Ok(())
}

fn read_curve(ctx: Context<ReadCurveV4>, request: QuoteRequestV4) -> Result<QuoteResponseV4> {
    canonical_profile()?;
    require!(ctx.remaining_accounts.is_empty(), MakerError::Binding);
    let clock = Clock::get()?;
    canonical::quote(
        ctx.accounts.config.key(),
        &ctx.accounts.config.state,
        &ctx.accounts.price.state,
        &request,
        clock.slot,
        clock.unix_timestamp,
    )
    .map_err(|_| error!(MakerError::Quote))
}
