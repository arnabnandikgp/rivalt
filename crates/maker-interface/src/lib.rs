//! Bounded, read-only maker quote contract. Quotes confer no clearing authority.
pub mod canonical;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuoteError {
    Binding,
    Lifetime,
    Bounds,
    Capacity,
    Arithmetic,
    Producer,
    Response,
}
type QuoteResult<T> = core::result::Result<T, QuoteError>;
