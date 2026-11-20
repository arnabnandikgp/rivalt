use super::*;
use crate::instructions::account_safety::settlement_pages::{PageVersion, PageWindow};
use default_plan_selection::joint::receipt_bounds::PaymentRates;
use financial_core::clearing::scalable::{
    collection::validate_reduction,
    insurance_rounds::InsuranceRounds,
    pages::{PagePlan, PageRequest, PAGE_WORDS},
    rate_work::RateWork,
    snapshot::SnapshotTotals,
    wide::LimbStorage,
};
use num_bigint::BigUint;
use solana_sha256_hasher::hashv;

pub(super) const CAPTURE: u8 = 0;
pub(super) const VERIFY_RATES: u8 = 1;
pub(super) const VERIFIED: u8 = 2;

pub(super) fn financial<T>(result: financial_core::Result<T>) -> Result<T> {
    result.map_err(|_| ClearingError::Resolution.into())
}
pub(super) fn number(words: &[u64]) -> BigUint {
    BigUint::new(
        words
            .iter()
            .flat_map(|word| [*word as u32, (*word >> 32) as u32])
            .collect(),
    )
}
impl PaymentProposal {
    fn payment_rates(&self, common: &[u64]) -> Result<PaymentRates> {
        financial(PaymentRates::new(
            self.rates.each_ref().map(|v| number(v)),
            number(common) * number(&self.factor),
        ))
    }
}
impl JointPaymentProof {
    pub(super) fn source(&self, source: &RecoverySource, stage: u8) -> Result<()> {
        source.check_stage(self.epoch, ORIGINAL_RATES)?;
        let (attempt, totals, _) = super::super::foreign_protection::sealed(&source.prepared)?;
        require!(
            self.prepared == *source.prepared.address()
                && self.attempt == attempt
                && self.stage == stage
                && self.charges == totals,
            ClearingError::Resolution
        );
        Ok(())
    }
    pub(super) fn progress(&mut self) -> Result<()> {
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?;
        Ok(())
    }
    pub(super) fn totals(&self, header: &PreparedSettlement) -> Result<SnapshotTotals> {
        let totals = financial(
            SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
                .and_then(|v| v.result()),
        )?;
        financial(
            totals
                .after_market_charge_wide(0, self.charges[0])
                .and_then(|t| t.after_market_charge_wide(1, self.charges[1])),
        )
    }
    pub(super) fn payment_rates(&self) -> Result<(PaymentRates, PaymentRates)> {
        let after = self.proposals.last().ok_or(ClearingError::Resolution)?;
        Ok((
            self.original.payment_rates(&self.common)?,
            after.payment_rates(&self.common)?,
        ))
    }
}

/// Authenticate the original volume of the common denominator and the two
/// original numerators before any proposed effective rate can be evaluated.
#[inline(never)]
fn original(
    source: &RecoverySource,
    rates: &BorshAccount<SettlementRates>,
    versions: [u64; 3],
    pages: &mut [AccountView],
) -> Result<(u32, Vec<u64>, PaymentProposal, [u64; 2])> {
    let header = &source.prepared;
    let expected = create_program_address(
        &[b"settlement-rates", header.venue.as_ref(), &[rates.bump]],
        &crate::ID,
    )
    .map_err(|_| ClearingError::Resolution)?;
    require!(
        expected == *rates.address() && rates.stage == VERIFIED_RATE,
        ClearingError::Resolution
    );
    let input = super::super::rates::input(header, rates)?;
    let work = financial(RateWork::from_checkpoint(&rates.state.work, input))?;
    financial(work.verified_values())?;
    let spent = financial(super::super::rates::rounds(header, rates)?.result())?.0;
    require!(
        financial(work.result())?.spent == spent,
        ClearingError::Resolution
    );
    let registers = [input.common.register, 3, 4];
    let lengths = [
        input.common.used,
        input.rate_lengths[0],
        input.rate_lengths[1],
    ];
    require!(
        lengths.iter().all(|&length| length <= PAGE_WORDS),
        ClearingError::Resolution
    );
    let plan = financial(PagePlan::window(
        &registers.map(|register| PageRequest {
            register,
            index: 0,
            writable: false,
        }),
        financial(required_limbs(header.count))?,
    ))?;
    let attempts = [0, rates.attempt, rates.attempt];
    let v: [PageVersion; 3] = core::array::from_fn(|i| PageVersion {
        attempt: attempts[i],
        revision: versions[i],
    });
    let window = PageWindow::load(&header.venue, header.epoch, plan, &v, pages)?;
    let read = |i: usize| -> Result<Vec<u64>> {
        (0..lengths[i])
            .map(|word| financial(window.read(registers[i], word)))
            .collect()
    };
    Ok((
        input.common.register,
        read(0)?,
        PaymentProposal {
            factor: rates.factor,
            rates: [read(1)?, read(2)?],
        },
        spent,
    ))
}

