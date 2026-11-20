use super::{
    admission::{apply_deltas, financial, number, VERIFIED, VERIFY_RATES},
    *,
};
use financial_core::clearing::scalable::{
    insurance_rounds::InsuranceRounds,
    normalized::Magnitude,
    rate_work::{RateInput, RateWork},
    wide::LimbStorage,
};

/// Physical scratch capacity is paid by the proposer. The core still uses its
/// normal count-derived numerical bounds. A missing physical word fails closed.
struct Registers<'a> {
    width: usize,
    words: &'a mut [u64],
}
impl Registers<'_> {
    fn index(&self, register: u32, limb: u64) -> financial_core::Result<usize> {
        let limb = usize::try_from(limb).map_err(|_| financial_core::Error::Bounds)?;
        if register >= 25 || limb >= self.width {
            return Err(financial_core::Error::Bounds);
        }
        Ok(register as usize * self.width + limb)
    }
}
impl LimbStorage for Registers<'_> {
    fn read(&self, register: u32, limb: u64) -> financial_core::Result<u64> {
        self.words
            .get(self.index(register, limb)?)
            .copied()
            .ok_or(financial_core::Error::Bounds)
    }
    fn write(&mut self, register: u32, limb: u64, word: u64) -> financial_core::Result<()> {
        let index = self.index(register, limb)?;
        *self
            .words
            .get_mut(index)
            .ok_or(financial_core::Error::Bounds)? = word;
        Ok(())
    }
}

fn input(proof: &JointPaymentProof, header: &PreparedSettlement) -> Result<RateInput> {
    let totals = proof.totals(header)?;
    let proposal = proof
        .proposals
        .get(usize::from(proof.round))
        .ok_or(ClearingError::Resolution)?;
    let insurance = financial(InsuranceRounds::from_checkpoint(
        &proof.insurance_state,
        header.insurance,
    ))?;
    Ok(RateInput {
        count: header.count,
        common: Magnitude {
            register: proof.common_register,
            used: proof.common.len() as u64,
        },
        rate_lengths: proposal.rates.each_ref().map(|r| r.len() as u64),
        factor: proposal.factor,
        positive: totals.positive,
        negative: totals.negative,
        pools: header.pools,
        budgets: insurance.budgets(),
    })
}

pub(super) fn start(proof: &mut JointPaymentProof, header: &PreparedSettlement) -> Result<()> {
    let proposal = proof
        .proposals
        .get(usize::from(proof.round))
        .ok_or(ClearingError::Resolution)?;
    let width = usize::from(proof.width);
    require!(
        proof.registers.len() == 25 * width,
        ClearingError::Resolution
    );
    proof.registers.fill(0);
    for (register, words) in [
        (proof.common_register as usize, &proof.common),
        (3, &proposal.rates[0]),
        (4, &proposal.rates[1]),
    ] {
        let base = register * width;
        require!(words.len() <= width, ClearingError::Resolution);
        proof.registers[base..base + words.len()].copy_from_slice(words);
    }
    proof.row_cursor = 0;
    proof.rate_work = financial(RateWork::new(input(proof, header)?))?.checkpoint().to_vec();
    Ok(())
}

impl JointPaymentPage {
    pub fn bound(&self, address: &Address, proof: &Address, index: u64) -> Result<()> {
        let expected = create_program_address(
            &[
                b"joint-payment-page",
                proof.as_ref(),
                &index.to_le_bytes(),
                &[self.bump],
            ],
            &crate::ID,
        )
        .map_err(|_| ClearingError::Resolution)?;
        require!(
            expected == *address
                && self.payment == *proof
                && self.index == index
                && (1..=8).contains(&self.count),
            ClearingError::Resolution
        );
        Ok(())
    }
}

#[inline(never)]
pub fn advance(ctx: &mut Context<AdvanceJointPayment>, revision: u64, steps: u16) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty() && (1..=256).contains(&steps),
        ClearingError::Resolution
    );
    let a = &mut ctx.accounts;
    let proof = &mut a.payment;
    proof.source(&a.source, VERIFY_RATES)?;
    require!(proof.revision == revision, ClearingError::Resolution);
    let header = &a.source.prepared;
    let base = (proof.row_cursor.min(header.count - 1) / 8) * 8;
    super::super::recovery::source::row(header, &a.frozen_page, base)?;
    a.delta_page
        .bound(a.delta_page.address(), proof.address(), base / 8)?;
    require!(
        a.delta_page.count == a.frozen_page.row_count
            && a.frozen_page.original_budget_attempt == proof.attempt,
        ClearingError::Resolution
    );
    let mut work = financial(RateWork::from_checkpoint(
        &proof.rate_work,
        input(proof, header)?,
    ))?;
    let mut cursor = proof.row_cursor;
    {
        let mut store = Registers {
            width: usize::from(proof.width),
            words: &mut proof.registers,
        };
        for _ in 0..steps {
            if work.is_done() {
                break;
            }
            if let Ok(ordinal) = work.row_index() {
                require!(cursor == ordinal, ClearingError::Resolution);
                if ordinal / 8 != base / 8 {
                    break;
                }
                let offset = (ordinal % 8) as usize;
                require!(
                    offset < usize::from(a.delta_page.count),
                    ClearingError::Resolution
                );
                let row = &a.frozen_page.rows[offset];
                let (original, effective) = apply_deltas(row, a.delta_page.deltas[offset])?;
                financial(work.accept_reduction(ordinal, row.id, original, effective))?;
                cursor += 1;
            } else {
                financial(work.step(&mut store))?;
            }
        }
    }
    proof.row_cursor = cursor;
    proof.rate_work.copy_from_slice(&work.checkpoint());
    if work.is_done() {
        require!(cursor == header.count, ClearingError::Resolution);
        let mut insurance = financial(InsuranceRounds::from_checkpoint(
            &proof.insurance_state,
            header.insurance,
        ))?;
        financial(insurance.accept(financial(work.result())?))?;
        proof.insurance_state = insurance.checkpoint();
        proof.round += 1;
        if insurance.is_done() {
            require!(
                usize::from(proof.round) == proof.proposals.len(),
                ClearingError::Resolution
            );
            let spent = financial(insurance.result())?.0;
            let snapshot = financial(
                SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
                    .and_then(|s| s.result()),
            )?;
            let (original, adjusted) = proof.payment_rates()?;
            financial(original.full_recovery(
                &adjusted,
                snapshot.positive.map(|p| number(&p.words())),
                proof.charges,
                proof.original_spent,
                spent,
            ))?;
            proof.spent = spent;
            proof.stage = VERIFIED;
        } else {
            start(proof, header)?;
        }
    }
    proof.progress()
}
