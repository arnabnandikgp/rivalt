//! Candidate-only extensions. New PDAs have zeroed tails at initialization.
//! A route escrows its full fee and appends it to the first maker's lane.
//! The complete market checkpoint reclassifies earned insurance before spending.
pub const LANE_EXTRA: usize = if cfg!(feature = "aggregate-fee-qualification") {
    16
} else {
    0
};
pub const LEDGER_EXTRA: usize = if cfg!(feature = "aggregate-fee-qualification") {
    24
} else {
    0
};

#[cfg(feature = "aggregate-fee-qualification")]
mod candidate {
    use super::*;
    use crate::{
        state::{accounts::MarketLedger, liquidity::MakerRegistration},
        ClearingError,
    };
    use anchor_lang::prelude::*;
    use financial_core::fee_lanes::{classify, FeeCheckpoint, FeeLane, MarketFunds};

    fn check(value: bool) -> Result<()> {
        require!(value, ClearingError::Reconciliation);
        Ok(())
    }

    fn inspect<
        T: anchor_lang::Space
            + Discriminator
            + for<'a> SchemaRead<'a, anchor_lang::BorshConfig, Dst = T>
            + SchemaWrite<anchor_lang::BorshConfig, Src = T>
            + Owner,
        const N: usize,
    >(
        account: &mut BorshAccount<T>,
        change: impl FnOnce(&mut [u8; N]) -> Result<()>,
        mutating: bool,
    ) -> Result<()> {
        let mut view = account.account().clone();
        let prefix = T::DISCRIMINATOR.len() + T::INIT_SPACE;
        check(view.data_len() == prefix + N)?;
        account.release_borrow()?;
        let mut tail: [u8; N] = view.try_borrow()?[prefix..]
            .try_into()
            .map_err(|_| ClearingError::Profile)?;
        change(&mut tail)?;
        if mutating {
            view.try_borrow_mut()?[prefix..].copy_from_slice(&tail);
        }
        account.reacquire_guard_only()?;
        Ok(())
    }

    pub(crate) fn clean(ledger: &mut BorshAccount<MarketLedger>) -> Result<()> {
        inspect::<_, LEDGER_EXTRA>(ledger, |bytes| check(bytes[16..] == [0; 8]), false)
    }

    pub(crate) fn escrow(
        ledger: &mut BorshAccount<MarketLedger>,
        maker: &mut BorshAccount<MakerRegistration>,
        fee: u64,
    ) -> Result<(u128, u64)> {
        let mut lifetime = 0;
        inspect::<_, LANE_EXTRA>(
            maker,
            |bytes| {
                lifetime = FeeLane {
                    collected: u128::from_le_bytes(*bytes),
                }
                .record(fee)
                .map_err(|_| ClearingError::Arithmetic)?
                .collected;
                *bytes = lifetime.to_le_bytes();
                Ok(())
            },
            true,
        )?;
        let mut pending = 0;
        inspect::<_, LEDGER_EXTRA>(
            ledger,
            |bytes| {
                let current = u64::from_le_bytes(bytes[16..].try_into().unwrap());
                pending = financial_core::cash_add(current, fee)
                    .map_err(|_| ClearingError::Arithmetic)?;
                bytes[16..].copy_from_slice(&pending.to_le_bytes());
                Ok(())
            },
            true,
        )?;
        // The fee bucket includes pending escrow on this build. Treasury and
        // resolution can use it only after the complete read clears pending.
        ledger.fees =
            financial_core::cash_add(ledger.fees, fee).map_err(|_| ClearingError::Arithmetic)?;
        crate::instructions::account_custody::increment(&mut ledger.version)?;
        crate::instructions::account_custody::increment(&mut ledger.liability_version)?;
        Ok((lifetime, pending))
    }

    pub(crate) fn collect(
        ledger: &mut BorshAccount<MarketLedger>,
        registrations: [&mut BorshAccount<MakerRegistration>; 3],
    ) -> Result<(u128, u64, u64)> {
        let mut lanes = [FeeLane::default(); 3];
        for (index, registration) in registrations.into_iter().enumerate() {
            check(
                registration.market == ledger.market
                    && registration.venue == ledger.venue
                    && usize::from(registration.instance) == index,
            )?;
            let bytes = registration.account().try_borrow()?;
            let prefix = 8 + MakerRegistration::INIT_SPACE;
            check(bytes.len() == prefix + LANE_EXTRA)?;
            lanes[index].collected = u128::from_le_bytes(bytes[prefix..].try_into().unwrap());
        }
        let mut result = None;
        let (insurance, available, carry) = (
            ledger.insurance,
            ledger.fees,
            ledger.insurance_fee_remainder,
        );
        inspect::<_, LEDGER_EXTRA>(
            ledger,
            |bytes| {
                let previous = u128::from_le_bytes(bytes[..16].try_into().unwrap());
                let pending = u64::from_le_bytes(bytes[16..].try_into().unwrap());
                let retained = available
                    .checked_sub(pending)
                    .ok_or(ClearingError::Reconciliation)?;
                let next = classify(
                    FeeCheckpoint {
                        classified: previous,
                        carry,
                    },
                    MarketFunds {
                        insurance,
                        retained,
                    },
                    &lanes,
                )
                .map_err(|_| ClearingError::Reconciliation)?;
                check(next.new_fees == pending)?;
                bytes[..16].copy_from_slice(&next.checkpoint.classified.to_le_bytes());
                bytes[16..].fill(0);
                result = Some(next);
                Ok(())
            },
            true,
        )?;
        let next = result.ok_or(ClearingError::Reconciliation)?;
        ledger.insurance = next.funds.insurance;
        ledger.fees = next.funds.retained;
        ledger.insurance_fee_remainder = next.checkpoint.carry;
        if next.new_fees > 0 {
            crate::instructions::account_custody::increment(&mut ledger.version)?;
        }
        Ok((
            next.checkpoint.classified,
            next.new_fees,
            next.insurance_credit,
        ))
    }
}
#[cfg(feature = "aggregate-fee-qualification")]
pub(crate) use candidate::*;
