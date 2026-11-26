//! Replay one root's finalized, two-market account bytes through the candidate
//! directory. Each manifest row gives a snapshot filename and expected bindings.
use anchor_lang::AccountDeserialize;
use clearing::state::{
    accounts::{MarginAccount, MARGIN_ALLOCATION, MARGIN_PREFIX, SCHEMA_VERSION},
    identity::{MODE_CROSS, MODE_ISOLATED},
};
use clearing_accounting::{
    entry_cost::EntryCost,
    market_slots::{MarketImage, MarketSlots},
    Error, Mode, Position,
};
use std::{fs, path::PathBuf};

fn main() {
    let manifest = PathBuf::from(std::env::args().nth(1).expect("snapshot manifest"));
    let mut directory = None;
    let mut previous = None;
    let mut retired = Vec::new();
    let rows = fs::read_to_string(&manifest).unwrap();
    assert!(!rows.is_empty());
    for row in rows.lines() {
        let (filename, expected) = row.split_once('\t').unwrap();
        let bytes = fs::read(manifest.parent().unwrap().join(filename)).unwrap();
        assert_eq!(bytes.len(), MARGIN_ALLOCATION);
        let root = MarginAccount::try_deserialize(&mut &bytes[..MARGIN_PREFIX]).unwrap();
        assert_eq!(root.schema_version, SCHEMA_VERSION);
        assert_eq!(&bytes[MARGIN_PREFIX..MARGIN_PREFIX + 8], b"RVPROF03");
        let identity = (
            root.venue,
            root.portfolio,
            root.id,
            root.activation_generation,
            root.mode,
            root.isolated_market_index,
        );
        if let Some((old_identity, revision, prior_bytes)) = previous {
            assert_eq!(old_identity, identity);
            assert!(
                root.revision > revision || (root.revision == revision && bytes == prior_bytes)
            );
        }
        let mode = match root.mode {
            MODE_CROSS => Mode::Cross,
            MODE_ISOLATED => Mode::Isolated(usize::from(root.isolated_market_index)),
            _ => panic!("invalid margin mode"),
        };
        let book = directory.get_or_insert_with(|| MarketSlots::new(mode, root.positions.len()));
        let costs = bytes[MARGIN_PREFIX + 8..].chunks_exact(EntryCost::BYTES);
        let images: Vec<_> = root
            .positions
            .iter()
            .zip(costs)
            .enumerate()
            .map(|(index, (position, cost))| MarketImage {
                market: u16::try_from(index).unwrap(),
                position: Position {
                    lots: position.lots,
                    virtual_scaled: position.virtual_scaled,
                    funding_checkpoint: position.funding_checkpoint_scaled,
                    generation: position.generation,
                },
                entry: EntryCost::read(cost, position.lots).unwrap(),
            })
            .collect();
        let orders: Vec<_> = root
            .book
            .orders
            .iter()
            .filter(|row| row.order.active())
            .map(|row| u16::from(row.market_index))
            .collect();
        let next = book.successor(&images, &orders).unwrap();
        let bindings: Vec<_> = next
            .records()
            .iter()
            .map(|(binding, stored)| {
                assert_eq!(stored, &images[usize::from(binding.market)]);
                format!("{}={}", binding.market, binding.incarnation)
            })
            .collect();
        assert_eq!(bindings.join(","), expected, "{filename}");
        for (old, _) in book.records() {
            if next.records().iter().all(|(binding, _)| binding != old) {
                retired.push(*old);
            }
        }
        for old in &retired {
            assert_eq!(next.resolve(*old), Err(Error::Generation), "{filename}");
        }
        *book = next;
        previous = Some((identity, root.revision, bytes));
    }
    println!(
        "Verified {} finalized snapshots from {}",
        rows.lines().count(),
        manifest.display()
    );
}
