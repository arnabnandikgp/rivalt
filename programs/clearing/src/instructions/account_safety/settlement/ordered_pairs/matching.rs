use super::{
    verify::{DEBTORS, MATCH, VERIFIED, WINNERS},
    *,
};
use clearing_accounting::attribution::LotRate;
use default_plan_selection::{
    joint::ordered_fill::apply_pair,
    pair_prefix::{LotBudget, Position},
};
use solana_sha256_hasher::hashv;

impl PairBookRow {
    fn position(&self, rate: u64) -> Position {
        Position {
            atoms: self.atoms_left,
            lots: self.lots_left,
            rate,
        }
    }
    fn consume(&mut self, remaining: Position) {
        self.atoms_left = remaining.atoms;
        self.lots_left = remaining.lots;
    }
}

pub fn match_page(ctx: &mut Context<MatchPairPage>, revision: u64) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    let cert = &mut accounts.certificate;
    cert.check(&accounts.source, MATCH)?;
    require!(cert.revision == revision, ClearingError::Resolution);
    let winners = &mut accounts.winners;
    let debtors = &mut accounts.debtors;
    winners.bound(
        winners.address(),
        cert.address(),
        WINNERS,
        cert.winner_cursor / 8,
    )?;
    debtors.bound(debtors.address(), cert.address(), DEBTORS, cert.debtor_page)?;
    let winner_slot = (cert.winner_cursor % 8) as usize;
    require!(
        winner_slot < usize::from(winners.row_count),
        ClearingError::Resolution
    );
    let winner = &mut winners.rows[winner_slot];
    let [numerator, denominator] = winner.original.rate;
    let rate = LotRate {
        numerator,
        denominator,
    };
    // The inventory construction and frozen openings have authenticated both
    // the rate and its denominator before this stage can begin.
    let mut gain = winner.position(numerator.div_ceil(denominator));
    let mut budget = LotBudget {
        remaining: cert.lots_left,
        winner_floor: cert.floor[0],
        debtor_floor: cert.floor[1],
    };
    let count = usize::from(debtors.row_count);
    for debtor in &mut debtors.rows[..count] {
        if gain.atoms == 0 {
            break;
        }
        if debtor.atoms_left == 0 || debtor.original.lots.signum() == winner.original.lots.signum()
        {
            continue;
        }
        let mut debt = debtor.position(cert.fastest);
        let fill = apply_pair(&mut budget, &mut debt, &mut gain, rate)
            .map_err(|_| ClearingError::Resolution)?;
        if fill.atoms > 0 {
            let ticks = fill.atoms / fill.matched;
            let extra = fill.atoms % fill.matched;
            cert.pair_hash = hashv(&[
                &cert.pair_hash,
                &debtor.original.member_id.to_le_bytes(),
                &winner.original.member_id.to_le_bytes(),
                &fill.atoms.to_le_bytes(),
                &fill.matched.to_le_bytes(),
                &ticks.to_le_bytes(),
                &extra.to_le_bytes(),
            ])
            .to_bytes();
            cert.pairs = cert.pairs.checked_add(1).ok_or(ClearingError::Arithmetic)?;
            cert.paired_atoms = cert
                .paired_atoms
                .checked_add(u128::from(fill.atoms))
                .ok_or(ClearingError::Arithmetic)?;
            debtor.consume(debt);
        }
    }
    winner.consume(gain);
    cert.lots_left = budget.remaining;
    cert.floor = [budget.winner_floor, budget.debtor_floor];
    if cert.debtor_page == cert.first_unpaid_page
        && debtors.rows[..count].iter().all(|row| row.atoms_left == 0)
    {
        cert.first_unpaid_page += 1;
    }
    if gain.atoms == 0 {
        cert.winner_cursor += 1;
        cert.debtor_page = cert.first_unpaid_page;
    } else {
        cert.debtor_page += 1;
    }
    if cert.winner_cursor == cert.rows[0] {
        require!(
            cert.paired_atoms == cert.total_atoms && cert.lots_left == 0 && cert.floor == [0, 0],
            ClearingError::Resolution
        );
        cert.stage = VERIFIED;
    } else {
        require!(
            cert.debtor_page < cert.rows[1].div_ceil(8),
            ClearingError::Resolution
        );
    }
    cert.advance()
}
