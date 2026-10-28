//! Profile-4 source initialization and complete sealed-registry sampling. A
//! missing valid price degrades the observation; substituted identities reject.
use super::*;
use crate::instructions::account_trading::{self, oracle::InitializeAccountOracle};
use crate::state::v4::{SampleInputV4, SampleLegV4};
use financial_core::oracle as policy;

#[event_cpi]
#[derive(Accounts)]
pub struct SampleLiquidityV4<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue,
        constraint = market.index < 2 && venue.markets[usize::from(market.index)] == market.key() @ ClearingError::Profile)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(seeds = [b"liquidity-v4", market.key().as_ref()], bump = registry.bump, has_one = venue, has_one = market)]
    pub registry: Box<Account<'info, LiquidityRegistryV4>>,
    /// CHECK: fixed source identity/owner/schema/sequence checked before policy.
    pub primary_asset: UncheckedAccount<'info>,
    /// CHECK: fixed source identity/owner/schema/sequence checked before policy.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: fixed source identity/owner/schema/sequence checked before policy.
    pub guard_asset: UncheckedAccount<'info>,
    /// CHECK: fixed source identity/owner/schema/sequence checked before policy.
    pub guard_collateral: UncheckedAccount<'info>,
    pub first_capital: Box<Account<'info, MarginAccountV3>>,
    pub first_registration: Box<Account<'info, MakerRegistrationV4>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: canonical read-only maker dependency authenticated before quoting.
    pub first_config: UncheckedAccount<'info>,
    /// CHECK: canonical read-only publication authenticated before quoting.
    pub first_price: UncheckedAccount<'info>,
    pub second_capital: Box<Account<'info, MarginAccountV3>>,
    pub second_registration: Box<Account<'info, MakerRegistrationV4>>,
    pub second_program: Program<'info>,
    pub second_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: canonical read-only maker dependency authenticated before quoting.
    pub second_config: UncheckedAccount<'info>,
    /// CHECK: canonical read-only publication authenticated before quoting.
    pub second_price: UncheckedAccount<'info>,
    pub third_capital: Box<Account<'info, MarginAccountV3>>,
    pub third_registration: Box<Account<'info, MakerRegistrationV4>>,
    pub third_program: Program<'info>,
    pub third_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: canonical read-only maker dependency authenticated before quoting.
    pub third_config: UncheckedAccount<'info>,
    /// CHECK: canonical read-only publication authenticated before quoting.
    pub third_price: UncheckedAccount<'info>,
}

pub fn initialize(
    ctx: Context<InitializeAccountOracle>,
    primary: Pubkey,
    guard: Pubkey,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    execution_profile(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
        &ctx.accounts.market,
    )?;
    account_trading::oracle::initialize_accounts(ctx, primary, guard)
}

pub fn sample(ctx: Context<SampleLiquidityV4>) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    execution_profile(
        &accounts.venue,
        &accounts.custody,
        &accounts.safety,
        &accounts.market,
    )?;
    let clock = Clock::get()?;
    let old = accounts.market.oracle;
    let views = [
        pricing::View {
            capital: &accounts.first_capital,
            registration: &accounts.first_registration,
            program: &accounts.first_program,
            data: &accounts.first_program_data,
            config: &accounts.first_config,
            price: &accounts.first_price,
        },
        pricing::View {
            capital: &accounts.second_capital,
            registration: &accounts.second_registration,
            program: &accounts.second_program,
            data: &accounts.second_program_data,
            config: &accounts.second_config,
            price: &accounts.second_price,
        },
        pricing::View {
            capital: &accounts.third_capital,
            registration: &accounts.third_registration,
            program: &accounts.third_program,
            data: &accounts.third_program_data,
            config: &accounts.third_config,
            price: &accounts.third_price,
        },
    ];
    let mut inputs = [SampleInputV4::default(); 3];
    for (instance, view) in views.iter().enumerate() {
        view.bind(&accounts.venue, &accounts.market, &accounts.registry)?;
        require!(
            view.registration.instance as usize == instance
                && views[..instance]
                    .iter()
                    .all(|previous| previous.capital.key() != view.capital.key()
                        && previous.capital.id != view.capital.id),
            ClearingError::MakerBinding
        );
        inputs[instance].registration = view.registration.key();
        inputs[instance].capital = view.capital.key();
    }
    let sources = [
        &accounts.primary_asset,
        &accounts.primary_collateral,
        &accounts.guard_asset,
        &accounts.guard_collateral,
    ];
    let mut values = [None; 4];
    let mut sequences = old.source_sequences;
    for (position, feed) in account_trading::oracle::feed_indexes(accounts.market.index)?
        .into_iter()
        .enumerate()
    {
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
    let prices = bounds.filter(|bounds| bounds.normal).and_then(|bounds| {
        impact::sample(
            &accounts.venue,
            &accounts.market,
            &accounts.registry,
            &views,
            bounds,
            &clock,
            &mut inputs,
        )
        .ok()
    });
    let next = funding::sample_candidate(
        accounts.safety.mode,
        &accounts.market,
        &clock,
        bounds,
        sequences,
        prices.as_ref(),
    )?;
    accounts.market.set_inner(next);
    increment(&mut accounts.custody.sequence)?;
    increment(&mut accounts.market.observation_sequence)?;
    let (bid_legs, ask_legs): (Vec<SampleLegV4>, Vec<SampleLegV4>) = prices
        .map(|prices| (prices.bid_legs, prices.ask_legs))
        .unwrap_or_default();
    let event = LiquidityOracleChangedV4 {
        venue: accounts.venue.key(),
        sequence: accounts.custody.sequence,
        slot: clock.slot,
        market: accounts.market.key(),
        state: MarketSnapshotV3::from(&**accounts.market),
        inputs,
        bid_legs,
        ask_legs,
    };
    crate::event_cpi::emit(&event, accounts.event_authority.to_account_info())
}
