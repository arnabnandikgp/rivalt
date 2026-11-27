//! Single-episode, local SPL-custody qualification. Only the dedicated build
//! initializes ResolutionCustody; ordinary slot fixtures keep their original type.
use super::*;
use crate::slot_custody::checked;
use anchor_lang::{AccountDeserialize, BorshConfig};
use anchor_spl::token::TokenAccount;
use solana_sha256_hasher::hashv;
mod settlement;

const TRADING: u8 = 1;
const FROZEN: u8 = 2;
const RESOLVED: u8 = 3;
const MEMBERS: usize = 5;
const MARKETS: usize = 3;

#[account(borsh)]
#[derive(InitSpace)]
pub struct ResolutionCustody {
    pub owner: Address,
    pub mint: Address,
    pub bump: u8,
    pub phase: u8,
    pub roots: [Address; MEMBERS],
    pub market_ids: [u16; MARKETS],
    pub markets: [Address; MARKETS],
    pub commitment: [u8; 32],
    pub frozen_slot: u64,
    pub allocated: u64,
    pub charge: u64,
    pub matched: u64,
    pub payouts: [u64; MEMBERS],
}

#[cfg(feature = "signed-three-market-default")]
impl ResolutionCustody {
    pub fn trading(&self) -> Result<()> {
        require!(self.phase == TRADING, ProofError::DefaultPhase);
        Ok(())
    }
    pub fn allow_market(&self, id: u16) -> Result<()> {
        self.trading()?;
        require!(self.market_ids.contains(&id), ProofError::DefaultRoster);
        Ok(())
    }
    pub fn allow_root(&self, root: &Address) -> Result<()> {
        self.trading()?;
        require!(self.roots.contains(root), ProofError::DefaultRoster);
        Ok(())
    }
    pub fn allow_wallet(&self, withdraw: bool) -> Result<()> {
        require!(
            self.phase == TRADING || (withdraw && self.phase == RESOLVED),
            ProofError::DefaultPhase
        );
        Ok(())
    }
    pub fn reject_static_margin(&self) -> Result<()> {
        Err(ProofError::DefaultRoster.into())
    }
}

#[derive(Accounts)]
pub struct ConfigureDefault {
    pub owner: Signer,
    #[account(mut,has_one=owner @ ProofError::CustodyBinding)]
    pub custody: BorshAccount<ResolutionCustody>,
}

#[derive(Accounts)]
pub struct ResolveDefault {
    #[account(mut)]
    pub custody: BorshAccount<ResolutionCustody>,
    #[account(seeds=[b"slot-vault".as_ref(),custody.address().as_ref()],bump,
        constraint=vault.mint()==&custody.mint && vault.owner()==custody.address() @ ProofError::CustodyBinding)]
    pub vault: Account<TokenAccount>,
}

pub fn configure(
    ctx: &mut Context<ConfigureDefault>,
    owners: [Address; MEMBERS],
    ids: [u16; MARKETS],
) -> Result<()> {
    let domain = &mut ctx.accounts.custody;
    require!(domain.phase == 0, ProofError::DefaultPhase);
    require!(
        ids[0] < ids[1] && ids[1] < ids[2] && ids[2] < CROSS,
        ProofError::DefaultRoster
    );
    for (index, owner) in owners.iter().enumerate() {
        require!(!owners[..index].contains(owner), ProofError::DefaultRoster);
    }
    let key = *domain.address();
    domain.market_ids = ids;
    domain.markets = ids.map(|id| {
        find_program_address(
            &[b"trade-market", key.as_ref(), &id.to_le_bytes()],
            &crate::ID,
        )
        .0
    });
    let roles = [CROSS, ids[0], ids[0], ids[1], ids[2]];
    domain.roots = core::array::from_fn(|i| {
        find_program_address(
            &[
                b"trade-root",
                key.as_ref(),
                owners[i].as_ref(),
                &roles[i].to_le_bytes(),
            ],
            &crate::ID,
        )
        .0
    });
    domain.phase = TRADING;
    Ok(())
}

struct Book {
    roots: Vec<TradingMargin>,
    markets: Vec<TradingMarket>,
    allocated: u64,
    digest: [u8; 32],
}

