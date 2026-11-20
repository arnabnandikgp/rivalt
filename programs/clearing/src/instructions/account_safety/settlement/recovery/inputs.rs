use super::*;
use financial_core::clearing::scalable::{number::Number, settlement::Proposal};

#[cfg(not(feature = "paged-recovery-qualification"))]
impl RateWitness {
    pub(crate) fn proposal(&self) -> [Proposal; 1] {
        let [factor, btc, eth] = self.rates.map(|n| Number::from(u128::from(n)));
        [Proposal {
            factor,
            rates: [btc, eth],
        }]
    }
    pub(crate) fn orders(&self) -> [[u64; 8]; 2] {
        self.orders.map(|order| order.map(u64::from))
    }
}

#[cfg(feature = "paged-recovery-qualification")]
impl RateWitness {
    pub(crate) fn proposal(&self) -> Vec<Proposal> {
        self.rates
            .iter()
            .map(|&[factor, btc, eth]| Proposal {
                factor: u128::from(factor).into(),
                rates: [u128::from(btc).into(), u128::from(eth).into()],
            })
            .collect()
    }
    pub(crate) fn orders(&self) -> [Vec<u64>; 2] {
        self.orders
            .each_ref()
            .map(|order| order.iter().copied().map(u64::from).collect())
    }
    pub(super) fn validate_shape(&self, count: usize) -> Result<()> {
        require!(
            (1..=3).contains(&self.rates.len())
                && self.orders.iter().all(|order| order.len() == count),
            ProofError::Unsupported
        );
        Ok(())
    }
}
