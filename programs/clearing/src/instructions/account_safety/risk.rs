//! Consenting receiver, full two-market funding and strict post-fee risk progress.
use super::*;
use account_cash::*;
use account_trading::authority::AccountGuard;

#[event_cpi]
#[derive(Accounts)]
pub struct LiquidateAccount<'info> {
    pub identity: AccountFinancialIdentity<'info>,
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
) -> Result<super::super::group_safety::risk::Candidate> {
    let target = account_trading::root_view(target)?;
    let receiver = account_trading::root_view(receiver)?;
    let markets = [
        account_trading::market_view(markets[0])?,
        account_trading::market_view(markets[1])?,
    ];
    // The shared oracle adapter uses 2 for active two-market funding. V3's
    // persisted ACTIVE mode is authenticated separately by candidate_profile.
    super::super::group_safety::risk::candidate(
        &target,
        &receiver,
        [&markets[0], &markets[1]],
        2,
        market_index,
        lots,
        price,
        clock,
    )
}

pub fn liquidate(
    ctx: Context<LiquidateAccount>,
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
    let candidate = candidate(
        &accounts.target,
        &accounts.receiver,
        [&accounts.identity.btc, &accounts.identity.eth],
        usize::from(market_index),
        lots,
        price,
        &clock,
    )?;
    let target_positions = accounts.target.positions;
    let receiver_positions = accounts.receiver.positions;
    account_trading::commit_root(&mut accounts.target, &candidate.target)?;
    account_trading::commit_root(&mut accounts.receiver, &candidate.receiver)?;
    account_trading::invalidate(
        &mut accounts.identity.custody,
        target_positions,
        accounts.target.positions,
    )?;
    account_trading::invalidate(
        &mut accounts.identity.custody,
        receiver_positions,
        accounts.receiver.positions,
    )?;
    let selected = if market_index == 0 {
        &mut accounts.identity.btc
    } else {
        &mut accounts.identity.eth
    };
    selected.gross_lots = candidate.gross_lots;
    account_trading::materialize(
        [&mut accounts.identity.btc, &mut accounts.identity.eth],
        &clock,
    )?;
    account_custody::increment(&mut accounts.identity.custody.sequence)?;
    account_custody::reconciled(
        &accounts.identity.custody,
        [&accounts.identity.btc_ledger, &accounts.identity.eth_ledger],
        accounts.identity.vault.amount,
    )?;
    emit(
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
    sequence: u64,
    slot: u64,
    safety_epoch: u64,
    liability_versions: [u64; 2],
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
    markets: [&'a Market; 2],
}

#[inline(never)]
fn emit(
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
        sequence: accounts.identity.custody.sequence,
        slot,
        safety_epoch: accounts.identity.safety.epoch,
        liability_versions: accounts.identity.custody.liability_versions,
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
        markets: [&accounts.identity.btc, &accounts.identity.eth],
    };
    crate::event_cpi::emit_borrowed::<crate::events::AccountLiquidated, _>(
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
            schema_version: 3,
            cash: 17,
            nonce: 9,
            positions: [
                crate::state::v2::Position {
                    lots: -2,
                    virtual_scaled: -300_000_001,
                    funding_checkpoint_scaled: 12,
                    generation: 3,
                },
                crate::state::v2::Position::default(),
            ],
            ..Default::default()
        };
        let receiver = MarginAccount {
            schema_version: 3,
            cash: 21,
            id: 1,
            ..Default::default()
        };
        let market = Market {
            schema_version: 3,
            reference_price: 20_000,
            funding_index_scaled: -17,
            ..Default::default()
        };
        let owned = crate::events::AccountLiquidated {
            venue: Pubkey::new_unique(),
            sequence: 8,
            slot: 42,
            safety_epoch: 4,
            liability_versions: [5, 6],
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
            markets: [
                crate::events::MarketSnapshot::from(&market),
                crate::events::MarketSnapshot::from(&market),
            ],
        };
        let view = LiquidationEventView {
            venue: owned.venue,
            sequence: owned.sequence,
            slot: owned.slot,
            safety_epoch: owned.safety_epoch,
            liability_versions: owned.liability_versions,
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
            markets: [&market, &market],
        };
        let mut expected = Vec::new();
        owned.serialize(&mut expected).unwrap();
        let mut actual = Vec::new();
        view.serialize(&mut actual).unwrap();
        assert_eq!(actual, expected);
    }
}
