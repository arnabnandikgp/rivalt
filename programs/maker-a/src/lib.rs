include!("../../maker-common.rs");
#[cfg(not(feature = "devnet-test-profile"))]
declare_id!("7Kp4Y5yeBiuS9NYmw67quMLRto5Y9CcUQ29VjLviHggU");
#[cfg(feature = "devnet-test-profile")]
declare_id!("C2dhcKi2FQTsJgHiAYYb8hGeqYWdcUQr9MB4kU6AdLJG");
const MAKER_ID: u8 = 0;
#[program]
pub mod maker_a {
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
