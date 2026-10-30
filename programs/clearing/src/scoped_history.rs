//! Invocation-local journal revisions. These are not financial signing guards.
//! Access is taken from the declared context, never message-wide writable flags.
use crate::{
    error::ClearingError,
    event_cpi,
    events::AccountTransition,
    state::{accounts::*, liquidity::*},
};
use anchor_lang::{prelude::*, Bumps};

pub(crate) const MAX_ENTITIES: usize = 32;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ScopedRead {
    pub account: Pubkey,
    pub kind: u8,
    pub revision: u64,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ScopedWrite {
    pub account: Pubkey,
    pub kind: u8,
    pub before: u64,
    pub after: u64,
}

pub(crate) trait Revisioned {
    const KIND: u8;
    fn schema(&self) -> u16;
    fn revision(&self) -> u64;
    fn set_revision(&mut self, revision: u64);
}
macro_rules! revisioned {
    ($($kind:literal => $account:ty),+ $(,)?) => {$(
        impl Revisioned for $account {
            const KIND: u8 = $kind;
            fn schema(&self) -> u16 { self.schema_version }
            fn revision(&self) -> u64 { self.revision }
            fn set_revision(&mut self, revision: u64) { self.revision = revision; }
        }
    )+};
}
revisioned! {
    0 => Venue, 1 => Custody, 2 => VenueSafety, 3 => VenueRegistry,
    4 => Portfolio, 5 => MarginAccount, 6 => Market, 7 => MarketLedger,
    8 => CapitalBinding, 9 => SettlementCertificate, 10 => Resolution,
    11 => ResolutionPage, 12 => ResolutionWork, 13 => RetirementCertificate,
    14 => LiquidityRegistry, 15 => MakerRegistration, 16 => FundingPublisher,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Access {
    Read,
    Write,
    Create,
}
#[derive(Clone, Debug)]
struct Entry {
    account: Pubkey,
    kind: u8,
    revision: u64,
    access: Access,
}

pub(crate) struct Scope {
    entries: Vec<Entry>,
    cursor: Option<usize>,
}
impl Scope {
    fn new() -> Self {
        Self {
            entries: Vec::with_capacity(MAX_ENTITIES),
            cursor: None,
        }
    }

    /// Shared validation for typed and manually serialized remaining accounts.
    /// Returns the revision to persist; capture and readonly visits change none.
    fn visit(
        &mut self,
        account: Pubkey,
        kind: u8,
        schema: u16,
        revision: u64,
        access: Access,
    ) -> Result<u64> {
        if let Some(cursor) = self.cursor {
            let entry = self.entries.get(cursor).ok_or(ClearingError::Profile)?;
            require!(
                entry.account == account
                    && entry.kind == kind
                    && entry.access == access
                    && entry.revision == revision
                    && schema == SCHEMA_VERSION,
                ClearingError::Profile
            );
            self.cursor = Some(cursor + 1);
            if access == Access::Read {
                Ok(revision)
            } else {
                revision
                    .checked_add(1)
                    .ok_or_else(|| error!(ClearingError::Arithmetic))
            }
        } else {
            require!(
                self.entries.len() < MAX_ENTITIES && kind <= 16,
                ClearingError::Profile
            );
            require!(
                !self.entries.iter().any(|entry| entry.account == account),
                ClearingError::Alias
            );
            require!(
                if access == Access::Create {
                    schema == 0 && revision == 0
                } else {
                    schema == SCHEMA_VERSION && revision > 0
                },
                ClearingError::Profile
            );
            require!(
                access == Access::Read || revision < u64::MAX,
                ClearingError::Arithmetic
            );
            self.entries.push(Entry {
                account,
                kind,
                revision,
                access,
            });
            Ok(revision)
        }
    }

    pub(crate) fn account<T: Revisioned + AccountSerialize + AccountDeserialize + Clone + Owner>(
        &mut self,
        account: &mut Account<T>,
        access: Access,
    ) -> Result<()> {
        let revision = self.visit(
            account.key(),
            T::KIND,
            account.schema(),
            account.revision(),
            access,
        )?;
        if self.cursor.is_some() && access != Access::Read {
            account.set_revision(revision);
        }
        Ok(())
    }

    fn remaining(&mut self, accounts: &[AccountInfo], writable: bool) -> Result<()> {
        // All currently supported remaining accounts are canonical cohort roots.
        // The handler validates their venue/PDA/member order and stage authority.
        for account in accounts {
            require_keys_eq!(*account.owner, crate::ID, ClearingError::Profile);
            let data = account.try_borrow_data()?;
            require!(
                data.len() == 8 + MarginAccount::INIT_SPACE
                    && data[..8] == *MarginAccount::DISCRIMINATOR,
                ClearingError::Profile
            );
            let schema = u16::from_le_bytes(data[8..10].try_into().unwrap());
            let revision = u64::from_le_bytes(data[10..18].try_into().unwrap());
            drop(data);
            let access = if writable {
                Access::Write
            } else {
                Access::Read
            };
            require!(!writable || account.is_writable, ClearingError::Profile);
            let next = self.visit(*account.key, MarginAccount::KIND, schema, revision, access)?;
            if self.cursor.is_some() && writable {
                account.try_borrow_mut_data()?[10..18].copy_from_slice(&next.to_le_bytes());
            }
        }
        Ok(())
    }

    fn finish(
        &self,
        venue: Pubkey,
        domain: [u8; 32],
        instruction: [u8; 8],
        payload_count: u16,
        slot: u64,
    ) -> Result<TransitionView<'_>> {
        require!(
            self.cursor == Some(self.entries.len()) && payload_count <= 4,
            ClearingError::Profile
        );
        require!(self.entries.iter().any(|entry| entry.access != Access::Read), ClearingError::Profile);
        Ok(TransitionView {
            schema_version: SCHEMA_VERSION,
            venue, domain, slot, instruction, payload_count,
            reads: ScopedRows { entries: &self.entries, writes: false },
            writes: ScopedRows { entries: &self.entries, writes: true },
        })
    }
}

/// Serialize the frozen rows directly. Allocating two new vectors here consumes
/// unreclaimable SBF heap after the handler's financial payloads have been emitted.
struct ScopedRows<'a> {
    entries: &'a [Entry],
    writes: bool,
}
impl AnchorSerialize for ScopedRows<'_> {
    fn serialize<W: std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
        let included = |entry: &&Entry| (entry.access != Access::Read) == self.writes;
        let count = self.entries.iter().filter(included).count() as u32;
        count.serialize(writer)?;
        for entry in self.entries.iter().filter(included) {
            entry.account.serialize(writer)?;
            entry.kind.serialize(writer)?;
            entry.revision.serialize(writer)?;
            if self.writes {
                entry.revision.checked_add(1).ok_or_else(|| std::io::Error::new(
                    std::io::ErrorKind::InvalidData, "scoped revision exhausted"))?.serialize(writer)?;
            }
        }
        Ok(())
    }
}
struct TransitionView<'a> {
    schema_version: u16,
    venue: Pubkey,
    domain: [u8; 32],
    slot: u64,
    instruction: [u8; 8],
    payload_count: u16,
    reads: ScopedRows<'a>,
    writes: ScopedRows<'a>,
}

