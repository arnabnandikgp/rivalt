//! Price policy 1: the existing local profile, expressed in explicit units.
//! Numeric bounds are proof obligations; market bounds are economic policy.
//! These constants are immutable for a deployment. Changing a value requires a
//! new policy version, accepted calibration and a fresh domain, not an updater.
//! `ops/generate-price-policy.py` generates the SDK constants from these literals.

// Arithmetic domain (also used by maker curves, reservations and liquidation).
pub const MAX_PRICE: u64 = 1_000_000;

// Deployment-selected policy. This version is not an account-schema version.
pub const PRICE_POLICY_VERSION: u16 = 1;
pub const BTC_LOTS_PER_UNIT: u64 = 1_000_000;
pub const ETH_LOTS_PER_UNIT: u64 = 100_000;
pub const COLLATERAL_ATOMS_PER_UNIT: u64 = 1_000_000;
pub const SOURCE_EXPONENT: i32 = -6;

// Asset USD micro-units after multiplying by collateral atoms / market lots.
// Consequently BTC is $10,000..100,000 and ETH is $1,000..10,000.
pub const MIN_NORMALIZED_ASSET_USD: i64 = 10_000_000_000;
pub const MAX_NORMALIZED_ASSET_USD: i64 = 100_000_000_000;
pub const MIN_COLLATERAL_USD: i64 = 500_000;
pub const MAX_COLLATERAL_USD: i64 = 1_500_000;
pub const MIN_NORMAL_COLLATERAL_USD: i64 = 950_000;
pub const MAX_NORMAL_COLLATERAL_USD: i64 = 1_050_000;
pub const ASSET_CONFIDENCE_BPS: u64 = 50;
pub const COLLATERAL_CONFIDENCE_BPS: u64 = 25;
pub const SOURCE_DIVERGENCE_BPS: u64 = 100;
pub const BASIS_POINTS: u64 = 10_000;
pub const SOURCE_AGE: i64 = 20;
pub const DEVNET_SOURCE_AGE: i64 = 30;
pub const FUTURE_SKEW: i64 = 2;

// Collateral atoms per market lot. These are policy, not integer capacity.
pub const MIN_REFERENCE_PRICE: u64 = 10_000;
pub const MAX_REFERENCE_PRICE: u64 = 100_000;
pub const MIN_ORDER_PRICE: u64 = 9_000;
pub const MAX_ORDER_PRICE: u64 = 110_000;
pub const MIN_TRIGGER_PRICE: u64 = 10_000;
pub const MAX_TRIGGER_PRICE: u64 = 100_000;
pub const RISK_LOWER_PERCENT: u64 = 99;
pub const RISK_UPPER_PERCENT: u64 = 101;
pub const DEGRADED_LOWER_PERCENT: u64 = 97;
pub const DEGRADED_UPPER_PERCENT: u64 = 103;
pub const PERCENT_DENOMINATOR: u64 = 100;
// Keep the reduced rational band: changing its denominator can change overflow
// behavior for malformed reports even when its mathematical ratio is the same.
pub const EXECUTION_LOWER_NUMERATOR: u64 = 9;
pub const EXECUTION_UPPER_NUMERATOR: u64 = 11;
pub const EXECUTION_DENOMINATOR: u64 = 10;
pub const FUNDING_REFERENCE_NOTIONAL: u64 = 6_000_000;
pub const MAX_FUNDING_SAMPLE_LOTS: u64 = 600;
pub const FUNDING_CAP_BPS: u64 = 50;

pub fn source_multiplier(lots_per_unit: u64) -> Option<i64> {
    match lots_per_unit {
        BTC_LOTS_PER_UNIT => Some((COLLATERAL_ATOMS_PER_UNIT / BTC_LOTS_PER_UNIT) as i64),
        ETH_LOTS_PER_UNIT => Some((COLLATERAL_ATOMS_PER_UNIT / ETH_LOTS_PER_UNIT) as i64),
        _ => None,
    }
}

pub fn reference_in_policy(price: u64) -> bool {
    (MIN_REFERENCE_PRICE..=MAX_REFERENCE_PRICE).contains(&price)
}

pub fn order_in_policy(price: u64) -> bool {
    (MIN_ORDER_PRICE..=MAX_ORDER_PRICE).contains(&price)
}

pub fn trigger_in_policy(price: u64) -> bool {
    (MIN_TRIGGER_PRICE..=MAX_TRIGGER_PRICE).contains(&price)
}
