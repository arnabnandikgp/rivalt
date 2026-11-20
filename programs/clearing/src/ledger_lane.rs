//! Fresh qualification artifact. Each fill records the change to its first
//! maker's lane. Any later consumer of the serial ledger must fold all three.
//! The ledger's scoped revision binds each lane to one immutable checkpoint.
use crate::{
    instructions::account_cash::maintained,
    market_fees::{inspect, LANE_EXTRA, LEDGER_EXTRA},
    state::{
        accounts::{MarginAccount, MarketLedger, VenueSafety},
        liquidity::MakerRegistration,
    },
    ClearingError,
};
use anchor_lang::prelude::*;
use financial_core::backing::changes::{apply, Change, LANE_COUNT};

const OFFSET: usize = 64;

#[derive(Default, AnchorSerialize, AnchorDeserialize)]
struct Pending {
    revision: u64,
    fills: u64,
    liabilities: u64,
    fees: u64,
    bad: i128,
    quantity: i128,
    positive: i128,
    negative: i128,
    required: [i128; 2],
}

impl Pending {
    fn read(bytes: &[u8], ledger: &MarketLedger) -> Result<Self> {
        require!(
            bytes.len() == 128 && ledger.revision != 0,
            ClearingError::Reconciliation
        );
        let value: Self = crate::wire::read(bytes)?;
        require!(
            value.revision <= ledger.revision,
            ClearingError::Reconciliation
        );
        if value.revision == ledger.revision {
            Ok(value)
        } else {
            Ok(Self {
                revision: ledger.revision,
                ..Self::default()
            })
        }
    }

    fn change(&self) -> Change {
        Change {
            bad: self.bad,
            quantity: self.quantity,
            positive: self.positive,
            negative: self.negative,
            required: self.required,
        }
    }

    fn record_root(
        &mut self,
        ledger: &MarketLedger,
        safety: &VenueSafety,
        before: &MarginAccount,
        after: &MarginAccount,
    ) -> Result<()> {
        maintained::validate_pair(before, after)?;
        let index = usize::from(ledger.market_index);
        require!(
            index < 2
                && before.venue == ledger.venue
                && !maintained::relevant(before, after, 1 - index),
            ClearingError::OrderState
        );
        if !maintained::relevant(before, after, index) {
            return Ok(());
        }
        self.liabilities = self
            .liabilities
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?;
        if let Some((old, new)) = maintained::changes(ledger, before, after, safety)? {
            let delta = self
                .change()
                .record(old, new)
                .map_err(|_| ClearingError::Reconciliation)?;
            self.bad = delta.bad;
            self.quantity = delta.quantity;
            self.positive = delta.positive;
            self.negative = delta.negative;
            self.required = delta.required;
        }
        Ok(())
    }
}

fn headroom(base: u64, instance: u8) -> u64 {
    let total = u64::MAX - base;
    total / 3 + u64::from(u64::from(instance) < total % 3)
}

#[inline(never)]
pub(crate) fn record<'a>(
    ledger: &MarketLedger,
    safety: &VenueSafety,
    first: &mut BorshAccount<MakerRegistration>,
    roots: impl Iterator<Item = (&'a MarginAccount, &'a MarginAccount)>,
    fee: u64,
) -> Result<(u128, u64)> {
    let instance = first.instance;
    require!(
        instance < 3 && first.venue == ledger.venue && first.market == ledger.market,
        ClearingError::MakerBinding
    );
    let mut detail = None;
    inspect::<_, LANE_EXTRA>(
        first,
        |bytes| {
            let mut pending = Pending::read(&bytes[OFFSET..], ledger)?;
            for (before, after) in roots {
                pending.record_root(ledger, safety, before, after)?;
            }
            pending.fills = pending
                .fills
                .checked_add(1)
                .ok_or(ClearingError::Arithmetic)?;
            pending.liabilities = pending
                .liabilities
                .checked_add(1)
                .ok_or(ClearingError::Arithmetic)?;
            pending.fees = financial_core::cash_add(pending.fees, fee)
                .map_err(|_| ClearingError::Arithmetic)?;
            // Reserve one ledger version for fee classification, which follows the
            // complete fold. The serial route remains available if a lane runs out.
            let classification_base = ledger
                .version
                .checked_add(1)
                .ok_or(ClearingError::Arithmetic)?;
            require!(
                ledger.revision < u64::MAX
                    && pending.fills <= headroom(classification_base, instance)
                    && pending.liabilities <= headroom(ledger.liability_version, instance),
                ClearingError::Arithmetic
            );
            let collected = u128::from_le_bytes(bytes[..16].try_into().unwrap())
                .checked_add(u128::from(fee))
                .ok_or(ClearingError::Arithmetic)?;
            bytes[..16].copy_from_slice(&collected.to_le_bytes());
            crate::wire::write(&pending, &mut bytes[OFFSET..])?;
            detail = Some((collected, pending.fees));
            Ok(())
        },
        true,
    )?;
    detail.ok_or(ClearingError::Reconciliation.into())
}

#[inline(never)]
pub(crate) fn fold(
    ledger: &mut BorshAccount<MarketLedger>,
    registrations: [&BorshAccount<MakerRegistration>; LANE_COUNT],
) -> Result<()> {
    let mut changes = [Change::default(); LANE_COUNT];
    let mut fills = 0u64;
    let mut liabilities = 0u64;
    let mut fees = 0u64;
    for (index, registration) in registrations.into_iter().enumerate() {
        require!(
            usize::from(registration.instance) == index
                && registration.market == ledger.market
                && registration.venue == ledger.venue,
            ClearingError::MakerBinding
        );
        let bytes = registration.account().try_borrow()?;
        require!(
            bytes.len() == 8 + MakerRegistration::INIT_SPACE + LANE_EXTRA,
            ClearingError::Profile
        );
        let pending = Pending::read(&bytes[8 + MakerRegistration::INIT_SPACE + OFFSET..], ledger)?;
        changes[index] = pending.change();
        fills = fills
            .checked_add(pending.fills)
            .ok_or(ClearingError::Arithmetic)?;
        liabilities = liabilities
            .checked_add(pending.liabilities)
            .ok_or(ClearingError::Arithmetic)?;
        fees =
            financial_core::cash_add(fees, pending.fees).map_err(|_| ClearingError::Arithmetic)?;
    }
    if ledger.backing.epoch != 0 {
        ledger.backing.summary = apply(ledger.backing.totals()?, changes)
            .map_err(|_| ClearingError::Reconciliation)?
            .checkpoint();
    } else {
        require!(
            changes == [Change::default(); LANE_COUNT],
            ClearingError::Reconciliation
        );
    }
    ledger.fees =
        financial_core::cash_add(ledger.fees, fees).map_err(|_| ClearingError::Arithmetic)?;
    ledger.version = ledger
        .version
        .checked_add(fills)
        .ok_or(ClearingError::Arithmetic)?;
    ledger.liability_version = ledger
        .liability_version
        .checked_add(liabilities)
        .ok_or(ClearingError::Arithmetic)?;
    inspect::<_, LEDGER_EXTRA>(
        ledger,
        |bytes| {
            let pending = u64::from_le_bytes(bytes[16..24].try_into().unwrap());
            let total =
                financial_core::cash_add(pending, fees).map_err(|_| ClearingError::Arithmetic)?;
            bytes[16..24].copy_from_slice(&total.to_le_bytes());
            Ok(())
        },
        true,
    )
}