// This private borrowed view is not an IDL type. Manual field-order serialization
// also avoids Anchor's IDL derive treating the rows' lifetime as a type parameter.
impl AnchorSerialize for TransitionView<'_> {
    fn serialize<W: std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
        self.schema_version.serialize(writer)?;
        self.venue.serialize(writer)?;
        self.domain.serialize(writer)?;
        self.slot.serialize(writer)?;
        self.instruction.serialize(writer)?;
        self.payload_count.serialize(writer)?;
        self.reads.serialize(writer)?;
        self.writes.serialize(writer)
    }
}

/// Implementations live beside the context coverage table. Visits are identical
/// before/after the handler, including optional and nested account declarations.
pub(crate) trait ScopedContext<'info>: Bumps {
    fn visit(&mut self, scope: &mut Scope) -> Result<()>;
    fn venue(&self) -> (Pubkey, [u8; 32]);
    fn event_authority(&self) -> AccountInfo<'info>;
}

#[inline(never)]
pub(crate) fn run<'context, 'info, T: ScopedContext<'info>>(
    mut context: Context<'context, T>,
    instruction: [u8; 8],
    remaining_writable: bool,
    handler: impl FnOnce(&mut Context<'context, T>, &mut event_cpi::Payloads) -> Result<()>,
) -> Result<()> {
    let mut scope = Scope::new();
    context.accounts.visit(&mut scope)?;
    scope.remaining(context.remaining_accounts, remaining_writable)?;
    let mut payloads = event_cpi::Payloads::default();
    handler(&mut context, &mut payloads)?;
    scope.cursor = Some(0);
    context.accounts.visit(&mut scope)?;
    scope.remaining(context.remaining_accounts, remaining_writable)?;
    let (venue, domain) = context.accounts.venue();
    let event = scope.finish(
        venue,
        domain,
        instruction,
        payloads.count(),
        Clock::get()?.slot,
    )?;
    event_cpi::emit_borrowed::<AccountTransition, _>(&event, context.accounts.event_authority())
}

#[cfg(test)]
mod tests;
