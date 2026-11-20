//! Resource measurement of the existing exact general settlement kernel on one
//! authenticated page and an already certified cross-creditor reduction.
use super::*;
use clearing::instructions::account_safety::settlement::foreign_creditor::Receipt;
use financial_core::clearing::{
    row::Row,
    scalable::{
        number::{Arithmetic, Number},
        rounding::Circulation,
        settlement::{verify, verify_reduced_claims},
        wide::required_limbs,
    },
};

#[derive(Accounts)]
pub struct AuditSettlement {
    pub source: Nested<RecoverySource>,
    pub page: Box<BorshAccount<FrozenMarginPage>>,
}

fn arithmetic<T>(result: financial_core::Result<T>) -> Result<T> {
    result.map_err(|_| ProofError::Accounting.into())
}
fn finish(graph: &mut Circulation<'_, '_>) -> Result<[u64; 8]> {
    while !graph.is_done() {
        require!(!graph.protected_search_exhausted(), ProofError::Accounting);
        arithmetic(graph.step())?;
    }
    arithmetic(graph.result())?
        .cash
        .try_into()
        .map_err(|_| ProofError::Accounting.into())
}

#[inline(never)]
pub fn audit(
    accounts: &AuditSettlement,
    epoch: u64,
    revision: u64,
    phase: u8,
    before: RateWitness,
    after: RateWitness,
) -> Result<[u64; 8]> {
    let header = &accounts.source.prepared;
    accounts.source.check_stage(epoch, 2)?;
    require!(
        header.revision == revision
            && header.count == 8
            && accounts.page.row_count == 8
            && phase <= 3,
        ProofError::Source
    );
    let receipt = Receipt::read(header)?.ok_or(ProofError::Source)?;
    let mut original = Vec::with_capacity(8);
    let mut adjusted = Vec::with_capacity(8);
    for ordinal in 0..8 {
        let row = source::row(header, &accounts.page, ordinal)?;
        original.push(Row {
            cash: row.cash,
            claims: row.claims,
        });
        adjusted.push(Row {
            cash: row.cash,
            claims: receipt.claims(row)?,
        });
    }
    let mut work = arithmetic(Arithmetic::new(arithmetic(required_limbs(8))?, 128))?;
    if phase == 1 {
        let effective = arithmetic(verify_reduced_claims(
            &original,
            &adjusted,
            header.pools,
            header.insurance,
            header.fees,
            &after.proposal(),
            &mut work,
        ))?;
        let mut result = [0; 8];
        result[..2].copy_from_slice(&effective.insurance_spent());
        return Ok(result);
    }
    let baseline = arithmetic(verify(
        &original,
        header.pools,
        header.insurance,
        header.fees,
        &before.proposal(),
        &mut work,
    ))?;
    if phase == 0 {
        let mut result = [0; 8];
        result[..2].copy_from_slice(&baseline.insurance_spent());
        return Ok(result);
    }
    let orders = before.orders();
    let mut prior = arithmetic(Circulation::new(
        &baseline,
        [&orders[0], &orders[1]],
        &mut work,
    ))?;
    let cash = finish(&mut prior)?;
    if phase == 2 {
        return Ok(cash);
    }
    let effective = arithmetic(verify_reduced_claims(
        &original,
        &adjusted,
        header.pools,
        header.insurance,
        header.fees,
        &after.proposal(),
        &mut work,
    ))?;
    let orders = after.orders();
    let mut protected = arithmetic(Circulation::after_reduction(
        &effective,
        &prior,
        [&orders[0], &orders[1]],
        &mut work,
    ))?;
    finish(&mut protected)
}
