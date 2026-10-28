include!("../../maker-common.rs");
#[cfg(not(feature = "devnet-test-profile"))]
declare_id!("F3ETRB1fPHjJ2KQYuL8SomC1auBpWK5VtVqFwAU7k2Yc");
#[cfg(feature = "devnet-test-profile")]
declare_id!("8gBGZLMdws9ci5ax8ASmK46WPigHguFYvm8azK8q6Ckc");
const MAKER_ID: u8 = 1;
#[program]
pub mod maker_b {
    use super::*;
    pub fn initialize_curve_v4(context: Context<InitializeCurveV4>, shape: ShapeV4, updater: Pubkey, expiry: u64, instance: u8) -> Result<()> {
        initialize_curve(context, shape, updater, expiry, instance)
    }
    pub fn reprice_v4(context: Context<RepriceCurveV4>, expected_control: u64, expected_sequence: u64, anchor: u64) -> Result<()> {
        reprice_curve(context, expected_control, expected_sequence, anchor)
    }
    pub fn control_curve_v4(context: Context<ControlCurveV4>, expected_control: u64, expected_shape: u64, action: CurveControlV4) -> Result<()> {
        control_curve(context, expected_control, expected_shape, action)
    }
    pub fn quote_v4(context: Context<ReadCurveV4>, request: QuoteRequestV4) -> Result<QuoteResponseV4> {
        read_curve(context, request)
    }
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
    pub fn initialize_account_config(
        context: Context<InitializeAccountConfig>,
        duration: u64,
    ) -> Result<()> {
        initialize_account(context, duration)
    }
    pub fn publish_account_epoch(context: Context<PublishAccount>, duration: u64) -> Result<()> {
        publish_account(context, duration)
    }
    pub fn quote_account(
        context: Context<ReadAccountQuote>,
        request: maker_interface::AccountQuoteRequest,
    ) -> Result<QuoteResponse> {
        read_account_quote(context, request)
    }
    pub fn publish_epoch(context: Context<Publish>, duration: u64) -> Result<()> {
        publish(context, duration)
    }
    pub fn quote(context: Context<ReadQuote>, request: QuoteRequest) -> Result<QuoteResponse> {
        read_quote(context, request)
    }
}
