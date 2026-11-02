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

    pub fn emit<T: Event + SchemaWrite<anchor_lang::BorshConfig, Src = T>>(
        &mut self,
        event: &T,
        authority: AccountView,
    ) -> Result<()> {
        self.emit_borrowed::<T, T>(event, authority)
    }

    pub fn emit_borrowed<T: Event, S: SchemaWrite<anchor_lang::BorshConfig, Src = S>>(
        &mut self,
        event: &S,
        authority: AccountView,
    ) -> Result<()> {
        require!(self.count < 4, crate::error::ClearingError::Profile);
        emit_borrowed::<T, S>(event, authority)?;
        self.count += 1;
        Ok(())
    }
}

fn payload<T: SchemaWrite<anchor_lang::BorshConfig, Src = T>>(
    event: &T,
    discriminator: &[u8],
) -> Result<Vec<u8>> {
    profile_cu!("payload-size-enter");
    let payload_size = T::size_of(event).map_err(|_| ProgramError::InvalidInstructionData)?;
    let prefix_size = anchor_lang::event::EVENT_IX_TAG_LE.len() + discriminator.len();
    let size = prefix_size
        .checked_add(payload_size)
        .filter(|size| *size <= MAX_EVENT_BYTES)
        .ok_or(ProgramError::InvalidInstructionData)?;
    profile_cu!("payload-size-exit");
    let mut bytes = vec![0; size];
    bytes[..8].copy_from_slice(anchor_lang::event::EVENT_IX_TAG_LE);
    bytes[8..prefix_size].copy_from_slice(discriminator);
    let mut output = &mut bytes[prefix_size..];
    T::write(&mut output, event).map_err(|_| ProgramError::InvalidInstructionData)?;
    require!(output.is_empty(), crate::ClearingError::Profile);
    profile_cu!("payload-encoded");
    Ok(bytes)
}

/// Borrowed views avoid duplicating large fixed account snapshots on the SBF
/// bump heap. The caller must prove exact serialization parity with the IDL event.
/// Same program, tag, readonly authority signer and seeds as emit_cpi!; the
/// bounded payload moves directly into the CPI instruction.
pub(crate) fn emit_borrowed<T: Event, S: SchemaWrite<anchor_lang::BorshConfig, Src = S>>(
    event: &S,
    authority: AccountView,
) -> Result<()> {
    let (expected_authority, bump) = find_program_address(&[b"__event_authority"], &crate::ID);
    require_keys_eq!(
        *authority.address(),
        expected_authority,
        crate::error::ClearingError::Authority
    );
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: vec![AccountMeta::new_readonly(*authority.address(), true)],
        data: payload(event, T::DISCRIMINATOR)?,
    };
    invoke_signed(
        &instruction,
        &[CpiHandle::readonly(&authority)],
        &[&[b"__event_authority", &[bump]]],
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
            venue: Address::new_unique(),
            slot: 17,
            epoch: 3,
            id: 1,
            member: Address::new_unique(),
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
