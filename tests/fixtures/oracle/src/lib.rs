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
}
