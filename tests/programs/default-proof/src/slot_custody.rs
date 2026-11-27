//! Local test-token custody only. Fixture creation fixes the positions and standing
//! order. Every cash credit subsequently comes from an SPL deposit or another root.
use super::*;
use anchor_lang::AccountDeserialize;
use anchor_spl::{
    mint::Mint,
    token::{self, Token, TokenAccount, TransferChecked},
};
use clearing_accounting::{
    entry_cost::EntryCost,
    market_slots::{Binding, MarketImage, MarketSlots},
    Mode, Position,
};
use financial_core::{cash_add, cash_sub, Participant, SCALE};
use risk_engine::{
    orders,
    withdrawal::{cash_required, MarketWindow, OccupiedSlot},
    Risk,
};

const PRICE: u64 = 100;
const MAX_SLOTS: usize = 8;
const RECEIVER_ORDER_MARKET: u16 = 43;

#[cfg(feature = "signed-three-market-default")]
pub use crate::three_market_default::ResolutionCustody as SlotCustody;

#[cfg(not(feature = "signed-three-market-default"))]
#[account(borsh)]
#[derive(InitSpace)]
pub struct SlotCustody {
    pub owner: Address,
    pub mint: Address,
    pub bump: u8,
}

#[account(borsh)]
#[derive(InitSpace)]
pub struct SlotMarket {
    pub market: u16,
    pub price: u64,
    pub funding: i128,
    pub low: i128,
    pub high: i128,
    pub expires: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone)]
pub struct CashSlot {
    market: u16,
    incarnation: u64,
    lots: i64,
    virtual_scaled: i128,
    checkpoint: i128,
    generation: u64,
    entry: [u8; EntryCost::BYTES],
}

impl CashSlot {
    pub(super) fn market(&self) -> u16 {
        self.market
    }

    pub(super) fn decode(&self) -> Result<(Binding, MarketImage)> {
        let position = Position {
            lots: self.lots,
            virtual_scaled: self.virtual_scaled,
            funding_checkpoint: self.checkpoint,
            generation: self.generation,
        };
        Ok((
            Binding {
                market: self.market,
                incarnation: self.incarnation,
            },
            MarketImage {
                market: self.market,
                position,
                entry: checked(EntryCost::read(&self.entry, self.lots))?,
            },
        ))
    }

    pub(super) fn encode((binding, image): &(Binding, MarketImage)) -> Result<Self> {
        let mut entry = [0; EntryCost::BYTES];
        checked(image.entry.write(&mut entry))?;
        let position = image.position;
        Ok(Self {
            market: binding.market,
            incarnation: binding.incarnation,
            lots: position.lots,
            virtual_scaled: position.virtual_scaled,
            checkpoint: position.funding_checkpoint,
            generation: position.generation,
            entry,
        })
    }
}

#[account(borsh)]
pub struct SlotMargin {
    pub custody: Address,
    pub width: u8,
    pub child: u8,
    pub revision: u64,
    pub cash: u64,
    pub last_incarnation: u64,
    // Each synthetic book has one immutable standing buy. Its reserve is
    // recalculated from its own authenticated market on every cash exit.
    pub order_market: u16,
    pub slots: Vec<CashSlot>,
}

impl SlotMargin {
    fn space(width: u8) -> usize {
        8 + 32 + 2 + 3 * 8 + 2 + 4 + usize::from(width).min(MAX_SLOTS) * CashSlot::INIT_SPACE
    }

    fn directory(&self) -> Result<MarketSlots> {
        let records = self
            .slots
            .iter()
            .map(CashSlot::decode)
            .collect::<Result<Vec<_>>>()?;
        checked(MarketSlots::restore(
            Mode::Cross,
            usize::from(self.width),
            self.last_incarnation,
            records,
            &[self.order_market],
        ))
    }
}

pub(super) fn checked<T>(result: clearing_accounting::Result<T>) -> Result<T> {
    result.map_err(|_| ProofError::UnsupportedBook.into())
}

