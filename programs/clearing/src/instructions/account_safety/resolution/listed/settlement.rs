//! Complete-cohort verification and application share a transaction. No
//! caller-selected balance or per-market subset can reach the terminal writes.
use super::*;
use crate::events::ListedDefaultSettled;
use crate::instructions::account_cash::listed::ListedMargin;
use clearing_accounting::attribution::FrozenCapacity;
use default_plan_selection::market_indexed::{verify_frozen_book, Cell, Episode, Member, RatesProof};

struct FrozenMembers {
    ids: Vec<u64>,
    rows: Vec<Member>,
    capacities: Vec<(usize, usize, FrozenCapacity)>,
    gross: [u64; WIDTH],
    cash: u64,
}

impl FrozenMembers {
    #[inline(never)]
    fn read(
        &mut self,
        view: &AccountView,
        venue: &Address,
        next_id: u64,
        markets: &[FrozenListedMarket],
    ) -> Result<()> {
        let data = view.try_borrow()?;
        let root = Box::new(MarginAccount::try_deserialize(&mut &data[..])?);
        listing_key(
            view,
            &[
                b"margin-v3",
                root.portfolio.as_ref(),
                &root.subaccount_index.to_le_bytes(),
                &[root.bump],
            ],
        )?;
        require!(
            root.venue == *venue
                && root.revision > 0
                && root.id < next_id
                && self.ids.last().is_none_or(|previous| *previous < root.id),
            ClearingError::Resolution
        );
        let model = account_trading::model(&root)?;
        let directory = ListedMargin::stored_directory(
            &root,
            data.get(MARGIN_ALLOCATION..)
                .ok_or(ClearingError::Profile)?,
        )?;
        require!(
            data[MARGIN_PREFIX..].starts_with(crate::profit_attribution::MAGIC),
            ClearingError::Profile
        );
        let mut cells = vec![Cell::default(); markets.len()];
        let mut record = directory.records().iter().peekable();
        for (column, frozen) in markets.iter().enumerate() {
            let listed_image = if column < MARKET_COUNT {
                None
            } else {
                match record.peek() {
                    Some((binding, _)) if binding.market < frozen.market => {
                        return Err(ClearingError::Resolution.into())
                    }
                    Some((binding, _)) if binding.market == frozen.market => {
                        record.next().map(|(_, image)| image)
                    }
                    _ => continue,
                }
            };
            let position = match listed_image {
                Some(image) => image.position,
                None => *model
                    .positions
                    .get(column)
                    .ok_or(ClearingError::Resolution)?,
            };
            let claim = checked(position.unpaid(frozen.reference, frozen.funding))?;
            require!(claim % math::SCALE == 0, ClearingError::Resolution);
            self.gross[column] = self.gross[column]
                .checked_add(position.lots.unsigned_abs())
                .ok_or(ClearingError::Arithmetic)?;
            let mut eligible = 0;
            if position.lots != 0 && claim > 0 {
                let basis = match listed_image {
                    Some(image) => checked(image.entry.frozen_basis(position.lots))?,
                    None => crate::profit_attribution::frozen_account_basis(
                        view,
                        &root.positions,
                        column,
                    )?,
                };
                let capacity = checked(basis.frozen_capacity(
                    position.lots,
                    frozen.reference,
                    claim,
                    position.lots.unsigned_abs(),
                ))?;
                eligible =
                    u32::try_from(capacity.eligible).map_err(|_| ClearingError::Resolution)?;
                if eligible > 0 {
                    self.capacities.push((self.ids.len(), column, capacity));
                }
            }
            cells[column] = Cell {
                lots: position.lots,
                claim: i32::try_from(claim / math::SCALE).map_err(|_| ClearingError::Resolution)?,
                eligible,
            };
        }
        require!(record.next().is_none(), ClearingError::Resolution);
        self.cash = self
            .cash
            .checked_add(root.cash)
            .ok_or(ClearingError::Arithmetic)?;
        self.ids.push(root.id);
        self.rows.push(Member {
            cash: u32::try_from(root.cash).map_err(|_| ClearingError::Resolution)?,
            cells,
        });
        Ok(())
    }
}

