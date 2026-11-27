#![cfg(feature = "surviving-profit")]

use clearing_accounting::{
    entry_cost::EntryCost,
    market_slots::{MarketImage, MarketSlots},
    Error, Mode, Position, SCALE,
};

fn flat(market: u16, claim: i128) -> MarketImage {
    MarketImage {
        market,
        position: Position {
            virtual_scaled: claim,
            ..Position::default()
        },
        entry: EntryCost::default(),
    }
}

#[test]
fn fractions_and_each_remaining_order_keep_the_binding() {
    for residue in [-1, 1] {
        let empty = MarketSlots::new(Mode::Cross, 1);
        let opened = MarketImage {
            market: 50_000,
            position: Position {
                lots: 2,
                virtual_scaled: -201 * SCALE,
                generation: 1,
                ..Position::default()
            },
            entry: EntryCost::default().fill(0, 2, 201).unwrap(),
        };
        let book = empty.successor(&[opened], &[]).unwrap();
        let binding = book.records()[0].0;
        let closed = flat(opened.market, residue);
        let book = book.successor(&[closed], &[]).unwrap();
        assert_eq!(book.resolve(binding).unwrap(), &closed);
        assert_eq!(book.successor(&[], &[]), Err(Error::Invariant));
        let cleared = flat(opened.market, 0);
        let protected = book
            .successor(&[cleared], &[opened.market, opened.market])
            .unwrap();
        let one_child = protected.successor(&[cleared], &[opened.market]).unwrap();
        assert!(one_child.resolve(binding).is_ok());
        let vacant = one_child.successor(&[cleared], &[]).unwrap();
        assert_eq!(vacant.resolve(binding), Err(Error::Generation));
        let reopened = vacant.successor(&[opened], &[]).unwrap();
        assert_eq!(reopened.resolve(binding), Err(Error::Generation));
        assert_eq!(reopened.records()[0].1, opened);
    }
}

#[test]
fn saturated_book_reuses_a_discharged_slot_in_either_market_order() {
    for width in [2usize, 4, 8] {
        let start: Vec<_> = (0..width).map(|i| flat(200 + 5 * i as u16, -1)).collect();
        let full = MarketSlots::new(Mode::Cross, width)
            .successor(&start, &[])
            .unwrap();
        for replacement in [3, 65_000] {
            let mut input = start.clone();
            input.push(flat(replacement, 0));
            input.sort_by_key(|image| image.market);
            assert_eq!(full.successor(&input, &[replacement]), Err(Error::Bounds));
            let released = start[width / 2].market;
            let old = full.records()[width / 2].0;
            input
                .iter_mut()
                .find(|i| i.market == released)
                .unwrap()
                .position
                .virtual_scaled = 0;
            let next = full.successor(&input, &[replacement]).unwrap();
            assert_eq!(next.records().len(), width);
            assert_eq!(next.resolve(old), Err(Error::Generation));
            assert_eq!(
                next.records()
                    .iter()
                    .find(|(key, _)| key.market == replacement)
                    .unwrap()
                    .0
                    .incarnation,
                width as u64 + 1
            );
            for (binding, image) in full
                .records()
                .iter()
                .filter(|(key, _)| key.market != released)
            {
                assert_eq!(next.resolve(*binding).unwrap(), image);
            }
        }
    }
}

#[test]
fn complete_sorted_books_and_isolation_are_required() {
    let empty = MarketSlots::new(Mode::Isolated(427), 1);
    let own = flat(427, -1);
    assert_eq!(empty.successor(&[own], &[404]), Err(Error::Invariant));
    assert_eq!(empty.successor(&[flat(428, 1)], &[]), Err(Error::Bounds));
    assert_eq!(empty.successor(&[flat(428, 0)], &[428]), Err(Error::Bounds));
    assert_eq!(empty.successor(&[own, own], &[]), Err(Error::Invariant));
    assert_eq!(
        empty.successor(&[own, flat(3, 0)], &[]),
        Err(Error::Invariant)
    );
    let book = empty.successor(&[own], &[]).unwrap();
    for missing in [3, 65_000] {
        assert_eq!(
            book.successor(&[flat(missing, 0)], &[]),
            Err(Error::Invariant)
        );
    }
    let stale_basis = MarketImage {
        entry: EntryCost::default().fill(0, 1, 100).unwrap(),
        ..flat(427, 0)
    };
    assert_eq!(book.successor(&[stale_basis], &[]), Err(Error::Invariant));
    assert_eq!(book.records()[0].1, own);
}

