//! Scalar account validation and root-scoped trading authority.
use super::*;

pub(crate) fn model(root: &MarginAccount) -> Result<math::margin::Margin> {
    require!(
        root.schema_version == SCHEMA_VERSION
            && valid_identity(
                0,
                root.subaccount_index,
                root.mode,
                root.isolated_market_index,
                root.role
            )
            && root.delegate_epoch > 0
            && ((root.delegate == Pubkey::default()) == (root.delegate_expiry_slot == 0))
            && (root.delegate == Pubkey::default() || root.delegate != root.owner),
        ClearingError::Profile
    );
    let model = math::margin::Margin {
        id: root.id,
        mode: if root.mode == MODE_CROSS {
            math::margin::Mode::Cross
        } else {
            math::margin::Mode::Isolated(usize::from(root.isolated_market_index))
        },
        cash: root.cash,
        reserved: root.reserved,
        positions: root.positions.map(|position| math::margin::Position {
            lots: position.lots,
            virtual_scaled: position.virtual_scaled,
            funding_checkpoint: position.funding_checkpoint_scaled,
            generation: position.generation,
        }),
    };
    checked(model.validate())?;
    Ok(model)
}

pub(crate) fn commit_model(
    root: &mut MarginAccount,
    candidate: math::margin::Margin,
) -> Result<()> {
    let previous = model(root)?;
    require!(
        candidate.id == previous.id && candidate.mode == previous.mode,
        ClearingError::Profile
    );
    checked(candidate.validate())?;
    root.cash = candidate.cash;
    root.reserved = candidate.reserved;
    root.positions = candidate.positions.map(|position| Position {
        lots: position.lots,
        virtual_scaled: position.virtual_scaled,
        funding_checkpoint_scaled: position.funding_checkpoint,
        generation: position.generation,
    });
    Ok(())
}

/// Zero identifies owner-created durable authority. The live delegate grant is
/// scoped to this root and expires exclusively at its stored slot.
pub(crate) fn trade_authority(root: &MarginAccount, actor: Pubkey, slot: u64) -> Result<u64> {
    model(root)?;
    if actor == root.owner {
        return Ok(0);
    }
    require!(
        actor != Pubkey::default() && actor == root.delegate && slot < root.delegate_expiry_slot,
        ClearingError::Authority
    );
    Ok(root.delegate_epoch)
}

pub(crate) fn live_order_authority(root: &MarginAccount, epoch: u64, slot: u64) -> bool {
    epoch == 0
        || (epoch == root.delegate_epoch
            && root.delegate != Pubkey::default()
            && slot < root.delegate_expiry_slot)
}
