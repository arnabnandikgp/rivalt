//! Authenticate bound source accounts before evaluating their price policy.
use super::*;
use financial_core::oracle as policy;
use oracle_fixture::{Feed, ID as FIXTURE};

pub(crate) fn source(
    info: &AccountInfo,
    expected: Pubkey,
    index: usize,
    sequence: u64,
) -> Result<(policy::Price, u64)> {
    binding(info, expected, index)?;
    #[cfg(feature = "devnet-test-profile")]
    if index < 2 {
        return crate::pyth_core::decode(info, index, sequence, Clock::get()?.slot)
            .ok_or_else(|| error!(ClearingError::OracleSource));
    }
    require!(
        info.key == &expected && info.owner == &FIXTURE && !info.is_writable,
        ClearingError::OracleSource
    );
    let bytes = info.try_borrow_data()?;
    require!(
        bytes.len() == 8 + Feed::INIT_SPACE,
        ClearingError::OracleSource
    );
    let feed = Feed::try_deserialize(&mut &bytes[..])?;
    require!(
        feed.feed_id == [index as u8 + 1; 32]
            && feed.value.verifier == FIXTURE
            && feed.value.level == 2
            && feed.sequence > 0
            && feed.sequence >= sequence,
        ClearingError::OracleSource
    );
    Ok((
        policy::Price {
            value: feed.value.price,
            confidence: feed.value.confidence,
            exponent: feed.value.exponent,
            published: feed.value.published,
        },
        feed.sequence,
    ))
}

/// Bad account substitution rejects before a policy failure can be recorded.
pub(crate) fn binding(info: &AccountInfo, expected: Pubkey, index: usize) -> Result<()> {
    #[cfg(feature = "devnet-test-profile")]
    let owner = if index < 2 {
        crate::pyth_core::RECEIVER
    } else {
        FIXTURE
    };
    #[cfg(not(feature = "devnet-test-profile"))]
    let owner = {
        let _ = index;
        FIXTURE
    };
    require!(
        info.key == &expected && info.owner == &owner && !info.is_writable && !info.executable,
        ClearingError::OracleSource
    );
    Ok(())
}
