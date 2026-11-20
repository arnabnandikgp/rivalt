//! Copy a fully verified proposal into the canonical settlement workspace. Every
//! cursor can be advanced permissionlessly. Withdrawals stay frozen throughout.
use super::{
    admission::{financial, VERIFIED},
    *,
};
use financial_core::clearing::scalable::pages::PAGE_WORDS;

const COPYING: u8 = 22;
const MARKER: &[u8; 8] = b"RVJOINT2";

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct PaymentReceipt {
    epoch: u64,
    payment: Address,
    pub charges: [u128; 2],
    pub spent: [u64; 2],
    attempt: u64,
    next_member: u64,
    next_register: u32,
}

pub fn receipt(header: &PreparedSettlement) -> Result<Option<PaymentReceipt>> {
    let bytes = &header.state.membership;
    if !bytes.starts_with(MARKER) {
        return Ok(None);
    }
    let value: PaymentReceipt = crate::wire::read(&bytes[8..8 + PaymentReceipt::INIT_SPACE])?;
    require!(
        value.epoch == header.epoch && matches!(header.stage, COPYING | PROPOSAL),
        ClearingError::Resolution
    );
    Ok(Some(value))
}

impl PaymentReceipt {
    fn store(&self, header: &mut PreparedSettlement) -> Result<()> {
        let bytes = &mut header.state.membership;
        bytes.fill(0);
        bytes[..8].copy_from_slice(MARKER);
        crate::wire::write(self, &mut bytes[8..8 + Self::INIT_SPACE])
    }
    fn pending(header: &PreparedSettlement, revision: u64) -> Result<Self> {
        require!(
            header.stage == COPYING && header.revision == revision,
            ClearingError::Resolution
        );
        receipt(header)?.ok_or(ClearingError::Resolution.into())
    }
}

pub fn bind(ctx: &mut Context<BindJointPayment>, revision: u64) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    let header = &mut accounts.prepared;
    accounts.source.frozen().matches(header)?;
    let proof = &accounts.payment;
    let (attempt, charges, _) = super::super::foreign_protection::sealed(header)?;
    require!(
        header.stage == ORIGINAL_RATES
            && header.revision == revision
            && header.count > 0
            && proof.stage == VERIFIED
            && proof.epoch == header.epoch
            && proof.prepared == *header.address()
            && proof.charges == charges
            && proof.attempt == attempt
            && accounts.rates.attempt == attempt
            && accounts.rates.stage == VERIFIED_RATE,
        ClearingError::Resolution
    );
    let receipt = PaymentReceipt {
        epoch: header.epoch,
        payment: *proof.address(),
        charges,
        spent: proof.spent,
        attempt,
        next_member: 0,
        next_register: 3,
    };
    header.stage = COPYING;
    receipt.store(header)
}

pub fn copy_claims(ctx: &mut Context<CopyJointClaims>, index: u64, revision: u64) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    let header = &mut accounts.prepared;
    accounts.source.frozen().matches(header)?;
    let mut receipt = PaymentReceipt::pending(header, revision)?;
    require!(
        receipt.next_member < header.count && receipt.next_member / 8 == index,
        ClearingError::Resolution
    );
    let page = &mut accounts.page;
    let source = &accounts.delta_page;
    source.bound(source.address(), &receipt.payment, index)?;
    let count = (header.count - receipt.next_member).min(8);
    require!(
        page.schema_version == SETTLEMENT_SCHEMA
            && page.original_budget_attempt == receipt.attempt
            && u64::from(source.count) == count
            && source.count == page.row_count,
        ClearingError::Resolution
    );
    for (row, delta) in page.rows[..count as usize].iter_mut().zip(&source.deltas) {
        row.recovery_payout.claim_delta = *delta;
    }
    receipt.next_member += count;
    receipt.store(header)
}

pub fn copy_register(
    ctx: &mut Context<CopyJointRegister>,
    register: u32,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    let header = &mut accounts.prepared;
    accounts.source.frozen().matches(header)?;
    let mut receipt = PaymentReceipt::pending(header, revision)?;
    let proof = &accounts.payment;
    let rates = &mut accounts.rates;
    let page = &mut accounts.page;
    let length = financial(required_limbs(header.count))?.min(PAGE_WORDS);
    require!(
        receipt.next_member == header.count
            && receipt.next_register == register
            && (3..=24).contains(&register)
            && *proof.address() == receipt.payment
            && proof.stage == VERIFIED
            && rates.stage == VERIFIED_RATE
            && rates.attempt == receipt.attempt
            && page.schema_version == SETTLEMENT_SCHEMA
            && u64::from(page.word_count) == length,
        ClearingError::Resolution
    );
    let width = usize::from(proof.width);
    let base = register as usize * width;
    let words = proof
        .registers
        .get(base..base + width)
        .ok_or(ClearingError::Resolution)?;
    let used = width.min(length as usize);
    require!(
        words[used..].iter().all(|word| *word == 0),
        ClearingError::Resolution
    );
    page.payload.words.fill(0);
    page.payload.words[..used].copy_from_slice(&words[..used]);
    let attempt = receipt
        .attempt
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    page.attempt = attempt;
    receipt.next_register += 1;
    receipt.store(header)?;
    if register == 24 {
        let terminal = proof.proposals.last().ok_or(ClearingError::Resolution)?;
        rates.attempt = attempt;
        rates.proposer = Address::default();
        rates.last_progress_slot = Clock::get()?.slot;
        rates.factor = terminal.factor;
        rates.lengths = terminal.rates.each_ref().map(|words| words.len() as u64);
        rates.uploaded = rates.lengths;
        rates.state.clone_from(&proof.checkpoints);
        header.stage = PROPOSAL;
        let (_, spent) = super::super::rates::verified_rates(header, rates)?;
        require!(spent == receipt.spent, ClearingError::Reconciliation);
    }
    Ok(())
}
