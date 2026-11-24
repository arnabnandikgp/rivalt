//! Native experiment: authenticate a closed-quantity entry history before valuing it.
//! The freeze supplies the anchor, limits and valuation inputs. Only the witness is replaceable.
use clearing_accounting::attribution::Attribution;
use financial_core::{MAX_LOTS, MAX_PRICE, MAX_SCALED};
use serde::{Deserialize, Serialize};
use solana_sha256_hasher::hashv;
use std::io::{self, BufRead};

const CHECKPOINT_TAG: &[u8] = b"Rivalt/entry-replay/checkpoint/v1\0";
const FILL_TAG: &[u8] = b"Rivalt/entry-replay/fill/v1\0";

mod decimal {
    use serde::{de::Error, Deserialize, Deserializer, Serializer};
    use std::{fmt::Display, str::FromStr};

    pub fn serialize<T: Display, S: Serializer>(
        value: &T,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serializer.collect_str(value)
    }

    pub fn deserialize<'de, T: FromStr, D: Deserializer<'de>>(data: D) -> Result<T, D::Error>
    where
        T::Err: Display,
    {
        String::deserialize(data)?.parse().map_err(D::Error::custom)
    }
}

#[derive(Deserialize)]
struct Snapshot {
    domain: [u8; 32],
    tip: [u8; 32],
    #[serde(with = "decimal")]
    sequence: u64,
    #[serde(with = "decimal")]
    lots: i64,
    #[serde(with = "decimal")]
    claim_scaled: i128,
    #[serde(with = "decimal")]
    mark: u64,
    #[serde(with = "decimal")]
    matched: u64,
}

#[derive(Deserialize, Serialize)]
struct Checkpoint {
    #[serde(with = "decimal")]
    sequence: u64,
    #[serde(with = "decimal")]
    lots: i64,
    entry: Vec<u8>,
}

impl Checkpoint {
    fn digest(&self, domain: &[u8; 32]) -> [u8; 32] {
        hashv(&[
            CHECKPOINT_TAG,
            domain,
            &self.sequence.to_le_bytes(),
            &self.lots.to_le_bytes(),
            &self.entry,
        ])
        .to_bytes()
    }
}

#[derive(Deserialize)]
struct Fill {
    #[serde(with = "decimal")]
    delta: i64,
    #[serde(with = "decimal")]
    gross: u64,
}

impl Fill {
    fn extend(&self, preceding: &[u8; 32]) -> [u8; 32] {
        hashv(&[
            FILL_TAG,
            preceding,
            &self.delta.to_le_bytes(),
            &self.gross.to_le_bytes(),
        ])
        .to_bytes()
    }
}

#[derive(Deserialize)]
struct Witness {
    checkpoint: Checkpoint,
    fills: Vec<Fill>,
}

#[derive(Deserialize)]
struct Budget {
    fills: usize,
    entry_bytes: usize,
}

#[derive(Deserialize)]
struct Request {
    snapshot: Snapshot,
    witness: Witness,
    budget: Budget,
}

#[derive(Serialize)]
struct Verified {
    #[serde(with = "decimal")]
    ordinary: u64,
    #[serde(with = "decimal")]
    forced: u64,
    peak_entry_bytes: usize,
    // The checkpoint and its digest may seed the next segment only after success.
    checkpoint: Checkpoint,
    checkpoint_digest: [u8; 32],
}

fn record_len(lots: i64, bytes: &[u8]) -> Option<usize> {
    if lots == 0 {
        return Some(0);
    }
    let sizes = bytes
        .get(..6)?
        .chunks_exact(2)
        .map(|pair| usize::from(u16::from_le_bytes([pair[0], pair[1]])));
    Some(6 + sizes.sum::<usize>())
}

fn verify(request: Request) -> Result<Verified, &'static str> {
    let Request {
        snapshot,
        witness,
        budget,
    } = request;
    let Witness { checkpoint, fills } = witness;
    // These ceilings meter logical work in this native experiment. The byte cap
    // covers serialized exact state, including intermediate positions before a close.
    if fills.len() > budget.fills {
        return Err("fill budget");
    }
    if checkpoint.entry.len() > budget.entry_bytes {
        return Err("entry budget");
    }
    if checkpoint.sequence.checked_add(fills.len() as u64) != Some(snapshot.sequence) {
        return Err("incomplete sequence");
    }
    let mut tip = checkpoint.digest(&snapshot.domain);
    for fill in &fills {
        tip = fill.extend(&tip);
    }
    if tip != snapshot.tip {
        return Err("commitment mismatch");
    }

    let mut lots = checkpoint.lots;
    if record_len(lots, &checkpoint.entry) != Some(checkpoint.entry.len()) {
        return Err("invalid checkpoint width");
    }
    let mut entry = Attribution::read(&checkpoint.entry, lots).map_err(|_| "invalid checkpoint")?;
    let mut used = checkpoint.entry.len();
    let mut peak = used;
    let mut storage = checkpoint.entry;
    storage.resize(budget.entry_bytes, 0);
    for fill in fills {
        let count = fill.delta.unsigned_abs();
        let next = lots.checked_add(fill.delta).ok_or("invalid lots")?;
        if count == 0
            || count > MAX_LOTS as u64
            || next.unsigned_abs() > MAX_LOTS as u64
            || fill.gross < count
            || fill.gross > count * MAX_PRICE
        {
            return Err("invalid fill");
        }
        entry = entry
            .fill(lots, next, fill.gross)
            .map_err(|_| "invalid transition")?;
        lots = next;
        entry.write(&mut storage).map_err(|_| "entry budget")?;
        used = record_len(lots, &storage).ok_or("invalid entry")?;
        peak = peak.max(used);
    }
    let claim = snapshot.claim_scaled;
    if lots != snapshot.lots
        || claim.unsigned_abs() > MAX_SCALED as u128
        || !(1..=MAX_PRICE).contains(&snapshot.mark)
        || snapshot.matched > lots.unsigned_abs()
    {
        return Err("invalid terminal snapshot");
    }
    let ordinary = entry
        .closed_quantity_payment_cap(lots, snapshot.mark, claim)
        .map_err(|_| "invalid ordinary ceiling")?;
    let forced = entry
        .charge_cap(lots, snapshot.mark, claim, snapshot.matched)
        .map_err(|_| "invalid forced ceiling")?;
    storage.truncate(used);
    let checkpoint = Checkpoint {
        sequence: snapshot.sequence,
        lots,
        entry: storage,
    };
    Ok(Verified {
        ordinary,
        forced,
        peak_entry_bytes: peak,
        checkpoint_digest: checkpoint.digest(&snapshot.domain),
        checkpoint,
    })
}

fn main() {
    for line in io::stdin().lock().lines() {
        let request = serde_json::from_str(&line.unwrap()).expect("invalid experiment request");
        match verify(request) {
            Ok(result) => println!("{}", serde_json::to_string(&result).unwrap()),
            Err(reason) => println!("{}", serde_json::json!({ "error": reason })),
        }
    }
}
