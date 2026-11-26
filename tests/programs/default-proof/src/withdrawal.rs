//! Read-only financial decision on synthetic, immutable account and market PDAs.
use super::*;
use anchor_lang::AccountDeserialize;
use financial_core::{margin::Position, SCALE};
use risk_engine::{
    withdrawal::{cash_required, MarketWindow, OccupiedSlot},
    Risk,
};

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct WidthLeg {
    market: u8,
    lots: i64,
    virtual_atoms: i64,
}

#[account(borsh)]
pub struct WidthBook {
    cash: u64,
    reserved: u64,
    legs: Vec<WidthLeg>,
}

#[account(borsh)]
#[derive(InitSpace)]
pub struct WidthWindow {
    market: u8,
    price: u64,
    funding_low: i128,
    funding_high: i128,
    bump: u8,
}

#[derive(Accounts)]
#[instruction(width: u8)]
pub struct PrepareWidthBook {
    #[account(mut)]
    pub payer: Signer,
    #[account(init, payer=payer, space=8+16+4+usize::from(width)*WidthLeg::INIT_SPACE,
        seeds=[b"width-book".as_ref(), &[width]], bump)]
    pub book: BorshAccount<WidthBook>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
#[instruction(ordinal: u8)]
pub struct PrepareWidthWindow {
    #[account(mut)]
    pub payer: Signer,
    #[account(init, payer=payer, space=8+WidthWindow::INIT_SPACE,
        seeds=[b"width-window".as_ref(), &[ordinal]], bump)]
    pub window: BorshAccount<WidthWindow>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
pub struct CheckWidthExit {
    pub book: BorshAccount<WidthBook>,
}

fn market_id(ordinal: u8) -> u8 {
    3 + 5 * ordinal
}

pub fn prepare_book(ctx: &mut Context<PrepareWidthBook>, width: u8) -> Result<()> {
    require!(matches!(width, 2 | 4 | 8), ProofError::UnsupportedBook);
    let book = &mut ctx.accounts.book;
    book.cash = 10_000;
    book.reserved = 7;
    book.legs = (0..width)
        .map(|ordinal| {
            let size = i64::from(ordinal) + 1;
            let lots = if ordinal % 2 == 0 { size } else { -size };
            WidthLeg {
                market: market_id(ordinal),
                lots,
                virtual_atoms: -100 * lots,
            }
        })
        .collect();
    Ok(())
}

pub fn prepare_window(ctx: &mut Context<PrepareWidthWindow>, ordinal: u8) -> Result<()> {
    require!(ordinal < 8, ProofError::UnsupportedBook);
    let window = &mut ctx.accounts.window;
    window.market = market_id(ordinal);
    window.price = 100;
    window.funding_low = if ordinal % 2 == 0 { 0 } else { -60 * SCALE };
    window.funding_high = if ordinal % 2 == 0 { 60 * SCALE } else { 0 };
    window.bump = ctx.bumps.window;
    Ok(())
}

pub fn assess(ctx: &mut Context<CheckWidthExit>, amount: u64) -> Result<u64> {
    let book = &ctx.accounts.book;
    let cash = book.cash;
    let reserved = book.reserved;
    let slots: Vec<_> = book
        .legs
        .iter()
        .map(|leg| OccupiedSlot {
            market: leg.market.into(),
            position: Position {
                lots: leg.lots,
                virtual_scaled: i128::from(leg.virtual_atoms) * SCALE,
                ..Position::default()
            },
        })
        .collect();
    let accounts = ctx.remaining_accounts()?;
    require!(accounts.len() == slots.len(), ProofError::Incomplete);
    let mut windows = Vec::with_capacity(accounts.len());
    for (ordinal, account) in accounts.iter().enumerate() {
        require!(
            account.owner() == &crate::ID && !account.is_writable() && !account.executable(),
            ProofError::UnsupportedBook
        );
        let window = WidthWindow::try_deserialize(&mut &account.try_borrow()?[..])?;
        let expected = create_program_address(
            &[b"width-window", &[ordinal as u8], &[window.bump]],
            &crate::ID,
        )
        .map_err(|_| ProofError::UnsupportedBook)?;
        require_keys_eq!(expected, *account.address(), ProofError::UnsupportedBook);
        windows.push(MarketWindow {
            market: window.market.into(),
            current: Risk {
                lower: window.price,
                upper: window.price,
                funding: 0,
            },
            funding_low: window.funding_low,
            funding_high: window.funding_high,
        });
    }
    let required =
        cash_required(&slots, &windows, reserved).map_err(|_| ProofError::UnsupportedBook)?;
    let remaining = cash
        .checked_sub(amount)
        .ok_or(ProofError::WithdrawalHealth)?;
    let remaining_scaled = i128::from(remaining) * SCALE;
    require!(
        amount > 0
            && remaining_scaled >= required.current_scaled
            && remaining_scaled >= required.held_scaled,
        ProofError::WithdrawalHealth
    );
    Ok(remaining)
}
