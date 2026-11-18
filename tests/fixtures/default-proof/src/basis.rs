//! One surviving long, no payments: add a lot at 100 and sell one at 100.
//! An odd initial entry retains the full power-of-two denominator each cycle.
use super::*;
use anchor_lang::pinocchio::{
    sysvars::{rent::Rent, Sysvar},
    Resize,
};

#[account(borsh)]
pub struct Basis {
    pub cycles: u8,
    pub numerator: Vec<u8>,
}

#[derive(Accounts)]
pub struct StartBasis {
    #[account(mut)]
    pub payer: Signer,
    #[account(init,payer=payer,space=8+1+4+8,seeds=[b"basis-probe".as_ref(),payer.address().as_ref()],bump)]
    pub basis: BorshAccount<Basis>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
pub struct UpdateBasis {
    pub trader: Signer,
    #[account(mut,seeds=[b"basis-probe".as_ref(),trader.address().as_ref()],bump)]
    pub basis: BorshAccount<Basis>,
}

pub fn cycle(ctx: &mut Context<UpdateBasis>, expected: u8, count: u8) -> Result<()> {
    let basis = &mut ctx.accounts.basis;
    require!(
        expected == basis.cycles && count > 0 && u16::from(expected) + u16::from(count) <= 120,
        ProofError::WrongCursor
    );
    let mut bytes = [0; 16];
    bytes[..basis.numerator.len()].copy_from_slice(&basis.numerator);
    let mut numerator = u128::from_le_bytes(bytes);
    for power in expected..expected + count {
        numerator += 100u128 << power;
    }
    let width = if numerator <= u128::from(u64::MAX) {
        8
    } else {
        16
    };
    if width > basis.numerator.len() {
        let new_size = 8 + 1 + 4 + width;
        let mut account = basis.account().clone();
        require!(
            account.lamports() >= Rent::get()?.try_minimum_balance(new_size)?,
            ProofError::StorageFunding
        );
        basis.release_borrow()?;
        account.resize(new_size)?;
        basis.reacquire_borrow_mut()?;
    }
    basis.numerator = numerator.to_le_bytes()[..width].to_vec();
    basis.cycles += count;
    Ok(())
}
