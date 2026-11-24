//! Native-only bounds on surviving total entry cost. No exact attribution is an input.
use financial_core::{Error, Result, MAX_PRICE, SCALE};

/// Twice an outward-rounded integer bound, plus one if equality is impossible.
/// The integer is in billionths of a collateral atom. Both fields fit in 32 bytes total.
#[derive(Clone, Copy, Default)]
struct Endpoint(i128);

impl Endpoint {
    fn from_integer(value: i128, strict: bool) -> Result<Self> {
        value
            .checked_mul(2)
            .and_then(|bits| bits.checked_add(i128::from(strict)))
            .map(Self)
            .ok_or(Error::Overflow)
    }

    fn value(self) -> i128 {
        self.0 / 2
    }
    fn strict(self) -> bool {
        self.0 % 2 != 0
    }

    fn add(self, gross: i128) -> Result<Self> {
        Self::from_integer(
            self.value().checked_add(gross).ok_or(Error::Overflow)?,
            self.strict(),
        )
    }

    fn share(self, remaining: i128, original: i128, upper: bool) -> Result<Self> {
        // remaining/original is strictly positive. An open endpoint stays open.
        let numerator = self.value().checked_mul(remaining).ok_or(Error::Overflow)?;
        let inexact = numerator % original != 0;
        let rounded = numerator / original + i128::from(upper && inexact);
        Self::from_integer(rounded, self.strict() || inexact)
    }
}

#[derive(Default)]
pub(super) struct EntryBounds {
    lower: Endpoint,
    upper: Endpoint,
}

#[derive(Debug)]
pub(super) struct Decision {
    pub ordinary: Option<i128>,
    pub forced: Option<i128>,
}

impl EntryBounds {
    pub fn fill(&self, before: i64, after: i64, gross: u64) -> Result<Self> {
        let gross = i128::from(gross) * SCALE;
        let remaining = i128::from(after.unsigned_abs());
        if remaining == 0 {
            return Ok(Self::default());
        }
        if before.signum() != after.signum() {
            // Opening or flipping discards all uncertainty from the previous side.
            let executed = i128::from(before.abs_diff(after));
            let total = Endpoint::from_integer(gross, false)?;
            return Ok(Self {
                lower: total.share(remaining, executed, false)?,
                upper: total.share(remaining, executed, true)?,
            });
        }
        let original = i128::from(before.unsigned_abs());
        if remaining > original {
            return Ok(Self {
                lower: self.lower.add(gross)?,
                upper: self.upper.add(gross)?,
            });
        }
        Ok(Self {
            lower: self.lower.share(remaining, original, false)?,
            upper: self.upper.share(remaining, original, true)?,
        })
    }

    pub fn scaled_endpoints(&self) -> (i128, bool, i128, bool) {
        (
            self.lower.value(),
            self.lower.strict(),
            self.upper.value(),
            self.upper.strict(),
        )
    }

    pub fn certify(
        &self,
        lots: i64,
        mark: u64,
        claim: i128,
        available: u64,
        use_strict: bool,
    ) -> Decision {
        // Both whole-atom ceilings are monotone in cost for fixed signed lots, mark,
        // claim and matched quantity. Their thresholds lie at integer scaled costs.
        // A half-step evaluates the one-sided limit at an excluded endpoint; it is
        // an evaluation point, never a replacement for the stored bound or true cost.
        let low_probe = self.lower.value() * 2 + i128::from(use_strict && self.lower.strict());
        let high_probe = self.upper.value() * 2 - i128::from(use_strict && self.upper.strict());
        let low = ceilings(low_probe, lots, mark, claim, available);
        let high = ceilings(high_probe, lots, mark, claim, available);
        Decision {
            ordinary: (low.0 == high.0).then_some(low.0),
            forced: (low.1 == high.1).then_some(low.1),
        }
    }
}

/// Evaluate both ceilings in half units of scaled cost. Position, mark, claim
/// and matched lots are validated by the production comparison before evaluation.
/// Twice the maximum scaled claim and the lot/mark products fit in i128.
pub(super) fn ceilings(
    doubled_cost: i128,
    lots: i64,
    mark: u64,
    claim: i128,
    available: u64,
) -> (i128, i128) {
    let unit = 2 * SCALE;
    let open_gain = (i128::from(lots) * i128::from(mark) * unit
        - i128::from(lots.signum()) * doubled_cost)
        .max(0);
    let ordinary = (2 * claim - open_gain).max(0) / unit;
    let forced = if lots == 0 || claim <= 0 {
        0
    } else {
        let ticks = open_gain / (i128::from(lots.unsigned_abs()) * unit);
        let room = if lots > 0 { mark - 1 } else { MAX_PRICE - mark };
        (ticks.min(i128::from(room)) * i128::from(available)).min(claim / SCALE)
    };
    (ordinary, forced)
}
