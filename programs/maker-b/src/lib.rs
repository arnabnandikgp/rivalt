include!("../../maker-common.rs");
#[cfg(not(feature = "devnet-test-profile"))]
declare_id!("F3ETRB1fPHjJ2KQYuL8SomC1auBpWK5VtVqFwAU7k2Yc");
#[cfg(feature = "devnet-test-profile")]
declare_id!("8gBGZLMdws9ci5ax8ASmK46WPigHguFYvm8azK8q6Ckc");
#[program]
pub mod maker_b {
    use super::*;
    #[instruction(discriminator = [2, 112, 249, 167, 34, 145, 140, 171])]
    pub fn initialize_curve(
        context: Context<InitializeCurve>,
        shape: LiquidityShape,
        updater: Pubkey,
        expiry: u64,
        instance: u8,
    ) -> Result<()> {
        super::initialize_curve(context, shape, updater, expiry, instance)
    }
    #[instruction(discriminator = [104, 190, 176, 98, 109, 111, 187, 154])]
    pub fn reprice(
        context: Context<RepriceCurve>,
        expected_control: u64,
        expected_sequence: u64,
        anchor: u64,
    ) -> Result<()> {
        reprice_curve(context, expected_control, expected_sequence, anchor)
    }
    #[instruction(discriminator = [87, 246, 69, 138, 190, 131, 55, 141])]
    pub fn control_curve(
        context: Context<ControlCurve>,
        expected_control: u64,
        expected_shape: u64,
        action: CurveControl,
    ) -> Result<()> {
        super::control_curve(context, expected_control, expected_shape, action)
    }
    #[instruction(discriminator = [186, 69, 30, 223, 191, 154, 12, 19])]
    pub fn quote_curve(
        context: Context<ReadCurve>,
        request: MakerQuoteRequest,
    ) -> Result<MakerQuoteResponse> {
        read_curve(context, request)
    }
}
