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
        context: Context<Initialize>,
        market: Pubkey,
        domain: [u8; 32],
        duration: u64,
    ) -> Result<()> {
        initialize(context, market, domain, duration)
    }
    pub fn initialize_group_config(
        context: Context<InitializeGroupConfig>,
        duration: u64,
    ) -> Result<()> {
        initialize_group(context, duration)
    }
    pub fn publish_group_epoch(context: Context<PublishGroup>, duration: u64) -> Result<()> {
        publish_group(context, duration)
    }
    pub fn quote_group(
        context: Context<ReadGroupQuote>,
        request: maker_interface::GroupQuoteRequest,
    ) -> Result<QuoteResponse> {
        read_group_quote(context, request)
    }
    pub fn publish_epoch(context: Context<Publish>, duration: u64) -> Result<()> {
        publish(context, duration)
    }
    pub fn quote(context: Context<ReadQuote>, request: QuoteRequest) -> Result<QuoteResponse> {
        read_quote(context, request)
    }
}
