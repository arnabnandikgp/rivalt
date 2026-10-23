//! P13 wire boundary for sponsored Core Compatible accounts.
//! Selected only by the separate devnet engineering profile; defaults stay disabled.
use anchor_lang::prelude::*;
use financial_core::oracle::Price;

pub const RECEIVER: Pubkey = pubkey!("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp");
pub const ACCOUNTS: [Pubkey; 2] = [
    pubkey!("APgzQGGdv2qCgBkX6aHVkrGePtBVDDg68GiqaM7rmtf5"),
    pubkey!("6HAuqASbHEh4w4REJEUUUCginTLfj1kwCh215ZLtMkrT"),
];
// PriceUpdateV2 and PriceFeedMessage at pyth-crosschain revision
// 145e9b4a88ef0bf2795357fdce8c0c2fe57b77d2. No legacy Anchor dependency.
const DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];
const FEEDS: [[u8; 32]; 2] = [
    [
        230, 45, 246, 200, 180, 168, 95, 225, 166, 125, 180, 77, 193, 45, 229, 219, 51, 15, 122,
        198, 107, 114, 220, 101, 138, 254, 223, 15, 74, 65, 91, 67,
    ],
    [
        234, 160, 32, 198, 28, 196, 121, 113, 40, 19, 70, 28, 225, 83, 137, 74, 150, 166, 192, 11,
        33, 237, 12, 252, 39, 152, 209, 249, 169, 233, 201, 74,
    ],
];

pub fn decode(
    info: &AccountInfo,
    index: usize,
    previous_publish: u64,
    slot: u64,
) -> Option<(Price, u64)> {
    let expected = ACCOUNTS.get(index)?;
    if info.key != expected || info.owner != &RECEIVER || info.is_writable || info.executable {
        return None;
    }
    let b = info.try_borrow_data().ok()?;
    // Full is enum tag 1; Partial has a different serialized length and is refused.
    // The account allocates the enum's maximum size, leaving one padding byte for Full.
    if b.len() != 134
        || b[..8] != DISCRIMINATOR
        || b[40] != 1
        || &b[8..40] != expected.as_ref()
        || b[41..73] != FEEDS[index]
    {
        return None;
    }
    let price = i64::from_le_bytes(b[73..81].try_into().ok()?);
    let confidence = u64::from_le_bytes(b[81..89].try_into().ok()?);
    let exponent = i32::from_le_bytes(b[89..93].try_into().ok()?);
    let published = i64::from_le_bytes(b[93..101].try_into().ok()?);
    let previous = i64::from_le_bytes(b[101..109].try_into().ok()?);
    let posted_slot = u64::from_le_bytes(b[125..133].try_into().ok()?);
    let sequence = u64::try_from(published).ok()?;
    if sequence == 0
        || sequence < previous_publish
        || previous > published
        || posted_slot == 0
        || posted_slot > slot
    {
        return None;
    }
    let (value, confidence) = normalize(price, confidence, exponent)?;
    Some((
        Price {
            value,
            confidence,
            exponent: -6,
            published,
        },
        sequence,
    ))
}

