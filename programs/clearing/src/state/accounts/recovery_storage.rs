//! Rent ownership and reusable recovery capacity. Neither record represents
//! collateral, insurance, a claim, or authority to select settlement outcomes.
use super::*;
use financial_core::clearing::scalable::recovery_storage::Provisioning;

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct RecoveryStorage {
    pub schema_version: u16,
    pub revision: u64,
    pub venue: Address,
    pub ready_capacity: u64,
    pub target_capacity: u64,
    pub next_allocation: u64,
    pub generation: u64,
    pub locked_epoch: u64,
    pub completed_epoch: u64,
    pub bump: u8,
}
impl RecoveryStorage {
    pub(crate) fn model(&self) -> Provisioning {
        Provisioning {
            ready_capacity: self.ready_capacity,
            target_capacity: self.target_capacity,
            next_allocation: self.next_allocation,
            generation: self.generation,
            locked_epoch: self.locked_epoch,
            completed_epoch: self.completed_epoch,
        }
    }
    pub(crate) fn commit(&mut self, next: Provisioning) -> Result<()> {
        next.validate()
            .map_err(|_| crate::ClearingError::Resolution)?;
        self.ready_capacity = next.ready_capacity;
        self.target_capacity = next.target_capacity;
        self.next_allocation = next.next_allocation;
        self.generation = next.generation;
        self.locked_epoch = next.locked_epoch;
        self.completed_epoch = next.completed_epoch;
        Ok(())
    }
}

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct StorageFunding {
    pub schema_version: u16,
    pub revision: u64,
    pub venue: Address,
    pub allocation: Address,
    pub rent_payer: Address,
    /// Lamports actually paid to create the allocation, excluding this receipt's
    /// own rent. This immutable record is not a transferable withdrawal right.
    pub contributed_lamports: u64,
    pub bump: u8,
}

/// Permanent terminal marker. The original payer receipt remains immutable;
/// only rent above this small marker's minimum is refundable.
#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct StorageTombstone {
    pub schema_version: u16,
    pub revision: u64,
    pub venue: Address,
    pub original_kind: u8,
    pub completed_epoch: u64,
    pub register: u32,
    pub page_index: u64,
    pub bump: u8,
}
