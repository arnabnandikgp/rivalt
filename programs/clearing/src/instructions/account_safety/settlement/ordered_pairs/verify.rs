use super::*;
use clearing_accounting::attribution::LotRate;
use default_plan_selection::member_priority;
use solana_sha256_hasher::hashv;

pub(super) const WINNERS: u8 = 0;
pub(super) const DEBTORS: u8 = 1;
const OPEN_MEMBERS: u8 = 2;
pub(super) const MATCH: u8 = 3;
pub(super) const VERIFIED: u8 = 4;

impl PairScheduleProof {
    pub(super) fn check(&self, source: &RecoverySource, stage: u8) -> Result<()> {
        source.check_stage(self.epoch, ORIGINAL_RATES)?;
        let (attempt, _, _) = super::super::foreign_protection::sealed(&source.prepared)?;
        require!(
            self.prepared == *source.prepared.address()
                && self.attempt == attempt
                && self.stage == stage,
            ClearingError::Resolution
        );
        Ok(())
    }

    pub(super) fn advance(&mut self) -> Result<()> {
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?;
        Ok(())
    }
}

pub fn open(ctx: &mut Context<OpenPairSchedule>, order_root: [u8; 32]) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    let allocation = &accounts.allocation;
    let header = &accounts.source.prepared;
    accounts
        .source
        .check_stage(allocation.epoch, ORIGINAL_RATES)?;
    let (attempt, totals, _) = super::super::foreign_protection::sealed(header)?;
    require!(
        allocation.stage == 2
            && allocation.prepared == *header.address()
            && allocation.original_attempt == attempt
            && allocation.cursor == header.count
            && allocation.market < 2,
        ClearingError::Resolution
    );
    let cert = &mut accounts.certificate;
    cert.prepared = *header.address();
    cert.allocation = *allocation.address();
    cert.epoch = allocation.epoch;
    cert.attempt = attempt;
    cert.market = allocation.market;
    cert.members_left = header.count;
    cert.target_hash = allocation.target_digest;
    cert.minimum_lots = allocation.minimum_lots;
    cert.lots_left = allocation.minimum_lots;
    cert.total_atoms = totals[usize::from(cert.market)];
    cert.order_hash = order_root;
    cert.pair_hash = hashv(&[
        b"Rivalt/pair-fills/v1\0",
        header.venue.as_ref(),
        &cert.epoch.to_le_bytes(),
        &[cert.market],
    ])
    .to_bytes();
    if cert.total_atoms == 0 {
        require!(
            cert.minimum_lots == 0 && order_root == [0; 32],
            ClearingError::Resolution
        );
        cert.stage = VERIFIED;
    } else {
        require!(order_root != [0; 32], ClearingError::Resolution);
    }
    cert.advance()
}

fn order_hash(role: u8, entries: &[PairBookEntry], next: &[u8; 32]) -> Result<[u8; 32]> {
    let mut bytes = [0; 8 * PairBookEntry::INIT_SPACE];
    let bytes = &mut bytes[..entries.len() * PairBookEntry::INIT_SPACE];
    for (target, entry) in bytes
        .chunks_exact_mut(PairBookEntry::INIT_SPACE)
        .zip(entries)
    {
        crate::wire::write(entry, target)?;
    }
    Ok(hashv(&[
        b"Rivalt/pair-order-page/v1\0",
        &[role, entries.len() as u8],
        bytes,
        next,
    ])
    .to_bytes())
}

pub fn append(
    ctx: &mut Context<AppendPairOrder>,
    role: u8,
    index: u64,
    entries: Vec<PairBookEntry>,
    next: [u8; 32],
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    let cert = &mut accounts.certificate;
    cert.check(&accounts.source, role)?;
    require!(
        role <= DEBTORS && (1..=8).contains(&entries.len()),
        ClearingError::Resolution
    );
    let side = usize::from(role);
    require!(
        cert.rows[side] % 8 == 0
            && index == cert.rows[side] / 8
            && order_hash(role, &entries, &next)? == cert.order_hash,
        ClearingError::Resolution
    );
    let page = &mut accounts.order_page;
    page.certificate = *cert.address();
    page.role = role;
    page.index = index;
    page.row_count = entries.len() as u8;
    page.bump = ctx.bumps.order_page;
    let header = &accounts.source.prepared;
    for (slot, entry) in entries.into_iter().enumerate() {
        let priority = member_priority(header.venue.as_ref(), cert.epoch, entry.member_id);
        require!(
            entry.ordinal < header.count
                && entry.atoms > 0
                && entry.lots != 0
                && (cert.rows[side] == 0
                    || (cert.last_priority, cert.last_member) < (priority, entry.member_id)),
            ClearingError::Resolution
        );
        cert.last_priority = priority;
        cert.last_member = entry.member_id;
        cert.rows[side] = cert.rows[side]
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?;
        require!(cert.rows[side] <= header.count, ClearingError::Resolution);
        let upper_rate = if role == WINNERS {
            let rate = LotRate {
                numerator: entry.rate[0],
                denominator: entry.rate[1],
            };
            require!(
                rate.capacity(entry.lots.unsigned_abs())
                    .map_err(|_| ClearingError::Resolution)?
                    >= entry.atoms,
                ClearingError::Resolution
            );
            let upper = rate.numerator.div_ceil(rate.denominator);
            cert.fastest = cert.fastest.max(upper);
            upper
        } else {
            require!(
                entry.rate == [0, 1] && cert.fastest > 0,
                ClearingError::Resolution
            );
            cert.fastest
        };
        cert.floor[side] = cert.floor[side]
            .checked_add(u128::from(entry.atoms.div_ceil(upper_rate)))
            .ok_or(ClearingError::Arithmetic)?;
        cert.amounts[side] = cert.amounts[side]
            .checked_add(u128::from(entry.atoms))
            .ok_or(ClearingError::Arithmetic)?;
        page.rows[slot] = PairBookRow {
            original: entry,
            atoms_left: entry.atoms,
            lots_left: entry.lots.unsigned_abs(),
        };
    }
    require!(
        cert.amounts[side] <= cert.total_atoms && cert.floor[side] <= cert.minimum_lots,
        ClearingError::Resolution
    );
    if cert.amounts[side] == cert.total_atoms {
        cert.stage += 1;
    } else {
        require!(page.row_count == 8, ClearingError::Resolution);
    }
    require!(
        (cert.stage == OPEN_MEMBERS) == (next == [0; 32]),
        ClearingError::Resolution
    );
    cert.order_hash = next;
    cert.advance()
}

