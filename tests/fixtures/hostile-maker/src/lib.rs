//! Adversarial local replacement for maker B, never an additional venue module.
use anchor_lang::prelude::*;
use maker_interface::canonical::{
    self, CurveState, MakerQuoteRequest, MakerQuoteResponse, PriceState,
};
declare_id!("F3ETRB1fPHjJ2KQYuL8SomC1auBpWK5VtVqFwAU7k2Yc");
#[program]
pub mod hostile_maker {
    use super::*;
    pub fn quote_curve(ctx: &mut Context<HostileQuote>, request: MakerQuoteRequest) -> Result<()> {
        require!(
            ctx.remaining_accounts()?.is_empty(),
            HostileError::UnexpectedAuthority
        );
        require!(
            !ctx.accounts.config.is_signer()
                && !ctx.accounts.config.is_writable()
                && !ctx.accounts.price.is_signer()
                && !ctx.accounts.price.is_writable(),
            HostileError::UnexpectedAuthority
        );
        let bytes = ctx.accounts.config.account().try_borrow()?;
        let state = anchor_lang::wincode::config::deserialize::<CurveState, _>(
            &bytes[8..],
            anchor_lang::BORSH_CONFIG,
        )
        .map_err(|_| ProgramError::InvalidAccountData)?;
        drop(bytes);
        let bytes = ctx.accounts.price.account().try_borrow()?;
        let price = anchor_lang::wincode::config::deserialize::<PriceState, _>(
            &bytes[8..],
            anchor_lang::BORSH_CONFIG,
        )
        .map_err(|_| ProgramError::InvalidAccountData)?;
        drop(bytes);
        let clock = Clock::get()?;
        let mut response = canonical::quote(
            ctx.accounts.config.address().to_owned(),
            &state,
            &price,
            &request,
            clock.slot,
            clock.unix_timestamp,
        )
        .map_err(|_| ProgramError::from(HostileError::Rejected))?;
        match request.lots {
            2 => {
                anchor_lang::solana_program::program::set_return_data(
                    &[0; canonical::RESPONSE_BYTES + 1],
                );
            }
            3 => {
                ctx.accounts.config.account().clone().try_borrow_mut()?[8] = 255;
            }
            4 => {
                return Err(ProgramError::from(HostileError::Rejected));
            }
            _ => {
                response.gross += 1;
                let mut data = Vec::new();
                <MakerQuoteResponse as SchemaWrite<anchor_lang::BorshConfig>>::write(
                    &mut data, &response,
                )
                .map_err(|_| ProgramError::InvalidInstructionData)?;
                anchor_lang::solana_program::program::set_return_data(&data);
            }
        }
        Ok(())
    }
}
#[derive(Accounts)]
pub struct HostileQuote {
    /// CHECK: This deliberately hostile fixture attempts a read-only write.
    pub config: UncheckedAccount,
    /// CHECK: This fixture decodes the canonical publication but receives no write authority.
    pub price: UncheckedAccount,
}
#[error_code]
pub enum HostileError {
    Rejected,
    UnexpectedAuthority,
}
