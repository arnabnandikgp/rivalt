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
    #[cfg(feature = "read-only-route-market")]
    fn venue_mode(&self) -> Option<u8> { None }
    #[cfg(feature = "maintained-coverage")]
    fn coverage_root(&self) -> Option<&MarginAccount> { None }
    fn set_revision(&mut self, revision: u64);
}
macro_rules! revisioned {
    ($($kind:literal => $account:ty $(; $mode:ident)?),+ $(,)?) => {$(
        impl Revisioned for $account {
            const KIND: u8 = $kind;
            $(#[cfg(feature = "read-only-route-market")]
            fn venue_mode(&self) -> Option<u8> { Some(self.$mode) })?
            fn schema(&self) -> u16 { self.schema_version }
            fn revision(&self) -> u64 { self.revision }
            fn set_revision(&mut self, revision: u64) { self.revision = revision; }
        }
    )+};
}
revisioned! {
    0 => Venue, 1 => Custody, 2 => VenueSafety; mode, 3 => VenueRegistry,
    4 => Portfolio, 6 => Market, 7 => MarketLedger,
    8 => CapitalBinding, 9 => SettlementCertificate, 10 => Resolution,
    // Kinds 11/12 are retired; never reuse their persisted identities.
    13 => RetirementCertificate,
    14 => LiquidityRegistry, 15 => MakerRegistration, 16 => FundingPublisher,
    17 => PreparedSettlement, 18 => FrozenMarginPage, 19 => MemberIndexNode,
    20 => MemberPage, 21 => SettlementLimbPage, 22 => SettlementRates, 23 => SettlementPlan,
    24 => RecoveryStorage, 25 => StorageFunding, 26 => MarginTombstone, 27 => StorageTombstone,
    28 => MarketListing, 29 => ListedSymbol, 30 => ListingIndex, 31 => ListedFunding,
    32 => ListedVenue, 33 => ListedMarketBook,
}

impl Revisioned for MarginAccount {
    const KIND: u8 = 5;
    fn schema(&self) -> u16 { self.schema_version }
    fn revision(&self) -> u64 { self.revision }
    fn set_revision(&mut self, revision: u64) { self.revision = revision; }
    #[cfg(feature = "maintained-coverage")]
    fn coverage_root(&self) -> Option<&MarginAccount> { Some(self) }
}

