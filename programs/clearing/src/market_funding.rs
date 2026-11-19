//! Local candidate. Single-market fills checkpoint the first maker's registration.
//! Other actions and sibling-market materializations use the target market's own
//! canonical checkpoint. The only consumer here is clearing's funding publisher.
pub const EXTRA: usize = if cfg!(feature = "checked-funding-prefix") {
    32
} else {
    0
};

#[cfg(feature = "checked-funding-prefix")]
mod candidate {
    use crate::{
        market_fees::inspect,
        state::{
            accounts::{Market, SCHEMA_VERSION},
            liquidity::MakerRegistration,
        },
        ClearingError,
    };
    use anchor_lang::prelude::*;
    use financial_core::oracle::prefix::{FundingWindow, Materialization};

    fn window(market: &Market) -> Option<FundingWindow> {
        let source = &market.oracle;
        (source.held_epoch == market.config_epoch && source.held_until > source.sampled_at)
            .then_some(FundingWindow {
                market: market.index,
                config: market.config_epoch,
                observation: market.observation_sequence,
                sample_slot: market.valid_from,
                sampled_at: source.sampled_at,
                held_until: source.held_until,
                held_slot: source.held_slot,
                base: source.funding_base,
                premium: source.premium_scaled,
            })
    }
    fn touch(market: &Market, clock: &Clock) -> Result<Option<Materialization>> {
        let Some(source) = window(market) else {
            return Ok(None);
        };
        source
            .observe(clock.slot, clock.unix_timestamp)
            .map_err(|_| ClearingError::OraclePolicy.into())
    }
    fn store(bytes: &mut [u8], stamp: Materialization) {
        bytes[..8].copy_from_slice(&stamp.config.to_le_bytes());
        bytes[8..16].copy_from_slice(&stamp.observation.to_le_bytes());
        bytes[16..24].copy_from_slice(&stamp.slot.to_le_bytes());
        bytes[24..32].copy_from_slice(&stamp.timestamp.to_le_bytes());
    }
    fn load(bytes: &[u8], market: u8) -> Result<Option<Materialization>> {
        let bytes: &[u8; 32] = bytes.try_into().map_err(|_| ClearingError::Profile)?;
        if *bytes == [0; 32] {
            return Ok(None);
        }
        Ok(Some(Materialization {
            market,
            config: u64::from_le_bytes(bytes[..8].try_into().unwrap()),
            observation: u64::from_le_bytes(bytes[8..16].try_into().unwrap()),
            slot: u64::from_le_bytes(bytes[16..24].try_into().unwrap()),
            timestamp: i64::from_le_bytes(bytes[24..].try_into().unwrap()),
        }))
    }
    pub(crate) fn canonical(market: &mut BorshAccount<Market>, clock: &Clock) -> Result<()> {
        if let Some(stamp) = touch(market, clock)? {
            inspect::<_, { crate::market_capacity::MARKET_EXTRA }>(
                market,
                |bytes| {
                    store(&mut bytes[16..], stamp);
                    Ok(())
                },
                true,
            )?;
        }
        Ok(())
    }
    pub(crate) fn selected(
        market: &Market,
        maker: &mut BorshAccount<MakerRegistration>,
        clock: &Clock,
    ) -> Result<()> {
        if let Some(stamp) = touch(market, clock)? {
            inspect::<_, { crate::market_fees::LANE_EXTRA }>(
                maker,
                |bytes| {
                    store(&mut bytes[32..], stamp);
                    Ok(())
                },
                true,
            )?;
        }
        Ok(())
    }
    pub(crate) fn check(
        market: &mut BorshAccount<Market>,
        accounts: &[AccountView],
        clock: &Clock,
        active: bool,
    ) -> Result<()> {
        require!(accounts.len() == 3, ClearingError::Profile);
        let mut lanes = [None; 3];
        for (instance, account) in accounts.iter().enumerate() {
            let data = account.try_borrow()?;
            let prefix = 8 + MakerRegistration::INIT_SPACE;
            require!(
                account.owner() == &crate::ID
                    && !account.executable()
                    && !account.is_signer()
                    && data.len() == prefix + crate::market_fees::LANE_EXTRA
                    && data[..8] == *MakerRegistration::DISCRIMINATOR,
                ClearingError::MakerBinding
            );
            let maker: MakerRegistration = crate::wire::read(&data[8..prefix])?;
            let address = create_program_address(
                &[
                    b"maker-v4",
                    market.address().as_ref(),
                    &[instance as u8],
                    &[maker.bump],
                ],
                &crate::ID,
            )?;
            require!(
                account.address() == &address
                    && maker.instance as usize == instance
                    && maker.market == *market.address()
                    && maker.venue == market.venue
                    && maker.schema_version == SCHEMA_VERSION,
                ClearingError::MakerBinding
            );
            lanes[instance] = load(&data[prefix + 32..], market.index)?;
        }
        let Some(source) = window(market) else {
            return Ok(());
        };
        if !active {
            return Ok(());
        }
        let mut canonical = None;
        inspect::<_, { crate::market_capacity::MARKET_EXTRA }>(
            market,
            |bytes| {
                canonical = load(&bytes[16..], source.market)?;
                Ok(())
            },
            false,
        )?;
        let accrued = source
            .resolve(canonical, lanes, clock.slot)
            .map_err(|_| ClearingError::Reconciliation)?;
        require!(
            market.funding_time == accrued.through && market.funding_index_scaled == accrued.index,
            ClearingError::Reconciliation
        );
        Ok(())
    }
}
#[cfg(feature = "checked-funding-prefix")]
pub(crate) use candidate::*;
