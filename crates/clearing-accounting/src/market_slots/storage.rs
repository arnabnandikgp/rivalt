//! Wire format for listed markets in a venue margin PDA. BTC and ETH live in
//! the existing prefix. Cash and order reservations live there exactly once.
use super::{Binding, EntryCost, Error, MarketImage, MarketSlots, Mode, Position, Result, Vec};

pub const MAGIC: &[u8; 8] = b"RVMKTS01";
pub const HEADER_BYTES: usize = 18;
pub const RECORD_BYTES: usize = 58 + EntryCost::BYTES;
pub const FIRST_LISTED_MARKET: u16 = 2;

fn capacity(bytes: &[u8]) -> Result<usize> {
    let records = bytes.len().checked_sub(HEADER_BYTES).ok_or(Error::Bounds)?;
    if records == 0 || records % RECORD_BYTES != 0 || records / RECORD_BYTES > usize::from(u16::MAX)
    {
        return Err(Error::Bounds);
    }
    Ok(records / RECORD_BYTES)
}

/// Legacy instructions may read a wider root only while its directory is empty.
/// An empty directory may retain a nonzero incarnation counter after a close.
pub fn require_empty(bytes: &[u8]) -> Result<()> {
    capacity(bytes)?;
    if !bytes.starts_with(MAGIC) || bytes[16..].iter().any(|byte| *byte != 0) {
        return Err(Error::Invariant);
    }
    Ok(())
}

impl MarketSlots {
    pub fn from_listed_bytes(bytes: &[u8], mode: Mode, live_order_markets: &[u16]) -> Result<Self> {
        let capacity = capacity(bytes)?;
        if !bytes.starts_with(MAGIC) {
            return Err(Error::Invariant);
        }
        let last = u64::from_le_bytes(bytes[8..16].try_into().unwrap());
        let count = usize::from(u16::from_le_bytes(bytes[16..18].try_into().unwrap()));
        if count > capacity {
            return Err(Error::Bounds);
        }
        let (populated, spare) = bytes[HEADER_BYTES..].split_at(count * RECORD_BYTES);
        if spare.iter().any(|byte| *byte != 0) {
            return Err(Error::Invariant);
        }
        let mut records = Vec::with_capacity(count);
        for row in populated.chunks_exact(RECORD_BYTES) {
            let market = u16::from_le_bytes(row[..2].try_into().unwrap());
            if market < FIRST_LISTED_MARKET {
                return Err(Error::Invariant);
            }
            let incarnation = u64::from_le_bytes(row[2..10].try_into().unwrap());
            let position = Position {
                lots: i64::from_le_bytes(row[10..18].try_into().unwrap()),
                virtual_scaled: i128::from_le_bytes(row[18..34].try_into().unwrap()),
                funding_checkpoint: i128::from_le_bytes(row[34..50].try_into().unwrap()),
                generation: u64::from_le_bytes(row[50..58].try_into().unwrap()),
            };
            let entry = EntryCost::read(&row[58..], position.lots)?;
            records.push((
                Binding {
                    market,
                    incarnation,
                },
                MarketImage {
                    market,
                    position,
                    entry,
                },
            ));
        }
        Self::restore(mode, capacity, last, records, live_order_markets)
    }

    pub fn write_listed_bytes(&self, bytes: &mut [u8]) -> Result<()> {
        if capacity(bytes)? != self.capacity
            || self
                .records
                .iter()
                .any(|(key, _)| key.market < FIRST_LISTED_MARKET)
        {
            return Err(Error::Bounds);
        }
        bytes[..8].copy_from_slice(MAGIC);
        bytes[8..16].copy_from_slice(&self.last_incarnation.to_le_bytes());
        bytes[16..18].copy_from_slice(&(self.records.len() as u16).to_le_bytes());
        let (populated, spare) =
            bytes[HEADER_BYTES..].split_at_mut(self.records.len() * RECORD_BYTES);
        spare.fill(0);
        for ((binding, image), row) in self
            .records
            .iter()
            .zip(populated.chunks_exact_mut(RECORD_BYTES))
        {
            row[..2].copy_from_slice(&binding.market.to_le_bytes());
            row[2..10].copy_from_slice(&binding.incarnation.to_le_bytes());
            row[10..18].copy_from_slice(&image.position.lots.to_le_bytes());
            row[18..34].copy_from_slice(&image.position.virtual_scaled.to_le_bytes());
            row[34..50].copy_from_slice(&image.position.funding_checkpoint.to_le_bytes());
            row[50..58].copy_from_slice(&image.position.generation.to_le_bytes());
            image.entry.write(&mut row[58..])?;
        }
        Ok(())
    }
}
