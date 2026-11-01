//! Signed local dependency fixture. This is NOT an upstream price verifier.
use anchor_lang::prelude::*;
#[cfg(not(feature = "devnet-test-profile"))]
declare_id!("A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj");
#[cfg(feature = "devnet-test-profile")]
declare_id!("gUq9vLuLsncqn1JGR753q9XZkypWUoMZ6CKquiCk6EF");
#[program]
pub mod oracle_fixture {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>, feed_id: [u8; 32]) -> Result<()> {
        let f = &mut ctx.accounts.feed;
        f.authority = ctx.accounts.authority.key();
        f.feed_id = feed_id;
        f.bump = ctx.bumps.feed;
        Ok(())
    }
    pub fn publish(ctx: Context<Publish>, value: Value) -> Result<()> {
        let f = &mut ctx.accounts.feed;
        f.sequence = f.sequence.checked_add(1).ok_or(FixtureError::Overflow)?;
        f.value = value;
        Ok(())
    }

    /// Local transport fixture: retain the transaction's real signer privileges
    /// while making one or two clearing calls beneath an external CPI frame.
    /// It supplies no PDA signer and cannot authorize an owner's financial act.
    pub fn forward_clearing(
        ctx: Context<ForwardClearing>,
        instructions: Vec<Vec<u8>>,
    ) -> Result<()> {
        require!(
            !cfg!(feature = "devnet-test-profile")
                && (1..=2).contains(&instructions.len())
                && ctx.remaining_accounts.len() <= 24
                && instructions
                    .iter()
                    .all(|data| (8..=1024).contains(&data.len())),
            FixtureError::ForwardBounds
        );
        let metas: Vec<_> = ctx
            .remaining_accounts
            .iter()
            .map(|account| {
                if account.is_writable {
                    anchor_lang::solana_program::instruction::AccountMeta::new(
                        *account.key,
                        account.is_signer,
                    )
                } else {
                    anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                        *account.key,
                        account.is_signer,
                    )
                }
            })
            .collect();
        for data in instructions {
            anchor_lang::solana_program::program::invoke(
                &anchor_lang::solana_program::instruction::Instruction {
                    program_id: ctx.accounts.clearing.key(),
                    accounts: metas.clone(),
                    data,
                },
                ctx.remaining_accounts,
            )?;
        }
        Ok(())
    }
}
#[derive(Accounts)]
pub struct ForwardClearing<'info> {
    /// CHECK: fixed executable; each nested instruction authenticates its owner.
    #[account(executable, address = pubkey!("Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo"))]
    pub clearing: UncheckedAccount<'info>,
}
#[derive(Accounts)]
#[instruction(feed_id:[u8;32])]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init,payer=authority,space=8+Feed::INIT_SPACE,seeds=[b"feed",authority.key().as_ref(),&feed_id],bump)]
    pub feed: Account<'info, Feed>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Publish<'info> {
    pub authority: Signer<'info>,
    #[account(mut,seeds=[b"feed",authority.key().as_ref(),&feed.feed_id],bump=feed.bump,has_one=authority)]
    pub feed: Account<'info, Feed>,
}
#[account]
#[derive(InitSpace)]
pub struct Feed {
    pub authority: Pubkey,
    pub feed_id: [u8; 32],
    pub sequence: u64,
    pub value: Value,
    pub bump: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Value {
    pub verifier: Pubkey,
    pub level: u8,
    pub price: i64,
    pub confidence: u64,
    pub exponent: i32,
    pub published: i64,
}
#[error_code]
pub enum FixtureError {
    Overflow,
    ForwardBounds,
}
