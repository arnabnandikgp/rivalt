//! Fresh local capacity accounts. The market prefix still materializes the
//! legacy total as a comparison and fallback. The public view uses only checked
//! capacity ownership. A new generation invalidates all preceding lane values.
use crate::{
    state::{
        accounts::{Market, Venue},
        liquidity::MakerRegistration,
    },
    ClearingError,
};
use anchor_lang::prelude::*;

pub const MARKET_EXTRA: usize = if cfg!(feature = "bounded-market-read") {
    16 + crate::market_funding::EXTRA
} else {
    0
};
pub const LANE_EXTRA: usize = if cfg!(feature = "bounded-market-read") {
    16
} else {
    0
};

#[derive(Accounts)]
pub struct ReadMarketGross {
    #[account(seeds=[b"venue-v3",&venue.domain], bump=venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(has_one=venue, constraint=market.index<2 && venue.markets[market.index as usize]==market.address().to_owned() @ ClearingError::Profile)]
    pub market: Box<BorshAccount<Market>>,
    #[account(seeds=[b"maker-v4",market.address().as_ref(),&[0]],bump=first.bump)]
    pub first: Box<BorshAccount<MakerRegistration>>,
    #[account(seeds=[b"maker-v4",market.address().as_ref(),&[1]],bump=second.bump)]
    pub second: Box<BorshAccount<MakerRegistration>>,
    #[account(seeds=[b"maker-v4",market.address().as_ref(),&[2]],bump=third.bump)]
    pub third: Box<BorshAccount<MakerRegistration>>,
}

pub fn read_gross(ctx: &mut Context<ReadMarketGross>) -> Result<u64> {
    #[cfg(not(feature = "bounded-market-read"))]
    {
        let _ = ctx;
        Err(ClearingError::Profile.into())
    }
    #[cfg(feature = "bounded-market-read")]
    {
        require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Profile);
        let accounts = &ctx.accounts;
        candidate::total(
            &accounts.market,
            [&accounts.first, &accounts.second, &accounts.third],
        )
    }
}

#[cfg(feature = "bounded-market-read")]
mod candidate {
    use super::*;
    use crate::market_fees::inspect;
    use financial_core::MAX_GROSS_LOTS;

    #[derive(Clone, Copy)]
    struct Anchor {
        generation: u64,
        gross: u64,
    }

    fn word(bytes: &[u8]) -> Result<u64> {
        Ok(u64::from_le_bytes(
            bytes
                .try_into()
                .map_err(|_| ClearingError::Reconciliation)?,
        ))
    }
    fn anchor(market: &BorshAccount<Market>) -> Result<Anchor> {
        let bytes = market.account().try_borrow()?;
        let start = 8 + Market::INIT_SPACE;
        require!(bytes.len() == start + MARKET_EXTRA, ClearingError::Profile);
        let generation = word(&bytes[start..start + 8])?;
        let gross = word(&bytes[start + 8..start + 16])?;
        require!(
            gross <= MAX_GROSS_LOTS && (generation != 0 || gross == 0),
            ClearingError::Reconciliation
        );
        Ok(Anchor { generation, gross })
    }

    fn available(tail: &[u8], instance: u8, anchor: Anchor) -> Result<u64> {
        require!(
            tail.len() == LANE_EXTRA && instance < 3,
            ClearingError::Profile
        );
        let generation = word(&tail[..8])?;
        let stored = word(&tail[8..])?;
        require!(
            generation <= anchor.generation && stored <= MAX_GROSS_LOTS,
            ClearingError::Reconciliation
        );
        if generation != 0 && generation == anchor.generation {
            return Ok(stored);
        }
        let free = MAX_GROSS_LOTS - anchor.gross;
        Ok(free / 3 + u64::from(u64::from(instance) < free % 3))
    }

    pub(crate) fn total(
        market: &BorshAccount<Market>,
        makers: [&BorshAccount<MakerRegistration>; 3],
    ) -> Result<u64> {
        require!(market.schema_version == 10, ClearingError::Profile);
        sum_lanes(*market.address(), market.venue, anchor(market)?, makers)
    }

    #[cfg(feature = "read-only-route-market")]
    pub(crate) fn checkpoint_gross(
        market: &mut BorshAccount<Market>,
        makers: [&BorshAccount<MakerRegistration>; 3],
    ) -> Result<u64> {
        require!(market.schema_version == 10, ClearingError::Profile);
        market.release_borrow()?;
        let checkpoint = anchor(market)?;
        market.reacquire_guard_only()?;
        sum_lanes(*market.address(), market.venue, checkpoint, makers)
    }

