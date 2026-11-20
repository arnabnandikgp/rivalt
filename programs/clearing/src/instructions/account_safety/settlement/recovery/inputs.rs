use super::*;
use financial_core::clearing::scalable::{number::Number, settlement::Proposal};

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
