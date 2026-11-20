use super::*;
use clearing_accounting::attribution::LotRate;
use default_plan_selection::{
    joint::winner_inventory::{MarketInventory, OpposingLots, SideInventory},
    linked_sharing::LinkedSharing,
    member_priority,
    proportional::{Marginal, MarginalRange, MemberPriority},
};
use financial_core::SCALE;

const INVENTORY: u8 = 0;
const SCORE: u8 = 1;
const VERIFIED: u8 = 2;

impl WinnerCutoff {
    fn marginal(self, venue: &Address, epoch: u64, extra_lots: u64) -> Result<Option<Marginal>> {
        if self.unit == 0 {
            require!(
                self.capacity == 0 && self.member_id == 0 && extra_lots == 0,
                ClearingError::Resolution
            );
            return Ok(None);
        }
        require!(self.unit <= self.capacity, ClearingError::Resolution);
        Ok(Some(Marginal {
            unit: self.unit,
            capacity: self.capacity,
            extra_lots,
            member: priority(venue, epoch, self.member_id),
        }))
    }
}

fn priority(venue: &Address, epoch: u64, id: u64) -> MemberPriority {
    MemberPriority {
        digest: member_priority(venue.as_ref(), epoch, id),
        id,
    }
}

impl WinnerMarginal {
    fn store(value: Option<Marginal>) -> Self {
        value
            .map(|m| Self {
                cutoff: WinnerCutoff {
                    unit: m.unit,
                    capacity: m.capacity,
                    member_id: m.member.id,
                },
                extra_lots: m.extra_lots,
            })
            .unwrap_or_default()
    }
}

impl WinnerRange {
    fn read(self, venue: &Address, epoch: u64) -> Result<MarginalRange> {
        Ok(MarginalRange {
            last_selected: self.last_selected.cutoff.marginal(
                venue,
                epoch,
                self.last_selected.extra_lots,
            )?,
            first_remaining: self.first_remaining.cutoff.marginal(
                venue,
                epoch,
                self.first_remaining.extra_lots,
            )?,
        })
    }
    fn store(value: MarginalRange) -> Self {
        Self {
            last_selected: WinnerMarginal::store(value.last_selected),
            first_remaining: WinnerMarginal::store(value.first_remaining),
        }
    }
}

impl From<WinnerSide> for SideInventory {
    fn from(value: WinnerSide) -> Self {
        Self {
            total: value.total,
            smallest: value.smallest,
            largest: value.largest,
            fastest: value.fastest,
        }
    }
}
impl From<SideInventory> for WinnerSide {
    fn from(value: SideInventory) -> Self {
        Self {
            total: value.total,
            smallest: value.smallest,
            largest: value.largest,
            fastest: value.fastest,
        }
    }
}

pub fn open(
    accounts: &mut OpenWinnerProof,
    epoch: u64,
    market: u8,
    cutoffs: [WinnerCutoff; 2],
) -> Result<()> {
    accounts.source.check_stage(epoch, ORIGINAL_RATES)?;
    let header = &accounts.source.prepared;
    let (attempt, _, _) = super::super::foreign_protection::sealed(header)?;
    require!(market < 2, ClearingError::Resolution);
    for cutoff in cutoffs {
        cutoff.marginal(&header.venue, epoch, 0)?;
    }
    let proof = &mut accounts.proof;
    proof.prepared = *header.address();
    proof.epoch = epoch;
    proof.original_attempt = attempt;
    proof.market = market;
    proof.cutoffs = cutoffs;
    proof.target_digest = solana_sha256_hasher::hashv(&[
        b"Rivalt/winner-targets/v1\0",
        header.venue.as_ref(),
        &epoch.to_le_bytes(),
        &[market],
    ])
    .to_bytes();
    proof.revision = 1;
    Ok(())
}

fn frozen_page<'a>(
    page: &'a BorshAccount<FrozenMarginPage>,
    header: &PreparedSettlement,
    ordinal: u64,
    attempt: u64,
) -> Result<&'a [FrozenMargin]> {
    // The first row check also verifies owner (typed account), canonical PDA,
    // discriminator, exact length, schema, venue, epoch and the ordinal.
    super::super::recovery::source::row(header, page, ordinal)?;
    require!(
        page.original_budget_attempt == attempt
            && usize::from(page.row_count) == (header.count - 8 * page.page_index).min(8) as usize,
        ClearingError::Resolution
    );
    Ok(&page.rows[..usize::from(page.row_count)])
}

fn rate(row: &FrozenMargin, market: usize) -> LotRate {
    let [numerator, denominator] = row.recovery_lot_rates[market];
    LotRate {
        numerator,
        denominator,
    }
}