fn snapshot(
    views: &[AccountView],
    domain: &BorshAccount<ResolutionCustody>,
    vault: u64,
    slot: u64,
    apply: bool,
) -> Result<Book> {
    require!(views.len() == MEMBERS + MARKETS, ProofError::DefaultRoster);
    let mut roots = Vec::with_capacity(MEMBERS);
    let mut markets = Vec::with_capacity(MARKETS);
    let mut allocated = 0;
    let mut digest = hashv(&[
        b"Rivalt/local-three-market-freeze/v1",
        crate::ID.as_ref(),
        domain.address().as_ref(),
        domain.mint.as_ref(),
        &slot.to_le_bytes(),
    ])
    .to_bytes();
    for (index, (view, expected)) in views
        .iter()
        .zip(domain.roots.iter().chain(&domain.markets))
        .enumerate()
    {
        require!(
            view.address() == expected && view.owner() == &crate::ID && !view.executable(),
            ProofError::DefaultRoster
        );
        if apply && index <= MEMBERS {
            require!(view.is_writable(), ProofError::DefaultRoster);
        }
        let data = view.try_borrow()?;
        digest = hashv(&[&digest, expected.as_ref(), &data]).to_bytes();
        if index < MEMBERS {
            let root = TradingMargin::try_deserialize(&mut &data[..])?;
            require!(
                root.custody == *domain.address()
                    && root.order.remaining == 0
                    && root.revision <= u64::MAX - 2,
                ProofError::UnsupportedBook
            );
            allocated = checked(financial_core::cash_add(allocated, root.cash))?;
            roots.push(root);
        } else {
            let market = TradingMarket::try_deserialize(&mut &data[..])?;
            require!(
                market.custody == *domain.address()
                    && market.id == domain.market_ids[index - MEMBERS],
                ProofError::DefaultRoster
            );
            market.window(slot)?;
            allocated = checked(financial_core::cash_add(allocated, market.insurance))?;
            allocated = checked(financial_core::cash_add(allocated, market.retained))?;
            markets.push(market);
        }
    }
    // Unsolicited test tokens cannot create a distributable balance or invalidate the freeze.
    require!(vault >= allocated, ProofError::CustodyBinding);
    Ok(Book {
        roots,
        markets,
        allocated,
        digest,
    })
}

pub fn freeze(ctx: &mut Context<ResolveDefault>) -> Result<()> {
    let views = ctx.remaining_accounts()?;
    let domain = &mut ctx.accounts.custody;
    require!(domain.phase == TRADING, ProofError::DefaultPhase);
    let slot = Clock::get()?.slot;
    let book = snapshot(&views, domain, ctx.accounts.vault.amount(), slot, false)?;
    // Do not strand a healthy or unsupported book in a terminal-only mode.
    settlement::plan(&book)?;
    domain.allocated = book.allocated;
    domain.commitment = book.digest;
    domain.frozen_slot = slot;
    domain.phase = FROZEN;
    Ok(())
}

fn store<T: SchemaWrite<BorshConfig, Src = T>>(view: &mut AccountView, account: &T) -> Result<()> {
    let mut data = view.try_borrow_mut()?;
    data[8..].fill(0);
    T::write(&mut data[8..], account).map_err(|_| ProgramError::InvalidAccountData)
}

pub fn apply(ctx: &mut Context<ResolveDefault>, commitment: [u8; 32], charge: u64) -> Result<()> {
    let mut views = ctx.remaining_accounts()?;
    let domain = &mut ctx.accounts.custody;
    require!(domain.phase == FROZEN, ProofError::DefaultPhase);
    let mut book = snapshot(
        &views,
        domain,
        ctx.accounts.vault.amount(),
        domain.frozen_slot,
        true,
    )?;
    require!(
        commitment == domain.commitment
            && book.digest == commitment
            && book.allocated == domain.allocated,
        ProofError::DefaultCommitment
    );
    let plan = settlement::plan(&book)?;
    require!(charge == plan.charge, ProofError::DefaultCharge);
    for (i, root) in book.roots.iter_mut().enumerate() {
        root.cash = plan.cash[i];
        root.slots.clear();
        root.advance()?;
        store(&mut views[i], root)?;
    }
    book.markets[0].insurance = 0;
    store(&mut views[MEMBERS], &book.markets[0])?;
    domain.charge = charge;
    domain.matched = plan.matched;
    domain.payouts = plan.cash;
    domain.phase = RESOLVED;
    Ok(())
}
