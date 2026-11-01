//! Shared serialized position/order records, independent of deployment generation.
use super::identity::{MARKET_COUNT, MAX_MEMBERS};
use super::{OrderRecord, ProtectiveGroup};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType)]
pub struct Position {
    pub lots: i64,
    pub virtual_scaled: i128,
    pub funding_checkpoint_scaled: i128,
    pub generation: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType)]
pub struct StoredOrder {
    pub market_index: u8,
    /// Zero for owner-created authority, otherwise the root's delegate epoch.
    pub delegate_epoch: u64,
    pub order: OrderRecord,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType)]
pub struct Protection {
    pub market_index: u8,
    pub protection: ProtectiveGroup,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, IdlType)]
pub struct OrderBook {
    pub last_order_id: u64,
    pub last_group_id: u64,
    pub reserve_observations: [u64; MARKET_COUNT],
    pub orders: [StoredOrder; 4],
    pub protections: [Protection; 2],
}

/// Validate the cohort prefix before Wincode allocates its single Vec buffer.
/// The codec sees the payload after the discriminator. Its length prefix follows
/// schema, revision, venue, membership version and declared member count.
pub struct RegistryCodec;
pub type RegistryAccount =
    anchor_lang::accounts::SerializedAccount<super::accounts::VenueRegistry, RegistryCodec>;

impl anchor_lang::accounts::AnchorAccountSerialize<super::accounts::VenueRegistry>
    for RegistryCodec
{
    fn serialize(value: &super::accounts::VenueRegistry, bytes: &mut &mut [u8]) -> Result<()> {
        require!(
            value.members.len() <= MAX_MEMBERS,
            crate::ClearingError::Profile
        );
        anchor_lang::accounts::BorshSerializer::serialize(value, bytes)
    }

    fn deserialize(bytes: &mut &[u8]) -> Result<super::accounts::VenueRegistry> {
        const PREFIX_OFFSET: usize = 2 + 8 + 32 + 8 + 2;
        let prefix = bytes
            .get(PREFIX_OFFSET..PREFIX_OFFSET + 4)
            .ok_or(ProgramError::InvalidAccountData)?;
        let count = u32::from_le_bytes(
            prefix
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        ) as usize;
        require!(count <= MAX_MEMBERS, crate::ClearingError::Profile);
        anchor_lang::accounts::BorshSerializer::deserialize(bytes)
    }
}

#[cfg(test)]
mod registry_codec_tests {
    use super::*;
    use anchor_lang::accounts::AnchorAccountSerialize;

    fn literal_payload(count: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&8u16.to_le_bytes());
        bytes.extend_from_slice(&9u64.to_le_bytes());
        bytes.extend_from_slice(&[11; 32]);
        bytes.extend_from_slice(&12u64.to_le_bytes());
        bytes.extend_from_slice(&(count as u16).to_le_bytes());
        bytes.extend_from_slice(&count.to_le_bytes());
        for member in 0..count {
            bytes.extend_from_slice(&[member as u8; 32]);
        }
        bytes.push(253);
        bytes
    }

    #[test]
    fn bounded_registry_decodes_literal_empty_and_maximum_vectors() {
        for count in [0, 1, 64] {
            let bytes = literal_payload(count);
            let mut cursor = bytes.as_slice();
            let registry = RegistryCodec::deserialize(&mut cursor).unwrap();
            assert!(cursor.is_empty());
            assert_eq!(registry.members.len(), count as usize);
            assert_eq!(
                (registry.schema_version, registry.revision, registry.membership_version),
                (8, 9, 12)
            );
            assert_eq!(registry.venue, Address::new_from_array([11; 32]));
            assert_eq!(registry.bump, 253);
            for (index, member) in registry.members.iter().enumerate() {
                assert_eq!(*member, Address::new_from_array([index as u8; 32]));
            }
            let mut actual = vec![0; bytes.len()];
            RegistryCodec::serialize(&registry, &mut actual.as_mut_slice()).unwrap();
            assert_eq!(actual, bytes);
        }
    }

    #[test]
    fn registry_rejects_oversized_prefix_before_reading_members() {
        for count in [65, u32::MAX] {
            let mut prefix = literal_payload(0);
            prefix[52..56].copy_from_slice(&count.to_le_bytes());
            prefix.truncate(56); // no member bytes: must fail the bound first
            assert!(matches!(RegistryCodec::deserialize(&mut prefix.as_slice()),
                Err(error) if error == ProgramError::from(crate::ClearingError::Profile)));
        }
        let bytes = literal_payload(64);
        for length in 0..bytes.len() {
            assert!(RegistryCodec::deserialize(&mut &bytes[..length]).is_err());
        }
    }
}
