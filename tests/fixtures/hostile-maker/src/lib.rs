//! Adversarial local replacement for maker B, never an additional venue module.
use anchor_lang::prelude::*;
use maker_interface::canonical::{self, CurveState, MakerQuoteRequest, PriceState};
declare_id!("F3ETRB1fPHjJ2KQYuL8SomC1auBpWK5VtVqFwAU7k2Yc");
#[program]
pub mod hostile_maker {
    use super::*;
    #[instruction(discriminator = [186, 69, 30, 223, 191, 154, 12, 19])]
    pub fn quote_curve(ctx: Context<HostileQuote>, request: MakerQuoteRequest) -> Result<()> {
        require!(
            ctx.remaining_accounts.is_empty(),
            HostileError::UnexpectedAuthority
        );
        require!(
            !ctx.accounts.config.is_signer
                && !ctx.accounts.config.is_writable
                && !ctx.accounts.price.is_signer
                && !ctx.accounts.price.is_writable,
            HostileError::UnexpectedAuthority
        );
        let bytes = ctx.accounts.config.try_borrow_data()?;
        let state = CurveState::try_from_slice(&bytes[8..])?;
        drop(bytes);
        let bytes = ctx.accounts.price.try_borrow_data()?;
        let price = PriceState::try_from_slice(&bytes[8..])?;
        drop(bytes);
        let clock = Clock::get()?;
        let mut response = canonical::quote(
            ctx.accounts.config.key(),
            &state,
            &price,
            &request,
            clock.slot,
            clock.unix_timestamp,
        )
        .map_err(|_| error!(HostileError::Rejected))?;
        match request.lots {
            2 => {
                anchor_lang::solana_program::program::set_return_data(
                    &[0; canonical::RESPONSE_BYTES + 1],
                );
            }
            3 => {
                ctx.accounts.config.try_borrow_mut_data()?[8] = 255;
            }
            4 => {
                return err!(HostileError::Rejected);
            }
            _ => {
                response.gross += 1;
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
    /// CHECK: This fixture decodes the canonical publication but receives no write authority.
    pub price: UncheckedAccount<'info>,
}
#[error_code]
pub enum HostileError {
    Rejected,
    UnexpectedAuthority,
}