#[test]
fn restored_bindings_preserve_retired_numbers_and_reject_inconsistent_records() {
    let empty = MarketSlots::new(Mode::Cross, 2);
    let full = empty.successor(&[flat(3, -1), flat(43, 0)], &[43]).unwrap();
    let retired = full.records()[1].0;
    let live = full.successor(&[flat(3, -1), flat(43, 0)], &[]).unwrap();
    let restored = MarketSlots::restore(
        Mode::Cross,
        2,
        live.last_incarnation(),
        live.records().to_vec(),
        &[],
    )
    .unwrap();
    assert_eq!(restored, live);
    let reopened = restored
        .successor(&[flat(3, -1), flat(43, 0)], &[43])
        .unwrap();
    assert_eq!(reopened.resolve(retired), Err(Error::Generation));
    assert_eq!(reopened.last_incarnation(), 3);

    let records = full.records().to_vec();
    let restore = |records, counter, orders: &[u16]| {
        MarketSlots::restore(Mode::Cross, 2, counter, records, orders)
    };
    assert!(restore(records.clone(), 1, &[43]).is_err());
    assert!(restore(records.clone(), 2, &[3]).is_err());
    assert!(restore(records.clone(), 2, &[43, 73]).is_err());
    let mut duplicate = records.clone();
    duplicate[1].0.incarnation = duplicate[0].0.incarnation;
    assert!(restore(duplicate, 2, &[43]).is_err());
    let mut reversed = records.clone();
    reversed.reverse();
    assert!(restore(reversed, 2, &[43]).is_err());
    let mut foreign = records.clone();
    foreign[1].0.market = 42;
    assert!(restore(foreign, 2, &[43]).is_err());
    let exhausted = restore(records, u64::MAX, &[43]).unwrap();
    assert_eq!(
        exhausted.successor(&[flat(3, -1), flat(43, 0), flat(99, 1)], &[]),
        Err(Error::Overflow)
    );
}

#[test]
fn listed_wire_keeps_full_market_ids_and_fractional_debts_in_the_original_root() {
    use clearing_accounting::market_slots::storage::{require_empty, HEADER_BYTES, RECORD_BYTES};
    let mut bytes = vec![0xa5; HEADER_BYTES + 2 * RECORD_BYTES];
    let first = flat(258, -1);
    let last = MarketImage {
        market: u16::MAX,
        position: Position {
            lots: -2,
            virtual_scaled: 201 * SCALE,
            funding_checkpoint: -9,
            generation: 4,
        },
        entry: EntryCost::default().fill(0, -2, 201).unwrap(),
    };
    let start = MarketSlots::new(Mode::Cross, 2);
    let book = start.successor(&[first, last], &[]).unwrap();
    book.write_listed_bytes(&mut bytes).unwrap();
    assert_eq!(bytes.len(), 214);
    assert_eq!(&bytes[..18], b"RVMKTS01\x02\0\0\0\0\0\0\0\x02\0");
    assert_eq!(&bytes[18..20], &[2, 1]);
    assert_eq!(&bytes[36..52], &[255; 16]);
    assert_eq!(&bytes[116..118], &[255, 255]);
    assert_eq!(
        MarketSlots::from_listed_bytes(&bytes, Mode::Cross, &[]).unwrap(),
        book
    );
    assert!(require_empty(&bytes).is_err());
    assert!(MarketSlots::from_listed_bytes(&bytes, Mode::Isolated(258), &[]).is_err());
    for (offset, replacement) in [
        (0, &[0][..]),
        (16, &[3]),
        (18, &[1, 0]),
        (20, &[3]),
        (118, &[1]),
        (174, &[0; 40]),
    ] {
        let mut bad = bytes.clone();
        bad[offset..offset + replacement.len()].copy_from_slice(replacement);
        assert!(
            MarketSlots::from_listed_bytes(&bad, Mode::Cross, &[]).is_err(),
            "offset {offset}"
        );
    }
    let empty = book
        .successor(&[flat(258, 0), flat(u16::MAX, 0)], &[])
        .unwrap();
    empty.write_listed_bytes(&mut bytes).unwrap();
    require_empty(&bytes).unwrap();
    assert_eq!(
        MarketSlots::from_listed_bytes(&bytes, Mode::Cross, &[])
            .unwrap()
            .last_incarnation(),
        2
    );
    assert!(bytes[16..].iter().all(|&byte| byte == 0));
    *bytes.last_mut().unwrap() = 1;
    assert!(require_empty(&bytes).is_err());
    assert!(MarketSlots::from_listed_bytes(&bytes, Mode::Cross, &[]).is_err());
}
