//! Shared serialized position/order records, independent of deployment generation.
use anchor_lang::prelude::*;
use super::{OrderRecord, ProtectiveGroup};
use super::identity::{MARKET_COUNT, MAX_MEMBERS};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Position {
    pub lots: i64,
    pub virtual_scaled: i128,
    pub funding_checkpoint_scaled: i128,
    pub generation: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct StoredOrder {
    pub market_index: u8,
    /// Zero for owner-created authority, otherwise the root's delegate epoch.
    pub delegate_epoch: u64,
    pub order: OrderRecord,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Protection {
    pub market_index: u8,
    pub protection: ProtectiveGroup,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct OrderBook {
    pub last_order_id: u64,
    pub last_group_id: u64,
    pub reserve_observations: [u64; MARKET_COUNT],
    pub orders: [StoredOrder; 4],
    pub protections: [Protection; 2],
}


/// Borsh's generic Vec reader grows its allocation while decoding. The SBF
/// bump allocator cannot reclaim those buffers. Allocate the bounded cohort once
/// while retaining precisely the same u32-length + element wire representation.
pub(crate) fn deserialize_cohort<R: std::io::Read, T: AnchorDeserialize>(
    reader: &mut R,
) -> std::io::Result<Vec<T>> {
    let count = u32::deserialize_reader(reader)? as usize;
    if count > MAX_MEMBERS {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "group cohort exceeds 64 members",
        ));
    }
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        entries.push(T::deserialize_reader(reader)?);
    }
    Ok(entries)
}
