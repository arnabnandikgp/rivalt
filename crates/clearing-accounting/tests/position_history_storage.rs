//! Measure exact survivor history under reductions at entry and one-atom open-gain payments.
//! This is a native accounting case. It does not exercise on-chain admission or settlement.
#![cfg(feature = "surviving-profit")]

use clearing_accounting::{attribution::Attribution, SCALE};
use num_bigint::BigUint;
use num_traits::ToPrimitive;

fn is_prime(quantity: u64) -> bool {
    (2..)
        .take_while(|divisor| divisor * divisor <= quantity)
        .all(|divisor| quantity % divisor != 0)
}

#[test]
fn exact_history_after_partial_closes_and_payments_at_dollar_sizes() {
    let entry = 61_002u64;
    // Golden lengths from independent rational arithmetic. Each paid atom is shared
    // across a different prime lot count, so its factor survives in the denominator.
    for (initial, shared_bytes, separate_bytes) in [
        (1_640, 805, 545),
        (16_394, 1_164, 784),
        (163_935, 1_444, 971),
        (1_000_000, 1_660, 1_115),
    ] {
        let quantities: Vec<u64> = (11..=initial)
            .rev()
            .filter(|&lots| is_prime(lots))
            .take(220)
            .collect();
        assert_eq!(quantities.len(), 220);
        let denominator: BigUint = quantities.iter().copied().map(BigUint::from).product();
        let paid_numerator: BigUint = quantities.iter().map(|&lots| &denominator / lots).sum();
        let scaled_entry = BigUint::from(entry) * SCALE as u64;
        // Distinct primes excluding 2 and 5 also stay coprime to the decimal scale.
        let paid_scaled = &paid_numerator * SCALE as u64;
        let byte_length = |number: &BigUint| number.bits().div_ceil(8) as usize;
        // Two independently reduced fractions with four u16 magnitude lengths.
        assert_eq!(
            8 + byte_length(&scaled_entry)
                + 1
                + byte_length(&paid_scaled)
                + byte_length(&denominator),
            separate_bytes
        );

        for side in [1i64, -1] {
            let mark = (entry as i64 + side * 1_000) as u64;
            let mut previous = side * initial as i64;
            let mut state = Attribution::default()
                .fill(0, previous, initial * entry)
                .unwrap();
            for (payments_before, &quantity) in quantities.iter().enumerate() {
                let remaining = side * quantity as i64;
                if previous != remaining {
                    state = state
                        .fill(previous, remaining, previous.abs_diff(remaining) * entry)
                        .unwrap();
                }
                // Closing at entry realizes zero price gain. The aggregate claim at
                // the payment mark loses exactly one atom for each previous payment.
                let claim = (i128::from(quantity) * 1_000 - payments_before as i128) * SCALE;
                state = state.payment(remaining, mark, claim, 1).unwrap();
                previous = remaining;
            }
            let mut bytes = vec![0; shared_bytes];
            assert!(state.write(&mut bytes[..shared_bytes - 1]).is_err());
            state.write(&mut bytes).unwrap();
            assert_eq!(Attribution::read(&bytes, previous).unwrap(), state);
            let mut offset = 6;
            for (field, expected) in [
                &denominator * &scaled_entry,
                paid_scaled.clone(),
                denominator.clone(),
            ]
            .into_iter()
            .enumerate()
            {
                let size = u16::from_le_bytes([bytes[2 * field], bytes[2 * field + 1]]) as usize;
                assert_eq!(
                    BigUint::from_bytes_le(&bytes[offset..offset + size]),
                    expected
                );
                offset += size;
            }
            assert_eq!(offset, shared_bytes);
            let quantity = previous.unsigned_abs();
            let matched = quantity / 2;
            let unpaid_atoms = quantity * 1_000 - quantities.len() as u64;
            // The matched lots retain their exact fraction of payments. Eligibility
            // is floored in whole atoms and capped by the account's aggregate claim.
            let matched_gain = ((&denominator * 1_000u64 - &paid_numerator) * matched
                / &denominator)
                .to_u64()
                .unwrap();
            assert_eq!(
                state.charge_cap(previous, mark, i128::from(unpaid_atoms) * SCALE, matched),
                Ok(matched_gain.min(unpaid_atoms))
            );
            // An aggregate claim of 37.5 atoms can fund only 37 whole atoms,
            // even when the matched lots have a larger unpaid gain.
            assert!(matched_gain > 37);
            assert_eq!(
                state.charge_cap(previous, mark, 37 * SCALE + SCALE / 2, matched),
                Ok(37)
            );
            assert_eq!(state.charge_cap(previous, mark, 0, matched), Ok(0));
            assert_eq!(
                state.fill(previous, 0, quantity * entry).unwrap(),
                Attribution::default()
            );
        }
    }
}
