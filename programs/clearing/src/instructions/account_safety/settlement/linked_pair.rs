//! Joint financial admission on a fresh local profile. BTC and ETH use the
//! same frozen cross debtor. A verified BTC leg alone cannot start settlement.
use super::*;

pub const AWAIT_ETH: u8 = 6;
const MARKER: &[u8; 8] = b"RVLINK01";

#[derive(AnchorSerialize, AnchorDeserialize, Default, Clone, Copy)]
pub struct Leg {
    pub winner: u64,
    pub charge: u64,
    pub eligible: u64,
    pub matched: u64,
    pub price: u64,
    pub extra: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct Joint {
    epoch: u64,
    pub debtor: u64,
    shares: [u64; 2],
    pub legs: [Leg; 2],
}
impl Joint {
    fn write(&self, header: &mut PreparedSettlement) -> Result<()> {
        let bytes = &mut header.state.membership;
        bytes.fill(0);
        bytes[..8].copy_from_slice(MARKER);
        crate::wire::write(self, &mut bytes[8..136]).map_err(|_| ClearingError::Resolution.into())
    }

    pub fn read(header: &PreparedSettlement) -> Result<Option<Self>> {
        let bytes = &header.state.membership;
        if !bytes.starts_with(MARKER) {
            return Ok(None);
        }
        let value =
            crate::wire::read::<Self>(&bytes[8..136]).map_err(|_| ClearingError::Resolution)?;
        require!(
            value.epoch == header.epoch
                && matches!(header.stage, AWAIT_ETH | DENOMINATOR | PROPOSAL),
            ClearingError::Resolution
        );
        Ok(Some(value))
    }

    pub fn claims(&self, frozen: &FrozenMargin) -> Result<[i128; 2]> {
        let mut claims = frozen.claims;
        for (market, leg) in self.legs.iter().enumerate() {
            let change = if frozen.id == self.debtor {
                i128::from(leg.charge)
            } else if frozen.id == leg.winner {
                -i128::from(leg.charge)
            } else {
                0
            };
            claims[market] = claims[market]
                .checked_add(change * financial_core::SCALE)
                .ok_or(ClearingError::Arithmetic)?;
        }
        Ok(claims)
    }
}

#[inline(never)]
pub fn verify(
    header: &mut PreparedSettlement,
    debtor: FrozenMargin,
    winner: FrozenMargin,
    winner_root: &BorshAccount<MarginAccount>,
    events: &mut crate::event_cpi::Payloads,
    authority: AccountView,
) -> Result<()> {
    let market = match header.stage {
        single_pair::AWAIT_PAIR => 0,
        AWAIT_ETH => 1,
        _ => return Err(ClearingError::Resolution.into()),
    };
    let row = |frozen: &FrozenMargin| Row {
        cash: frozen.cash,
        claims: frozen.claims,
    };
    let scan = SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(header))
        .map_err(|_| ClearingError::Resolution)?;
    let (shares, shortfall) = scan
        .linked_pair_shortfall(market, row(&debtor), debtor.lots, row(&winner), winner.lots)
        .map_err(|_| ClearingError::Resolution)?;
    let mark = header.prices[market];
    let lots = winner.lots[market];
    let terms = crate::profit_attribution::frozen_history(winner_root, market)?
        .paired_lots(
            lots,
            mark,
            winner.claims[market],
            lots.unsigned_abs(),
            shortfall,
        )
        .map_err(|_| ClearingError::Resolution)?;
    // Both markets must be fully recoverable at the frozen cash split. For
    // these books each market has exactly one creditor and its own insurer.
    require!(
        shortfall > 0 && terms.charge == shortfall && terms.matched > 0,
        ClearingError::Resolution
    );
    let price = if lots > 0 {
        mark.checked_sub(terms.base_ticks)
    } else {
        mark.checked_add(terms.base_ticks)
    }
    .ok_or(ClearingError::Arithmetic)?;
    let mut joint = if market == 0 {
        Joint {
            epoch: header.epoch,
            debtor: debtor.id,
            shares,
            legs: [Leg::default(); 2],
        }
    } else {
        let saved = Joint::read(header)?.ok_or(ClearingError::Resolution)?;
        require!(
            saved.debtor == debtor.id
                && saved.shares == shares
                && saved.legs[0].winner != winner.id
                && saved.legs[0].charge > 0,
            ClearingError::Resolution
        );
        saved
    };
    joint.legs[market] = Leg {
        winner: winner.id,
        charge: shortfall,
        eligible: terms.eligible,
        matched: terms.matched,
        price,
        extra: terms.extra_tick_lots,
    };
    joint.write(header)?;
    if market == 0 {
        header.stage = AWAIT_ETH;
        return Ok(());
    }
    header.stage = DENOMINATOR;
    events.emit(
        &crate::events::FrozenJointReductionVerified {
            venue: header.venue,
            epoch: header.epoch,
            slot: Clock::get()?.slot,
            debtor_id: debtor.id,
            winners: joint.legs.map(|leg| leg.winner),
            shares,
            charges: joint.legs.map(|leg| leg.charge),
            eligible: joint.legs.map(|leg| leg.eligible),
            matched_lots: joint.legs.map(|leg| leg.matched),
            base_prices: joint.legs.map(|leg| leg.price),
            extra_tick_lots: joint.legs.map(|leg| leg.extra),
        },
        authority,
    )
}