    fn sum_lanes(
        market: Address,
        venue: Address,
        checkpoint: Anchor,
        makers: [&BorshAccount<MakerRegistration>; 3],
    ) -> Result<u64> {
        let mut gross = MAX_GROSS_LOTS;
        for (index, maker) in makers.into_iter().enumerate() {
            require!(
                maker.schema_version == 10
                    && maker.instance as usize == index
                    && maker.venue == venue
                    && maker.market == market,
                ClearingError::MakerBinding
            );
            let bytes = maker.account().try_borrow()?;
            require!(bytes.len() == 8 + MakerRegistration::INIT_SPACE + crate::market_fees::LANE_EXTRA, ClearingError::Profile);
            let tail = bytes
                .get(8 + MakerRegistration::INIT_SPACE + 16..8 + MakerRegistration::INIT_SPACE + 32)
                .ok_or(ClearingError::Profile)?;
            gross = gross
                .checked_sub(available(tail, maker.instance, checkpoint)?)
                .ok_or(ClearingError::Reconciliation)?;
        }
        Ok(gross)
    }

    /// Global writers (receiver liquidation and default application) know the
    /// exact resulting market gross. Start a new distribution atomically with
    /// that change. Untouched makers inherit their share on their next access.
    pub(crate) fn reset(market: &mut BorshAccount<Market>, gross: u64) -> Result<()> {
        require!(gross <= MAX_GROSS_LOTS, ClearingError::RouteHealth);
        inspect::<_, MARKET_EXTRA>(
            market,
            |bytes| {
                let generation = word(&bytes[..8])?
                    .checked_add(1)
                    .ok_or(ClearingError::Arithmetic)?;
                bytes[..8].copy_from_slice(&generation.to_le_bytes());
                bytes[8..16].copy_from_slice(&gross.to_le_bytes());
                Ok(())
            },
            true,
        )
    }

    /// The hot route owns only the first registration's capacity. A short
    /// lane can use the fully checkpointed ordinary route for global admission.
    #[cfg(feature = "read-only-route-market")]
    pub(crate) fn record_local(
        market: &BorshAccount<Market>, maker: &mut BorshAccount<MakerRegistration>, delta: i128,
    ) -> Result<()> {
        let checkpoint = anchor(market)?;
        require!(checkpoint.generation > 0 && maker.market == *market.address() && maker.venue == market.venue,
            ClearingError::MakerBinding);
        let instance = maker.instance;
        inspect::<_, {crate::market_fees::LANE_EXTRA}>(maker, |bytes| {
            let free = available(&bytes[16..32], instance, checkpoint)?;
            let remaining = i128::from(free).checked_sub(delta).ok_or(ClearingError::Arithmetic)?;
            require!((0..=i128::from(MAX_GROSS_LOTS)).contains(&remaining), ClearingError::RouteHealth);
            bytes[16..24].copy_from_slice(&checkpoint.generation.to_le_bytes());
            bytes[24..32].copy_from_slice(&(remaining as u64).to_le_bytes());
            Ok(())
        }, true)
    }

    pub(crate) fn record(
        market: &mut BorshAccount<Market>,
        maker: &mut BorshAccount<MakerRegistration>,
        after: u64,
        position_delta: i128,
    ) -> Result<()> {
        let before = market.gross_lots;
        require!(
            before <= MAX_GROSS_LOTS && after <= MAX_GROSS_LOTS,
            ClearingError::RouteHealth
        );
        market.release_borrow()?;
        let mut checkpoint = anchor(market)?;
        market.reacquire_guard_only()?;
        if checkpoint.generation == 0 {
            reset(market, before)?;
            checkpoint = Anchor {
                generation: 1,
                gross: before,
            };
        }
        let instance = maker.instance;
        let mut needs_rebalance = false;
        inspect::<_, { crate::market_fees::LANE_EXTRA }>(
            maker,
            |bytes| {
                let free = available(&bytes[16..32], instance, checkpoint)?;
                let remaining = i128::from(free) - position_delta;
                if remaining < 0 {
                    needs_rebalance = true;
                } else {
                    let next = u64::try_from(remaining).map_err(|_| ClearingError::Arithmetic)?;
                    require!(next <= MAX_GROSS_LOTS, ClearingError::Reconciliation);
                    bytes[16..24].copy_from_slice(&checkpoint.generation.to_le_bytes());
                    bytes[24..32].copy_from_slice(&next.to_le_bytes());
                }
                Ok(())
            },
            true,
        )?;
        if needs_rebalance {
            // The serialized route still checks the complete common cap. A new
            // generation redistributes the exact remaining capacity atomically.
            reset(market, after)?;
        }
        Ok(())
    }
}
#[cfg(feature = "bounded-market-read")]
pub(crate) use candidate::{record, reset};
#[cfg(feature = "read-only-route-market")]
pub(crate) use candidate::{checkpoint_gross,record_local};