fn normalize(price: i64, confidence: u64, exponent: i32) -> Option<(i64, u64)> {
    if price <= 0 || !(-18..=0).contains(&exponent) {
        return None;
    }
    let shift = exponent + 6;
    let scale = 10u128.checked_pow(shift.unsigned_abs())?;
    let p = u128::try_from(price).ok()?;
    let c = u128::from(confidence);
    let (value, conf) = if shift >= 0 {
        (p.checked_mul(scale)?, c.checked_mul(scale)?)
    } else {
        // Include the midpoint remainder so both ends enclose the source interval.
        (p / scale, c.checked_add(p % scale)?.div_ceil(scale))
    };
    let value = i64::try_from(value).ok()?;
    if value == 0 {
        return None;
    }
    Some((value, u64::try_from(conf).ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn bytes() -> Vec<u8> {
        let mut b = vec![0; 134];
        b[..8].copy_from_slice(&DISCRIMINATOR);
        b[8..40].copy_from_slice(ACCOUNTS[0].as_ref());
        b[40] = 1;
        b[41..73].copy_from_slice(&FEEDS[0]);
        b[73..81].copy_from_slice(&8_123_456_789_012i64.to_le_bytes());
        b[81..89].copy_from_slice(&10_001u64.to_le_bytes());
        b[89..93].copy_from_slice(&(-8i32).to_le_bytes());
        b[93..101].copy_from_slice(&1_000i64.to_le_bytes());
        b[101..109].copy_from_slice(&999i64.to_le_bytes());
        b[125..133].copy_from_slice(&123u64.to_le_bytes());
        b
    }
    fn read(
        b: &mut [u8],
        key: Pubkey,
        owner: Pubkey,
        writable: bool,
        previous: u64,
        slot: u64,
    ) -> Option<(Price, u64)> {
        let mut lamports = 1;
        decode(
            &AccountInfo::new(&key, false, writable, &mut lamports, b, &owner, false),
            0,
            previous,
            slot,
        )
    }
    #[test]
    fn identity_full_verification_and_time_regression() {
        let b = bytes();
        let (p, seq) = read(&mut b.clone(), ACCOUNTS[0], RECEIVER, false, 1_000, 123).unwrap();
        assert_eq!(
            (p.value, p.confidence, p.exponent, p.published, seq),
            (81_234_567_890, 101, -6, 1_000, 1_000)
        );
        assert!(read(&mut b.clone(), ACCOUNTS[1], RECEIVER, false, 0, 123).is_none());
        assert!(read(
            &mut b.clone(),
            ACCOUNTS[0],
            Pubkey::default(),
            false,
            0,
            123
        )
        .is_none());
        assert!(read(&mut b.clone(), ACCOUNTS[0], RECEIVER, true, 0, 123).is_none());
        assert!(read(&mut b.clone(), ACCOUNTS[0], RECEIVER, false, 1_001, 123).is_none());
        assert!(read(&mut b.clone(), ACCOUNTS[0], RECEIVER, false, 0, 122).is_none());
        for at in [0, 8, 40, 41] {
            let mut bad = b.clone();
            bad[at] ^= 1;
            assert!(read(&mut bad, ACCOUNTS[0], RECEIVER, false, 0, 123).is_none());
        }
        assert!(read(&mut b[..133].to_vec(), ACCOUNTS[0], RECEIVER, false, 0, 123).is_none());
    }
    #[test]
    fn conservative_integer_conversion_vectors() {
        assert_eq!(
            normalize(8_123_456_789_012, 10_001, -8),
            Some((81_234_567_890, 101))
        );
        assert_eq!(normalize(100_099, 100, -8), Some((1_000, 2)));
        assert_eq!(normalize(8_123_456, 3, -2), Some((81_234_560_000, 30_000)));
        assert_eq!(normalize(i64::MAX, 0, 0), None);
        assert_eq!(normalize(1, 0, -18), None);
        assert_eq!(normalize(-1, 0, -6), None);
        assert_eq!(normalize(1, 0, -19), None);
        assert_eq!(normalize(1, u64::MAX, 0), None);
    }
    #[test]
    fn captured_devnet_accounts_match_independent_decimal_values() {
        // Actual finalized account bytes from the clean ffc20f3 RPC observation.
        // This unit replay is not on-chain Rivalt consumption or A18 completion.
        let cases = [
            (
                include_str!("../../../tests/fixtures/btc-account.hex"),
                81_649_327_449,
                68_172_551,
            ),
            (
                include_str!("../../../tests/fixtures/collateral-account.hex"),
                999_839,
                83,
            ),
        ];
        for (index, (hex, value, confidence)) in cases.into_iter().enumerate() {
            let mut b: Vec<u8> = hex
                .trim()
                .as_bytes()
                .chunks_exact(2)
                .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
                .collect();
            let mut lamports = 1;
            let info = AccountInfo::new(
                &ACCOUNTS[index],
                false,
                false,
                &mut lamports,
                &mut b,
                &RECEIVER,
                false,
            );
            let (p, sequence) = decode(&info, index, 0, u64::MAX).unwrap();
            assert_eq!(
                (p.value, p.confidence, p.exponent, p.published, sequence),
                (value, confidence, -6, 1_792_752_688, 1_792_752_688)
            );
        }
    }
}