fn schema_for_kind(kind: u8) -> Result<u16> {
    match kind {
        0..=10 | 13..=16 => Ok(SCHEMA_VERSION),
        17..=27 => Ok(SETTLEMENT_SCHEMA),
        28..=33 => Ok(LISTING_SCHEMA),
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
    written_kind: u8,
    revision: u64,
    access: Access,
}

pub(crate) struct Scope {
    #[cfg(feature = "maintained-coverage")]
    coverage: crate::shadow_coverage::maintenance::Changes,
    #[cfg(feature = "listed-margin-storage")]
    listed_margin_write: bool,
    selected_makers: Option<MakerAccess>,
    #[cfg(feature = "read-only-route-market")]
    venue_mode: Option<u8>,
    entries: Vec<Entry>,
    limit: usize,
    cursor: Option<usize>,
}
impl Scope {
    fn new() -> Self {
        Self::with_limit(MAX_ENTITIES)
    }

    fn with_limit(limit: usize) -> Self {
        Self {
            #[cfg(feature = "maintained-coverage")]
            coverage: Default::default(),
            #[cfg(feature = "listed-margin-storage")]
            listed_margin_write: false,
            entries: Vec::with_capacity(limit), limit, cursor: None, selected_makers: None,
            #[cfg(feature = "read-only-route-market")] venue_mode: None }
    }

    pub(crate) fn maker_access(&self, index: usize) -> Result<(Access, Access)> {
        let plan = self.selected_makers.ok_or(ClearingError::Profile)?;
        let filled = *plan.filled.get(index).ok_or(ClearingError::Profile)?;
        let capital = if filled { Access::Write } else { Access::Read };
        let registration = if plan.lane_slot == Some(index) { Access::Write } else { capital };
        Ok((capital, registration))
    }

    #[cfg(feature = "book-inventory-qualification")]
    fn inventory_pages(pages: usize) -> Result<Self> {
        // Fixed event tags and footer fields occupy 108 bytes. This instruction
        // reads ten revisioned accounts and writes the prepared header and pages.
        const FIXED: usize = 108 + 10 * 41 + 49;
        require!(pages <= (event_cpi::MAX_EVENT_BYTES - FIXED) / 49, ClearingError::Profile);
        Ok(Self::with_limit(11 + pages))
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
        let expected_schema = schema_for_kind(kind)?;
        if let Some(cursor) = self.cursor {
            let entry = self.entries.get(cursor).ok_or(ClearingError::Profile)?;
            require!(
                entry.account == account
                    && entry.kind == kind
                    && entry.access == access
                    && entry.revision == revision
                    && schema == expected_schema,
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
            require!(self.entries.len() < self.limit, ClearingError::Profile);
            require!(
                !self.entries.iter().any(|entry| entry.account == account),
                ClearingError::Alias
            );
            require!(
                if access == Access::Create {
                    schema == 0 && revision == 0
                } else {
                    schema == expected_schema && revision > 0
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
                written_kind: kind,
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
        #[cfg(feature = "listed-margin-storage")]
        if !self.listed_margin_write && T::KIND == MarginAccount::KIND && (access != Access::Create || self.cursor.is_some()) {
            let view = account.account().clone();
            if view.data_len() != MARGIN_ALLOCATION {
                // Read-only wrappers already allow a shared read. RC2 writable
                // wrappers hold an exclusive Borsh guard across the handler.
                let shared = view.try_borrow();
                if let Ok(bytes) = shared {
                    legacy_margin_bytes(&bytes)?;
                } else {
                    account.release_borrow()?;
                    legacy_margin_bytes(&view.try_borrow()?)?;
                    account.reacquire_guard_only()?;
                }
            }
        }
        #[cfg(feature = "read-only-route-market")]
        if self.cursor.is_none() {
            if let Some(mode) = account.venue_mode() { self.venue_mode = Some(mode); }
        }
        #[cfg(feature = "maintained-coverage")]
        if access != Access::Read {
            if let Some(root) = account.coverage_root() {
                #[cfg(feature = "listed-margin-storage")]
                if !self.listed_margin_write {
                self.coverage.capture(*account.address(), root, self.cursor.is_some())?;
                }
                #[cfg(not(feature = "listed-margin-storage"))]
                self.coverage.capture(*account.address(), root, self.cursor.is_some())?;
            }
        }
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
            (if T::KIND == MarginAccount::KIND { crate::state::accounts::valid_margin_size(bytes.len()) } else if T::KIND == MakerRegistration::KIND { bytes.len() == 8 + T::INIT_SPACE + crate::market_fees::LANE_EXTRA } else { bytes.len() == 8 + T::INIT_SPACE }) && bytes[..8] == *T::DISCRIMINATOR,
            ClearingError::Profile
        );
        #[cfg(feature = "listed-margin-storage")]
        if T::KIND == MarginAccount::KIND { legacy_margin_bytes(&bytes)?; }
        let schema = u16::from_le_bytes(bytes[8..10].try_into().unwrap());
        let revision = u64::from_le_bytes(bytes[10..18].try_into().unwrap());
        drop(bytes);
        #[cfg(feature = "maintained-coverage")]
        if T::KIND == MarginAccount::KIND && access == Access::Write {
            self.coverage.capture_raw(account, self.cursor.is_some())?;
        }
        let next = self.visit(*account.address(), T::KIND, schema, revision, access)?;
        if self.cursor.is_some() && access != Access::Read {
            account.try_borrow_mut()?[10..18].copy_from_slice(&next.to_le_bytes());
        }
        Ok(())
    }

    /// Canonical PDA initialization inside the handler lets the rent receipt
    /// record the exact payer top-up even when somebody donated lamport dust.
    pub(crate) fn created_raw<T: Revisioned + Discriminator + Space>(
        &mut self,
        account: &mut AccountView,
    ) -> Result<()> {
        require!(
            account.is_writable() && !account.executable() && !account.is_signer(),
            ClearingError::Profile
        );
        let (schema, revision) = if self.cursor.is_none() {
            require!(
                account.owner() == &anchor_lang::system_program::ID && account.data_len() == 0,
                ClearingError::Profile
            );
            (0, 0)
        } else {
            require!(account.owner() == &crate::ID, ClearingError::Profile);
            let bytes = account.try_borrow()?;
            require!(
                bytes.len() == 8 + T::INIT_SPACE && bytes[..8] == *T::DISCRIMINATOR,
                ClearingError::Profile
            );
            (
                u16::from_le_bytes(bytes[8..10].try_into().unwrap()),
                u64::from_le_bytes(bytes[10..18].try_into().unwrap()),
            )
        };
        let next = self.visit(
            *account.address(),
            T::KIND,
            schema,
            revision,
            Access::Create,
        )?;
        if self.cursor.is_some() {
            account.try_borrow_mut()?[10..18].copy_from_slice(&next.to_le_bytes());
        }
        Ok(())
    }

    /// The sole same-address kind transition. The journal reports terminal kind
    /// 26 with the predecessor root revision; decoders authorize 5 -> 26 only for
    /// retire_margin and its matching lifecycle payload. No general relabel API.
    pub(crate) fn retire_margin(&mut self, account: &mut AccountView) -> Result<()> {
        require!(
            account.owner() == &crate::ID
                && account.is_writable()
                && !account.is_signer()
                && !account.executable(),
            ClearingError::Profile
        );
        let bytes = account.try_borrow()?;
        let after = self.cursor.is_some();
        let (length, discriminator) = if after {
            (
                8 + MarginTombstone::INIT_SPACE,
                MarginTombstone::DISCRIMINATOR,
            )
        } else {
            (crate::state::accounts::MARGIN_ALLOCATION, MarginAccount::DISCRIMINATOR)
        };
        require!(
            (if after { bytes.len() == length } else { crate::state::accounts::valid_margin_size(bytes.len()) }) && bytes[..8] == *discriminator,
            ClearingError::Profile
        );
        #[cfg(feature = "listed-margin-storage")]
        if !after { legacy_margin_bytes(&bytes)?; }
        let schema = u16::from_le_bytes(bytes[8..10].try_into().unwrap());
        let revision = u64::from_le_bytes(bytes[10..18].try_into().unwrap());
        drop(bytes);
        let next = self.visit(
            *account.address(),
            MarginAccount::KIND,
            schema,
            revision,
            Access::Write,
        )?;
        if after {
            account.try_borrow_mut()?[10..18].copy_from_slice(&next.to_le_bytes());
        } else {
            self.entries
                .last_mut()
                .ok_or(ClearingError::Profile)?
                .written_kind = MarginTombstone::KIND;
        }
        Ok(())
    }

    /// Terminal work cleanup is restricted to the five physical recovery kinds.
    /// It cannot retire a live member page, financial root or arbitrary account.
    pub(crate) fn retire_storage(&mut self, account: &mut AccountView) -> Result<()> {
        require!(
            account.owner() == &crate::ID
                && account.is_writable()
                && !account.is_signer()
                && !account.executable(),
            ClearingError::Profile
        );
        let bytes = account.try_borrow()?;
        require!(bytes.len() >= 18, ClearingError::Profile);
        let after = self.cursor.is_some();
        let kind = if after {
            require!(
                bytes.len() == 8 + StorageTombstone::INIT_SPACE
                    && bytes[..8] == *StorageTombstone::DISCRIMINATOR,
                ClearingError::Profile
            );
            bytes[50]
        } else {
            let shapes = [
                (
                    17,
                    PreparedSettlement::DISCRIMINATOR,
                    PreparedSettlement::INIT_SPACE,
                ),
                (
                    18,
                    FrozenMarginPage::DISCRIMINATOR,
                    FrozenMarginPage::INIT_SPACE,
                ),
                (
                    21,
                    SettlementLimbPage::DISCRIMINATOR,
                    SettlementLimbPage::INIT_SPACE,
                ),
                (
                    22,
                    SettlementRates::DISCRIMINATOR,
                    SettlementRates::INIT_SPACE,
                ),
                (
                    23,
                    SettlementPlan::DISCRIMINATOR,
                    SettlementPlan::INIT_SPACE,
                ),
            ];
            shapes
                .into_iter()
                .find(|(_, discriminator, size)| {
                    bytes[..8] == **discriminator && bytes.len() == 8 + size
                })
                .ok_or(ClearingError::Profile)?
                .0
        };
        require!([17, 18, 21, 22, 23].contains(&kind), ClearingError::Profile);
        let schema = u16::from_le_bytes(bytes[8..10].try_into().unwrap());
        let revision = u64::from_le_bytes(bytes[10..18].try_into().unwrap());
        drop(bytes);
        let next = self.visit(*account.address(), kind, schema, revision, Access::Write)?;
        if after {
            account.try_borrow_mut()?[10..18].copy_from_slice(&next.to_le_bytes());
        } else {
            self.entries
                .last_mut()
                .ok_or(ClearingError::Profile)?
                .written_kind = StorageTombstone::KIND;
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
                crate::state::accounts::valid_margin_size(data.len())
                    && data[..8] == *MarginAccount::DISCRIMINATOR,
                ClearingError::Profile
            );
            #[cfg(feature = "listed-margin-storage")]
            legacy_margin_bytes(&data)?;
            let schema = u16::from_le_bytes(data[8..10].try_into().unwrap());
            let revision = u64::from_le_bytes(data[10..18].try_into().unwrap());
            drop(data);
            let access = if writable {
                Access::Write
            } else {
                Access::Read
            };
            require!(!writable || account.is_writable(), ClearingError::Profile);
            #[cfg(feature = "maintained-coverage")]
            if writable { self.coverage.capture_raw(account, self.cursor.is_some())?; }
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
        if count > event_cpi::MAX_EVENT_BYTES / if value.writes { 49 } else { 41 } {
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
            writer.write(&[if value.writes {
                entry.written_kind
            } else {
                entry.kind
            }])?;
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

/// Original business-account list, excluding the optional local coverage suffix.
#[inline]
pub(crate) fn economic_accounts<T: Bumps>(ctx: &mut Context<T>) -> Result<Vec<AccountView>> {
    let accounts = ctx.remaining_accounts()?;
    #[cfg(feature = "maintained-coverage")]
    let accounts = {
        let mut accounts = accounts;
        accounts.truncate(crate::shadow_coverage::maintenance::trailing_lanes(&accounts)?);
        accounts
    };
    Ok(accounts)
}

/// Implementations live beside the context coverage table. Visits are identical
/// before/after the handler, including optional and nested account declarations.
pub(crate) trait ScopedContext: Bumps {
    fn visit(&mut self, scope: &mut Scope) -> Result<()>;
    fn venue(&self) -> &BorshAccount<Venue>;
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

pub(crate) fn run_listed_directory<'context, T: ScopedContext>(
    context: &mut Context<'context,T>, instruction:[u8;8],
    handler: impl FnOnce(&mut Context<'context,T>, &mut event_cpi::Payloads) -> Result<()>,
) -> Result<()> {
    run_with_remaining(context,instruction,Remaining::ListedRegistrations,handler)
}

/// The checked publisher authenticates a fixed set of read-only registrations.
#[inline(never)]
pub(crate) fn run_funding<'context, T: ScopedContext>(
    context: &mut Context<'context, T>,
    instruction: [u8; 8],
    handler: impl FnOnce(&mut Context<'context, T>, &mut event_cpi::Payloads) -> Result<()>,
) -> Result<()> {
    #[cfg(feature = "checked-funding-prefix")]
    let access = Remaining::FundingRegistrations;
    #[cfg(not(feature = "checked-funding-prefix"))]
    let access = Remaining::Roots(false);
    run_with_remaining(context, instruction, access, handler)
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

pub(crate) fn run_frozen_pages<'context, T: ScopedContext>(
    context: &mut Context<'context, T>,
    instruction: [u8; 8],
    handler: impl FnOnce(&mut Context<'context, T>, &mut event_cpi::Payloads) -> Result<()>,
) -> Result<()> {
    run_with_remaining(context, instruction, Remaining::FrozenPlanPages, handler)
}

pub(crate) fn run_membership<'context, T: ScopedContext>(
    context: &mut Context<'context, T>,
    instruction: [u8; 8],
    handler: impl FnOnce(&mut Context<'context, T>, &mut event_cpi::Payloads) -> Result<()>,
) -> Result<()> {
    run_with_remaining(context, instruction, Remaining::MembershipPath, handler)
}

pub(crate) fn run_membership_scan<'context, T: ScopedContext>(
    context: &mut Context<'context, T>,
    instruction: [u8; 8],
    handler: impl FnOnce(&mut Context<'context, T>, &mut event_cpi::Payloads) -> Result<()>,
) -> Result<()> {
    run_with_remaining(context, instruction, Remaining::MembershipScan(false), handler)
}

pub(crate) fn run_backing_scan<'context, T: ScopedContext>(
    context: &mut Context<'context, T>, instruction: [u8; 8],
    handler: impl FnOnce(&mut Context<'context, T>, &mut event_cpi::Payloads) -> Result<()>,
) -> Result<()> {
    run_with_remaining(context, instruction, Remaining::MembershipScan(true), handler)
}

/// Selection is fixed before either journal visit. Only the account holding
/// the selected market totals may advance without an accompanying capital fill.
#[derive(Clone, Copy)]
pub(crate) struct MakerAccess {
    pub filled: [bool; 8],
    pub extras: usize,
    pub lane_slot: Option<usize>,
    pub external_lane: Option<Address>,
}

#[derive(Clone, Copy)]
enum Remaining {
    ListedRegistrations,
    #[cfg(feature="listed-venue-cash")]
    ListedCashWindows,
    SelectedMakers(MakerAccess),
    ExplicitLane,
    #[cfg(feature = "checked-funding-prefix")]
    FundingRegistrations,
    FrozenPlanPages,
    MembershipPath,
    MembershipScan(bool),
    Roots(bool),
    Limbs(financial_core::clearing::scalable::pages::PagePlan),
}
impl Remaining {
    fn visit(self, scope: &mut Scope, accounts: &mut [AccountView]) -> Result<()> {
        match self {
            #[cfg(feature="listed-venue-cash")]
            Self::ListedCashWindows => {
                require!(accounts.len() <= 12 && accounts.len() % 2 == 0, ClearingError::OracleSource);
                for pair in accounts.chunks_exact_mut(2) {
                    require!(!pair[0].is_writable() && pair[1].is_writable(), ClearingError::OracleSource);
                    scope.raw::<MarketListing>(&mut pair[0],Access::Read)?;
                    scope.raw::<ListedFunding>(&mut pair[1],Access::Write)?;
                }
                Ok(())
            }
            Self::ListedRegistrations => {
                require!(accounts.len()==usize::from(maker_interface::canonical::REGISTRATION_LIMIT),ClearingError::MakerBinding);
                for account in accounts {
                    require!(!account.is_writable() && !account.executable(),ClearingError::MakerBinding);
                    if account.owner()==&crate::ID { scope.raw::<MakerRegistration>(account,Access::Read)?; }
                    else { require!(account.owner()==&anchor_lang::system_program::ID && account.data_len()==0,ClearingError::MakerBinding); }
                }
                Ok(())
            }
            Self::ExplicitLane => {
                require!(accounts.len() <= 1, ClearingError::Profile);
                if let Some(lane) = accounts.first_mut() {
                    scope.raw::<MakerRegistration>(lane, Access::Write)?;
                }
                Ok(())
            }
            Self::SelectedMakers(plan) => {
                let boundary=plan.extras.checked_mul(6).ok_or(ClearingError::Profile)?;
                require!(plan.extras<=5 && accounts.len()>=boundary && accounts.len()<=boundary+3, ClearingError::Profile);
                let (bundles,lanes)=accounts.split_at_mut(boundary);
                for (index,bundle) in bundles.chunks_exact_mut(6).enumerate() {
                    let access=if plan.filled[3+index] {Access::Write} else {Access::Read};
                    scope.raw::<MarginAccount>(&mut bundle[0],access)?;
                    scope.raw::<MakerRegistration>(&mut bundle[1],access)?;
                }
                for account in lanes {
                    let access = if Some(*account.address()) == plan.external_lane { Access::Write } else { Access::Read };
                    scope.raw::<MakerRegistration>(account, access)?;
                }
                Ok(())
            }
            Self::MembershipScan(root_write) => {
                require!(accounts.len() <= 2, ClearingError::Resolution);
                for account in accounts {
                    let discriminator = account
                        .try_borrow()?
                        .get(..8)
                        .ok_or(ClearingError::Resolution)?
                        .to_vec();
                    if discriminator == MemberIndexNode::DISCRIMINATOR {
                        scope.raw::<MemberIndexNode>(account, Access::Read)?;
                    } else if discriminator == MemberPage::DISCRIMINATOR {
                        scope.raw::<MemberPage>(account, Access::Read)?;
                    } else {
                        scope.raw::<MarginAccount>(account, if root_write { Access::Write } else { Access::Read })?;
                    }
                }
                Ok(())
            }
            Self::FrozenPlanPages => {
                for account in accounts {scope.raw::<FrozenMarginPage>(account,Access::Write)?;}
                Ok(())
            }
            #[cfg(feature = "checked-funding-prefix")]
            Self::FundingRegistrations => {
                require!(accounts.len()==3,ClearingError::Profile);
                for account in accounts {scope.raw::<MakerRegistration>(account,Access::Read)?;}
                Ok(())
            }
            Self::MembershipPath => {
                require!(accounts.len() == 15, ClearingError::Resolution);
                for account in accounts {
                    scope.raw::<MemberIndexNode>(account, Access::Write)?;
                }
                Ok(())
            }
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
    let mut remaining = context.remaining_accounts()?;
    #[cfg(feature = "maintained-coverage")]
    let coverage_lanes = {
        let start = crate::shadow_coverage::maintenance::trailing_lanes(&remaining)?;
        remaining.split_off(start)
    };
    #[cfg(feature = "book-inventory-qualification")]
    let mut scope = if matches!(access, Remaining::FrozenPlanPages) {
        Scope::inventory_pages(remaining.len())?
    } else {
        Scope::new()
    };
    #[cfg(not(feature = "book-inventory-qualification"))]
    let mut scope = Scope::new();
    #[cfg(feature = "listed-venue-execution")]
    if context.accounts.venue().profile_version == LISTED_VENUE_PROFILE {
        use crate::instructions::maker_liquidity::routes::listed_venue;
        require!(listed_venue::permits(instruction), ClearingError::Profile);
        scope.listed_margin_write = instruction == listed_venue::FILL || listed_venue::is_cash(instruction);
        require!(coverage_lanes.is_empty(), ClearingError::Profile);
    }
    #[cfg(feature="listed-venue-cash")]
    let access = if scope.listed_margin_write && crate::instructions::maker_liquidity::routes::listed_venue::is_cash(instruction) {
        Remaining::ListedCashWindows
    } else { access };
    if let Remaining::SelectedMakers(selected) = access {
        scope.selected_makers = Some(selected);
    }
    context.accounts.visit(&mut scope)?;
    access.visit(&mut scope, &mut remaining)?;
    let mut payloads = event_cpi::Payloads::default();
    #[cfg(feature = "read-only-route-ledger")]
    if scope.entries.iter().any(|entry| matches!(entry.kind, 6 | 7) && entry.access != Access::Create) {
        let mode=scope.venue_mode.ok_or(ClearingError::Profile)?;
        if mode == crate::state::accounts::ACTIVE && instruction != [1,178,168,44,243,136,161,76] {
        crate::market_checkpoint::require_financial_checkpoints(instruction, scope.entries.iter()
            .filter(|entry| entry.access != Access::Create).map(|entry| (entry.kind,entry.account)))?;
        }
    }
    #[cfg(all(feature = "read-only-route-market", not(feature = "read-only-route-ledger")))]
    if instruction != [234, 231, 222, 47, 209, 237, 138, 64] && instruction != [154, 97, 38, 114, 234, 143, 70, 85] {
        let markets = scope.entries.iter().filter(|entry| entry.kind == Market::KIND && entry.access != Access::Create)
            .map(|entry| entry.account);
        if markets.clone().next().is_some() {
            let mode = scope.venue_mode.ok_or(ClearingError::Profile)?;
            if mode == crate::state::accounts::ACTIVE {
                crate::market_checkpoint::require_recent(markets)?;
            }
        }
    }
    profile_cu!("handler-enter");
    handler(context, &mut payloads)?;
    profile_cu!("handler-exit");
    scope.cursor = Some(0);
    context.accounts.visit(&mut scope)?;
    access.visit(&mut scope, &mut remaining)?;
    let venue_account = context.accounts.venue();
    let (venue, domain) = (*venue_account.address(), venue_account.domain);
    #[cfg(feature = "maintained-coverage")]
    scope.coverage.commit(venue, &coverage_lanes)?;
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

pub(crate) fn run_explicit_route<'context, T: ScopedContext>(
    context: &mut Context<'context, T>, instruction: [u8; 8],
    handler: impl FnOnce(&mut Context<'context, T>, &mut event_cpi::Payloads) -> Result<()>,
) -> Result<()> {
    run_with_remaining(context, instruction, Remaining::ExplicitLane, handler)
}

pub(crate) fn run_selected_route<'context, T: ScopedContext>(
    context: &mut Context<'context, T>,
    instruction: [u8; 8],
    plan: MakerAccess,
    handler: impl FnOnce(&mut Context<'context, T>, &mut event_cpi::Payloads) -> Result<()>,
) -> Result<()> {
    run_with_remaining(context, instruction, Remaining::SelectedMakers(plan), handler)
}

#[cfg(test)]
mod tests;
