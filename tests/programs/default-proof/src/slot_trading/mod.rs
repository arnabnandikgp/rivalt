//! Local qualification with a single standing trader order and one consenting,
//! funded isolated maker per fill. Routing and production source admission live in clearing.
use super::*;
use crate::slot_custody::{checked, SlotCustody};
use anchor_lang::AccountDeserialize;
use anchor_spl::token::{self, TransferChecked};
use financial_core::{cash_add, cash_sub, fee_increment, fee_lanes, price_policy, SCALE};
use risk_engine::withdrawal::MarketWindow;
mod contexts;
mod state;
pub use contexts::*;
pub use state::*;

pub fn open_root(ctx: &mut Context<OpenTradeRoot>, isolated: u16) -> Result<()> {
    let root = &mut ctx.accounts.margin;
    root.owner = *ctx.accounts.owner.address();
    root.custody = *ctx.accounts.custody.address();
    root.isolated = isolated;
    Ok(())
}

fn deadline() -> Result<u64> {
    Clock::get()?
        .slot
        .checked_add(8192)
        .ok_or_else(|| ProofError::TradeTerms.into())
}

pub fn open_market(ctx: &mut Context<OpenTradeMarket>, id: u16) -> Result<()> {
    require!(id != CROSS, ProofError::TradeTerms);
    let market = &mut ctx.accounts.market;
    market.custody = *ctx.accounts.custody.address();
    market.id = id;
    market.price = 100;
    market.expires = deadline()?;
    market.bump = ctx.bumps.market;
    Ok(())
}

pub fn publish(
    ctx: &mut Context<PublishTradeMarket>,
    revision: u64,
    price: u64,
    funding_atoms: i64,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(revision == market.revision, ProofError::WrongCursor);
    let funding = i128::from(funding_atoms) * SCALE;
    require!(
        price_policy::reference_in_policy(price)
            && (funding - market.funding).unsigned_abs() <= 2 * SCALE as u128
            && funding.unsigned_abs() + 2 * SCALE as u128 <= financial_core::MAX_FUNDING as u128,
        ProofError::TradeTerms
    );
    market.revision = revision.checked_add(1).ok_or(ProofError::WrongCursor)?;
    market.price = price;
    market.funding = funding;
    market.expires = deadline()?;
    Ok(())
}

// The selected fill market also holds its fee buckets and is in the fixed context.
// Authenticate every remaining market exactly once in increasing ID order.
fn load(
    views: &[AccountView],
    custody: &Address,
    roots: &[&TradingMargin],
    touched: Option<u16>,
    selected: Option<&TradingMarket>,
) -> Result<Vec<MarketWindow>> {
    let mut ids: Vec<_> = roots
        .iter()
        .flat_map(|root| root.slots.iter().map(|row| row.market()))
        .collect();
    ids.extend(touched);
    ids.sort_unstable();
    ids.dedup();
    require!(
        views.len() + usize::from(selected.is_some()) == ids.len(),
        ProofError::Incomplete
    );
    let slot = Clock::get()?.slot;
    let mut views = views.iter();
    let mut windows = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(market) = selected.filter(|m| m.id == id) {
            windows.push(market.window(slot)?);
            continue;
        }
        let account = views.next().ok_or(ProofError::Incomplete)?;
        require!(
            account.owner() == &crate::ID && !account.is_writable() && !account.executable(),
            ProofError::CustodyBinding
        );
        let market = TradingMarket::try_deserialize(&mut &account.try_borrow()?[..])?;
        let actual = create_program_address(
            &[
                b"trade-market",
                custody.as_ref(),
                &id.to_le_bytes(),
                &[market.bump],
            ],
            &crate::ID,
        )
        .map_err(|_| ProofError::CustodyBinding)?;
        require!(
            market.id == id && market.custody == *custody && actual == *account.address(),
            ProofError::CustodyBinding
        );
        windows.push(market.window(slot)?);
    }
    Ok(windows)
}

pub fn place(ctx: &mut Context<TraderOrder>, revision: u64, terms: OrderTerms) -> Result<()> {
    let views = ctx.remaining_accounts()?;
    let root = &mut ctx.accounts.margin;
    root.guard(revision)?;
    require!(
        root.order.remaining == 0
            && terms.market != CROSS
            && terms.side <= 1
            && terms.lots > 0
            && terms.lots <= financial_core::MAX_LOTS as u64
            && price_policy::order_in_policy(terms.limit)
            && terms.expires > Clock::get()?.slot
            && terms.fee_budget <= financial_core::MAX_CASH,
        ProofError::TradeTerms
    );
    let windows = load(&views, &root.custody, &[root], Some(terms.market), None)?;
    let position = root.position(terms.market)?;
    let order = RestingOrder {
        remaining: terms.lots,
        gross: 0,
        fee_left: terms.fee_budget,
        generation: position.generation,
        terms,
    };
    order.reduction(position)?;
    let required = root.transition(&windows, order, None)?;
    require!(
        i128::from(root.cash) * SCALE >= required.current_scaled,
        ProofError::TradeHealth
    );
    root.advance()
}

pub fn cancel(ctx: &mut Context<TraderOrder>, revision: u64) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty(), ProofError::Incomplete);
    ctx.accounts.margin.guard(revision)?;
    ctx.accounts.margin.cancel()
}

