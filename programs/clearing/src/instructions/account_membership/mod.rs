//! Successor live membership. Public lifecycle/authority integration is still
//! gated; an authenticated index update alone cannot admit financial activity.
pub(crate) mod index;
pub(crate) mod storage;
mod contexts;
pub use contexts::*;
pub(crate) mod provision;
pub(crate) mod lifecycle;
pub(crate) mod allocation;
pub(crate) mod members;
pub(crate) mod handlers;
pub(crate) mod scan;