#[inline(never)]
fn clear_root(
    view: &mut AccountView,
    id: u64,
    cash: u64,
    markets: &[FrozenListedMarket],
) -> Result<()> {
    let mut bytes = view.try_borrow_mut()?;
    let mut root = Box::new(MarginAccount::try_deserialize(&mut &bytes[..])?);
    require!(root.id == id, ClearingError::Resolution);
    let directory = ListedMargin::stored_directory(&root, &bytes[MARGIN_ALLOCATION..])?;
    if bytes.len() > MARGIN_ALLOCATION {
        let images: Vec<_> = directory
            .records()
            .iter()
            .map(|(_, image)| {
                let mut flat = *image;
                flat.position = Default::default();
                flat.entry = Default::default();
                flat
            })
            .collect();
        checked(
            checked(directory.successor(&images, &[]))?
                .write_listed_bytes(&mut bytes[MARGIN_ALLOCATION..]),
        )?;
    }
    bytes[MARGIN_PREFIX + 8..MARGIN_ALLOCATION].fill(0);
    for (index, position) in root.positions.iter_mut().enumerate() {
        if root.mode == MODE_ISOLATED && usize::from(root.isolated_market_index) != index {
            continue;
        }
        position.lots = 0;
        position.virtual_scaled = 0;
        position.funding_checkpoint_scaled = markets[index].funding;
        increment(&mut position.generation)?;
    }
    let (last_order_id, last_group_id) = (root.book.last_order_id, root.book.last_group_id);
    root.book = Default::default();
    root.book.last_order_id = last_order_id;
    root.book.last_group_id = last_group_id;
    root.cash = cash;
    root.reserved = 0;
    root.delegate = Address::default();
    root.delegate_expiry_slot = 0;
    root.backing_epochs = [0; MARKET_COUNT];
    increment(&mut root.nonce)?;
    increment(&mut root.state_version)?;
    increment(&mut root.delegate_epoch)?;
    account_trading::model(&root)?;
    crate::wire::write_account(&*root, &mut bytes[..MARGIN_PREFIX])
}

#[inline(never)]
fn commit_books(
    identity: &mut ResolutionIdentity,
    views: &mut [AccountView],
    markets: &[FrozenListedMarket],
    spent: &[u64],
) -> Result<()> {
    for (index, (market, ledger)) in [
        (&mut identity.btc, &mut identity.btc_ledger),
        (&mut identity.eth, &mut identity.eth_ledger),
    ]
    .into_iter()
    .enumerate()
    {
        let frozen = &markets[index];
        require!(
            market.gross_lots == frozen.gross_lots
                && ledger.insurance == frozen.insurance
                && ledger.fees == frozen.fees
                && ledger.settlement == frozen.settlement
                && ledger.insurance_fee_remainder == frozen.insurance_carry,
            ClearingError::Reconciliation
        );
        // Retire pre-default maker-lane reservations as the canonical gross is
        // cleared. Bounded market reads must also see zero after settlement.
        crate::market_capacity::reset(market, 0)?;
        market.gross_lots = 0;
        increment(&mut market.terms_epoch)?;
        ledger.settlement = 0;
        ledger.insurance = checked(math::cash_sub(ledger.insurance, spent[index]))?;
        increment(&mut ledger.version)?;
        increment(&mut ledger.liability_version)?;
    }
    for (offset, view) in views.iter_mut().enumerate() {
        let index = MARKET_COUNT + offset;
        let frozen = &markets[index];
        let listing = find_program_address(
            &[
                b"market-listing",
                identity.venue.address().as_ref(),
                &frozen.market.to_le_bytes(),
            ],
            &crate::ID,
        )
        .0;
        let mut book = ListedMarketBook::try_deserialize(&mut &view.try_borrow()?[..])?;
        listing_key(view, &[b"listed-book", listing.as_ref(), &[book.bump]])?;
        require!(
            book.listing == listing
                && book.schema_version == LISTING_SCHEMA
                && book.gross_lots == frozen.gross_lots
                && book.fees == frozen.fees
                && book.insurance == frozen.insurance
                && book.settlement == frozen.settlement
                && book.insurance_carry == frozen.insurance_carry,
            ClearingError::Reconciliation
        );
        book.gross_lots = 0;
        book.settlement = 0;
        book.insurance = checked(math::cash_sub(book.insurance, spent[index]))?;
        crate::wire::write_account(&book, &mut view.try_borrow_mut()?)?;
    }
    Ok(())
}

