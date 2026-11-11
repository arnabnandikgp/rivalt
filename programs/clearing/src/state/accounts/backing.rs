//! D102 scalar proof state lives with its existing market ledger. There is no
//! new global financial account and no caller-supplied contribution authority.
use super::*;
use financial_core::backing::{MarketRegion, Region, Summary, CHECKPOINT_BYTES};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType)]
pub struct BackingRegion {
    pub prices: [[u64; 2]; 2],
    pub funding: [[i128; 2]; 2],
}
impl BackingRegion {
    pub fn around(prices: [[u64; 2]; 2], funding: [[i128; 2]; 2]) -> Result<Self> {
        let current = Self { prices, funding };
        current.model().validate().map_err(|_| crate::ClearingError::ExitCohort)?;
        let mut result = current;
        for index in 0..2 {
            let width = (prices[index][1] - prices[index][0]).max(1);
            result.prices[index] = [prices[index][0].saturating_sub(width).max(1),
                prices[index][1].saturating_add(width).min(financial_core::MAX_PRICE)];
            // One hour of the existing capped premium. This bounds arithmetic;
            // it never authorizes that much elapsed accrual or stale observations.
            let radius = i128::from(result.prices[index][1]).checked_mul(financial_core::SCALE)
                .and_then(|value| value.checked_mul(i128::from(financial_core::price_policy::FUNDING_CAP_BPS)))
                .ok_or(crate::ClearingError::Arithmetic)? / i128::from(financial_core::price_policy::BASIS_POINTS);
            result.funding[index] = [funding[index][0].checked_sub(radius).ok_or(crate::ClearingError::Arithmetic)?
                    .max(-financial_core::MAX_FUNDING),
                funding[index][1].checked_add(radius).ok_or(crate::ClearingError::Arithmetic)?
                    .min(financial_core::MAX_FUNDING)];
        }
        result.model().validate().map_err(|_| crate::ClearingError::ExitCohort)?;
        Ok(result)
    }
    pub fn model(&self) -> Region {
        Region { markets: std::array::from_fn(|index| MarketRegion {
            price_low: self.prices[index][0], price_high: self.prices[index][1],
            funding_low: self.funding[index][0], funding_high: self.funding[index][1],
        }) }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, IdlType)]
pub struct BackingState {
    pub epoch: u64,
    pub safety_epoch: u64,
    pub membership_epoch: u64,
    pub terms_epoch: u64,
    pub config_epochs: [u64; 2],
    pub region: BackingRegion,
    pub summary: [u8; CHECKPOINT_BYTES],
}
impl Default for BackingState {
    fn default() -> Self { Self { epoch: 0, safety_epoch: 0, membership_epoch: 0,
        terms_epoch: 0, config_epochs: [0; 2], region: BackingRegion::default(), summary: [0; CHECKPOINT_BYTES] } }
}
impl BackingState {
    pub fn totals(&self) -> Result<Summary> {
        require!(self.epoch != 0, crate::ClearingError::ExitCohort);
        Summary::from_checkpoint(&self.summary).map_err(|_| crate::ClearingError::ExitCohort.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deterministic_region_extends_risk_and_held_endpoints_without_changing_their_policy() {
        let region = BackingRegion::around([[99,101],[199,201]],[[-7,11],[-13,17]]).unwrap();
        assert_eq!(region.prices, [[97,103],[197,203]]);
        assert_eq!(region.funding, [[-515_000_007,515_000_011],[-1_015_000_013,1_015_000_017]]);
        let edge = BackingRegion::around([[1,2],[999_999,1_000_000]],
            [[-financial_core::MAX_FUNDING,-financial_core::MAX_FUNDING],
             [financial_core::MAX_FUNDING,financial_core::MAX_FUNDING]]).unwrap();
        assert_eq!(edge.prices, [[1,3],[999_998,1_000_000]]);
        assert_eq!(edge.funding[0][0], -financial_core::MAX_FUNDING);
        assert_eq!(edge.funding[1][1], financial_core::MAX_FUNDING);
        assert!(BackingRegion::around([[0,1],[1,1]],[[0,0];2]).is_err());
        assert_eq!(BackingState::INIT_SPACE, 248);
    }
}
