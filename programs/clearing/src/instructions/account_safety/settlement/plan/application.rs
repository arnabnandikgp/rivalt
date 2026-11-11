//! Root mutation primitives for the forthcoming exclusive-adoption controller.
//! Not an instruction: callers must authenticate source/plan/graph ownership and
//! commit the complete application scan, flow applied bit and this root atomically.
use super::*;
use crate::instructions::{account_custody::increment, account_trading};
use financial_core::clearing::scalable::application::AppliedAmounts;

fn empty_position(position: &crate::state::Position) -> bool {
    position.lots == 0
        && position.virtual_scaled == 0
        && position.funding_checkpoint_scaled == 0
        && position.generation == 0
}
pub(super) fn original_margin(
    header: &PreparedSettlement,
    frozen: &FrozenMargin,
    root: &MarginAccount,
) -> Result<()> {
    require!(
        root.venue == header.venue
            && u64::from(root.id) == frozen.id
            && frozen.activation_generation == 1
            && root.revision == frozen.original_revision
            && root.cash == frozen.cash
            && root.positions.map(|position| position.lots) == frozen.lots
            && root.positions.map(|position| position.generation) == frozen.generations
            && exact(account_trading::model(root)?.claims(header.prices, header.funding))?
                == frozen.claims,
        ClearingError::Resolution
    );
    Ok(())
}

