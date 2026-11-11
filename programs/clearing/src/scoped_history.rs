//! Invocation-local journal revisions. These are not financial signing guards.
//! Access is taken from the declared context, never message-wide writable flags.
use crate::{
    error::ClearingError,
    event_cpi,
    events::AccountTransition,
    state::{accounts::*, liquidity::*},
};
use anchor_lang::accounts::{AnchorAccountSerialize, SerializedAccount};
use anchor_lang::{prelude::*, Bumps};

pub(crate) const MAX_ENTITIES: usize = 32;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, IdlType)]
pub struct ScopedRead {
    pub account: Address,
    pub kind: u8,
    pub revision: u64,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, IdlType)]
pub struct ScopedWrite {
    pub account: Address,
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
    17 => PreparedSettlement, 18 => FrozenMarginPage, 19 => MemberIndexNode,
    20 => MemberPage, 21 => SettlementLimbPage,
}

fn schema_for_kind(kind: u8) -> Result<u16> {
    match kind {
        0..=16 => Ok(SCHEMA_VERSION),
        17..=21 => Ok(SETTLEMENT_SCHEMA),
        _ => Err(ClearingError::Profile.into()),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Access {
    Read,
    Write,
    Create,
}
#[derive(Clone, Debug)]
struct Entry {
    account: Address,
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
        account: Address,
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
                    && schema == schema_for_kind(kind)?,
                ClearingError::Profile
            );
            self.cursor = Some(cursor + 1);
            if access == Access::Read {
                Ok(revision)
            } else {
                revision
                    .checked_add(1)
                    .ok_or_else(|| ProgramError::from(ClearingError::Arithmetic))
            }
        } else {
            require!(
                self.entries.len() < MAX_ENTITIES && kind <= 21,
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
                    schema == schema_for_kind(kind)? && revision > 0
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

    pub(crate) fn account<T: Revisioned + Owner + Discriminator, S: AnchorAccountSerialize<T>>(
        &mut self,
        account: &mut SerializedAccount<T, S>,
        access: Access,
    ) -> Result<()> {
        let revision = self.visit(
            account.address().to_owned(),
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

    /// A statically named owned record read directly by a bounded adapter. Its
    /// identity/stage PDA is checked by the handler; kind/schema/layout and
    /// invocation-local access/revision are checked here on both visits.
    pub(crate) fn raw<T: Revisioned + Discriminator + Space>(
        &mut self,
        account: &mut AccountView,
        access: Access,
    ) -> Result<()> {
        require!(
            access != Access::Create
                && account.owner() == &crate::ID
                && !account.executable()
                && !account.is_signer()
                && (access == Access::Read || account.is_writable()),
            ClearingError::Profile
        );
        let bytes = account.try_borrow()?;
        require!(
            bytes.len() == 8 + T::INIT_SPACE && bytes[..8] == *T::DISCRIMINATOR,
            ClearingError::Profile
        );
        let schema = u16::from_le_bytes(bytes[8..10].try_into().unwrap());
        let revision = u64::from_le_bytes(bytes[10..18].try_into().unwrap());
        drop(bytes);
        let next = self.visit(*account.address(), T::KIND, schema, revision, access)?;
        if self.cursor.is_some() && access != Access::Read {
            account.try_borrow_mut()?[10..18].copy_from_slice(&next.to_le_bytes());
        }
        Ok(())
    }

    fn remaining(&mut self, accounts: &mut [AccountView], writable: bool) -> Result<()> {
        // All currently supported remaining accounts are canonical cohort roots.
        // The handler validates their venue/PDA/member order and stage authority.
        for account in accounts {
            require_keys_eq!(*account.owner(), crate::ID, ClearingError::Profile);
            let data = account.try_borrow()?;
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
            require!(!writable || account.is_writable(), ClearingError::Profile);
            let next = self.visit(
                *account.address(),
                MarginAccount::KIND,
                schema,
                revision,
                access,
            )?;
            if self.cursor.is_some() && writable {
                account.try_borrow_mut()?[10..18].copy_from_slice(&next.to_le_bytes());
            }
        }
        Ok(())
    }

    fn limb_pages(
        &mut self,
        accounts: &mut [AccountView],
        plan: financial_core::clearing::scalable::pages::PagePlan,
    ) -> Result<()> {
        require!(
            accounts.len() == plan.requests().len(),
            ClearingError::Resolution
        );
        for (account, request) in accounts.iter_mut().zip(plan.requests()) {
            self.raw::<SettlementLimbPage>(
                account,
                if request.writable {
                    Access::Write
                } else {
                    Access::Read
                },
            )?;
        }
        Ok(())
    }

    fn finish(
        &self,
        venue: Address,
        domain: [u8; 32],
        instruction: [u8; 8],
        payload_count: u16,
        slot: u64,
    ) -> Result<TransitionView<'_>> {
        require!(
            self.cursor == Some(self.entries.len()) && payload_count <= 4,
            ClearingError::Profile
        );
        require!(
            self.entries
                .iter()
                .any(|entry| entry.access != Access::Read),
            ClearingError::Profile
        );
        Ok(TransitionView {
            schema_version: SCHEMA_VERSION,
            venue,
            domain,
            slot,
            instruction,
            payload_count,
            reads: ScopedRows {
                entries: &self.entries,
                writes: false,
            },
            writes: ScopedRows {
                entries: &self.entries,
                writes: true,
            },
        })
    }
}

/// Serialize the frozen rows directly. Allocating two new vectors here consumes
/// unreclaimable SBF heap after the handler's financial payloads have been emitted.
struct ScopedRows<'a> {
    entries: &'a [Entry],
    writes: bool,
}
// SAFETY: dynamic metadata; size_of exactly counts the u32 prefix and each
// emitted address/kind/revision field. No native-memory/zero-copy claim is made.
unsafe impl<'a> SchemaWrite<anchor_lang::BorshConfig> for ScopedRows<'a> {
    type Src = Self;
    fn size_of(value: &Self) -> anchor_lang::wincode::WriteResult<usize> {
        let count = value
            .entries
            .iter()
            .filter(|entry| (entry.access != Access::Read) == value.writes)
            .count();
        if count > MAX_ENTITIES {
            return Err(anchor_lang::wincode::WriteError::Custom(
                "too many scoped rows",
            ));
        }
        Ok(4 + count * if value.writes { 49 } else { 41 })
    }
    fn write(
        mut writer: impl anchor_lang::wincode::io::Writer,
        value: &Self,
    ) -> anchor_lang::wincode::WriteResult<()> {
        Self::size_of(value)?;
        let included = |entry: &&Entry| (entry.access != Access::Read) == value.writes;
        let count = value.entries.iter().filter(included).count() as u32;
        writer.write(&count.to_le_bytes())?;
        for entry in value.entries.iter().filter(included) {
            writer.write(entry.account.as_ref())?;
            writer.write(&[entry.kind])?;
            writer.write(&entry.revision.to_le_bytes())?;
            if value.writes {
                let after = entry.revision.checked_add(1).ok_or(
                    anchor_lang::wincode::WriteError::Custom("scoped revision exhausted"),
                )?;
                writer.write(&after.to_le_bytes())?;
            }
        }
        Ok(())
    }
}
struct TransitionView<'a> {
    schema_version: u16,
    venue: Address,
    domain: [u8; 32],
    slot: u64,
    instruction: [u8; 8],
    payload_count: u16,
    reads: ScopedRows<'a>,
    writes: ScopedRows<'a>,
}

// This private borrowed view is not an IDL type. Manual field-order serialization
// also avoids Anchor's IDL derive treating the rows' lifetime as a type parameter.
// SAFETY: the fixed 84-byte header and both bounded row streams are written in
// the IDL field order. Dynamic metadata avoids any Rust layout/alignment promise.
unsafe impl<'a> SchemaWrite<anchor_lang::BorshConfig> for TransitionView<'a> {
    type Src = Self;
    fn size_of(value: &Self) -> anchor_lang::wincode::WriteResult<usize> {
        Ok(84 + ScopedRows::size_of(&value.reads)? + ScopedRows::size_of(&value.writes)?)
    }
    fn write(
        mut writer: impl anchor_lang::wincode::io::Writer,
        value: &Self,
    ) -> anchor_lang::wincode::WriteResult<()> {
        writer.write(&value.schema_version.to_le_bytes())?;
        writer.write(value.venue.as_ref())?;
        writer.write(&value.domain)?;
        writer.write(&value.slot.to_le_bytes())?;
        writer.write(&value.instruction)?;
        writer.write(&value.payload_count.to_le_bytes())?;
        ScopedRows::write(writer.by_ref(), &value.reads)?;
        ScopedRows::write(writer.by_ref(), &value.writes)
    }
}

/// Implementations live beside the context coverage table. Visits are identical
/// before/after the handler, including optional and nested account declarations.
pub(crate) trait ScopedContext: Bumps {
    fn visit(&mut self, scope: &mut Scope) -> Result<()>;
    fn venue(&self) -> (Address, [u8; 32]);
    fn event_authority(&self) -> AccountView;
}

#[inline(never)]
pub(crate) fn run<'context, T: ScopedContext>(
    context: &mut Context<'context, T>,
    instruction: [u8; 8],
    remaining_writable: bool,
    handler: impl FnOnce(&mut Context<'context, T>, &mut event_cpi::Payloads) -> Result<()>,
) -> Result<()> {
    run_with_remaining(
        context,
        instruction,
        Remaining::Roots(remaining_writable),
        handler,
    )
}

/// The plan is derived from authenticated work before the handler and retained
/// unchanged for both scope visits. A caller cannot choose its access privileges.
pub(crate) fn run_pages<'context, T: ScopedContext>(
    context: &mut Context<'context, T>,
    instruction: [u8; 8],
    plan: financial_core::clearing::scalable::pages::PagePlan,
    handler: impl FnOnce(&mut Context<'context, T>, &mut event_cpi::Payloads) -> Result<()>,
) -> Result<()> {
    run_with_remaining(context, instruction, Remaining::Limbs(plan), handler)
}

#[derive(Clone, Copy)]
enum Remaining {
    Roots(bool),
    Limbs(financial_core::clearing::scalable::pages::PagePlan),
}
impl Remaining {
    fn visit(self, scope: &mut Scope, accounts: &mut [AccountView]) -> Result<()> {
        match self {
            Self::Roots(writable) => scope.remaining(accounts, writable),
            Self::Limbs(plan) => scope.limb_pages(accounts, plan),
        }
    }
}

#[inline(never)]
fn run_with_remaining<'context, T: ScopedContext>(
    context: &mut Context<'context, T>,
    instruction: [u8; 8],
    access: Remaining,
    handler: impl FnOnce(&mut Context<'context, T>, &mut event_cpi::Payloads) -> Result<()>,
) -> Result<()> {
    profile_cu!("scope-enter");
    let mut scope = Scope::new();
    context.accounts.visit(&mut scope)?;
    let mut remaining = context.remaining_accounts()?;
    access.visit(&mut scope, &mut remaining)?;
    let mut payloads = event_cpi::Payloads::default();
    profile_cu!("handler-enter");
    handler(context, &mut payloads)?;
    profile_cu!("handler-exit");
    scope.cursor = Some(0);
    context.accounts.visit(&mut scope)?;
    access.visit(&mut scope, &mut remaining)?;
    let (venue, domain) = context.accounts.venue();
    let event = scope.finish(
        venue,
        domain,
        instruction,
        payloads.count(),
        Clock::get()?.slot,
    )?;
    profile_cu!("footer-enter");
    event_cpi::emit_borrowed::<AccountTransition, _>(&event, context.accounts.event_authority())?;
    profile_cu!("scope-exit");
    Ok(())
}

#[cfg(test)]
mod tests;
