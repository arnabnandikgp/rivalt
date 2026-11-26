//! Exact debtor coverage from an authenticated financial projection. The
//! caller binds the complete rows and validated funding-adjusted price bounds.
//! This predicate grants no authority to collect or pay a claim.
use crate::{add, mul, scaled, Error, Result};

pub fn covers(
    cash: u64,
    lots: [i64; 2],
    fixed: [i128; 2],
    target: usize,
    endpoints: [[i128; 2]; 2],
) -> Result<bool> {
    if target >= 2 || endpoints.iter().any(|range| range[0] > range[1]) {
        return Err(Error::Bounds);
    }
    let mut claims = fixed;
    for (market, claim) in claims.iter_mut().enumerate() {
        let adverse = endpoints[market][usize::from(lots[market] < 0)];
        *claim = add(*claim, mul(i128::from(lots[market]), adverse)?)?;
    }
    Ok(claims[target] >= 0 || add(add(scaled(cash)?, claims[0].min(0))?, claims[1].min(0))? >= 0)
}
