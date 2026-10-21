use anchor_lang::{prelude::Pubkey, AnchorSerialize};
use maker_interface::*;
fn fixture(id: u8) -> (MakerState, QuoteRequest) {
    let m = Pubkey::new_from_array([1; 32]);
    let p = Pubkey::new_from_array([2; 32]);
    let s = MakerState {
        version: 1,
        maker_id: id,
        owner: Pubkey::new_from_array([3; 32]),
        market: m,
        capital: p,
        domain: [4; 32],
        quote_epoch: 1,
        start_slot: 100,
        expiry_slot: 500,
        bump: 255,
    };
    let r = QuoteRequest {
        version: 1,
        domain: s.domain,
        market: m,
        capital: p,
        quote_epoch: 1,
        authority_epoch: 1,
        terms_epoch: 1,
        market_config_epoch: 1,
        side: 0,
        lots: 10,
        inventory: 0,
        cash: 1_000_000_000,
        inventory_limit: 100_000,
        consumed: 0,
        reference_price: 60_000,
        slot: 100,
    };
    (s, r)
}
#[test]
fn small_and_large_orders_have_different_winners() {
    let (a, mut x) = fixture(0);
    let (b, _) = fixture(1);
    assert_eq!(quote(&a, &x).unwrap().gross_quote, 600_145);
    assert_eq!(quote(&b, &x).unwrap().gross_quote, 600_300);
    x.lots = 100;
    assert_eq!(quote(&a, &x).unwrap().gross_quote, 6_005_950);
    assert_eq!(quote(&b, &x).unwrap().gross_quote, 6_003_000);
    x.lots = 512;
    assert_eq!(quote(&a, &x).unwrap().gross_quote, 30_855_936);
    x.lots = 4096;
    assert_eq!(quote(&b, &x).unwrap().gross_quote, 253_253_760);
    x.side = 1;
    assert_eq!(quote(&b, &x).unwrap().gross_quote, 238_266_240);
    x.lots = 512;
    assert_eq!(quote(&a, &x).unwrap().gross_quote, 30_584_064);
    x.lots = 10;
    assert_eq!(quote(&a, &x).unwrap().gross_quote, 599_855);
    assert_eq!(quote(&b, &x).unwrap().gross_quote, 599_700);
    x.lots = 100;
    assert_eq!(quote(&a, &x).unwrap().gross_quote, 5_994_050);
    assert_eq!(quote(&b, &x).unwrap().gross_quote, 5_997_000);
}
#[test]
fn independent_per_lot_oracle_checks_both_curves() {
    // Expected values enumerate marginal lots; no shared cumulative/impact helper.
    let mut seed = 0x504f335f52495641u64;
    for _ in 0..4_000 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let id = (seed % 2) as u8;
        let (s, mut r) = fixture(id);
        r.side = ((seed >> 7) % 2) as u8;
        r.inventory = ((seed >> 9) % 2049) as i64 - 1024;
        r.consumed = (seed >> 23) % if id == 0 { 400 } else { 3_996 };
        r.lots = 1 + (seed >> 31) % 100;
        let center = 60_000
            - if id == 0 {
                r.inventory / 64 * 4
            } else {
                r.inventory / 256
            };
        let expected: i64 = (r.consumed..r.consumed + r.lots)
            .map(|i| {
                let offset = if id == 0 {
                    10 + i as i64
                } else {
                    30 + i.saturating_sub(256) as i64
                };
                if r.side == 0 {
                    center + offset
                } else {
                    center - offset
                }
            })
            .sum();
        assert_eq!(quote(&s, &r).unwrap().gross_quote, expected as u64);
    }
}
#[test]
fn cumulative_consumption_preserves_price_prefix_and_rejects_replay() {
    for id in 0..=1 {
        for side in 0..=1 {
            let (s, mut r) = fixture(id);
            r.side = side;
            r.lots = 300;
            let whole = quote(&s, &r).unwrap().gross_quote;
            r.lots = 100;
            let first = quote(&s, &r).unwrap();
            let mut total = first.gross_quote;
            r.consumed = consume(0, &first).unwrap();
            assert_eq!(consume(r.consumed, &first), Err(QuoteError::Response));
            r.lots = 200;
            total += quote(&s, &r).unwrap().gross_quote;
            assert_eq!(total, whole);
            let next = quote(&s, &r).unwrap();
            r.consumed = 0;
            let reset = quote(&s, &r).unwrap();
            if id == 0 {
                assert_ne!(next.gross_quote, reset.gross_quote);
            }
        }
    }
}
#[test]
fn binding_lifetime_price_inventory_cash_and_size_are_bounded() {
    let (s, r) = fixture(0);
    let reject = |x: QuoteRequest| assert!(quote(&s, &x).is_err());
    let mut x = r.clone();
    x.version = 2;
    reject(x);
    let mut x = r.clone();
    x.domain = [0; 32];
    reject(x);
    let mut x = r.clone();
    x.quote_epoch = 2;
    reject(x);
    let mut x = r.clone();
    x.slot = 99;
    reject(x);
    let mut x = r.clone();
    x.slot = 500;
    reject(x);
    let mut x = r.clone();
    x.side = 2;
    reject(x);
    let mut x = r.clone();
    x.lots = 0;
    reject(x);
    let mut x = r.clone();
    x.lots = 513;
    reject(x);
    let mut x = r.clone();
    x.consumed = 512;
    reject(x);
    let mut x = r.clone();
    x.consumed = u64::MAX;
    reject(x);
    let mut x = r.clone();
    x.cash = 0;
    reject(x);
    let mut x = r.clone();
    x.inventory = i64::MIN;
    reject(x);
    let mut x = r.clone();
    x.reference_price = 1;
    x.side = 1;
    reject(x);
    let mut x = r.clone();
    x.reference_price = 1_000_000;
    reject(x);
    let mut x = r.clone();
    x.inventory = -100_000;
    reject(x);
    let mut x = r.clone();
    x.lots = 512;
    assert_eq!(quote(&s, &x).unwrap().remaining, 0);
    x.slot = 499;
    assert!(quote(&s, &x).is_ok());
}
#[test]
fn producer_and_entire_response_are_authenticated() {
    let (s, r) = fixture(0);
    let response = quote(&s, &r).unwrap();
    let producer = Pubkey::new_from_array([9; 32]);
    let mut bytes = Vec::new();
    response.serialize(&mut bytes).unwrap();
    assert_eq!(bytes.len(), RESPONSE_BYTES);
    assert_eq!(
        validate_response(&producer, &producer, &bytes, &response).unwrap(),
        response
    );
    assert_eq!(
        validate_response(&producer, &s.owner, &bytes, &response),
        Err(QuoteError::Producer)
    );
    for i in 0..bytes.len() {
        let mut bad = bytes.clone();
        bad[i] ^= 1;
        assert!(validate_response(&producer, &producer, &bad, &response).is_err());
    }
    assert!(validate_response(&producer, &producer, &bytes[..bytes.len() - 1], &response).is_err());
    let mut extra = bytes.clone();
    extra.push(0);
    assert!(validate_response(&producer, &producer, &extra, &response).is_err());
}
