//! Consenting receiver, full two-market funding and strict post-fee risk progress.
use super::*;
use account_cash::*;
use account_trading::authority::AccountGuard;

#[event_cpi]
#[derive(Accounts)]
pub struct LiquidateAccount<'info> {
    pub identity: AccountFinancialIdentity<'info>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[0].as_ref()], bump = btc_ledger.bump,
        constraint = btc_ledger.venue == identity.venue.key() && btc_ledger.market == identity.venue.markets[0]
            && btc_ledger.market_index == 0 @ ClearingError::Profile)]
    pub btc_ledger: Option<Box<Account<'info, MarketLedger>>>,
    #[account(mut, seeds = [b"ledger-v3", identity.venue.markets[1].as_ref()], bump = eth_ledger.bump,
        constraint = eth_ledger.venue == identity.venue.key() && eth_ledger.market == identity.venue.markets[1]
            && eth_ledger.market_index == 1 @ ClearingError::Profile)]
    pub eth_ledger: Option<Box<Account<'info, MarketLedger>>>,
    pub receiver_owner: Signer<'info>,
    #[account(mut, seeds = [b"margin-v3", target.portfolio.as_ref(), &target.subaccount_index.to_le_bytes()],
        bump = target.bump, constraint = target.venue == identity.venue.key() @ ClearingError::Profile)]
    pub target: Box<Account<'info, MarginAccount>>,
    #[account(mut, seeds = [b"margin-v3", receiver.portfolio.as_ref(), &receiver.subaccount_index.to_le_bytes()],
        bump = receiver.bump, constraint = receiver.venue == identity.venue.key() @ ClearingError::Profile,
        constraint = receiver.owner == receiver_owner.key() @ ClearingError::Authority,
        constraint = receiver.key() != target.key() @ ClearingError::Alias)]
    pub receiver: Box<Account<'info, MarginAccount>>,
}

/// V3 validates its own identities before sharing the scalar risk engine.
#[inline(never)]
pub(crate) fn candidate(
    target: &MarginAccount,
    receiver: &MarginAccount,
    markets: [&Market; 2],
    market_index: usize,
    lots: u64,
    price: u64,
    clock: &Clock,
) -> Result<crate::engine::risk::Candidate> {
    candidate_optional(
        target,
        receiver,
        markets.map(Some),
        market_index,
        lots,
        price,
        clock,
    )
}

#[inline(never)]
pub(crate) fn candidate_optional(
    target: &MarginAccount,
    receiver: &MarginAccount,
    markets: [Option<&Market>; 2],
    market_index: usize,
    lots: u64,
    price: u64,
    clock: &Clock,
) -> Result<crate::engine::risk::Candidate> {
    let target = account_trading::root_view(target)?;
    let receiver = account_trading::root_view(receiver)?;
    let markets = [
        markets[0].map(account_trading::market_view).transpose()?,
        markets[1].map(account_trading::market_view).transpose()?,
    ];
    // The shared oracle adapter uses 2 for active two-market funding. V3's
    // persisted ACTIVE mode is authenticated separately by candidate_profile.
    crate::engine::risk::candidate_optional(
        &target,
        &receiver,
        markets.each_ref().map(Option::as_ref),
        2,
        market_index,
        lots,
        price,
        clock,
    )
}

pub fn liquidate(
    ctx: &mut Context<LiquidateAccount>,
    events: &mut crate::event_cpi::Payloads,
    target_guard: AccountGuard,
    receiver_guard: AccountGuard,
    market_index: u8,
    lots: u64,
    price: u64,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && market_index < 2,
        ClearingError::Profile
    );
    let accounts = &mut *ctx.accounts;
    candidate_profile(&accounts.identity)?;
    target_guard.check(
        &accounts.identity.venue,
        &accounts.identity.safety,
        &accounts.target,
    )?;
    receiver_guard.check(
        &accounts.identity.venue,
        &accounts.identity.safety,
        &accounts.receiver,
    )?;
    let clock = Clock::get()?;
    let candidate = candidate_optional(
        &accounts.target,
        &accounts.receiver,
        accounts.identity.markets(),
        usize::from(market_index),
        lots,
        price,
        &clock,
    )?;
    require!(
        u128::from(accounts.target.cash) + u128::from(accounts.receiver.cash)
            == u128::from(candidate.target.cash) + u128::from(candidate.receiver.cash),
        ClearingError::Reconciliation
    );
    let target_positions = accounts.target.positions;
    let receiver_positions = accounts.receiver.positions;
    account_trading::commit_root(&mut accounts.target, &candidate.target)?;
    account_trading::commit_root(&mut accounts.receiver, &candidate.receiver)?;
    account_trading::invalidate(
        [
            accounts
                .btc_ledger
                .as_deref_mut()
                .map(|ledger| &mut **ledger),
            accounts
                .eth_ledger
                .as_deref_mut()
                .map(|ledger| &mut **ledger),
        ],
        target_positions,
        accounts.target.positions,
    )?;
    account_trading::invalidate(
        [
            accounts
                .btc_ledger
                .as_deref_mut()
                .map(|ledger| &mut **ledger),
            accounts
                .eth_ledger
                .as_deref_mut()
                .map(|ledger| &mut **ledger),
        ],
        receiver_positions,
        accounts.receiver.positions,
    )?;
    let selected = if market_index == 0 {
        &mut accounts.identity.btc
    } else {
        &mut accounts.identity.eth
    };
    selected
        .as_deref_mut()
        .ok_or(ClearingError::OrderState)?
        .gross_lots = candidate.gross_lots;
    accounts.identity.materialize(&clock)?;
    emit(
        events,
        accounts,
        market_index,
        lots,
        price,
        candidate.fee,
        candidate.before,
        candidate.after,
        clock.slot,
    )
}