pub fn open(
    ctx: &mut Context<OpenJointPayment>,
    bytes: u16,
    width: u16,
    proposals: Vec<PaymentProposal>,
    versions: [u64; 3],
) -> Result<()> {
    let mut pages = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    let header = &accounts.source.prepared;
    accounts.source.check_stage(header.epoch, ORIGINAL_RATES)?;
    let (attempt, totals, _) = super::super::foreign_protection::sealed(header)?;
    require!(
        accounts.rates.attempt == attempt
            && (1..=3).contains(&proposals.len())
            && width > 0
            && 25 * usize::from(width) * 8 < usize::from(bytes),
        ClearingError::Resolution
    );
    let proof = &mut accounts.payment;
    for (market, (pairs, allocation)) in [
        (&accounts.btc_pairs, &accounts.btc_allocation),
        (&accounts.eth_pairs, &accounts.eth_allocation),
    ]
    .into_iter()
    .enumerate()
    {
        require!(
            pairs.stage == 4
                && pairs.prepared == *header.address()
                && pairs.epoch == header.epoch
                && pairs.attempt == attempt
                && usize::from(pairs.market) == market
                && pairs.allocation == *allocation.address()
                && pairs.total_atoms == totals[market]
                && pairs.paired_atoms == totals[market]
                && pairs.lots_left == 0
                && allocation.stage == 2
                && allocation.prepared == *header.address()
                && allocation.epoch == header.epoch
                && allocation.original_attempt == attempt
                && usize::from(allocation.market) == market,
            ClearingError::Resolution
        );
        proof.pair_certificates[market] = *pairs.address();
        proof.target_hashes[market] = allocation.target_digest;
    }
    let (common_register, common, baseline, spent) =
        original(&accounts.source, &accounts.rates, versions, &mut pages)?;
    require!(
        common.len() <= usize::from(width)
            && proposals
                .iter()
                .all(|proposal| {
                    proposal.factor.iter().any(|&word| word != 0)
                        && proposal.rates.iter().all(|words| {
                            words.len() <= usize::from(width) && words.last() != Some(&0)
                        })
                }),
        ClearingError::Resolution
    );
    proof.prepared = *header.address();
    proof.epoch = header.epoch;
    proof.attempt = attempt;
    proof.members_left = header.count;
    proof.original = baseline;
    proof.common_register = common_register;
    proof.common = common;
    proof.width = width;
    proof.charges = totals;
    proof.original_spent = spent;
    proof.proposals = proposals;
    proof.registers = vec![0; usize::from(width) * 25];
    proof.checkpoints.insurance = financial(InsuranceRounds::new(header.insurance))?.checkpoint();
    proof.payment_rates()?;
    proof.progress()
}

pub(crate) fn apply_deltas(row: &FrozenMargin, deltas: [i64; 2]) -> Result<(Row, Row)> {
    let before = Row {
        cash: row.cash,
        claims: row.claims,
    };
    let mut after = before;
    for (claim, delta) in after.claims.iter_mut().zip(deltas) {
        *claim = claim
            .checked_add(i128::from(delta) * financial_core::SCALE)
            .ok_or(ClearingError::Arithmetic)?;
    }
    financial(validate_reduction(&before, &after))?;
    Ok((before, after))
}

pub fn capture(
    ctx: &mut Context<CaptureJointPayment>,
    index: u64,
    prior: [[u8; 32]; 2],
    openings: Vec<JointMemberOpening>,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let a = &mut ctx.accounts;
    let proof = &mut a.payment;
    proof.source(&a.source, CAPTURE)?;
    let header = &a.source.prepared;
    require!(
        proof.members_left > 0 && index == (proof.members_left - 1) / 8,
        ClearingError::Resolution
    );
    let base = index * 8;
    super::super::recovery::source::row(header, &a.frozen_page, base)?;
    let count = (proof.members_left - base) as usize;
    require!(
        usize::from(a.frozen_page.row_count) == count
            && count == openings.len()
            && a.frozen_page.original_budget_attempt == proof.attempt,
        ClearingError::Resolution
    );
    let page = &mut a.delta_page;
    page.payment = *proof.address();
    page.index = index;
    page.count = count as u8;
    page.bump = ctx.bumps.delta_page;
    let (original, adjusted) = proof.payment_rates()?;
    let mut digests = prior;
    for (i, opening) in openings.iter().enumerate() {
        let row = &a.frozen_page.rows[i];
        for market in 0..2 {
            digests[market] = hashv(&[
                &digests[market],
                &row.id.to_le_bytes(),
                &opening.weights[market].to_le_bytes(),
                &opening.charges[market].to_le_bytes(),
            ])
            .to_bytes();
            page.deltas[i][market] = i64::try_from(
                i128::from(row.original_debtor_budgets[market])
                    - i128::from(opening.charges[market]),
            )
            .map_err(|_| ClearingError::Arithmetic)?;
        }
        let (before, after) = apply_deltas(row, page.deltas[i])?;
        financial(original.protects_row(
            &adjusted,
            before.claims,
            after.claims,
            proof.charges.map(|sum| sum != 0),
        ))?;
    }
    require!(digests == proof.target_hashes, ClearingError::Resolution);
    proof.target_hashes = prior;
    proof.members_left = base;
    if base == 0 {
        for (market, root) in prior.iter().enumerate() {
            require!(
                *root
                    == hashv(&[
                        b"Rivalt/winner-targets/v1\0",
                        header.venue.as_ref(),
                        &proof.epoch.to_le_bytes(),
                        &[market as u8]
                    ])
                    .to_bytes(),
                ClearingError::Resolution
            );
        }
        proof.stage = VERIFY_RATES;
        super::rates::start(proof, header)?;
    }
    proof.progress()
}
