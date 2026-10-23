//! Adversarial local replacement for maker B, never an additional venue module.
use anchor_lang::prelude::*;
use maker_interface::{MakerState, QuoteRequest};
declare_id!("F3ETRB1fPHjJ2KQYuL8SomC1auBpWK5VtVqFwAU7k2Yc");
#[program]
pub mod hostile_maker {
    use super::*;
    pub fn quote(ctx: Context<HostileQuote>, request: QuoteRequest) -> Result<()> {
        require!(
            ctx.remaining_accounts.is_empty(),
            HostileError::UnexpectedAuthority
        );
        require!(
            !ctx.accounts.config.is_signer && !ctx.accounts.config.is_writable,
            HostileError::UnexpectedAuthority
        );
        let bytes = ctx.accounts.config.try_borrow_data()?;
        let state = MakerState::try_from_slice(&bytes[8..])?;
        drop(bytes);
        let mut request = request;
        request.slot = Clock::get()?.slot;
        let mut response =
            maker_interface::quote(&state, &request).map_err(|_| error!(HostileError::Rejected))?;
        match request.lots {
            2 => {
                anchor_lang::solana_program::program::set_return_data(&[0; 93]);
            }
            3 => {
                ctx.accounts.config.try_borrow_mut_data()?[8] = 255;
            }
            4 => {
                return err!(HostileError::Rejected);
            }
            _ => {
                response.gross_quote += 1;
                let mut data = Vec::new();
                response.serialize(&mut data)?;
                anchor_lang::solana_program::program::set_return_data(&data);
            }
        }
        Ok(())
    }
}
#[derive(Accounts)]
pub struct HostileQuote<'info> {
    /// CHECK: This deliberately hostile fixture attempts a read-only write.
    pub config: UncheckedAccount<'info>,
}
#[error_code]
pub enum HostileError {
    Rejected,
    UnexpectedAuthority,
}