/// All fallible mutations occur on the private candidate. Generation/nonce
/// exhaustion cannot leave a partially cleared root even in native execution.
#[inline(never)]
pub(super) fn applied_margin(
    header: &PreparedSettlement,
    frozen: &FrozenMargin,
    root: &MarginAccount,
    amounts: AppliedAmounts,
) -> Result<Box<MarginAccount>> {
    original_margin(header, frozen, root)?;
    let mut next = Box::new(root.clone());
    next.cash = amounts.cash;
    for (market, position) in next.positions.iter_mut().enumerate() {
        if next.mode == MODE_ISOLATED && usize::from(next.isolated_market_index) != market {
            require!(empty_position(position), ClearingError::Profile);
            continue;
        }
        position.lots = 0;
        position.virtual_scaled = 0;
        position.funding_checkpoint_scaled = header.funding[market];
        increment(&mut position.generation)?;
    }
    // Both order and protective-group identifiers remain monotone. Nonces and
    // generations separately invalidate every previously signed trade/order.
    let (last_order_id, last_group_id) = (next.book.last_order_id, next.book.last_group_id);
    next.book = Default::default();
    next.book.last_order_id = last_order_id;
    next.book.last_group_id = last_group_id;
    next.reserved = 0;
    next.delegate = Address::default();
    next.delegate_expiry_slot = 0;
    increment(&mut next.delegate_epoch)?;
    increment(&mut next.nonce)?;
    increment(&mut next.state_version)?;
    account_trading::model(&next)?;
    // Scoped history alone increments revision after the financial commit.
    Ok(next)
}
pub(super) fn reconciled_margin(
    header: &PreparedSettlement,
    frozen: &FrozenMargin,
    root: &MarginAccount,
    final_cash: u64,
) -> Result<()> {
    require!(
        root.venue == header.venue
            && u64::from(root.id) == frozen.id
            && frozen.original_revision.checked_add(1) == Some(root.revision)
            && root.cash == final_cash
            && root.reserved == 0
            && root.delegate == Address::default()
            && root.delegate_expiry_slot == 0
            && root.positions.iter().enumerate().all(|(market, position)| {
                if root.mode == MODE_ISOLATED && usize::from(root.isolated_market_index) != market {
                    empty_position(position)
                } else {
                    position.lots == 0
                        && position.virtual_scaled == 0
                        && position.funding_checkpoint_scaled == header.funding[market]
                        && frozen.generations[market].checked_add(1) == Some(position.generation)
                }
            })
            && root.book.reserve_observations == [0; 2],
        ClearingError::Reconciliation
    );
    // Compare every book byte, including dormant order/protection fields, while
    // retaining its two monotone identifiers. Flags alone are not sufficient.
    let mut empty = crate::state::OrderBook::default();
    empty.last_order_id = root.book.last_order_id;
    empty.last_group_id = root.book.last_group_id;
    let (mut actual, mut expected) = (Vec::new(), Vec::new());
    crate::wire::write(&root.book, &mut actual)?;
    crate::wire::write(&empty, &mut expected)?;
    require!(actual == expected, ClearingError::Reconciliation);
    account_trading::model(root)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use financial_core::SCALE;
    fn fixture(isolated: bool) -> (PreparedSettlement, FrozenMargin, MarginAccount) {
        let header = PreparedSettlement {
            venue: Address::new_unique(),
            prices: [10, 20],
            funding: [5 * SCALE, 3 * SCALE],
            ..Default::default()
        };
        let mut root = MarginAccount {
            schema_version: 8,
            revision: 7,
            venue: header.venue,
            id: 0,
            mode: if isolated { MODE_ISOLATED } else { MODE_CROSS },
            isolated_market_index: if isolated { 0 } else { CROSS_MARKET_SENTINEL },
            subaccount_index: u16::from(isolated),
            cash: 1,
            delegate_epoch: 4,
            nonce: 12,
            state_version: 19,
            owner: Address::new_unique(),
            delegate: Address::new_unique(),
            delegate_expiry_slot: 400,
            ..Default::default()
        };
        root.positions[0] = crate::state::Position {
            lots: 1,
            virtual_scaled: -7 * SCALE,
            funding_checkpoint_scaled: 0,
            generation: 5,
        };
        if !isolated {
            root.positions[1] = crate::state::Position {
                lots: -1,
                virtual_scaled: 17 * SCALE,
                funding_checkpoint_scaled: 0,
                generation: 9,
            };
        }
        root.book.last_order_id = 33;
        root.book.last_group_id = 27;
        root.book.reserve_observations = [81, 83];
        let frozen = FrozenMargin {
            id: 0,
            activation_generation: 1,
            original_revision: 7,
            cash: 1,
            collected: 1,
            lots: root.positions.map(|position| position.lots),
            generations: root.positions.map(|position| position.generation),
            claims: [-2 * SCALE, 0],
            ..Default::default()
        };
        (header, frozen, root)
    }
    fn amounts() -> AppliedAmounts {
        AppliedAmounts {
            cash: 0,
            flows: [1, 0],
            movements: [-1, 0],
        }
    }
    #[test]
    fn cross_and_isolated_application_preserve_ids_funding_and_invalidate_authority() {
        for isolated in [false, true] {
            let (header, frozen, root) = fixture(isolated);
            let mut next = applied_margin(&header, &frozen, &root, amounts()).unwrap();
            assert_eq!(root.cash, 1);
            assert_eq!(root.nonce, 12);
            assert_eq!(next.cash, 0);
            assert_eq!(
                (next.nonce, next.state_version, next.delegate_epoch),
                (13, 20, 5)
            );
            assert_eq!((next.book.last_order_id, next.book.last_group_id), (33, 27));
            assert_eq!(next.revision, 7);
            assert_eq!(next.positions[0].funding_checkpoint_scaled, 5 * SCALE);
            assert_eq!(next.positions[0].generation, 6);
            if isolated {
                assert!(empty_position(&next.positions[1]));
            } else {
                assert_eq!(next.positions[1].generation, 10);
                assert_eq!(next.positions[1].funding_checkpoint_scaled, 3 * SCALE);
            }
            assert!(reconciled_margin(&header, &frozen, &next, 0).is_err());
            next.revision += 1;
            reconciled_margin(&header, &frozen, &next, 0).unwrap();
            assert!(applied_margin(&header, &frozen, &next, amounts()).is_err());
            next.book.orders[0].market_index = 1;
            assert!(reconciled_margin(&header, &frozen, &next, 0).is_err());
        }
    }
    #[test]
    fn accrued_claim_revision_and_counter_exhaustion_reject_without_mutating_root() {
        let (header, frozen, root) = fixture(false);
        for changed in [
            MarginAccount {
                revision: 8,
                ..root.clone()
            },
            MarginAccount {
                nonce: u64::MAX,
                ..root.clone()
            },
            MarginAccount {
                state_version: u64::MAX,
                ..root.clone()
            },
            MarginAccount {
                delegate_epoch: u64::MAX,
                ..root.clone()
            },
        ] {
            let mut before = Vec::new();
            crate::wire::write(&changed, &mut before).unwrap();
            assert!(applied_margin(&header, &frozen, &changed, amounts()).is_err());
            let mut after = Vec::new();
            crate::wire::write(&changed, &mut after).unwrap();
            assert_eq!(before, after);
        }
        let mut wrong = header;
        wrong.funding[0] += 1;
        assert!(applied_margin(&wrong, &frozen, &root, amounts()).is_err());
    }
}
