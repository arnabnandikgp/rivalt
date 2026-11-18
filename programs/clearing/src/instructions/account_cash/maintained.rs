//! The sole ordinary economic contribution update. Existing contexts authenticate
//! the complete before/after union of market ledgers; this adds no page accounts.
use super::*;

fn fixed(position: crate::state::Position) -> Result<i128> {
    add(position.virtual_scaled, i128::from(position.lots)
        .checked_mul(position.funding_checkpoint_scaled).ok_or(ClearingError::Arithmetic)?)
}

/// Orders/delegation can consume funding or change reservations, but their
/// ledger-free commit must never change cash, quantities or adjusted claims.
pub(crate) fn unchanged(before: &MarginAccount, after: &MarginAccount) -> Result<()> {
    require!(before.cash == after.cash, ClearingError::Reconciliation);
    for index in 0..2 {
        require!(before.positions[index].lots == after.positions[index].lots
            && fixed(before.positions[index])? == fixed(after.positions[index])?, ClearingError::Reconciliation);
    }
    Ok(())
}

#[inline(never)]
pub(crate) fn update(
    ledgers: [Option<&mut MarketLedger>; 2],
    before: &MarginAccount,
    after: &MarginAccount,
    safety: &VenueSafety,
) -> Result<()> {
    require!(before.venue == after.venue && before.id == after.id
        && before.lifecycle == MEMBER_FINANCIAL && after.lifecycle == MEMBER_FINANCIAL
        && before.activation_generation == after.activation_generation
        && before.backing_epochs == after.backing_epochs, ClearingError::Profile);
    for (index, ledger) in ledgers.into_iter().enumerate() {
        let relevant = [before.positions[index], after.positions[index]].iter()
            .any(|position| position.lots != 0 || position.virtual_scaled != 0);
        // With q=z=0, selected bad/q/z/dependency contribution is identically
        // zero under any cash/sibling change. Its coverage marker stays intact.
        if !relevant { continue; }
        let ledger = ledger.ok_or(ClearingError::OrderState)?;
        require!(ledger.schema_version == SCHEMA_VERSION && ledger.venue == before.venue
            && ledger.market_index as usize == index, ClearingError::Profile);
        increment(&mut ledger.liability_version)?;
        if ledger.backing.epoch != 0 && ledger.backing.safety_epoch == safety.epoch
            && safety.mode == ACTIVE && before.backing_epochs[index] == ledger.backing.epoch {
            let region = ledger.backing.region.model();
            let old = checked(region.contribution(&trading::model(before)?, index))?;
            let new = checked(region.contribution(&trading::model(after)?, index))?;
            let totals = checked(ledger.backing.totals()?.replace(old, new))?;
            ledger.backing.summary = totals.checkpoint();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use financial_core::{backing::Summary, SCALE};
    fn root() -> MarginAccount {
        MarginAccount { schema_version: SCHEMA_VERSION, venue: Address::new_unique(),
            mode: MODE_CROSS, isolated_market_index: CROSS_MARKET_SENTINEL,
            lifecycle: MEMBER_FINANCIAL, activation_generation: 1, delegate_epoch: 1,
            cash: 120, backing_epochs: [7; 2],
            positions: [-80*SCALE, -40*SCALE].map(|virtual_scaled| crate::state::Position {
                virtual_scaled, ..Default::default() }), ..Default::default() }
    }
    fn ledgers(root: &MarginAccount) -> [MarketLedger; 2] {
        [0, 1].map(|index| {
            let region = BackingRegion { prices: [[1, 100]; 2], funding: [[-SCALE, SCALE]; 2] };
            let contribution = region.model().contribution(&trading::model(root).unwrap(), index).unwrap();
            MarketLedger {schema_version: SCHEMA_VERSION, venue: root.venue, market_index: index as u8,
                backing: BackingState {epoch: 7, safety_epoch: 3, region,
                    summary: Summary::default().insert(contribution).unwrap().checkpoint(), ..Default::default()},
                ..Default::default()}
        })
    }
    fn safety() -> VenueSafety { VenueSafety {mode: ACTIVE, epoch: 3, ..Default::default()} }
    #[test]
    fn processed_cash_changes_install_bad_and_repair_without_restarting_coverage() {
        let original = root(); let mut ledgers = ledgers(&original);
        let mut withdrawn = original.clone(); withdrawn.cash = 100;
        update(ledgers.each_mut().map(Some), &original, &withdrawn, &safety()).unwrap();
        for ledger in &ledgers {
            assert_eq!(ledger.backing.epoch, 7);
            assert_eq!((ledger.backing.totals().unwrap().count(),ledger.backing.totals().unwrap().bad()), (1,1));
        }
        update(ledgers.each_mut().map(Some), &withdrawn, &original, &safety()).unwrap();
        for ledger in &ledgers {
            assert_eq!((ledger.backing.totals().unwrap().count(),ledger.backing.totals().unwrap().bad()), (1,0));
        }
    }
    #[test]
    fn unprocessed_or_old_safety_roots_cannot_alter_another_epoch_summary() {
        let original = root(); let mut ledgers = ledgers(&original);
        let checkpoints = ledgers.each_ref().map(|ledger| ledger.backing.summary);
        let mut unprocessed = original.clone(); unprocessed.id = 9; unprocessed.backing_epochs = [6; 2];
        let mut next = unprocessed.clone(); next.cash = 1;
        update(ledgers.each_mut().map(Some), &unprocessed, &next, &safety()).unwrap();
        assert_eq!(ledgers.each_ref().map(|ledger| ledger.backing.summary), checkpoints);
        let mut recovered = safety(); recovered.epoch = 4;
        let mut next = original.clone(); next.cash = 1;
        update(ledgers.each_mut().map(Some), &original, &next, &recovered).unwrap();
        assert_eq!(ledgers.each_ref().map(|ledger| ledger.backing.summary), checkpoints);
    }
    #[test]
    fn order_only_commits_require_exact_cash_quantity_and_adjusted_claim_identity() {
        let mut before = root(); before.positions[0].lots = 3; before.positions[0].generation = 1;
        let mut after = before.clone();
        after.positions[0].funding_checkpoint_scaled = SCALE/3;
        after.positions[0].virtual_scaled -= SCALE/3*3;
        after.reserved = 7;
        unchanged(&before, &after).unwrap();
        after.positions[0].virtual_scaled -= 1;
        assert!(unchanged(&before, &after).is_err());
        after = before.clone(); after.cash -= 1;
        assert!(unchanged(&before, &after).is_err());
        after = before.clone(); after.positions[1].lots = 1;
        assert!(unchanged(&before, &after).is_err());
    }
    #[test]
    fn missing_required_ledger_foreign_identity_and_changed_markers_reject() {
        let original = root(); let mut next = original.clone(); next.cash = 121;
        assert!(update([None,None], &original, &next, &safety()).is_err());
        let mut ledgers = ledgers(&original); ledgers[0].venue = Address::new_unique();
        assert!(update(ledgers.each_mut().map(Some), &original, &next, &safety()).is_err());
        let mut ledgers = self::ledgers(&original); next.backing_epochs[0] = 8;
        assert!(update(ledgers.each_mut().map(Some), &original, &next, &safety()).is_err());
        let mut neutral = original; neutral.positions = [crate::state::Position::default();2];
        let mut cash_only = neutral.clone(); cash_only.cash += 1;
        update([None,None], &neutral, &cash_only, &safety()).unwrap();
    }
}
