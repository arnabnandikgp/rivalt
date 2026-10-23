//! Frozen, exact-cohort resolution. Cash mutations and the planning ledger are
//! separate so even derived claims beyond the ordinary stored-v limit can close.
use crate::{
    custody, oracle, orders, routes, ClearingError, MarketState, Participant, ParticipantRegistry,
    TestRouteState,
};
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use financial_core::{self as math, oracle as policy};
use solana_sha256_hasher::hashv;

pub const IDLE: u8 = 0;
pub const AWAIT_VALUATION: u8 = 1;
pub const VALUE: u8 = 2;
pub const COLLECT: u8 = 3;
pub const INSURANCE_FLOORS: u8 = 4;
pub const INSURANCE_AWARDS: u8 = 5;
pub const IMPAIR_FLOORS: u8 = 6;
pub const IMPAIR_AWARDS: u8 = 7;
pub const PAY_FLOORS: u8 = 8;
pub const PAY_AWARDS: u8 = 9;
pub const APPLY: u8 = 10;
pub const RECONCILE: u8 = 11;
pub const COMPLETE: u8 = 12;
pub const RESUMED: u8 = 13;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct ResolutionHeader {
    pub epoch: u64,
    pub stage: u8,
    pub cursor: u16,
    pub count: u16,
    pub registry_hash: [u8; 32],
    pub price: u64,
    pub funding: i128,
    pub frozen_at: i64,
    pub initial_cash: u64,
    pub initial_pool: u64,
    pub initial_insurance: u64,
    pub initial_fees: u64,
    pub initial_vault: u64,
    pub scanned_cash: u64,
    pub scanned_lots: i128,
    pub scanned_gross: u64,
    pub claim_sum: i128,
    pub remaining_lots: i128,
    pub remaining_gross: u64,
    pub debt: u128,
    pub positive: u128,
    pub insured_atoms: u64,
    pub plan_pool: u64,
    pub assigned: u128,
    pub extra: u16,
    pub rounding_sum: i128,
    pub collected_total: u64,
    pub paid_applied: u64,
    pub insurance_moved: bool,
    pub recovery_since: i64,
    pub recovery_last: i64,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct ResolutionRow {
    pub cash_before: u64,
    pub lots: i64,
    pub generation: u64,
    /// Valued claim plus collected*SCALE. Ordinary v remains frozen until Apply.
    pub claim: i128,
    pub collected: u64,
    pub insured_scaled: u128,
    pub impaired_scaled: u128,
    pub paid: u64,
    pub rounding_scaled: i128,
    pub remainder: u128,
}
#[account]
#[derive(InitSpace)]
pub struct ResolutionState {
    pub version: u16,
    pub market: Pubkey,
    pub header: ResolutionHeader,
    #[max_len(64)]
    pub rows: Vec<ResolutionRow>,
    pub bump: u8,
}
#[derive(Accounts)]
pub struct InitializeResolution<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=authority)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(init,payer=authority,space=8+ResolutionState::INIT_SPACE,seeds=[b"resolution",market.key().as_ref()],bump)]
    pub resolution: Box<Account<'info, ResolutionState>>,
    pub system_program: Program<'info, System>,
}
#[event_cpi]
#[derive(Accounts)]
pub struct FreezeMarket<'info> {
    pub caller: Signer<'info>,
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=vault)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(seeds=[b"participant",market.key().as_ref(),target.owner.as_ref()],bump=target.bump,has_one=market)]
    pub target: Box<Account<'info, Participant>>,
    #[account(mut,seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(seeds=[b"registry",market.key().as_ref()],bump=registry.bump,has_one=market)]
    pub registry: Box<Account<'info, ParticipantRegistry>>,
    #[account(mut,seeds=[b"resolution",market.key().as_ref()],bump=resolution.bump,has_one=market)]
    pub resolution: Box<Account<'info, ResolutionState>>,
    #[account(seeds=[b"vault",market.key().as_ref()],bump=market.vault_bump,
        constraint=vault.mint==market.quote_mint @ ClearingError::Mint,
        constraint=vault.owner==market.key() @ ClearingError::Authority)]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: exact immutable source binding/owner/schema validated by sources().
    pub primary_btc: UncheckedAccount<'info>,
    /// CHECK: same authenticated source validation.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: same authenticated source validation.
    pub guard_btc: UncheckedAccount<'info>,
    /// CHECK: same authenticated source validation.
    pub guard_collateral: UncheckedAccount<'info>,
}
#[event_cpi]
#[derive(Accounts)]
pub struct AdvanceResolution<'info> {
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=vault)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(seeds=[b"registry",market.key().as_ref()],bump=registry.bump,has_one=market)]
    pub registry: Box<Account<'info, ParticipantRegistry>>,
    #[account(mut,seeds=[b"resolution",market.key().as_ref()],bump=resolution.bump,has_one=market)]
    pub resolution: Box<Account<'info, ResolutionState>>,
    #[account(seeds=[b"vault",market.key().as_ref()],bump=market.vault_bump,
        constraint=vault.mint==market.quote_mint @ ClearingError::Mint,
        constraint=vault.owner==market.key() @ ClearingError::Authority)]
    pub vault: Box<Account<'info, TokenAccount>>,
}
#[event_cpi]
#[derive(Accounts)]
pub struct RecoverResolution<'info> {
    pub caller: Signer<'info>,
    #[account(mut,seeds=[b"market".as_ref(),b"BTC".as_ref()],bump=market.bump,has_one=vault)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(mut,seeds=[b"test-routes",market.key().as_ref()],bump=route_state.bump,has_one=market)]
    pub route_state: Box<Account<'info, TestRouteState>>,
    #[account(seeds=[b"registry",market.key().as_ref()],bump=registry.bump,has_one=market)]
    pub registry: Box<Account<'info, ParticipantRegistry>>,
    #[account(mut,seeds=[b"resolution",market.key().as_ref()],bump=resolution.bump,has_one=market)]
    pub resolution: Box<Account<'info, ResolutionState>>,
    #[account(seeds=[b"vault",market.key().as_ref()],bump=market.vault_bump,
        constraint=vault.mint==market.quote_mint @ ClearingError::Mint,
        constraint=vault.owner==market.key() @ ClearingError::Authority)]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: exact immutable source binding/owner/schema validated by sources().
    pub primary_btc: UncheckedAccount<'info>,
    /// CHECK: same authenticated source validation.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: same authenticated source validation.
    pub guard_btc: UncheckedAccount<'info>,
    /// CHECK: same authenticated source validation.
    pub guard_collateral: UncheckedAccount<'info>,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ResolutionUpdate {
    pub id: u16,
    pub row: ResolutionRow,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ResolutionParticipant {
    pub participant: Pubkey,
    pub id: u16,
    pub cash: u64,
    pub lots: i64,
    pub virtual_scaled: i128,
    pub funding_checkpoint_scaled: i128,
    pub generation: u64,
    /// Apply invalidates all active orders, zeros reserves/IDs and group allowance.
    /// Collection leaves the full existing book and nonce unchanged.
    pub finalized: bool,
}
#[event]
pub struct ResolutionProgress {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub sequence: u64,
    pub slot: u64,
    /// 0 freeze/reset rows, 1 page, 2 valuation/recovery check, 3 resume.
    pub kind: u8,
    pub mode: u8,
    pub paused: bool,
    pub funding_index_scaled: i128,
    pub funding_time: i64,
    pub total_cash: u64,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
    pub allocated_vault: u64,
    pub gross_lots: u64,
    pub oracle: oracle::OracleState,
    pub header: ResolutionHeader,
    pub rows: Vec<ResolutionUpdate>,
    pub participants: Vec<ResolutionParticipant>,
}
fn checked<T>(r: math::Result<T>) -> Result<T> {
    r.map_err(|_| error!(ClearingError::Resolution))
}
fn next(n: u64) -> Result<u64> {
    n.checked_add(1)
        .ok_or_else(|| error!(ClearingError::Arithmetic))
}
fn registry_hash(r: &ParticipantRegistry) -> Result<[u8; 32]> {
    require!(
        r.schema_version == 1
            && r.count > 0
            && r.count <= 64
            && usize::from(r.count) == r.members.len(),
        ClearingError::Resolution
    );
    Ok(hashv(&r.members.iter().map(|k| k.as_ref()).collect::<Vec<_>>()).to_bytes())
}
fn sources(
    infos: [&AccountInfo; 4],
    o: &mut oracle::OracleState,
    now: i64,
) -> Result<Option<policy::Bounds>> {
    let mut values = [None; 4];
    for i in 0..4 {
        oracle::binding(infos[i], o.sources[i], i)?;
        if let Ok((p, sequence)) = oracle::source(infos[i], o.sources[i], i, o.source_sequences[i])
        {
            values[i] = Some(p);
            o.source_sequences[i] = sequence;
        }
    }
    Ok(values[0].zip(values[1]).and_then(|(p, c)| {
        policy::bounds([p, c], values[2].zip(values[3]).map(|(p, c)| [p, c]), now).ok()
    }))
}
fn frozen(
    m: &MarketState,
    r: &TestRouteState,
    registry: &ParticipantRegistry,
    state: &ResolutionState,
    vault: u64,
    epoch: u64,
) -> Result<()> {
    require!(crate::financial_profile(), ClearingError::Profile);
    custody::profile(m)?;
    let h = &state.header;
    require!(
        m.mode == 3
            && m.paused
            && state.version == 1
            && h.epoch == epoch
            && h.stage >= AWAIT_VALUATION
            && h.stage <= COMPLETE
            && h.count == registry.count
            && h.registry_hash == registry_hash(registry)?
            && state.rows.len() == usize::from(h.count)
            && m.funding_index_scaled == h.funding
            && r.gross_lots == h.remaining_gross,
        ClearingError::Resolution
    );
    cash_invariant(m, h, vault)
}
fn cash_invariant(m: &MarketState, h: &ResolutionHeader, vault: u64) -> Result<()> {
    let z = if h.insurance_moved {
        h.insured_atoms
    } else {
        0
    };
    require!(
        m.total_cash
            == checked(math::cash_add(
                checked(math::cash_sub(h.initial_cash, h.collected_total))?,
                h.paid_applied
            ))?
            && m.settlement
                == checked(math::cash_sub(
                    checked(math::cash_add(
                        checked(math::cash_add(h.initial_pool, h.collected_total))?,
                        z
                    ))?,
                    h.paid_applied
                ))?
            && m.insurance == checked(math::cash_sub(h.initial_insurance, z))?
            && m.fees == h.initial_fees
            && m.allocated_vault == h.initial_vault,
        ClearingError::Reconciliation
    );
    custody::reconciled(m, vault)
}
fn progress(
    m: &mut Account<MarketState>,
    r: &TestRouteState,
    state: &ResolutionState,
    kind: u8,
    rows: Vec<ResolutionUpdate>,
    participants: Vec<ResolutionParticipant>,
) -> Result<ResolutionProgress> {
    m.sequence = next(m.sequence)?;
    Ok(ResolutionProgress {
        version: 1,
        domain: m.domain,
        market: m.key(),
        terms_epoch: m.terms_epoch,
        config_epoch: m.config_epoch,
        sequence: m.sequence,
        slot: Clock::get()?.slot,
        kind,
        mode: m.mode,
        paused: m.paused,
        funding_index_scaled: m.funding_index_scaled,
        funding_time: m.funding_time,
        total_cash: m.total_cash,
        settlement: m.settlement,
        insurance: m.insurance,
        fees: m.fees,
        allocated_vault: m.allocated_vault,
        gross_lots: r.gross_lots,
        oracle: r.oracle,
        header: state.header,
        rows,
        participants,
    })
}
pub fn initialize(ctx: Context<InitializeResolution>) -> Result<()> {
    require!(
        crate::financial_profile()
            && ctx.remaining_accounts.is_empty()
            && ctx.accounts.market.mode == 2
            && !ctx.accounts.market.paused,
        ClearingError::Profile
    );
    let s = &mut ctx.accounts.resolution;
    s.version = 1;
    s.market = ctx.accounts.market.key();
    s.bump = ctx.bumps.resolution;
    Ok(())
}
/// Close the currently held diagnostic interval exactly once when entering freeze.
/// Charges have already been materialized by the causal oracle prefix function.
#[inline(never)]
fn freeze_coverage(m: &MarketState, o: &mut oracle::OracleState, now: i64) -> Result<()> {
    if o.sampled_at == 0 {
        return Ok(());
    }
    let elapsed = u64::try_from(
        now.checked_sub(o.sampled_at)
            .ok_or(ClearingError::Arithmetic)?,
    )
    .map_err(|_| error!(ClearingError::Resolution))?;
    let covered = if o.held_until > o.sampled_at {
        (m.funding_time.min(o.held_until) - o.sampled_at).max(0) as u64
    } else {
        0
    };
    require!(covered <= elapsed, ClearingError::Resolution);
    o.covered_seconds = o
        .covered_seconds
        .checked_add(covered)
        .ok_or(ClearingError::Arithmetic)?;
    o.skipped_seconds = o
        .skipped_seconds
        .checked_add(elapsed - covered)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(())
}
pub fn freeze(
    ctx: Context<FreezeMarket>,
    sequence: u64,
    observation: u64,
    emergency: bool,
) -> Result<()> {
    let a = &mut *ctx.accounts;
    require!(
        crate::financial_profile() && ctx.remaining_accounts.is_empty() && a.market.mode == 2,
        ClearingError::Profile
    );
    custody::profile(&a.market)?;
    custody::reconciled(&a.market, a.vault.amount)?;
    require!(
        a.market.sequence == sequence && a.route_state.observation_sequence == observation,
        ClearingError::FinancialSequence
    );
    require!(
        a.resolution.version == 1 && matches!(a.resolution.header.stage, IDLE | RESUMED),
        ClearingError::Resolution
    );
    let identity = registry_hash(&a.registry)?;
    require!(
        a.registry.members.get(usize::from(a.target.id)) == Some(&a.target.key()),
        ClearingError::Resolution
    );
    let now = Clock::get()?.unix_timestamp;
    let bounds = sources(
        [
            &a.primary_btc,
            &a.primary_collateral,
            &a.guard_btc,
            &a.guard_collateral,
        ],
        &mut a.route_state.oracle,
        now,
    )?;
    oracle::materialize(&mut a.market, &a.route_state)?;
    let price = if let Some(b) = bounds {
        require!(!emergency, ClearingError::Resolution);
        let p = routes::participant_model(&a.target)?;
        require!(
            checked(math::scaled(p.cash))?
                .checked_add(checked(
                    p.unpaid(b.reference, a.market.funding_index_scaled)
                )?)
                .ok_or(ClearingError::Arithmetic)?
                < 0,
            ClearingError::Resolution
        );
        b.reference
    } else {
        require!(
            emergency
                && a.caller.key() == a.market.authority
                && a.route_state.oracle.source_deadline > 0
                && now
                    >= a.route_state
                        .oracle
                        .source_deadline
                        .checked_add(30)
                        .ok_or(ClearingError::Arithmetic)?,
            ClearingError::Resolution
        );
        0
    };
    freeze_coverage(&a.market, &mut a.route_state.oracle, now)?;
    let h = ResolutionHeader {
        epoch: next(a.resolution.header.epoch)?,
        stage: if price == 0 { AWAIT_VALUATION } else { VALUE },
        count: a.registry.count,
        registry_hash: identity,
        price,
        funding: a.market.funding_index_scaled,
        frozen_at: now,
        initial_cash: a.market.total_cash,
        initial_pool: a.market.settlement,
        initial_insurance: a.market.insurance,
        initial_fees: a.market.fees,
        initial_vault: a.market.allocated_vault,
        remaining_gross: a.route_state.gross_lots,
        ..ResolutionHeader::default()
    };
    a.resolution.header = h;
    a.resolution.rows = vec![ResolutionRow::default(); usize::from(h.count)];
    a.market.mode = 3;
    a.market.paused = true;
    a.market.terms_epoch = next(a.market.terms_epoch)?;
    a.market.config_epoch = next(a.market.config_epoch)?;
    cash_invariant(&a.market, &h, a.vault.amount)?;
    let event = progress(
        &mut a.market,
        &a.route_state,
        &a.resolution,
        0,
        vec![],
        vec![],
    )?;
    emit_cpi!(event);
    Ok(())
}
#[inline(never)]
fn member(
    info: &AccountInfo,
    market: Pubkey,
    registry: &ParticipantRegistry,
    id: usize,
    writable: bool,
) -> Result<Participant> {
    require!(
        info.owner == &crate::ID
            && info.key == &registry.members[id]
            && info.is_writable == writable
            && info.data_len() == 8 + Participant::INIT_SPACE,
        ClearingError::Resolution
    );
    let p = Participant::try_deserialize(&mut &info.try_borrow_data()?[..])?;
    require!(
        p.schema_version == 1 && p.market == market && usize::from(p.id) == id,
        ClearingError::Resolution
    );
    let key = Pubkey::create_program_address(
        &[b"participant", market.as_ref(), p.owner.as_ref(), &[p.bump]],
        &crate::ID,
    )
    .map_err(|_| error!(ClearingError::Resolution))?;
    require_keys_eq!(key, *info.key, ClearingError::Resolution);
    Ok(p)
}
fn original(p: &Participant, row: &ResolutionRow, h: &ResolutionHeader) -> Result<()> {
    require!(
        p.cash == checked(math::cash_sub(row.cash_before, row.collected))?
            && p.lots == row.lots
            && p.generation == row.generation
            && checked(routes::participant_model(p)?.unpaid(h.price, h.funding))?
                .checked_add(checked(math::scaled(row.collected))?)
                .ok_or(ClearingError::Arithmetic)?
                == row.claim,
        ClearingError::Resolution
    );
    Ok(())
}
fn quotient(total: u128, weight: u128, denominator: u128) -> Result<(u128, u128)> {
    if denominator == 0 {
        require!(total == 0 && weight == 0, ClearingError::Resolution);
        return Ok((0, 0));
    }
    checked(math::mul_div_rem(total, weight, denominator))
}
fn bonus(rows: &[ResolutionRow], id: usize, extra: u16) -> u128 {
    let rem = rows[id].remainder;
    let rank = rows
        .iter()
        .enumerate()
        .filter(|(j, r)| r.remainder > rem || (r.remainder == rem && *j < id))
        .count();
    u128::from(rank < usize::from(extra))
}
fn sum(a: u128, b: u128) -> Result<u128> {
    a.checked_add(b)
        .ok_or_else(|| error!(ClearingError::Arithmetic))
}
fn signed_sum(a: i128, b: i128) -> Result<i128> {
    a.checked_add(b)
        .ok_or_else(|| error!(ClearingError::Arithmetic))
}
fn floor_end(h: &mut ResolutionHeader, total: u128) -> Result<()> {
    let extra = total
        .checked_sub(h.assigned)
        .ok_or(ClearingError::Resolution)?;
    require!(extra < u128::from(h.count), ClearingError::Resolution);
    h.extra = u16::try_from(extra).map_err(|_| error!(ClearingError::Arithmetic))?;
    h.assigned = 0;
    Ok(())
}
#[inline(never)]
fn finish_pass(
    m: &mut MarketState,
    r: &mut TestRouteState,
    h: &mut ResolutionHeader,
) -> Result<()> {
    match h.stage {
        VALUE => {
            require!(
                h.scanned_cash == h.initial_cash
                    && h.scanned_lots == 0
                    && h.scanned_gross == h.remaining_gross
                    && h.claim_sum == checked(math::scaled(h.initial_pool))?,
                ClearingError::Reconciliation
            );
        }
        COLLECT => {
            require!(
                h.positive.checked_sub(h.debt)
                    == Some(checked(math::scaled(m.settlement))? as u128),
                ClearingError::Reconciliation
            );
            h.insured_atoms =
                u64::try_from((h.debt / math::SCALE as u128).min(u128::from(m.insurance)))
                    .map_err(|_| error!(ClearingError::Arithmetic))?;
            h.plan_pool = checked(math::cash_add(m.settlement, h.insured_atoms))?;
        }
        INSURANCE_FLOORS => floor_end(h, checked(math::scaled(h.insured_atoms))? as u128)?,
        INSURANCE_AWARDS => {
            require!(
                h.assigned == checked(math::scaled(h.insured_atoms))? as u128,
                ClearingError::Reconciliation
            );
            h.assigned = 0;
        }
        IMPAIR_FLOORS => floor_end(
            h,
            h.debt
                .checked_sub(checked(math::scaled(h.insured_atoms))? as u128)
                .ok_or(ClearingError::Resolution)?,
        )?,
        IMPAIR_AWARDS => {
            require!(
                h.assigned
                    == h.debt
                        .checked_sub(checked(math::scaled(h.insured_atoms))? as u128)
                        .ok_or(ClearingError::Resolution)?,
                ClearingError::Reconciliation
            );
            h.assigned = 0;
        }
        PAY_FLOORS => floor_end(h, u128::from(h.plan_pool))?,
        PAY_AWARDS => {
            require!(
                h.assigned == u128::from(h.plan_pool) && h.rounding_sum == 0 && !h.insurance_moved,
                ClearingError::Reconciliation
            );
            m.insurance = checked(math::cash_sub(m.insurance, h.insured_atoms))?;
            m.settlement = checked(math::cash_add(m.settlement, h.insured_atoms))?;
            h.insurance_moved = true;
        }
        APPLY => {
            require!(
                m.settlement == 0
                    && h.paid_applied == h.plan_pool
                    && h.remaining_lots == 0
                    && h.remaining_gross == 0
                    && r.gross_lots == 0,
                ClearingError::Reconciliation
            );
            h.scanned_cash = 0;
            h.scanned_lots = 0;
            h.scanned_gross = 0;
            h.claim_sum = 0;
        }
        RECONCILE => {
            require!(
                h.scanned_cash == m.total_cash
                    && h.scanned_lots == 0
                    && h.scanned_gross == 0
                    && h.claim_sum == 0
                    && m.settlement == 0,
                ClearingError::Reconciliation
            );
        }
        _ => return err!(ClearingError::Resolution),
    }
    h.stage = h.stage.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    h.cursor = 0;
    Ok(())
}
#[inline(never)]
fn process_row(
    m: &mut MarketState,
    r: &mut TestRouteState,
    s: &mut ResolutionState,
    id: usize,
    p: &mut Participant,
) -> Result<()> {
    let h = &mut s.header;
    let award = if matches!(h.stage, INSURANCE_AWARDS | IMPAIR_AWARDS | PAY_AWARDS) {
        bonus(&s.rows, id, h.extra)
    } else {
        0
    };
    let row = &mut s.rows[id];
    if h.stage > VALUE && h.stage < RECONCILE {
        original(p, row, h)?;
    }
    match h.stage {
        VALUE => {
            let model = routes::participant_model(p)?;
            *row = ResolutionRow {
                cash_before: p.cash,
                lots: p.lots,
                generation: p.generation,
                claim: checked(model.unpaid(h.price, h.funding))?,
                ..ResolutionRow::default()
            };
            h.scanned_cash = checked(math::cash_add(h.scanned_cash, p.cash))?;
            h.scanned_lots = signed_sum(h.scanned_lots, i128::from(p.lots))?;
            h.scanned_gross = h
                .scanned_gross
                .checked_add(p.lots.unsigned_abs())
                .ok_or(ClearingError::Arithmetic)?;
            h.claim_sum = signed_sum(h.claim_sum, row.claim)?;
        }
        COLLECT => {
            let amount = u64::try_from(
                (row.claim.min(0).unsigned_abs() / math::SCALE as u128).min(u128::from(p.cash)),
            )
            .map_err(|_| error!(ClearingError::Arithmetic))?;
            row.collected = amount;
            row.claim = signed_sum(row.claim, checked(math::scaled(amount))?)?;
            p.cash = checked(math::cash_sub(p.cash, amount))?;
            m.total_cash = checked(math::cash_sub(m.total_cash, amount))?;
            m.settlement = checked(math::cash_add(m.settlement, amount))?;
            h.collected_total = checked(math::cash_add(h.collected_total, amount))?;
            h.debt = sum(h.debt, row.claim.min(0).unsigned_abs())?;
            h.positive = sum(h.positive, row.claim.max(0) as u128)?;
        }
        INSURANCE_FLOORS => {
            let (v, rem) = quotient(
                checked(math::scaled(h.insured_atoms))? as u128,
                row.claim.min(0).unsigned_abs(),
                h.debt,
            )?;
            row.insured_scaled = v;
            row.remainder = rem;
            h.assigned = sum(h.assigned, v)?;
        }
        INSURANCE_AWARDS => {
            row.insured_scaled = sum(row.insured_scaled, award)?;
            h.assigned = sum(h.assigned, row.insured_scaled)?;
        }
        IMPAIR_FLOORS => {
            let total = h
                .debt
                .checked_sub(checked(math::scaled(h.insured_atoms))? as u128)
                .ok_or(ClearingError::Resolution)?;
            let (v, rem) = quotient(total, row.claim.max(0) as u128, h.positive)?;
            row.impaired_scaled = v;
            row.remainder = rem;
            h.assigned = sum(h.assigned, v)?;
        }
        IMPAIR_AWARDS => {
            row.impaired_scaled = sum(row.impaired_scaled, award)?;
            h.assigned = sum(h.assigned, row.impaired_scaled)?;
        }
        PAY_FLOORS => {
            let entitlement = (row.claim.max(0) as u128)
                .checked_sub(row.impaired_scaled)
                .ok_or(ClearingError::Resolution)?;
            row.paid = u64::try_from(entitlement / math::SCALE as u128)
                .map_err(|_| error!(ClearingError::Arithmetic))?;
            row.remainder = entitlement % math::SCALE as u128;
            h.assigned = sum(h.assigned, u128::from(row.paid))?;
        }
        PAY_AWARDS => {
            row.paid = checked(math::cash_add(row.paid, award as u64))?;
            h.assigned = sum(h.assigned, u128::from(row.paid))?;
            let entitlement = (row.claim.max(0) as u128)
                .checked_sub(row.impaired_scaled)
                .ok_or(ClearingError::Resolution)?;
            row.rounding_scaled = checked(math::scaled(row.paid))?
                .checked_sub(
                    i128::try_from(entitlement).map_err(|_| error!(ClearingError::Arithmetic))?,
                )
                .ok_or(ClearingError::Arithmetic)?;
            require!(
                row.rounding_scaled.unsigned_abs() < math::SCALE as u128,
                ClearingError::Reconciliation
            );
            h.rounding_sum = signed_sum(h.rounding_sum, row.rounding_scaled)?;
        }
        APPLY => {
            p.cash = checked(math::cash_add(p.cash, row.paid))?;
            if p.lots != 0 {
                p.generation = next(p.generation)?;
            }
            h.remaining_lots = h
                .remaining_lots
                .checked_sub(i128::from(p.lots))
                .ok_or(ClearingError::Arithmetic)?;
            h.remaining_gross = h
                .remaining_gross
                .checked_sub(p.lots.unsigned_abs())
                .ok_or(ClearingError::Arithmetic)?;
            r.gross_lots = h.remaining_gross;
            p.lots = 0;
            p.virtual_scaled = 0;
            p.funding_checkpoint_scaled = h.funding;
            p.reserved = 0;
            p.order_ids = [0; 4];
            for o in &mut p.book.orders {
                if o.active() {
                    o.state = orders::INVALIDATED;
                }
                o.reserve = 0;
            }
            for g in &mut p.book.groups {
                g.remaining = 0;
            }
            m.total_cash = checked(math::cash_add(m.total_cash, row.paid))?;
            m.settlement = checked(math::cash_sub(m.settlement, row.paid))?;
            h.paid_applied = checked(math::cash_add(h.paid_applied, row.paid))?;
        }
        RECONCILE => {
            require!(
                p.cash
                    == checked(math::cash_add(
                        checked(math::cash_sub(row.cash_before, row.collected))?,
                        row.paid
                    ))?
                    && p.lots == 0
                    && p.virtual_scaled == 0
                    && p.funding_checkpoint_scaled == h.funding
                    && p.reserved == 0
                    && p.order_ids == [0; 4]
                    && p.book.orders.iter().all(|o| !o.active())
                    && p.book.groups.iter().all(|g| g.remaining == 0)
                    && p.generation
                        == if row.lots == 0 {
                            row.generation
                        } else {
                            next(row.generation)?
                        },
                ClearingError::Reconciliation
            );
            routes::participant_model(p)?;
            h.scanned_cash = checked(math::cash_add(h.scanned_cash, p.cash))?;
        }
        _ => return err!(ClearingError::Resolution),
    }
    Ok(())
}
pub fn advance(ctx: Context<AdvanceResolution>, epoch: u64, stage: u8, start: u16) -> Result<()> {
    let a = &mut *ctx.accounts;
    frozen(
        &a.market,
        &a.route_state,
        &a.registry,
        &a.resolution,
        a.vault.amount,
        epoch,
    )?;
    require!(
        (VALUE..=RECONCILE).contains(&stage)
            && a.resolution.header.stage == stage
            && a.resolution.header.cursor == start,
        ClearingError::Resolution
    );
    let n = ctx.remaining_accounts.len();
    require!(
        (1..=4).contains(&n) && usize::from(start) + n <= usize::from(a.resolution.header.count),
        ClearingError::Resolution
    );
    let (updates, participants) = page(a, ctx.remaining_accounts, stage, start)?;
    a.resolution.header.cursor = a
        .resolution
        .header
        .cursor
        .checked_add(n as u16)
        .ok_or(ClearingError::Arithmetic)?;
    if a.resolution.header.cursor == a.resolution.header.count {
        finish_pass(&mut a.market, &mut a.route_state, &mut a.resolution.header)?;
    }
    cash_invariant(&a.market, &a.resolution.header, a.vault.amount)?;
    let event = progress(
        &mut a.market,
        &a.route_state,
        &a.resolution,
        1,
        updates,
        participants,
    )?;
    emit_cpi!(event);
    Ok(())
}
pub fn recover(ctx: Context<RecoverResolution>, epoch: u64, resume: bool) -> Result<()> {
    let a = &mut *ctx.accounts;
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Resolution);
    frozen(
        &a.market,
        &a.route_state,
        &a.registry,
        &a.resolution,
        a.vault.amount,
        epoch,
    )?;
    let now = Clock::get()?.unix_timestamp;
    let bounds = sources(
        [
            &a.primary_btc,
            &a.primary_collateral,
            &a.guard_btc,
            &a.guard_collateral,
        ],
        &mut a.route_state.oracle,
        now,
    )?;
    let h = &mut a.resolution.header;
    let mut kind = 2;
    if h.stage == AWAIT_VALUATION {
        require!(!resume, ClearingError::Resolution);
        let b = bounds.ok_or(ClearingError::OraclePolicy)?;
        h.price = b.reference;
        h.stage = VALUE;
    } else {
        require!(h.stage == COMPLETE, ClearingError::Resolution);
        if resume {
            require_keys_eq!(a.caller.key(), a.market.authority, ClearingError::Authority);
            require!(
                bounds.is_some_and(|b| b.normal)
                    && h.recovery_since > 0
                    && h.recovery_last - h.recovery_since >= policy::RECOVERY
                    && now >= h.recovery_last
                    && now - h.recovery_last <= policy::HOLD,
                ClearingError::Resolution
            );
            a.market.mode = 2;
            a.market.paused = false;
            a.market.terms_epoch = next(a.market.terms_epoch)?;
            a.market.config_epoch = next(a.market.config_epoch)?;
            // Funding must qualify anew. No held prefix spans the frozen interval.
            let old = a.route_state.oracle;
            a.route_state.oracle = oracle::OracleState {
                sources: old.sources,
                source_sequences: old.source_sequences,
                funding_base: h.funding,
                covered_seconds: old.covered_seconds,
                skipped_seconds: old
                    .skipped_seconds
                    .checked_add(
                        u64::try_from(
                            now.checked_sub(h.frozen_at)
                                .ok_or(ClearingError::Arithmetic)?,
                        )
                        .map_err(|_| error!(ClearingError::Resolution))?,
                    )
                    .ok_or(ClearingError::Arithmetic)?,
                ..oracle::OracleState::default()
            };
            a.route_state.valid_until = 0;
            h.stage = RESUMED;
            kind = 3;
        } else {
            require!(
                h.recovery_last == 0 || now - h.recovery_last >= policy::SAMPLE_INTERVAL,
                ClearingError::Resolution
            );
            if bounds.is_some_and(|b| b.normal) {
                if h.recovery_since == 0 || now - h.recovery_last > policy::HOLD {
                    h.recovery_since = now;
                }
            } else {
                h.recovery_since = 0;
            }
            h.recovery_last = now;
        }
    }
    let event = progress(
        &mut a.market,
        &a.route_state,
        &a.resolution,
        kind,
        vec![],
        vec![],
    )?;
    emit_cpi!(event);
    Ok(())
}

