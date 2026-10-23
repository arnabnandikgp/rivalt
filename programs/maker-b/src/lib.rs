include!("../../maker-common.rs");
#[cfg(not(feature = "devnet-test-profile"))]
declare_id!("F3ETRB1fPHjJ2KQYuL8SomC1auBpWK5VtVqFwAU7k2Yc");
#[cfg(feature = "devnet-test-profile")]
declare_id!("8gBGZLMdws9ci5ax8ASmK46WPigHguFYvm8azK8q6Ckc");
const MAKER_ID: u8 = 1;
#[program]
pub mod maker_b {
    use super::*;
    pub fn initialize_config(
        ctx: Context<Initialize>,
        market: Pubkey,
        domain: [u8; 32],
        duration: u64,
    ) -> Result<()> {
        initialize(ctx, market, domain, duration)
    }
    pub fn publish_epoch(ctx: Context<Publish>, duration: u64) -> Result<()> {
        publish(ctx, duration)
    }
    pub fn quote(ctx: Context<ReadQuote>, request: QuoteRequest) -> Result<QuoteResponse> {
        read_quote(ctx, request)
    }
}