pub(crate) fn settle(
    ctx: &mut Context<SettleListedDefault>,
    events: &mut crate::event_cpi::Payloads,
    epoch: u64,
    selected: u8,
    denominator: u32,
    numerators: Vec<u32>,
) -> Result<()> {
    let mut remaining = ctx.remaining_accounts()?;
    let a = &mut ctx.accounts;
    let identity = &mut *a.identity;
    let header = &a.episode.snapshot;
    let width = usize::from(header.width);
    let count = usize::try_from(header.member_count).map_err(|_| ClearingError::Resolution)?;
    require!(
        identity.venue.schema_version == SCHEMA_VERSION
            && identity.venue.profile_version == LISTED_VENUE_PROFILE
            && identity.safety.mode == FROZEN
            && identity.safety.paused
            && identity.safety.resolution_epoch == epoch
            && identity.safety.epoch == header.safety_epoch
            && identity.venue.terms_epoch == header.terms_epoch
            && a.episode.schema_version == LISTING_SCHEMA
            && !a.episode.completed
            && header.epoch == epoch
            && header.registry_hash == registry_hash(&a.registry)?
            && header.membership_epoch == a.registry.membership_epoch
            && header.member_count == a.registry.financial_count
            && header.allocated_vault == identity.custody.allocated_vault
            && (3..=WIDTH).contains(&width)
            && (1..=MEMBERS).contains(&count)
            && remaining.len() == width - MARKET_COUNT + count,
        ClearingError::Resolution
    );
    account_custody::vault_backed(&identity.custody, identity.vault.amount())?;
    let markets = &header.markets[..width];
    let (books, roots) = remaining.split_at_mut(width - MARKET_COUNT);
    let venue = *identity.venue.address();
    let mut members = FrozenMembers {
        ids: Vec::with_capacity(count),
        rows: Vec::with_capacity(count),
        capacities: Vec::new(),
        gross: [0; WIDTH],
        cash: 0,
    };
    for view in roots.iter() {
        members.read(view, &venue, a.registry.next_id, markets)?;
    }
    let mut assets = u128::from(members.cash);
    for (index, frozen) in markets.iter().enumerate() {
        require!(
            members.gross[index] == frozen.gross_lots,
            ClearingError::Reconciliation
        );
        assets +=
            u128::from(frozen.settlement) + u128::from(frozen.insurance) + u128::from(frozen.fees);
    }
    require!(
        assets == u128::from(header.allocated_vault),
        ClearingError::Reconciliation
    );
    let pools: Vec<_> = markets.iter().map(|m| m.settlement).collect();
    let reserves: Vec<_> = markets.iter().map(|m| m.insurance).collect();
    let market_ids: Vec<_> = markets.iter().map(|m| m.market).collect();
    let result = verify_frozen_book(
        &members.rows,
        &pools,
        &reserves,
        &RatesProof {
            denominator,
            selected,
            numerators,
        },
        Episode {
            venue: &venue.to_bytes(),
            ordinal: epoch,
            member_ids: &members.ids,
            market_ids: &market_ids,
            capacities: &members.capacities,
        },
    )
    .map_err(|_| ClearingError::Resolution)?;
    let mut terminal: u128 = result.cash.iter().copied().map(u128::from).sum();
    for (index, market) in markets.iter().enumerate() {
        terminal += u128::from(checked(math::cash_sub(
            market.insurance,
            result.spent[index],
        ))?) + u128::from(market.fees);
    }
    require!(
        terminal == assets && result.cash.len() == count,
        ClearingError::Reconciliation
    );
    commit_books(identity, books, markets, &result.spent)?;
    for ((view, &id), &cash) in roots.iter_mut().zip(&members.ids).zip(&result.cash) {
        clear_root(view, id, cash, markets)?;
    }
    a.episode.completed = true;
    identity.safety.mode = RESOLVED;
    identity.safety.paused = false;
    increment(&mut identity.safety.epoch)?;
    increment(&mut identity.venue.terms_epoch)?;
    events.emit(
        &ListedDefaultSettled {
            venue,
            slot: Clock::get()?.slot,
            episode: *a.episode.address(),
            epoch,
            safety_epoch: identity.safety.epoch,
            terms_epoch: identity.venue.terms_epoch,
            checked_plans: u32::try_from(result.checked_plans)
                .map_err(|_| ClearingError::Arithmetic)?,
            selected,
            member_ids: members.ids,
            final_cash: result.cash,
            spent: result.spent[..width].to_vec(),
            charged: result.charges[..width].to_vec(),
        },
        a.event_authority.account().clone(),
    )
}