#[inline(never)]
fn page(
    a: &mut AdvanceResolution,
    infos: &[AccountInfo],
    stage: u8,
    start: u16,
) -> Result<(Vec<ResolutionUpdate>, Vec<ResolutionParticipant>)> {
    let n = infos.len();
    let writable = matches!(stage, COLLECT | APPLY);
    let mut updates = Vec::with_capacity(n);
    let mut participants = Vec::new();
    for (offset, info) in infos.iter().enumerate() {
        let id = usize::from(start) + offset;
        let mut p = member(info, a.market.key(), &a.registry, id, writable)?;
        process_row(
            &mut a.market,
            &mut a.route_state,
            &mut a.resolution,
            id,
            &mut p,
        )?;
        if writable {
            p.try_serialize(&mut &mut info.try_borrow_mut_data()?[..])?;
            participants.push(ResolutionParticipant {
                participant: *info.key,
                id: p.id,
                cash: p.cash,
                lots: p.lots,
                virtual_scaled: p.virtual_scaled,
                funding_checkpoint_scaled: p.funding_checkpoint_scaled,
                generation: p.generation,
                finalized: stage == APPLY,
            });
        }
        updates.push(ResolutionUpdate {
            id: id as u16,
            row: a.resolution.rows[id],
        });
    }
    Ok((updates, participants))
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::{Discriminator, Space};
    fn zero<T: AccountDeserialize + Discriminator + Space>() -> T {
        let mut bytes = vec![0; 8 + T::INIT_SPACE];
        bytes[..8].copy_from_slice(T::DISCRIMINATOR);
        T::try_deserialize(&mut bytes.as_slice()).unwrap()
    }
    fn persisted<T: AccountSerialize + AccountDeserialize>(value: &T) -> T {
        let mut bytes = Vec::new();
        value.try_serialize(&mut bytes).unwrap();
        T::try_deserialize(&mut bytes.as_slice()).unwrap()
    }
    #[test]
    fn paginated_derived_headroom_and_terminal_generation_survive_every_page_size() {
        // This is a pure state-machine boundary test, not a chain fixture or a
        // claim that those extreme positions were opened by the RPC harness.
        for count in [2usize, 5, 64] {
            for page_size in 1..=4 {
                let price = math::MAX_PRICE;
                let funding = -math::MAX_FUNDING;
                let mut ps: Vec<Participant> = (0..count)
                    .map(|id| {
                        let mut p: Participant = zero();
                        p.schema_version = 1;
                        p.id = id as u16;
                        p.cash = (id as u64) * 17;
                        p.generation = if id < 2 { u64::MAX - 1 } else { u64::MAX };
                        p.funding_checkpoint_scaled = math::MAX_FUNDING;
                        p
                    })
                    .collect();
                ps[0].lots = math::MAX_LOTS;
                ps[1].lots = -math::MAX_LOTS;
                ps[0].virtual_scaled = math::MAX_SCALED;
                ps[1].virtual_scaled = -math::MAX_SCALED;
                for id in 2..count {
                    let value = (id as i128) * 17 * math::SCALE + id as i128;
                    ps[id].virtual_scaled = value;
                    ps[1].virtual_scaled -= value;
                }
                // Keep each ordinary stored-v within its limit while adding a full
                // funding/price-derived interval beyond that limit on both sides.
                let excess = ps[1].virtual_scaled + math::MAX_SCALED;
                ps[1].virtual_scaled -= excess;
                ps[0].virtual_scaled += excess;
                let models: Vec<_> = ps
                    .iter()
                    .map(|p| routes::participant_model(p).unwrap())
                    .collect();
                assert!(models[0].unpaid(price, funding).unwrap() > math::MAX_SCALED);
                assert!(models[1].unpaid(price, funding).unwrap() < -math::MAX_SCALED);
                let cash = ps.iter().map(|p| p.cash).sum::<u64>();
                let insurance = 10_007;
                let expected = math::closeout(
                    &models,
                    math::Pools {
                        vault: cash + insurance,
                        insurance,
                        ..math::Pools::default()
                    },
                    price,
                    funding,
                )
                .unwrap();
                let mut m: MarketState = zero();
                m.total_cash = cash;
                m.insurance = insurance;
                m.allocated_vault = cash + insurance;
                let mut r: TestRouteState = zero();
                r.gross_lots = math::MAX_GROSS_LOTS;
                let mut s: ResolutionState = zero();
                s.rows = vec![ResolutionRow::default(); count];
                s.header = ResolutionHeader {
                    epoch: 1,
                    stage: VALUE,
                    count: count as u16,
                    price,
                    funding,
                    initial_cash: cash,
                    initial_insurance: insurance,
                    initial_vault: cash + insurance,
                    remaining_gross: r.gross_lots,
                    ..ResolutionHeader::default()
                };
                while s.header.stage < COMPLETE {
                    let end = (usize::from(s.header.cursor) + page_size).min(count);
                    for id in usize::from(s.header.cursor)..end {
                        process_row(&mut m, &mut r, &mut s, id, &mut ps[id]).unwrap();
                    }
                    s.header.cursor = end as u16;
                    if end == count {
                        finish_pass(&mut m, &mut r, &mut s.header).unwrap();
                    }
                    cash_invariant(&m, &s.header, m.allocated_vault).unwrap();
                    s = persisted(&s);
                    ps = ps.iter().map(persisted).collect();
                }
                assert_eq!(m.insurance, expected.pools.insurance);
                assert_eq!(m.settlement, 0);
                for (id, p) in ps.iter().enumerate() {
                    let row = s.rows[id];
                    assert_eq!(p.cash, expected.participants[id].cash);
                    assert_eq!(p.lots, 0);
                    assert_eq!(p.virtual_scaled, 0);
                    assert_eq!(p.generation, u64::MAX);
                    assert_eq!(row.collected, expected.collected[id]);
                    assert_eq!(row.insured_scaled as i128, expected.insured_scaled[id]);
                    assert_eq!(row.impaired_scaled as i128, expected.impaired_scaled[id]);
                    assert_eq!(row.rounding_scaled, expected.rounding_scaled[id]);
                    assert_eq!(row.paid, expected.paid[id]);
                }
            }
        }
    }
    #[test]
    fn one_atom_terminal_tie_goes_to_lower_stable_id_with_zero_sum_adjustments() {
        for size in 1..=4 {
            let mut ps: Vec<Participant> = (0..3)
                .map(|id| {
                    let mut p: Participant = zero();
                    p.schema_version = 1;
                    p.id = id;
                    p
                })
                .collect();
            ps[0].virtual_scaled = -5 * math::SCALE;
            ps[1].virtual_scaled = 5 * math::SCALE / 2;
            ps[2].virtual_scaled = 5 * math::SCALE / 2;
            let mut m: MarketState = zero();
            m.insurance = 1;
            m.allocated_vault = 1;
            let mut r: TestRouteState = zero();
            let mut s: ResolutionState = zero();
            s.rows = vec![ResolutionRow::default(); 3];
            s.header = ResolutionHeader {
                epoch: 1,
                stage: VALUE,
                count: 3,
                price: 60_000,
                initial_insurance: 1,
                initial_vault: 1,
                ..ResolutionHeader::default()
            };
            while s.header.stage < COMPLETE {
                let end = (usize::from(s.header.cursor) + size).min(3);
                for id in usize::from(s.header.cursor)..end {
                    process_row(&mut m, &mut r, &mut s, id, &mut ps[id]).unwrap();
                }
                s.header.cursor = end as u16;
                if end == 3 {
                    finish_pass(&mut m, &mut r, &mut s.header).unwrap();
                }
                cash_invariant(&m, &s.header, 1).unwrap();
                s = persisted(&s);
            }
            // Two exact 0.5-atom entitlements share one actually funded atom.
            assert_eq!(ps.iter().map(|p| p.cash).collect::<Vec<_>>(), vec![0, 1, 0]);
            assert_eq!(
                s.rows.iter().map(|r| r.insured_scaled).collect::<Vec<_>>(),
                vec![math::SCALE as u128, 0, 0]
            );
            assert_eq!(
                s.rows.iter().map(|r| r.impaired_scaled).collect::<Vec<_>>(),
                vec![0, 2 * math::SCALE as u128, 2 * math::SCALE as u128]
            );
            assert_eq!(
                s.rows.iter().map(|r| r.rounding_scaled).collect::<Vec<_>>(),
                vec![0, math::SCALE / 2, -math::SCALE / 2]
            );
            assert_eq!((m.insurance, m.settlement, m.total_cash), (0, 0, 1));
        }
    }
    #[test]
    fn freeze_accounts_only_materialized_prefix_and_records_uncovered_tail() {
        let mut m: MarketState = zero();
        m.funding_time = 104;
        let mut o = oracle::OracleState {
            sampled_at: 100,
            held_until: 106,
            covered_seconds: 20,
            skipped_seconds: 2,
            ..oracle::OracleState::default()
        };
        freeze_coverage(&m, &mut o, 107).unwrap();
        assert_eq!((o.covered_seconds, o.skipped_seconds), (24, 5));
        m.funding_time = 100;
        let mut o = oracle::OracleState {
            sampled_at: 100,
            held_until: 106,
            ..oracle::OracleState::default()
        };
        freeze_coverage(&m, &mut o, 200).unwrap();
        assert_eq!((o.covered_seconds, o.skipped_seconds), (0, 100));
    }
}
