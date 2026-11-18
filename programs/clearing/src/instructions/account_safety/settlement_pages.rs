//! Successor scratch-page adapter. The controller derives its plan/epoch/attempt
//! from authenticated work. Caller revisions are optimistic replay guards,
//! never historical proof. This adapter grants no payout authority.
use crate::{
    state::accounts::{SettlementLimbPage, LIMB_PAGE_BYTES, LIMB_WORDS_OFFSET, SETTLEMENT_SCHEMA},
    ClearingError,
};
use anchor_lang::prelude::*;
use financial_core::clearing::scalable::{
    pages::{PagePlan, PAGE_WORDS, MAX_WINDOW_PAGES},
    wide::{LimbStorage, WordAccess},
};

#[derive(Clone, Copy)]
pub(crate) struct PageVersion {
    pub attempt: u64,
    pub revision: u64,
}

pub(crate) struct PageWindow<'a> {
    accounts: &'a mut [AccountView],
    plan: PagePlan,
    capacities: [u64; MAX_WINDOW_PAGES],
    dirty: [bool; MAX_WINDOW_PAGES],
}

impl<'a> PageWindow<'a> {
    pub(crate) fn load(
        venue: &Address,
        epoch: u64,
        plan: PagePlan,
        versions: &[PageVersion],
        accounts: &'a mut [AccountView],
    ) -> Result<Self> {
        Self::load_bounded(
            venue,
            epoch,
            plan,
            versions,
            &[plan.capacity(); MAX_WINDOW_PAGES][..plan.requests().len()],
            accounts,
        )
    }

    /// Scalar registers have count-derived record capacities rather than wide
    /// integer widths. The caller derives each capacity from the owned layout.
    pub(crate) fn load_bounded(
        venue: &Address,
        epoch: u64,
        plan: PagePlan,
        versions: &[PageVersion],
        capacities: &[u64],
        accounts: &'a mut [AccountView],
    ) -> Result<Self> {
        let requests = plan.requests();
        require!(
            accounts.len() == requests.len()
                && versions.len() == requests.len()
                && capacities.len() == requests.len()
                && capacities
                    .iter()
                    .all(|capacity| *capacity > 0 && *capacity <= plan.capacity()),
            ClearingError::Resolution
        );
        for (((account, request), version), capacity) in
            accounts.iter().zip(requests).zip(versions).zip(capacities)
        {
            require!(
                account.owner() == &crate::ID
                    && !account.executable()
                    && !account.is_signer()
                    && (!request.writable || account.is_writable())
                    && (!request.writable || version.revision != u64::MAX)
                    && account.data_len() == LIMB_PAGE_BYTES,
                ClearingError::Resolution
            );
            let bytes = account.try_borrow()?;
            require!(
                bytes[..8] == *SettlementLimbPage::DISCRIMINATOR,
                ClearingError::Resolution
            );
            let word_count = capacity
                .checked_sub(
                    request
                        .index
                        .checked_mul(PAGE_WORDS)
                        .ok_or(ClearingError::Arithmetic)?,
                )
                .ok_or(ClearingError::Resolution)?
                .min(PAGE_WORDS);
            require!(
                word_count != 0
                    && u16::from_le_bytes(bytes[8..10].try_into().unwrap()) == SETTLEMENT_SCHEMA
                    && u64::from_le_bytes(bytes[10..18].try_into().unwrap()) == version.revision
                    && bytes[18..50] == venue.as_ref()[..]
                    && u64::from_le_bytes(bytes[50..58].try_into().unwrap()) == epoch
                    && u64::from_le_bytes(bytes[58..66].try_into().unwrap()) == version.attempt
                    && u32::from_le_bytes(bytes[66..70].try_into().unwrap()) == request.register
                    && u64::from_le_bytes(bytes[70..78].try_into().unwrap()) == request.index
                    && u16::from_le_bytes(bytes[78..80].try_into().unwrap()) == word_count as u16,
                ClearingError::Resolution
            );
            let expected = create_program_address(
                &[
                    b"resolution-limbs",
                    venue.as_ref(),
                    &request.register.to_le_bytes(),
                    &request.index.to_le_bytes(),
                    &[bytes[80]],
                ],
                &crate::ID,
            )
            .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
            require_keys_eq!(*account.address(), expected, ClearingError::Resolution);
        }
        let mut capacity_limits = [0; MAX_WINDOW_PAGES];
        capacity_limits[..capacities.len()].copy_from_slice(capacities);
        Ok(Self {
            accounts,
            plan,
            capacities: capacity_limits,
            dirty: [false; MAX_WINDOW_PAGES],
        })
    }

    /// A batch stops before reaching a missing next page. It never performs
    /// a partial step or turns a missing page into implicit zero data.
    pub(crate) fn covers(&self, accesses: [Option<WordAccess>; 3]) -> bool {
        accesses.into_iter().flatten().all(|access| {
            self.locate(access.register, access.limb, access.writable)
                .is_ok()
        })
    }

    fn locate(
        &self,
        register: u32,
        limb: u64,
        writable: bool,
    ) -> financial_core::Result<(usize, usize)> {
        if !self.plan.permits(register, limb, writable) {
            return Err(financial_core::Error::Bounds);
        }
        let page = self
            .plan
            .requests()
            .iter()
            .position(|request| request.register == register && request.index == limb / PAGE_WORDS)
            .ok_or(financial_core::Error::Bounds)?;
        if limb >= self.capacities[page] {
            return Err(financial_core::Error::Bounds);
        }
        Ok((page, LIMB_WORDS_OFFSET + 8 * (limb % PAGE_WORDS) as usize))
    }

    /// Advance each changed scratch page once per successful invocation. The
    /// owning handler must commit this and its work checkpoint atomically; do
    /// not invoke after a failing step. Scoped public handlers do not call this
    /// method: their invocation wrapper owns revision advancement instead.
    pub(crate) fn commit(self) -> Result<()> {
        for (index, account) in self.accounts.iter_mut().enumerate() {
            if self.dirty[index] {
                let mut bytes = account.try_borrow_mut()?;
                let next = u64::from_le_bytes(bytes[10..18].try_into().unwrap())
                    .checked_add(1)
                    .ok_or(ClearingError::Arithmetic)?;
                bytes[10..18].copy_from_slice(&next.to_le_bytes());
            }
        }
        Ok(())
    }
}

impl LimbStorage for PageWindow<'_> {
    fn read(&self, register: u32, limb: u64) -> financial_core::Result<u64> {
        let (page, offset) = self.locate(register, limb, false)?;
        let bytes = self.accounts[page]
            .try_borrow()
            .map_err(|_| financial_core::Error::Invariant)?;
        Ok(u64::from_le_bytes(
            bytes[offset..offset + 8].try_into().unwrap(),
        ))
    }
    fn write(&mut self, register: u32, limb: u64, value: u64) -> financial_core::Result<()> {
        let (page, offset) = self.locate(register, limb, true)?;
        let mut bytes = self.accounts[page]
            .try_borrow_mut()
            .map_err(|_| financial_core::Error::Invariant)?;
        bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
        self.dirty[page] = true;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
