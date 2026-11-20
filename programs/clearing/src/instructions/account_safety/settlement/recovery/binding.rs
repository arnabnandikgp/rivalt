//! Only clearing-owned, completely verified results can advance this local profile.
use super::super::{single_pair, BindRecoverySelection, DENOMINATOR, PROPOSAL};
use super::*;
use crate::state::accounts::FrozenMargin;
use crate::ClearingError;
use financial_core::clearing::scalable::{
    graph_pages::FlowRecord, recovery_payout::RecoveryPayoutScan,
};

const MARKER: &[u8; 8] = b"RVJOINT1";
const RECEIPT_LEN: usize = 8 + 32 + 16 + 16 + 8 * 48 + 2 * 16;
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct MemberResult {
    id: u64,
    claim_delta: [i64; 2],
    movements: [i64; 2],
    cash: u64,
}
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct BoundResult {
    epoch: u64,
    search: Address,
    pub charges: [u64; 2],
    pub insurance_spent: [u64; 2],
    members: [MemberResult; 8],
    schedule: u128,
    schedules_checked: u128,
}
impl BoundResult {
    pub fn read(header: &PreparedSettlement) -> Result<Self> {
        let bytes = &header.state.membership;
        require!(
            matches!(header.stage, DENOMINATOR | PROPOSAL) && bytes.starts_with(MARKER),
            ClearingError::Resolution
        );
        let result: Self =
            crate::wire::read(&bytes[8..8 + RECEIPT_LEN]).map_err(|_| ClearingError::Resolution)?;
        require!(
            result.epoch == header.epoch && header.count == 8,
            ClearingError::Resolution
        );
        Ok(result)
    }
    fn member(&self, id: u64) -> Result<&MemberResult> {
        self.members
            .binary_search_by_key(&id, |row| row.id)
            .map(|index| &self.members[index])
            .map_err(|_| ClearingError::Resolution.into())
    }
    pub fn claims(&self, row: &FrozenMargin) -> Result<[i128; 2]> {
        let member = self.member(row.id)?;
        let mut claims = row.claims;
        for (claim, delta) in claims.iter_mut().zip(member.claim_delta) {
            *claim = claim
                .checked_add(i128::from(delta) * financial_core::SCALE)
                .ok_or(ClearingError::Arithmetic)?;
        }
        Ok(claims)
    }
    /// The verified protected circulation may differ from the ordinary graph by
    /// individual rounding atoms. Both must use the verified greatest-rate floors.
    pub fn increments(&self, row: &FrozenMargin, flow: &FlowRecord) -> Result<[u64; 3]> {
        let member = self.member(row.id)?;
        let claims = self.claims(row)?;
        for (movement, claim) in member.movements.iter().zip(claims) {
            require!(
                *movement == 0 || i128::from(*movement).signum() == claim.signum(),
                ClearingError::Reconciliation
            );
        }
        let values = [
            member.movements[0].unsigned_abs(),
            member.movements[1].unsigned_abs(),
            member.cash,
        ];
        let mut increments = [0; 3];
        for (index, amount) in values.into_iter().enumerate() {
            increments[index] = amount
                .checked_sub(flow.whole[index])
                .filter(|difference| *difference <= u64::from(flow.fractional[index]))
                .ok_or(ClearingError::Reconciliation)?;
        }
        Ok(increments)
    }
}
pub fn bind(
    ctx: &mut Context<BindRecoverySelection>,
    events: &mut crate::event_cpi::Payloads,
    epoch: u64,
    revision: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts()?.is_empty(),
        ClearingError::Resolution
    );
    let accounts = &mut ctx.accounts;
    let header = &mut accounts.prepared;
    let proof = &accounts.search;
    accounts.source.frozen().matches(header)?;
    require!(
        header.stage == single_pair::AWAIT_PAIR
            && header.revision == revision
            && header.epoch == epoch
            && header.count == 8
            && proof.prepared == *header.address()
            && proof.epoch == epoch
            && proof.revision == revision
            && proof.stage == 4
            && proof.count != 0
            && proof.cursor == proof.count
            && proof.rows.len() == 8
            && proof.retained_fees == header.fees,
        ClearingError::Resolution
    );
    let mut net = [[0i128; 2]; 8];
    let mut charges = [0u64; 2];
    for leg in search::charges(&proof.edges, proof.proposed) {
        let index = |member| {
            proof
                .rows
                .binary_search_by_key(&member, |row| row.id)
                .map_err(|_| ClearingError::Resolution)
        };
        net[index(leg.debtor)?][leg.market] += i128::from(leg.atoms);
        net[index(leg.winner)?][leg.market] -= i128::from(leg.atoms);
        charges[leg.market] = charges[leg.market]
            .checked_add(leg.atoms)
            .ok_or(ClearingError::Arithmetic)?;
    }
    let mut members = [MemberResult::default(); 8];
    let mut payouts = RecoveryPayoutScan::default();
    for (index, member) in members.iter_mut().enumerate() {
        let row = &proof.rows[index];
        let changes = proof.movements[index];
        let cash = proof.cash[index];
        let [btc, eth] = net[index];
        *member = MemberResult {
            id: row.id,
            claim_delta: [
                i64::try_from(btc).map_err(|_| ClearingError::Arithmetic)?,
                i64::try_from(eth).map_err(|_| ClearingError::Arithmetic)?,
            ],
            movements: changes,
            cash,
        };
        payouts = payouts
            .accept(
                index as u64,
                row.id,
                row.cash,
                cash,
                changes,
                member.claim_delta,
            )
            .map_err(|_| ClearingError::Reconciliation)?;
    }
    let spent = payouts
        .finish(
            super::super::snapshot_binding(header),
            proof.remaining_insurance,
            proof.retained_fees,
        )
        .map_err(|_| ClearingError::Reconciliation)?;
    let result = BoundResult {
        epoch,
        search: *proof.address(),
        charges,
        insurance_spent: spent,
        members,
        schedule: proof.proposed,
        schedules_checked: proof.count,
    };
    let bytes = &mut header.state.membership;
    bytes.fill(0);
    bytes[..8].copy_from_slice(MARKER);
    crate::wire::write(&result, &mut bytes[8..8 + RECEIPT_LEN])
        .map_err(|_| ClearingError::Resolution)?;
    header.stage = DENOMINATOR;
    events.emit(
        &crate::events::RecoverySelectionBound {
            venue: header.venue,
            epoch,
            search: *proof.address(),
            schedule: proof.proposed,
            schedules_checked: proof.count,
            member_ids: members.map(|row| row.id),
            claim_deltas: members.map(|row| row.claim_delta),
            movements: proof.movements,
            final_cash: proof.cash,
            charge_atoms: charges,
            insurance_spent: spent,
            slot: Clock::get()?.slot,
        },
        accounts.event_authority.account().clone(),
    )
}
