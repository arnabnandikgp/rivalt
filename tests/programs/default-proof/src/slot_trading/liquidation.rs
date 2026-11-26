//! Permissionless transfer into a consenting trader's funded cross account.
use super::*;
use clearing_accounting::{add, scaled, sub};
use financial_core::liquidation::{receiver_fee, receiver_terms_valid};
use risk_engine::{margin_atoms, MM_BPS};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct TransferOutcome {
    pub deficit_before: i128,
    pub deficit_after: i128,
    pub receiver_fee: u64,
}

fn surviving_order(root: &TradingMargin, slot: u64, liquidated: bool) -> RestingOrder {
    let order = root.order;
    if slot >= order.terms.expires || (liquidated && !order.terms.reduce_only) {
        RestingOrder::default()
    } else {
        order
    }
}

fn dependencies(root: &TradingMargin, order: RestingOrder, ids: &mut Vec<u16>) -> Result<()> {
    for row in &root.slots {
        let (_, image) = row.decode()?;
        if image.position.lots != 0
            || image.position.virtual_scaled != 0
            || (order.remaining > 0 && order.terms.market == image.market)
        {
            ids.push(image.market);
        }
    }
    Ok(())
}

// Each market contributes rounded maintenance and its own negative claim at
// current funding. Positive claims and cancelled reservations cannot cure a deficit.
fn deficit(root: &TradingMargin, windows: &[MarketWindow]) -> Result<i128> {
    let mut balance = checked(scaled(root.cash))?;
    for row in &root.slots {
        let (_, image) = row.decode()?;
        let position = image.position;
        let claim = if position.lots == 0 {
            position.virtual_scaled
        } else {
            let risk = window(windows, image.market)?.current;
            let maintenance = checked(margin_atoms(position.lots, risk.upper, MM_BPS))?;
            balance = checked(sub(balance, checked(scaled(maintenance))?))?;
            let price = checked(risk.adverse_price(position.lots))?;
            checked(position.unpaid(price, risk.funding))?
        };
        balance = checked(add(balance, claim.min(0)))?;
    }
    checked(sub(0, balance.min(0)))
}

pub fn transfer(
    ctx: &mut Context<TransferRisk>,
    target_revision: u64,
    receiver_revision: u64,
    price_revision: u64,
    lots: u64,
    price: u64,
) -> Result<TransferOutcome> {
    let views = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    accounts.target.guard(target_revision)?;
    accounts.receiver.guard(receiver_revision)?;
    require!(
        price_revision == accounts.market.revision,
        ProofError::WrongCursor
    );
    require!(accounts.receiver.cash > 0, ProofError::ReceiverHealth);
    let market = accounts.market.id;
    let held = accounts.target.position(market)?.lots;
    require!(
        receiver_terms_valid(held, lots, price, accounts.market.price),
        ProofError::TradeTerms
    );
    let slot = Clock::get()?.slot;
    let target_order = surviving_order(&accounts.target, slot, true);
    let receiver_order = surviving_order(&accounts.receiver, slot, false);
    let mut ids = Vec::new();
    dependencies(&accounts.target, target_order, &mut ids)?;
    dependencies(&accounts.receiver, receiver_order, &mut ids)?;
    let windows = load(
        &views,
        accounts.custody.address(),
        ids,
        Some(market),
        Some(&accounts.market),
    )?;
    let deficit_before = deficit(&accounts.target, &windows)?;
    require!(deficit_before > 0, ProofError::HealthyTarget);
    let gross = lots.checked_mul(price).ok_or(ProofError::TradeTerms)?;
    let fee = receiver_fee(gross, accounts.target.cash);
    accounts.target.cash = checked(cash_sub(accounts.target.cash, fee))?;
    accounts.receiver.cash = checked(cash_add(accounts.receiver.cash, fee))?;
    let side = u8::from(held > 0);
    accounts.target.transition(
        &windows,
        target_order,
        Some(FillLeg {
            market,
            side,
            lots,
            gross,
        }),
    )?;
    let deficit_after = deficit(&accounts.target, &windows)?;
    require!(
        deficit_after < deficit_before,
        ProofError::NoLiquidationProgress
    );
    let required = accounts.receiver.transition(
        &windows,
        receiver_order,
        Some(FillLeg {
            market,
            side: 1 - side,
            lots,
            gross,
        }),
    )?;
    require!(
        checked(scaled(accounts.receiver.cash))? >= required.current_scaled,
        ProofError::ReceiverHealth
    );
    accounts.target.advance()?;
    accounts.receiver.advance()?;
    Ok(TransferOutcome {
        deficit_before,
        deficit_after,
        receiver_fee: fee,
    })
}
