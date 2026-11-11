//! Manually validated account storage with source-derived IDL type registration.
//! This has exactly UncheckedAccount's runtime semantics: the owning handler and
//! scoped journal must authenticate every owner, discriminator, layout and PDA.
//! It adds no witness account, fake instruction or manually maintained JSON type.
use anchor_lang::prelude::*;
use core::{marker::PhantomData, ops::Deref};

pub struct ManualAccount<T> {
    inner: UncheckedAccount,
    types: PhantomData<fn() -> T>,
}
impl<T> ManualAccount<T> {
    pub(crate) fn unchecked_mut(&mut self) -> &mut UncheckedAccount { &mut self.inner }
}
impl<T> Deref for ManualAccount<T> {
    type Target = AccountView;
    fn deref(&self) -> &AccountView { self.inner.account() }
}
impl<T> AnchorAccount for ManualAccount<T> {
    type Data = AccountView;
    fn load(view: AccountView) -> Result<Self> {
        Ok(Self { inner: UncheckedAccount::load(view)?, types: PhantomData })
    }
    fn account(&self) -> &AccountView { self.inner.account() }
}
impl<T> AsRef<AccountView> for ManualAccount<T> {
    fn as_ref(&self) -> &AccountView { self.account() }
}
impl<T> AsRef<Address> for ManualAccount<T> {
    fn as_ref(&self) -> &Address { self.address() }
}
impl<T> anchor_lang::ToCpiHandle for ManualAccount<T> {
    fn to_cpi_handle(&self) -> anchor_lang::CpiHandle<'_> { self.cpi_handle() }
}
impl<T> anchor_lang::ToCpiHandleMut for ManualAccount<T> {
    fn try_to_cpi_handle_mut(&mut self) -> Result<anchor_lang::CpiHandleMut<'_>> { self.try_cpi_handle_mut() }
}
// RC2's pinned transitive IDL walker supports account types which appear only in
// manual loaders (including same-address retirement). Numeric wire conformance
// separately verifies every emitted layout; no runtime trust derives from this.
#[cfg(feature="idl-build")]
impl<T: anchor_lang::IdlAccountType> anchor_lang::IdlAccountType for ManualAccount<T> {
    fn __register_idl_deps(accounts: &mut Vec<&'static str>, types: &mut Vec<&'static str>) {
        T::__register_idl_deps(accounts, types);
    }
}