/// Borrow scalar account fields in the IDL's exact snapshot order. This avoids
/// building two full roots and two markets on the 4 KiB SBF stack.
#[derive(AnchorSerialize)]
struct LiquidationEventView<'a> {
    venue: Pubkey,
    slot: u64,
    safety_epoch: u64,
    market_index: u8,
    lots: u64,
    price: u64,
    fee: u64,
    deficit_before: i128,
    deficit_after: i128,
    target: Pubkey,
    receiver: Pubkey,
    target_state: &'a MarginAccount,
    receiver_state: &'a MarginAccount,
    markets: Vec<&'a Market>,
    ledgers: Vec<crate::events::MarketLedgerSnapshot>,
}

#[inline(never)]
fn emit(
    events: &mut crate::event_cpi::Payloads,
    accounts: &LiquidateAccount,
    market_index: u8,
    lots: u64,
    price: u64,
    fee: u64,
    before: i128,
    after: i128,
    slot: u64,
) -> Result<()> {
    let event = LiquidationEventView {
        venue: accounts.identity.venue.key(),

        slot,
        safety_epoch: accounts.identity.safety.epoch,
        market_index,
        lots,
        price,
        fee,
        deficit_before: before,
        deficit_after: after,
        target: accounts.target.key(),
        receiver: accounts.receiver.key(),
        target_state: &accounts.target,
        receiver_state: &accounts.receiver,
        markets: accounts.identity.markets().into_iter().flatten().collect(),
        ledgers: [
            accounts.btc_ledger.as_deref(),
            accounts.eth_ledger.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(account_custody::ledger_snapshot)
        .collect(),
    };
    events.emit_borrowed::<crate::events::AccountLiquidated, _>(
        &event,
        accounts.event_authority.to_account_info(),
    )
}

#[cfg(test)]
mod event_tests {
    use super::*;
    #[test]
    fn borrowed_liquidation_is_exactly_the_owned_event_wire() {
        let target = MarginAccount {
            schema_version: 7,
            cash: 17,
            nonce: 9,
            positions: [
                crate::state::Position {
                    lots: -2,
                    virtual_scaled: -300_000_001,
                    funding_checkpoint_scaled: 12,
                    generation: 3,
                },
                crate::state::Position::default(),
            ],
            ..Default::default()
        };
        let receiver = MarginAccount {
            schema_version: 7,
            cash: 21,
            id: 1,
            ..Default::default()
        };
        let market = Market {
            schema_version: 7,
            reference_price: 20_000,
            funding_index_scaled: -17,
            ..Default::default()
        };
        let owned = crate::events::AccountLiquidated {
            venue: Pubkey::new_unique(),
            slot: 42,
            safety_epoch: 4,
            market_index: 1,
            lots: 7,
            price: 20_000,
            fee: 11,
            deficit_before: 1234,
            deficit_after: 567,
            target: Pubkey::new_unique(),
            receiver: Pubkey::new_unique(),
            target_state: crate::events::MarginAccountSnapshot::from(&target),
            receiver_state: crate::events::MarginAccountSnapshot::from(&receiver),
            ledgers: vec![],
            markets: vec![
                crate::events::MarketSnapshot::from(&market),
                crate::events::MarketSnapshot::from(&market),
            ],
        };
        let view = LiquidationEventView {
            venue: owned.venue,
            slot: owned.slot,
            safety_epoch: owned.safety_epoch,
            market_index: owned.market_index,
            lots: owned.lots,
            price: owned.price,
            fee: owned.fee,
            deficit_before: owned.deficit_before,
            deficit_after: owned.deficit_after,
            target: owned.target,
            receiver: owned.receiver,
            target_state: &target,
            receiver_state: &receiver,
            markets: vec![&market, &market],
            ledgers: vec![],
        };
        let mut expected = Vec::new();
        owned.serialize(&mut expected).unwrap();
        let mut actual = Vec::new();
        view.serialize(&mut actual).unwrap();
        assert_eq!(actual, expected);
    }
}