#[inline(never)]
pub fn advance(accounts: &mut AdvanceWinnerProof, revision: u64) -> Result<()> {
    let proof = &mut accounts.proof;
    let header = &accounts.source.prepared;
    accounts.source.check_stage(proof.epoch, ORIGINAL_RATES)?;
    let (attempt, budgets, caps) = super::super::foreign_protection::sealed(header)?;
    require!(
        proof.prepared == *header.address()
            && proof.original_attempt == attempt
            && proof.revision == revision
            && proof.stage < VERIFIED
            && proof.cursor < header.count
            && proof.market < 2,
        ClearingError::Resolution
    );
    let market = usize::from(proof.market);
    let rows = frozen_page(&accounts.page, header, proof.cursor, attempt)?;
    let mut inventory = MarketInventory {
        sides: proof.sides.map(SideInventory::from),
    };
    if proof.stage == INVENTORY {
        require!(
            accounts.opponents.is_none() && proof.cursor % 8 == 0,
            ClearingError::Resolution
        );
        for row in rows {
            inventory
                .include(
                    row.lots[market],
                    row.claims[market],
                    rate(row, market),
                    row.original_debtor_budgets[market],
                )
                .map_err(|_| ClearingError::Resolution)?;
        }
        proof.sides = inventory.sides.map(WinnerSide::from);
        proof.cursor += rows.len() as u64;
        if proof.cursor == header.count {
            proof.stage = SCORE;
            proof.cursor = 0;
        }
    } else {
        score_page(
            proof,
            header,
            rows,
            accounts.opponents.as_deref(),
            inventory,
            budgets[market],
            caps[market],
        )?;
    }
    proof.revision = proof
        .revision
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(())
}

#[inline(never)]
fn score_page(
    proof: &mut WinnerAllocationProof,
    header: &PreparedSettlement,
    rows: &[FrozenMargin],
    mut opponents: Option<&BorshAccount<FrozenMarginPage>>,
    inventory: MarketInventory,
    total: u128,
    cap: u128,
) -> Result<()> {
    let market = usize::from(proof.market);
    let ranges = |[left, right]: [WinnerRange; 2]| -> Result<[MarginalRange; 2]> {
        Ok([
            left.read(&header.venue, header.epoch)?,
            right.read(&header.venue, header.epoch)?,
        ])
    };
    let mut sharing = Box::new(LinkedSharing::from_checkpoint(
        ranges(proof.episode)?,
        ranges(proof.lots)?,
        proof.recovered,
        proof.winner_lots,
    ));
    require!(
        opponents.is_some() == proof.scanning_opponents,
        ClearingError::Resolution
    );
    for row in &rows[(proof.cursor % 8) as usize..] {
        let lots = row.lots[market];
        let rate = rate(row, market);
        let available = match inventory
            .opposing(lots, row.claims[market], rate)
            .map_err(|_| ClearingError::Resolution)?
        {
            OpposingLots::Known(available) => available,
            OpposingLots::Scan { minimum } => {
                if !proof.scanning_opponents {
                    proof.scanning_opponents = true;
                    break;
                }
                let page = opponents.take().ok_or(ClearingError::Resolution)?;
                let debtors =
                    frozen_page(page, header, proof.opponent_cursor, proof.original_attempt)?;
                for debtor in debtors {
                    let size = debtor.lots[market];
                    if debtor.original_debtor_budgets[market] > 0
                        && size.signum() == -lots.signum()
                        && size.unsigned_abs() >= minimum
                    {
                        proof.opponent_lots = proof
                            .opponent_lots
                            .saturating_add(size.unsigned_abs())
                            .min(lots.unsigned_abs());
                    }
                }
                proof.opponent_cursor += debtors.len() as u64;
                if proof.opponent_lots < lots.unsigned_abs() && proof.opponent_cursor < header.count
                {
                    break;
                }
                proof.scanning_opponents = false;
                proof.opponent_cursor = 0;
                core::mem::take(&mut proof.opponent_lots)
            }
        };
        let eligible = (row.claims[market].max(0) / SCALE) as u128;
        let weight = u64::try_from(
            eligible.min(u128::from(
                rate.capacity(available)
                    .map_err(|_| ClearingError::Resolution)?,
            )),
        )
        .map_err(|_| ClearingError::Arithmetic)?;
        let linked = row.claims[market] > 0
            && row.claims[1 - market] < 0
            && row.claims[1 - market].unsigned_abs() > u128::from(row.collected) * SCALE as u128;
        let charge = if weight > 0 {
            let holder = priority(&header.venue, header.epoch, row.id);
            let cutoff =
                proof.cutoffs[usize::from(linked)].marginal(&header.venue, header.epoch, 0)?;
            let charge = match cutoff {
                Some(last) => last
                    .charge(weight, holder, |_| Some(0))
                    .ok_or(ClearingError::Resolution)?,
                None => 0,
            };
            sharing
                .include(linked, total, holder, weight, charge, |atoms| {
                    rate.matched(atoms).ok()
                })
                .ok_or(ClearingError::Resolution)?;
            charge
        } else {
            0
        };
        proof.target_digest = solana_sha256_hasher::hashv(&[
            &proof.target_digest,
            &row.id.to_le_bytes(),
            &weight.to_le_bytes(),
            &charge.to_le_bytes(),
        ])
        .to_bytes();
        proof.debtor_lots += u128::from(
            inventory
                .debtor_floor(lots, row.original_debtor_budgets[market])
                .map_err(|_| ClearingError::Resolution)?,
        );
        proof.cursor += 1;
    }
    let [episode, lots] = sharing.ranges();
    proof.episode = episode.map(WinnerRange::store);
    proof.lots = lots.map(WinnerRange::store);
    proof.recovered = sharing.recovered();
    proof.winner_lots = sharing.winner_lots();
    if proof.cursor == header.count {
        let checked = sharing
            .certify(total, cap)
            .ok_or(ClearingError::Resolution)?;
        require!(
            proof.episode.map(|group| group.last_selected.cutoff) == proof.cutoffs,
            ClearingError::Resolution
        );
        proof.winner_floor_proved = checked.winner_lot_floor.is_some();
        proof.minimum_lots = proof.debtor_lots.max(checked.winner_lot_floor.unwrap_or(0));
        proof.stage = VERIFIED;
    }
    Ok(())
}
