use super::*;
use financial_core::clearing::scalable::{number::Number, settlement::Proposal};

#[derive(Accounts)]
pub struct RecoverySource {
    pub prepared: Box<BorshAccount<PreparedSettlement>>,
    pub resolution: Box<BorshAccount<Resolution>>,
}
#[derive(AnchorSerialize, AnchorDeserialize, IdlType, InitSpace, Default, Clone, Copy)]
pub struct RateWitness {
    // The measured book has one insurance round in each state. The core
    // still verifies clipping and rejects an insufficient proposal sequence.
    pub rates: [u64; 3],
    pub orders: [[u8; 8]; 2],
}

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
