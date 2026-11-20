//! Check the proportional, lot and ordered winner priorities without enumerating ties.
use super::{
    alloc::{vec, vec::Vec},
    foreign_protection::ProtectionTotals,
    original_terms::OriginalTerms,
    required_limbs, verify, Arithmetic, Charge, Error, FrozenBook, Receipt, Result, Witness,
};
use crate::{
    joint_priority::weights, linked_sharing::LinkedSharing, member_priority,
    proportional::MemberPriority,
};
use financial_core::clearing::scalable::snapshot::ClaimTotal;

pub struct SharingResult {
    pub linked_caps: [u128; 2],
    pub lot_floor: [u128; 2],
    pub winner_floor: [Option<u128>; 2],
    pub certified: bool,
}

impl FrozenBook<'_> {
    /// Admit the actual paired fills and adjusted settlement before checking
    /// any higher-priority bound. A final pair check alone assumes fixed totals.
    pub fn verify_dense_selection(
        &self,
        original: Witness<'_>,
        effective: Witness<'_>,
        charges: &[Charge],
        venue: &[u8; 32],
        epoch: u64,
    ) -> Result<(Receipt, bool, SharingResult)> {
        let (receipt, pair_order) =
            self.verify_with_pair_order(original, effective, charges, venue, epoch)?;
        let sharing = self.verify_sharing_bounds(original, charges, &receipt, venue, epoch)?;
        Ok((receipt, pair_order, sharing))
    }

    fn verify_sharing_bounds(
        &self,
        original: Witness<'_>,
        charges: &[Charge],
        receipt: &Receipt,
        venue: &[u8; 32],
        epoch: u64,
    ) -> Result<SharingResult> {
        let rows: Vec<_> = self.members.iter().map(|member| member.row).collect();
        let count = u64::try_from(rows.len()).map_err(|_| Error::Bounds)?;
        let mut arithmetic = Arithmetic::new(required_limbs(count)?, 128)?;
        let original = verify(
            &rows,
            self.pools,
            self.insurance,
            self.fees,
            original.rates,
            &mut arithmetic,
        )?;
        let terms = OriginalTerms::from_verified(&original)?;
        let mut bound = ProtectionTotals::default();
        let mut positive = [ClaimTotal::default(); 2];
        let mut links = Vec::with_capacity(rows.len());
        for (row, budget) in rows.iter().zip(&receipt.budgets) {
            links.push(bound.include(row, *budget)?);
            for (market, total) in positive.iter_mut().enumerate() {
                let value = row.claims[market].max(0) as u128;
                *total = total.add(ClaimTotal::from_words([
                    value as u64,
                    (value >> 64) as u64,
                    0,
                ])?)?;
            }
        }
        let caps = bound.linked_caps(positive, self.pools, self.insurance, &terms)?;
        let mut edges = Vec::new();
        self.visit_edges(&receipt.budgets, |edge| {
            edges.push(edge);
            Ok(true)
        })?;
        let weights = weights(self, &edges)?;
        let mut amount = vec![[0u64; 2]; rows.len()];
        let mut actual_lots = [0u128; 2];
        for (charge, fill) in charges.iter().zip(&receipt.fills) {
            let winner = self
                .members
                .binary_search_by_key(&charge.winner, |member| member.id)
                .map_err(|_| Error::Cohort)?;
            let target = &mut amount[winner][charge.market];
            *target = target.checked_add(charge.atoms).ok_or(Error::Overflow)?;
            actual_lots[charge.market] += u128::from(fill.matched);
        }
        let mut result = SharingResult {
            linked_caps: caps,
            lot_floor: [0; 2],
            winner_floor: [None; 2],
            certified: receipt.reaches_both_recovery_ceilings(),
        };
        for market in 0..2 {
            let total = bound.budget[market];
            let cap = caps[market];
            let mut sharing = LinkedSharing::default();
            let mut fastest = [0u64; 2];
            for (index, member) in self.members.iter().enumerate() {
                let weight = weights[index][market];
                if weight == 0 {
                    if amount[index][market] != 0 {
                        return Err(Error::Entitlement);
                    }
                    continue;
                }
                let lots = member.lots[market];
                let rate = self
                    .capacity(member, market, lots.unsigned_abs())?
                    .lot_rate(lots.unsigned_abs())?;
                let member_order = MemberPriority {
                    digest: member_priority(venue, epoch, member.id),
                    id: member.id,
                };
                sharing
                    .include(
                        links[index][market],
                        total,
                        member_order,
                        weight,
                        amount[index][market],
                        |n| rate.matched(n).ok(),
                    )
                    .ok_or(Error::Entitlement)?;
                let side = usize::from(lots > 0);
                fastest[side] = fastest[side].max(rate.numerator.div_ceil(rate.denominator));
            }
            let mut debtor_floor = 0u128;
            for (member, budget) in self.members.iter().zip(&receipt.budgets) {
                if budget[market] > 0 {
                    let upper = fastest[usize::from(member.lots[market] < 0)];
                    if upper == 0 || member.lots[market] == 0 {
                        return Err(Error::Entitlement);
                    }
                    debtor_floor += u128::from(budget[market].div_ceil(upper));
                }
            }
            if let Some(certificate) = sharing.certify(total, cap) {
                result.winner_floor[market] = certificate.winner_lot_floor;
                result.lot_floor[market] =
                    debtor_floor.max(certificate.winner_lot_floor.unwrap_or(0));
                result.certified &= result.lot_floor[market] == actual_lots[market];
            } else {
                result.certified = false;
            }
        }
        Ok(result)
    }
}