pub fn execute(
    ctx: &mut Context<MatchTrade>,
    trader_revision: u64,
    maker_revision: u64,
    price_revision: u64,
    lots: u64,
) -> Result<()> {
    let views = ctx.remaining_accounts()?;
    let a = &mut ctx.accounts;
    a.trader.guard(trader_revision)?;
    a.maker.guard(maker_revision)?;
    require!(price_revision == a.market.revision, ProofError::WrongCursor);
    let order = a.trader.order;
    let terms = order.terms;
    let price = a.market.price;
    require!(
        a.market.id == terms.market
            && lots > 0
            && lots <= order.remaining
            && Clock::get()?.slot < terms.expires
            && (if terms.side == 0 {
                price <= terms.limit
            } else {
                price >= terms.limit
            }),
        ProofError::TradeTerms
    );
    order.reduction(a.trader.position(terms.market)?)?;
    let windows = load(
        &views,
        a.custody.address(),
        &[&a.trader, &a.maker],
        Some(terms.market),
        Some(&a.market),
    )?;
    let gross = lots.checked_mul(price).ok_or(ProofError::TradeTerms)?;
    require!(
        terms.reduce_only || gross >= financial_core::MIN_ORDER_ATOMS,
        ProofError::TradeTerms
    );
    let (prefix, fee) = checked(fee_increment(order.gross, gross))?;
    let fee_left = order
        .fee_left
        .checked_sub(fee)
        .ok_or(ProofError::TradeTerms)?;
    let next_order = if lots == order.remaining {
        RestingOrder::default()
    } else {
        RestingOrder {
            remaining: order.remaining - lots,
            gross: prefix,
            fee_left,
            ..order
        }
    };
    a.trader.cash = checked(cash_sub(a.trader.cash, fee))?;
    let trader = a.trader.transition(
        &windows,
        next_order,
        Some(FillLeg {
            market: terms.market,
            side: terms.side,
            lots,
            gross,
        }),
    )?;
    let maker = a.maker.transition(
        &windows,
        RestingOrder::default(),
        Some(FillLeg {
            market: terms.market,
            side: 1 - terms.side,
            lots,
            gross,
        }),
    )?;
    require!(
        i128::from(a.trader.cash) * SCALE >= trader.current_scaled
            && i128::from(a.maker.cash) * SCALE >= maker.current_scaled,
        ProofError::TradeHealth
    );
    // No spending from the fee buckets is exposed on this profile.
    let prior = u128::from(a.market.retained) + u128::from(a.market.insurance);
    let classified = checked(fee_lanes::classify(
        fee_lanes::FeeCheckpoint {
            classified: prior,
            carry: a.market.carry,
        },
        fee_lanes::MarketFunds {
            retained: a.market.retained,
            insurance: a.market.insurance,
        },
        &[checked(
            fee_lanes::FeeLane { collected: prior }.record(fee),
        )?],
    ))?;
    a.market.retained = classified.funds.retained;
    a.market.insurance = classified.funds.insurance;
    a.market.carry = classified.checkpoint.carry;
    a.trader.advance()?;
    a.maker.advance()
}

pub fn wallet(
    ctx: &mut Context<TradeWallet>,
    revision: u64,
    amount: u64,
    withdraw: bool,
) -> Result<()> {
    let views = ctx.remaining_accounts()?;
    let a = &mut ctx.accounts;
    a.margin.guard(revision)?;
    require!(amount > 0, ProofError::TradeTerms);
    if withdraw {
        let windows = load(&views, a.custody.address(), &[&a.margin], None, None)?;
        let order = a.margin.order;
        let required = a.margin.transition(&windows, order, None)?;
        a.margin.cash =
            cash_sub(a.margin.cash, amount).map_err(|_| ProofError::WithdrawalHealth)?;
        let remaining = i128::from(a.margin.cash) * SCALE;
        require!(
            remaining >= required.current_scaled && remaining >= required.held_scaled,
            ProofError::WithdrawalHealth
        );
        let bump = [a.custody.bump];
        let seeds: &[&[u8]] = &[
            b"slot-custody",
            a.custody.owner.as_ref(),
            a.custody.mint.as_ref(),
            &bump,
        ];
        token::transfer_checked(
            CpiContext::new_with_signer(
                a.token_program.address(),
                TransferChecked {
                    from: a.vault.try_to_cpi_handle_mut()?,
                    mint: a.mint.to_cpi_handle(),
                    to: a.wallet.try_to_cpi_handle_mut()?,
                    authority: a.custody.to_cpi_handle(),
                },
                &[seeds],
            ),
            amount,
            6,
        )?;
    } else {
        require!(views.is_empty(), ProofError::Incomplete);
        a.margin.cash = checked(cash_add(a.margin.cash, amount))?;
        token::transfer_checked(
            CpiContext::new(
                a.token_program.address(),
                TransferChecked {
                    from: a.wallet.try_to_cpi_handle_mut()?,
                    mint: a.mint.to_cpi_handle(),
                    to: a.vault.try_to_cpi_handle_mut()?,
                    authority: a.owner.to_cpi_handle(),
                },
            ),
            amount,
            6,
        )?;
    }
    a.margin.advance()
}
