//! Anchor-compatible event CPI with one bounded allocation for larger V2 pages.
//! The stock macro grows the payload Vec, concatenates it, then copies it into an
//! Instruction. Solana's default allocator cannot reclaim those intermediate Vecs.
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_lang::{prelude::*, Event};

const MAX_GROUP_EVENT_BYTES: usize = 8_192;

struct PayloadSize(usize);
impl std::io::Write for PayloadSize {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0 = self
            .0
            .checked_add(bytes.len())
            .filter(|size| *size <= MAX_GROUP_EVENT_BYTES)
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "group event exceeds bounded CPI payload",
                )
            })?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn payload<T: Event>(event: &T) -> Result<Vec<u8>> {
    let mut size = PayloadSize(anchor_lang::event::EVENT_IX_TAG_LE.len() + T::DISCRIMINATOR.len());
    event.serialize(&mut size)?;
    let mut bytes = Vec::with_capacity(size.0);
    bytes.extend_from_slice(anchor_lang::event::EVENT_IX_TAG_LE);
    bytes.extend_from_slice(T::DISCRIMINATOR);
    event.serialize(&mut bytes)?;
    Ok(bytes)
}

/// Same program, event tag, discriminator, read-only authority signer and PDA
/// seeds as Anchor 1.2.1's emit_cpi!. The payload moves into the CPI instruction.
pub(crate) fn emit<T: Event>(event: &T, authority: AccountInfo) -> Result<()> {
    require_keys_eq!(
        *authority.key,
        crate::EVENT_AUTHORITY_AND_BUMP.0,
        crate::error::ClearingError::Authority
    );
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: vec![AccountMeta::new_readonly(*authority.key, true)],
        data: payload(event)?,
    };
    invoke_signed(
        &instruction,
        &[authority],
        &[&[b"__event_authority", &[crate::EVENT_AUTHORITY_AND_BUMP.1]]],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preallocated_payload_matches_anchor_event_bytes() {
        let event = crate::events::GroupResolutionProgressV2 {
            group: Pubkey::new_unique(),
            sequence: 9,
            slot: 17,
            kind: 1,
            mode: 3,
            paused: true,
            terms_epoch: 2,
            config_epoch: 2,
            markets: [
                crate::events::GroupMarketSnapshotV2::from(
                    &crate::state::v2::GroupMarketV2::default(),
                ),
                crate::events::GroupMarketSnapshotV2::from(
                    &crate::state::v2::GroupMarketV2::default(),
                ),
            ],
            header: crate::state::v2::GroupResolutionHeaderV2::default(),
            rows: (0..4)
                .map(|id| crate::events::GroupResolutionUpdateV2 {
                    id,
                    row: crate::state::v2::GroupResolutionRowV2::default(),
                })
                .collect(),
            roots: (0..4)
                .map(|_| {
                    crate::events::MarginAccountSnapshotV2::from(
                        &crate::state::v2::MarginAccountV2::default(),
                    )
                })
                .collect(),
            total_cash: 10,
            settlement: 2,
            insurance: 3,
            fees: 1,
            allocated_vault: 16,
            actual_vault: 16,
        };
        let expected = [anchor_lang::event::EVENT_IX_TAG_LE, event.data().as_slice()].concat();
        assert_eq!(payload(&event).unwrap(), expected);
    }
}
