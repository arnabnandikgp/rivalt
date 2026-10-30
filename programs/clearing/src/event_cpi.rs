//! Anchor-compatible event CPI with one bounded allocation for current events.
//! The stock macro grows the payload Vec, concatenates it, then copies it into an
//! Instruction. Solana's default allocator cannot reclaim those intermediate Vecs.
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_lang::{prelude::*, Event};

const MAX_EVENT_BYTES: usize = 8_192;

/// Invocation-local count of successfully emitted financial payloads. It is
/// passed explicitly through handlers; no account or global counter is written.
#[derive(Default)]
pub struct Payloads {
    count: u16,
}

impl Payloads {
    pub fn count(&self) -> u16 {
        self.count
    }

    pub fn emit<T: Event>(&mut self, event: &T, authority: AccountInfo) -> Result<()> {
        self.emit_borrowed::<T, T>(event, authority)
    }

    pub fn emit_borrowed<T: Event, S: AnchorSerialize>(
        &mut self,
        event: &S,
        authority: AccountInfo,
    ) -> Result<()> {
        require!(self.count < 4, crate::error::ClearingError::Profile);
        emit_borrowed::<T, S>(event, authority)?;
        self.count += 1;
        Ok(())
    }
}

struct PayloadSize(usize);
impl std::io::Write for PayloadSize {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0 = self
            .0
            .checked_add(bytes.len())
            .filter(|size| *size <= MAX_EVENT_BYTES)
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "event exceeds bounded CPI payload",
                )
            })?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn payload<T: AnchorSerialize>(event: &T, discriminator: &[u8]) -> Result<Vec<u8>> {
    let mut size = PayloadSize(anchor_lang::event::EVENT_IX_TAG_LE.len() + discriminator.len());
    event.serialize(&mut size)?;
    let mut bytes = Vec::with_capacity(size.0);
    bytes.extend_from_slice(anchor_lang::event::EVENT_IX_TAG_LE);
    bytes.extend_from_slice(discriminator);
    event.serialize(&mut bytes)?;
    Ok(bytes)
}

/// Same program, event tag, discriminator, read-only authority signer and PDA
/// seeds as Anchor 1.2.1's emit_cpi!. The payload moves into the CPI instruction.
pub(crate) fn emit<T: Event>(event: &T, authority: AccountInfo) -> Result<()> {
    emit_borrowed::<T, T>(event, authority)
}

/// Borrowed views avoid duplicating large fixed account snapshots on the SBF
/// bump heap. The caller must prove exact serialization parity with the IDL event.
pub(crate) fn emit_borrowed<T: Event, S: AnchorSerialize>(
    event: &S,
    authority: AccountInfo,
) -> Result<()> {
    require_keys_eq!(
        *authority.key,
        crate::EVENT_AUTHORITY_AND_BUMP.0,
        crate::error::ClearingError::Authority
    );
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: vec![AccountMeta::new_readonly(*authority.key, true)],
        data: payload(event, T::DISCRIMINATOR)?,
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
        use crate::events::{AccountResolutionApplied, MarginAccountSnapshot};
        let event = AccountResolutionApplied {
            venue: Pubkey::new_unique(),
            slot: 17,
            epoch: 3,
            id: 1,
            member: Pubkey::new_unique(),
            flows: [4, 5],
            cash_before: 20,
            cash_after: 29,
            remaining_cash: 50,
            applied_cash: 29,
            remaining_lots: [-2, 3],
            remaining_gross: [4, 6],
            remaining_claims: [-7, 8],
            state: MarginAccountSnapshot::from(&crate::state::accounts::MarginAccount::default()),
        };
        let expected = [anchor_lang::event::EVENT_IX_TAG_LE, event.data().as_slice()].concat();
        assert!(expected.len() > 1_000);
        assert_eq!(
            payload(&event, AccountResolutionApplied::DISCRIMINATOR).unwrap(),
            expected
        );
    }
}