#[derive(Accounts)]
pub struct OpenSlotCustody {
    #[account(mut)]
    pub owner: Signer,
    #[account(constraint = mint.decimals() == 6 && mint.freeze_authority().is_none() @ ProofError::CustodyBinding)]
    pub mint: Account<Mint>,
    #[account(init, payer=owner, space=8+SlotCustody::INIT_SPACE, seeds=[b"slot-custody".as_ref(), owner.address().as_ref(), mint.address().as_ref()], bump)]
    pub custody: BorshAccount<SlotCustody>,
    #[account(init, payer=owner, seeds=[b"slot-vault".as_ref(), custody.address().as_ref()], bump, token::mint=mint, token::authority=custody)]
    pub vault: Account<TokenAccount>,
    pub token_program: Program<Token>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
#[instruction(market: u16)]
pub struct CreateSlotMarket {
    #[account(mut)]
    pub owner: Signer,
    #[account(has_one=owner @ ProofError::CustodyBinding)]
    pub custody: BorshAccount<SlotCustody>,
    #[account(init, payer=owner, space=8+SlotMarket::INIT_SPACE, seeds=[b"slot-market".as_ref(), custody.address().as_ref(), &market.to_le_bytes()], bump)]
    pub window: BorshAccount<SlotMarket>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
#[instruction(width: u8, child: u8)]
pub struct CreateSlotMargin {
    #[account(mut)]
    pub owner: Signer,
    #[account(has_one=owner @ ProofError::CustodyBinding)]
    pub custody: BorshAccount<SlotCustody>,
    #[account(init, payer=owner, space=SlotMargin::space(width), seeds=[b"slot-margin".as_ref(), custody.address().as_ref(), &[width, child]], bump)]
    pub margin: BorshAccount<SlotMargin>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
pub struct SlotWallet {
    pub owner: Signer,
    #[account(has_one=owner @ ProofError::CustodyBinding, has_one=mint @ ProofError::CustodyBinding)]
    pub custody: BorshAccount<SlotCustody>,
    #[account(mut, has_one=custody @ ProofError::CustodyBinding)]
    pub margin: BorshAccount<SlotMargin>,
    pub mint: Account<Mint>,
    #[account(mut, seeds=[b"slot-vault".as_ref(), custody.address().as_ref()], bump, token::mint=mint, token::authority=custody)]
    pub vault: Account<TokenAccount>,
    #[account(mut, token::mint=mint, token::authority=owner, constraint = wallet.address() != vault.address() @ ProofError::CustodyBinding)]
    pub wallet: Account<TokenAccount>,
    pub token_program: Program<Token>,
}

#[derive(Accounts)]
pub struct SlotTransfer {
    pub owner: Signer,
    #[account(has_one=owner @ ProofError::CustodyBinding)]
    pub custody: BorshAccount<SlotCustody>,
    #[account(mut, has_one=custody @ ProofError::CustodyBinding)]
    pub donor: BorshAccount<SlotMargin>,
    #[account(mut, has_one=custody @ ProofError::CustodyBinding, constraint = donor.address() != recipient.address() @ ProofError::CustodyBinding)]
    pub recipient: BorshAccount<SlotMargin>,
}

pub fn open(ctx: &mut Context<OpenSlotCustody>) -> Result<()> {
    ctx.accounts.custody.owner = *ctx.accounts.owner.address();
    ctx.accounts.custody.mint = *ctx.accounts.mint.address();
    ctx.accounts.custody.bump = ctx.bumps.custody;
    Ok(())
}

pub fn market(ctx: &mut Context<CreateSlotMarket>, market: u16) -> Result<()> {
    let window = &mut ctx.accounts.window;
    window.market = market;
    window.price = PRICE;
    window.funding = 3 * SCALE;
    window.low = window.funding - 60 * SCALE;
    window.high = window.funding + 60 * SCALE;
    window.expires = Clock::get()?
        .slot
        .checked_add(8_192)
        .ok_or(ProofError::UnsupportedBook)?;
    window.bump = ctx.bumps.window;
    Ok(())
}

pub fn prepare(ctx: &mut Context<CreateSlotMargin>, width: u8, child: u8) -> Result<()> {
    #[cfg(feature = "signed-three-market-default")]
    ctx.accounts.custody.reject_static_margin()?;

    require!(
        matches!(width, 2 | 4 | 8) && child <= 1,
        ProofError::UnsupportedBook
    );
    let margin = &mut ctx.accounts.margin;
    margin.custody = *ctx.accounts.custody.address();
    margin.width = width;
    margin.child = child;
    margin.order_market = if child == 0 { 3 } else { RECEIVER_ORDER_MARKET };
    let mut images = Vec::new();
    for ordinal in 0..width {
        if child == 1 && ordinal != width - 1 {
            continue;
        }
        let size = i64::from(ordinal) + 1;
        let lots = if child == 1 {
            1
        } else if ordinal % 2 == 0 {
            size
        } else {
            -size
        };
        images.push(MarketImage {
            market: 3 + 5 * u16::from(ordinal),
            position: Position {
                lots,
                virtual_scaled: -i128::from(lots) * i128::from(PRICE) * SCALE,
                generation: 1,
                ..Position::default()
            },
            entry: checked(EntryCost::default().fill(0, lots, lots.unsigned_abs() * PRICE))?,
        });
    }
    if child == 1 {
        images.push(MarketImage {
            market: RECEIVER_ORDER_MARKET,
            position: Position::default(),
            entry: EntryCost::default(),
        });
    }
    let book = checked(
        MarketSlots::new(Mode::Cross, usize::from(width))
            .successor(&images, &[margin.order_market]),
    )?;
    margin.last_incarnation = book.last_incarnation();
    margin.slots = book
        .records()
        .iter()
        .map(CashSlot::encode)
        .collect::<Result<_>>()?;
    Ok(())
}

// Require one canonical, read-only market per distinct ID on either stored root,
// including order-only markets. The owner supplies no mask or position values.
fn windows(
    views: &[AccountView],
    custody: &Address,
    books: &[&SlotMargin],
) -> Result<Vec<MarketWindow>> {
    let mut ids: Vec<_> = books
        .iter()
        .flat_map(|book| book.slots.iter().map(|slot| slot.market))
        .collect();
    ids.sort_unstable();
    ids.dedup();
    require!(views.len() == ids.len(), ProofError::Incomplete);
    let slot = Clock::get()?.slot;
    let mut windows = Vec::with_capacity(ids.len());
    for (account, market) in views.iter().zip(ids) {
        require!(
            account.owner() == &crate::ID && !account.is_writable() && !account.executable(),
            ProofError::CustodyBinding
        );
        let window = SlotMarket::try_deserialize(&mut &account.try_borrow()?[..])?;
        let expected = create_program_address(
            &[
                b"slot-market",
                custody.as_ref(),
                &market.to_le_bytes(),
                &[window.bump],
            ],
            &crate::ID,
        )
        .map_err(|_| ProofError::CustodyBinding)?;
        require!(
            expected == *account.address() && window.market == market && slot < window.expires,
            ProofError::CustodyBinding
        );
        windows.push(MarketWindow {
            market,
            current: Risk {
                lower: window.price,
                upper: window.price,
                funding: window.funding,
            },
            funding_low: window.low,
            funding_high: window.high,
        });
    }
    Ok(windows)
}

// Bring every occupied position to current funding exactly once and recompute
// the remaining-order reserve. Receiving cash can improve an unhealthy root.
fn refresh(
    margin: &mut SlotMargin,
    windows: &[MarketWindow],
) -> Result<risk_engine::withdrawal::CashRequired> {
    let directory = margin.directory()?;
    let mut slots = Vec::new();
    let mut open = Vec::new();
    let lookup = |market| {
        windows
            .binary_search_by_key(&market, |w| w.market)
            .map(|i| &windows[i])
            .map_err(|_| ProofError::Incomplete)
    };
    for ((binding, image), stored) in directory.records().iter().zip(&mut margin.slots) {
        let window = lookup(binding.market)?;
        let mut position = image.position;
        if position.lots != 0 {
            let accrued = checked(
                Participant {
                    lots: position.lots,
                    virtual_scaled: position.virtual_scaled,
                    funding_checkpoint: position.funding_checkpoint,
                    generation: position.generation,
                    ..Participant::default()
                }
                .accrued(window.current.funding),
            )?;
            position.virtual_scaled = accrued.virtual_scaled;
            position.funding_checkpoint = accrued.funding_checkpoint;
            stored.virtual_scaled = position.virtual_scaled;
            stored.checkpoint = position.funding_checkpoint;
            open.push(MarketWindow {
                market: window.market,
                current: window.current,
                funding_low: window.funding_low,
                funding_high: window.funding_high,
            });
        }
        slots.push(OccupiedSlot {
            market: binding.market,
            position,
        });
    }
    let price = lookup(margin.order_market)?.current;
    let reserved = checked(orders::reserve(
        20,
        105,
        7,
        0,
        false,
        price.lower,
        price.upper,
    ))?;
    checked(cash_required(&slots, &open, reserved))
}

fn debit(root: &mut SlotMargin, markets: &[MarketWindow], amount: u64) -> Result<()> {
    let required = refresh(root, markets)?;
    let cash = cash_sub(root.cash, amount).map_err(|_| ProofError::WithdrawalHealth)?;
    let scaled = i128::from(cash) * SCALE;
    require!(
        scaled >= required.current_scaled && scaled >= required.held_scaled,
        ProofError::WithdrawalHealth
    );
    root.cash = cash;
    Ok(())
}

fn guard(root: &SlotMargin, revision: u64, amount: u64) -> Result<()> {
    require!(
        amount > 0 && revision == root.revision,
        ProofError::WrongCursor
    );
    Ok(())
}
fn advance(root: &mut SlotMargin) -> Result<()> {
    root.revision = root
        .revision
        .checked_add(1)
        .ok_or(ProofError::WrongCursor)?;
    Ok(())
}

pub fn fund(ctx: &mut Context<SlotWallet>, revision: u64, amount: u64) -> Result<()> {
    #[cfg(feature = "signed-three-market-default")]
    ctx.accounts.custody.reject_static_margin()?;

    require!(ctx.remaining_accounts()?.is_empty(), ProofError::Incomplete);
    let a = &mut ctx.accounts;
    guard(&a.margin, revision, amount)?;
    a.margin.cash = checked(cash_add(a.margin.cash, amount))?;
    advance(&mut a.margin)?;
    token::transfer_checked(
        CpiContext::new(
            a.token_program.address(),
            TransferChecked {
                from: a.wallet.try_to_cpi_handle_mut()?,
                mint: a.mint.to_cpi_handle(),
                to: a.vault.try_to_cpi_handle_mut()?,
                authority: a.owner.to_cpi_handle(),
            },
        ),
        amount,
        6,
    )
}

pub fn withdraw(ctx: &mut Context<SlotWallet>, revision: u64, amount: u64) -> Result<()> {
    #[cfg(feature = "signed-three-market-default")]
    ctx.accounts.custody.reject_static_margin()?;

    let views = ctx.remaining_accounts()?;
    let markets = windows(
        &views,
        ctx.accounts.custody.address(),
        &[&ctx.accounts.margin],
    )?;
    let a = &mut ctx.accounts;
    guard(&a.margin, revision, amount)?;
    debit(&mut a.margin, &markets, amount)?;
    advance(&mut a.margin)?;
    let bump = [a.custody.bump];
    let seeds: &[&[u8]] = &[
        b"slot-custody",
        a.custody.owner.as_ref(),
        a.custody.mint.as_ref(),
        &bump,
    ];
    token::transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.address(),
            TransferChecked {
                from: a.vault.try_to_cpi_handle_mut()?,
                mint: a.mint.to_cpi_handle(),
                to: a.wallet.try_to_cpi_handle_mut()?,
                authority: a.custody.to_cpi_handle(),
            },
            &[seeds],
        ),
        amount,
        6,
    )
}

pub fn transfer(ctx: &mut Context<SlotTransfer>, revision: u64, amount: u64) -> Result<()> {
    #[cfg(feature = "signed-three-market-default")]
    ctx.accounts.custody.reject_static_margin()?;

    let views = ctx.remaining_accounts()?;
    let markets = windows(
        &views,
        ctx.accounts.custody.address(),
        &[&ctx.accounts.donor, &ctx.accounts.recipient],
    )?;
    let a = &mut ctx.accounts;
    guard(&a.donor, revision, amount)?;
    debit(&mut a.donor, &markets, amount)?;
    refresh(&mut a.recipient, &markets)?;
    a.recipient.cash = checked(cash_add(a.recipient.cash, amount))?;
    advance(&mut a.donor)?;
    advance(&mut a.recipient)
}
