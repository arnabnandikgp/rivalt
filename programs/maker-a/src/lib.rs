include!("../../maker-common.rs");
#[cfg(not(feature = "devnet-test-profile"))]
declare_id!("7Kp4Y5yeBiuS9NYmw67quMLRto5Y9CcUQ29VjLviHggU");
#[cfg(feature = "devnet-test-profile")]
declare_id!("C2dhcKi2FQTsJgHiAYYb8hGeqYWdcUQr9MB4kU6AdLJG");
#[program]
pub mod maker_a {
    use super::*;
    pub fn initialize_curve(
        context: &mut Context<InitializeCurve>,
        shape: LiquidityShape,
        updater: Address,
        expiry: u64,
        instance: u8,
    ) -> Result<()> {
        super::initialize_curve(context, shape, updater, expiry, instance)
    }
    pub fn reprice(
        context: &mut Context<RepriceCurve>,
        expected_control: u64,
        expected_sequence: u64,
        anchor: u64,
    ) -> Result<()> {
        reprice_curve(context, expected_control, expected_sequence, anchor)
    }
    pub fn control_curve(
        context: &mut Context<ControlCurve>,
        expected_control: u64,
        expected_shape: u64,
        action: CurveControl,
    ) -> Result<()> {
        super::control_curve(context, expected_control, expected_shape, action)
    }
    pub fn quote_curve(
        context: &mut Context<ReadCurve>,
        request: MakerQuoteRequest,
    ) -> Result<MakerQuoteResponse> {
        read_curve(context, request)
    }
}
