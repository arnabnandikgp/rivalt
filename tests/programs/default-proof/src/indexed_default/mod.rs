//! Separate local build. An owner seals the admissible roster before trading.
//! A permissionless settlement checks the whole current book and applies it atomically.
use super::*;
use crate::slot_custody::checked;
use anchor_lang::{AccountDeserialize, BorshConfig};
use anchor_spl::token::TokenAccount;
use clearing_accounting::attribution::FrozenCapacity;
use financial_core::SCALE;
use solana_sha256_hasher::hashv;
mod verifier;
pub use verifier::RatesProof;
use verifier::{Cell, Member, MEMBERS, WIDTH};

#[account(borsh)]
#[derive(InitSpace)]
pub struct IndexedCustody {
    pub owner: Address,
    pub mint: Address,
    pub bump: u8,
    pub phase: u8,
    pub member_count: u8,
    pub market_count: u8,
    pub roots: [Address; MEMBERS],
    pub ids: [u16; WIDTH],
    pub commitment: [u8; 32],
    pub selected: u8,
    pub charges: [u64; WIDTH],
    pub matched: [u64; WIDTH],
}
impl IndexedCustody {
    pub fn trading(&self) -> Result<()> {
        require!(self.phase == 1, ProofError::DefaultPhase);
        Ok(())
    }
    pub fn allow_root(&self, key: &Address) -> Result<()> {
        self.trading()?;
        require!(
            self.roots[..usize::from(self.member_count)].contains(key),
            ProofError::DefaultRoster
        );
        Ok(())
    }
    pub fn allow_market(&self, id: u16) -> Result<()> {
        self.trading()?;
        require!(
            self.ids[..usize::from(self.market_count)].contains(&id),
            ProofError::DefaultRoster
        );
        Ok(())
    }
    pub fn allow_wallet(&self, withdraw: bool) -> Result<()> {
        require!(
            self.phase == 1 || (self.phase == 2 && withdraw),
            ProofError::DefaultPhase
        );
        Ok(())
    }
    pub fn reject_static_margin(&self) -> Result<()> {
        Err(ProofError::DefaultRoster.into())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MemberMode {
    pub owner: Address,
    pub mode: u16,
}
#[derive(Accounts)]
pub struct RegisterIndexed {
    pub owner: Signer,
    #[account(mut,has_one=owner @ ProofError::CustodyBinding)]
    pub custody: BorshAccount<IndexedCustody>,
}

pub fn register(
    ctx: &mut Context<RegisterIndexed>,
    members: Vec<MemberMode>,
    ids: Vec<u16>,
) -> Result<()> {
    let domain = &mut ctx.accounts.custody;
    require!(domain.phase == 0, ProofError::DefaultPhase);
    require!(
        (1..=WIDTH).contains(&ids.len())
            && (1..=MEMBERS).contains(&members.len())
            && !ids.contains(&CROSS)
            && ids.windows(2).all(|pair| pair[0] < pair[1]),
        ProofError::DefaultRoster
    );
    for (index, member) in members.iter().enumerate() {
        require!(
            member.mode == CROSS || ids.contains(&member.mode),
            ProofError::DefaultRoster
        );
        let root = find_program_address(
            &[
                b"trade-root",
                domain.address().as_ref(),
                member.owner.as_ref(),
                &member.mode.to_le_bytes(),
            ],
            &crate::ID,
        )
        .0;
        require!(
            !domain.roots[..index].contains(&root),
            ProofError::DefaultRoster
        );
        domain.roots[index] = root;
    }
    domain.ids[..ids.len()].copy_from_slice(&ids);
    domain.member_count = members.len() as u8;
    domain.market_count = ids.len() as u8;
    domain.phase = 1;
    Ok(())
}

#[derive(Accounts)]
pub struct SettleIndexed {
    #[account(mut)]
    pub custody: BorshAccount<IndexedCustody>,
    #[account(seeds=[b"slot-vault".as_ref(),custody.address().as_ref()],bump,constraint=vault.mint()==&custody.mint && vault.owner()==custody.address() @ ProofError::CustodyBinding)]
    pub vault: Account<TokenAccount>,
}

fn member(
    index: usize,
    root: &TradingMargin,
    ids: &[u16],
    markets: &[TradingMarket],
    capacities: &mut Vec<(usize, usize, FrozenCapacity)>,
) -> Result<Member> {
    let mut cells = vec![Cell::default(); ids.len()];
    require!(root.order.remaining == 0, ProofError::UnsupportedBook);
    let mut previous = None;
    for slot in &root.slots {
        let (_, image) = slot.decode()?;
        let m = ids
            .binary_search(&image.market)
            .map_err(|_| ProofError::DefaultRoster)?;
        require!(
            previous.is_none_or(|prior| prior < m)
                && (root.isolated == CROSS || root.isolated == image.market),
            ProofError::DefaultRoster
        );
        previous = Some(m);
        let mark = markets[m].price;
        let scaled = checked(image.position.unpaid(mark, markets[m].funding))?;
        require!(scaled % SCALE == 0, ProofError::UnsupportedBook);
        let lots = image.position.lots;
        let claim = i32::try_from(scaled / SCALE).map_err(|_| ProofError::UnsupportedBook)?;
        let mut eligible = 0;
        if lots != 0 && claim > 0 {
            let basis = checked(image.entry.frozen_basis(lots))?;
            let capacity = checked(basis.frozen_capacity(lots, mark, scaled, lots.unsigned_abs()))?;
            eligible = u32::try_from(capacity.eligible).map_err(|_| ProofError::UnsupportedBook)?;
            if eligible > 0 {
                capacities.push((index, m, capacity));
            }
        }
        cells[m] = Cell {
            claim,
            lots,
            eligible,
        };
    }
    Ok(Member {
        cash: u32::try_from(root.cash).map_err(|_| ProofError::UnsupportedBook)?,
        cells,
    })
}

pub fn settle(ctx: &mut Context<SettleIndexed>, digest: [u8; 32], proof: RatesProof) -> Result<()> {
    let mut views = ctx.remaining_accounts()?;
    let domain = &mut ctx.accounts.custody;
    domain.trading()?;
    let count = usize::from(domain.member_count);
    let ids = &domain.ids[..usize::from(domain.market_count)];
    require!(views.len() == count + ids.len(), ProofError::DefaultRoster);
    let slot = Clock::get()?.slot;
    let mut hash = hashv(&[
        b"Rivalt/local-indexed-settlement/v1",
        crate::ID.as_ref(),
        domain.address().as_ref(),
        domain.mint.as_ref(),
    ])
    .to_bytes();
    let mut roots = Vec::with_capacity(count);
    let mut markets = Vec::with_capacity(ids.len());
    let mut allocated = 0;
    for (i, view) in views.iter().enumerate() {
        require!(
            view.owner() == &crate::ID && !view.executable(),
            ProofError::DefaultRoster
        );
        let data = view.try_borrow()?;
        hash = hashv(&[&hash, view.address().as_ref(), &data]).to_bytes();
        if i < count {
            require!(
                view.is_writable() && view.address() == &domain.roots[i],
                ProofError::DefaultRoster
            );
            let root = TradingMargin::try_deserialize(&mut &data[..])?;
            require!(root.custody == *domain.address(), ProofError::DefaultRoster);
            allocated = checked(financial_core::cash_add(allocated, root.cash))?;
            roots.push(root);
        } else {
            let id = ids[i - count];
            let market = TradingMarket::try_deserialize(&mut &data[..])?;
            let key = create_program_address(
                &[
                    b"trade-market",
                    domain.address().as_ref(),
                    &id.to_le_bytes(),
                    &[market.bump],
                ],
                &crate::ID,
            )
            .map_err(|_| ProofError::DefaultRoster)?;
            require!(
                view.address() == &key && market.id == id && market.custody == *domain.address(),
                ProofError::DefaultRoster
            );
            require!(market.insurance == 0, ProofError::UnsupportedBook);
            market.window(slot)?;
            allocated = checked(financial_core::cash_add(allocated, market.retained))?;
            markets.push(market);
        }
    }
    require!(
        ctx.accounts.vault.amount() >= allocated,
        ProofError::CustodyBinding
    );
    require!(digest == hash, ProofError::DefaultCommitment);
    let mut capacities = Vec::new();
    let rows = roots
        .iter()
        .enumerate()
        .map(|(index, root)| member(index, root, ids, &markets, &mut capacities))
        .collect::<Result<Vec<_>>>()?;
    let plan = verifier::verify(&rows, ids.len(), &proof)?;
    for (m, &charge) in plan
        .charges
        .iter()
        .enumerate()
        .filter(|(_, charge)| **charge != 0)
    {
        let (_, _, terms) = capacities
            .iter()
            .find(|(i, market, _)| *i == plan.winners[m] && *market == m)
            .ok_or(ProofError::DefaultCharge)?;
        domain.matched[m] = checked(terms.schedule(charge))?.matched;
    }
    domain.charges = plan.charges;
    for ((root, amount), view) in roots.iter_mut().zip(plan.cash).zip(views.iter_mut()) {
        root.cash = amount;
        root.slots.clear();
        root.advance()?;
        let mut data = view.try_borrow_mut()?;
        data[8..].fill(0);
        <TradingMargin as SchemaWrite<BorshConfig>>::write(&mut data[8..], root)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    }
    domain.commitment = hash;
    domain.selected = proof.selected;
    domain.phase = 2;
    Ok(())
}

// Stateless metering of independently supplied frozen examples. This instruction
// accepts no custody accounts and its output cannot authorize a wallet transfer.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProbeCell {
    pub claim: i32,
    pub lots: i8,
    pub eligible: u16,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProbeMember {
    pub cash: u32,
    pub cells: Vec<ProbeCell>,
}
#[derive(Accounts)]
pub struct InspectIndexed {
    pub caller: Signer,
}
pub fn inspect(width: u8, input: Vec<ProbeMember>, proof: RatesProof) -> Result<Vec<u64>> {
    let rows = input
        .into_iter()
        .map(|row| Member {
            cash: row.cash,
            cells: row
                .cells
                .into_iter()
                .map(|cell| Cell {
                    claim: cell.claim,
                    lots: cell.lots.into(),
                    eligible: cell.eligible.into(),
                })
                .collect(),
        })
        .collect::<Vec<_>>();
    Ok(verifier::verify(&rows, usize::from(width), &proof)?.cash)
}