impl PairOrderPage {
    pub(super) fn bound(
        &self,
        address: &Address,
        cert: &Address,
        role: u8,
        index: u64,
    ) -> Result<()> {
        let expected = create_program_address(
            &[
                b"pair-order",
                cert.as_ref(),
                &[role],
                &index.to_le_bytes(),
                &[self.bump],
            ],
            &crate::ID,
        )
        .map_err(|_| ClearingError::Resolution)?;
        require!(
            expected == *address
                && self.certificate == *cert
                && self.role == role
                && self.index == index
                && (1..=8).contains(&self.row_count),
            ClearingError::Resolution
        );
        Ok(())
    }
}

#[inline(never)]
fn check_entry(
    account: &AccountView,
    certificate: &Address,
    role: u8,
    book_slot: u64,
    expected: PairBookEntry,
) -> Result<()> {
    require!(
        account.owned_by(&crate::ID) && !account.is_writable(),
        ClearingError::Resolution
    );
    let data = account.try_borrow()?;
    require!(
        data.len() == 8 + PairOrderPage::INIT_SPACE && data[..8] == *PairOrderPage::DISCRIMINATOR,
        ClearingError::Resolution
    );
    let page = crate::wire::read::<PairOrderPage>(&data[8..])?;
    page.bound(account.address(), certificate, role, book_slot / 8)?;
    let slot = (book_slot % 8) as usize;
    require!(
        slot < usize::from(page.row_count) && page.rows[slot].original == expected,
        ClearingError::Resolution
    );
    Ok(())
}

/// Open one original-ordinal hash prefix backwards. Every positive amount on
/// either side must match its single strictly ordered entry. Equality of both
/// book totals then excludes extra entries, even for zero-charge members.
pub fn check_members(
    ctx: &mut Context<CheckPairMembers>,
    prefix: [u8; 32],
    openings: Vec<PairMemberOpening>,
) -> Result<()> {
    let lookups = ctx.remaining_accounts()?;
    require!(lookups.len() <= 8, ClearingError::Resolution);
    let accounts = &mut ctx.accounts;
    let cert = &mut accounts.certificate;
    cert.check(&accounts.source, OPEN_MEMBERS)?;
    let header = &accounts.source.prepared;
    require!(cert.members_left > 0, ClearingError::Resolution);
    let base = ((cert.members_left - 1) / 8) * 8;
    super::super::recovery::source::row(header, &accounts.frozen_page, base)?;
    let count = (cert.members_left - base) as usize;
    let page = &accounts.frozen_page;
    require!(
        page.original_budget_attempt == cert.attempt
            && usize::from(page.row_count) == count
            && openings.len() == count,
        ClearingError::Resolution
    );
    let mut used = 0u16;
    let mut digest = prefix;
    let market = usize::from(cert.market);
    for (offset, opening) in openings.iter().enumerate() {
        let row = &page.rows[offset];
        digest = hashv(&[
            &digest,
            &row.id.to_le_bytes(),
            &opening.weight.to_le_bytes(),
            &opening.charge.to_le_bytes(),
        ])
        .to_bytes();
        let budget = row.original_debtor_budgets[market];
        require!(
            opening.charge == 0 || budget == 0,
            ClearingError::Resolution
        );
        let (role, atoms, rate) = if opening.charge > 0 {
            (WINNERS, opening.charge, row.recovery_lot_rates[market])
        } else if budget > 0 {
            (DEBTORS, budget, [0, 1])
        } else {
            require!(
                opening.lookup == 0 && opening.book_slot == 0,
                ClearingError::Resolution
            );
            continue;
        };
        let lookup = usize::from(opening.lookup);
        let account = lookups.get(lookup).ok_or(ClearingError::Resolution)?;
        used |= 1u16 << lookup;
        check_entry(
            account,
            cert.address(),
            role,
            opening.book_slot,
            PairBookEntry {
                ordinal: base + offset as u64,
                member_id: row.id,
                lots: row.lots[market],
                rate,
                atoms,
            },
        )?;
    }
    require!(
        used == (1u16 << lookups.len()) - 1 && digest == cert.target_hash,
        ClearingError::Resolution
    );
    cert.target_hash = prefix;
    cert.members_left = base;
    if base == 0 {
        let seed = hashv(&[
            b"Rivalt/winner-targets/v1\0",
            header.venue.as_ref(),
            &cert.epoch.to_le_bytes(),
            &[cert.market],
        ])
        .to_bytes();
        require!(prefix == seed, ClearingError::Resolution);
        cert.stage = MATCH;
    }
    cert.advance()
}
