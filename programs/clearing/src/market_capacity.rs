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
    16
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
        let gross = word(&bytes[start + 8..])?;
        require!(
            gross <= MAX_GROSS_LOTS && (generation != 0 || gross == 0),
            ClearingError::Reconciliation
        );
        Ok(Anchor { generation, gross })
    }

    fn available(maker: &BorshAccount<MakerRegistration>, anchor: Anchor) -> Result<u64> {
        let bytes = maker.account().try_borrow()?;
        let start = 8 + MakerRegistration::INIT_SPACE + 16;
        require!(
            bytes.len() == start + LANE_EXTRA && maker.instance < 3,
            ClearingError::Profile
        );
        let generation = word(&bytes[start..start + 8])?;
        require!(
            generation <= anchor.generation,
            ClearingError::Reconciliation
        );
        if generation > 0 && generation == anchor.generation {
            let free = word(&bytes[start + 8..])?;
            require!(free <= MAX_GROSS_LOTS, ClearingError::Reconciliation);
            return Ok(free);
        }
        let free = MAX_GROSS_LOTS - anchor.gross;
        Ok(free / 3 + u64::from(u64::from(maker.instance) < free % 3))
    }

    pub(super) fn total(
        market: &BorshAccount<Market>,
        makers: [&BorshAccount<MakerRegistration>; 3],
    ) -> Result<u64> {
        let checkpoint = anchor(market)?;
        let mut gross = MAX_GROSS_LOTS;
        for (index, maker) in makers.into_iter().enumerate() {
            require!(
                maker.instance as usize == index
                    && maker.venue == market.venue
                    && maker.market == market.address().to_owned(),
                ClearingError::MakerBinding
            );
            gross = gross
                .checked_sub(available(maker, checkpoint)?)
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
                bytes[8..].copy_from_slice(&gross.to_le_bytes());
                Ok(())
            },
            true,
        )
    }

    pub(crate) fn record(
        market: &mut BorshAccount<Market>,
        maker: &mut BorshAccount<MakerRegistration>,
        after: u64,
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
        maker.release_borrow()?;
        let free = available(maker, checkpoint)?;
        maker.reacquire_guard_only()?;
        let next = i128::from(free) + i128::from(before) - i128::from(after);
        if next < 0 {
            // The serialized legacy cap is also checked on this profile. Only
            // this fallback may draw on other makers' unused capacity. The
            // complete new distribution is installed after consuming the fill.
            return reset(market, after);
        }
        let next = u64::try_from(next).map_err(|_| ClearingError::Arithmetic)?;
        require!(next <= MAX_GROSS_LOTS, ClearingError::Reconciliation);
        inspect::<_, { crate::market_fees::LANE_EXTRA }>(
            maker,
            |bytes| {
                bytes[16..24].copy_from_slice(&checkpoint.generation.to_le_bytes());
                bytes[24..].copy_from_slice(&next.to_le_bytes());
                Ok(())
            },
            true,
        )
    }
}
#[cfg(feature = "bounded-market-read")]
pub(crate) use candidate::{record, reset};
