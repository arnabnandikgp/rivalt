//! Exact specialization for one BTC debtor, a cross winner, a flat BTC creditor,
//! and two isolated foreign creditors. Derive the bound before accepting any charge.
use super::*;
use clearing_accounting::entry_cost::EntryCost;
use financial_core::SCALE;

pub(super) struct Outcome {
    pub cash: [u64; MEMBERS],
    pub charge: u64,
    pub matched: u64,
}

fn atoms(value: i128) -> Result<u64> {
    u64::try_from(value).map_err(|_| ProofError::UnsupportedBook.into())
}

pub(super) fn plan(book: &Book) -> Result<Outcome> {
    let mut claims = [[0i128; MARKETS]; MEMBERS];
    let mut lots = [[0i64; MARKETS]; MEMBERS];
    let mut winner_entry = EntryCost::default();
    for (member, root) in book.roots.iter().enumerate() {
        let expected_mode = [
            CROSS,
            book.markets[0].id,
            book.markets[0].id,
            book.markets[1].id,
            book.markets[2].id,
        ][member];
        require!(root.isolated == expected_mode, ProofError::DefaultRoster);
        let mut previous = None;
        for slot in &root.slots {
            let (_, image) = slot.decode()?;
            let market = book
                .markets
                .iter()
                .position(|m| m.id == image.market)
                .ok_or(ProofError::DefaultRoster)?;
            require!(
                previous.is_none_or(|index| index < market)
                    && (member == 0 || root.isolated == image.market),
                ProofError::DefaultRoster
            );
            previous = Some(market);
            let price = &book.markets[market];
            let claim = checked(image.position.unpaid(price.price, price.funding))?;
            require!(claim % SCALE == 0, ProofError::UnsupportedBook);
            claims[member][market] = claim / SCALE;
            lots[member][market] = image.position.lots;
            if member == 0 && market == 0 {
                winner_entry = image.entry;
            }
        }
    }
    for market in 0..MARKETS {
        require!(
            claims.iter().map(|row| row[market]).sum::<i128>() == 0
                && lots.iter().map(|row| i128::from(row[market])).sum::<i128>() == 0,
            ProofError::UnsupportedBook
        );
    }
    require!(
        lots[0][0] != 0 && lots[2][0] == 0 && lots[1][0] == -lots[0][0],
        ProofError::UnsupportedBook
    );
    let debt = atoms(-claims[1][0])?;
    let gain = atoms(claims[0][0])?;
    let flat = atoms(claims[2][0])?;
    let eth = atoms(claims[3][1])?;
    let sol = atoms(claims[4][2])?;
    require!(
        debt > 0 && flat > 0 && gain > 0 && eth > 0 && sol > 0,
        ProofError::UnsupportedBook
    );
    let funded = checked(financial_core::cash_add(
        book.roots[1].cash,
        book.markets[0].insurance,
    ))?;
    let foreign = u128::from(eth) + u128::from(sol);
    let gap = foreign
        .checked_sub(u128::from(book.roots[0].cash))
        .ok_or(ProofError::UnsupportedBook)?;
    require!(
        funded < debt && gap > 0 && gap < u128::from(funded),
        ProofError::UnsupportedBook
    );

    // For charge x, total target payment C stays fixed up to its uninsured loss.
    // The winner can forward C*(G-x)/(D-x). Both foreign claims keep their
    // original full exact receipt precisely when this covers the remaining gap.
    let available = u128::from(funded) * u128::from(gain);
    let required = gap * u128::from(debt);
    require!(available >= required, ProofError::UnsupportedBook);
    let protected = (available - required) / (u128::from(funded) - gap);
    let capacity = checked(
        checked(winner_entry.frozen_basis(lots[0][0]))?.frozen_capacity(
            lots[0][0],
            book.markets[0].price,
            claims[0][0] * SCALE,
            lots[0][0].unsigned_abs(),
        ),
    )?;
    let charge = protected
        .min(u128::from(debt - funded))
        .min(u128::from(capacity.eligible)) as u64;
    require!(charge > 0, ProofError::UnsupportedBook);
    let schedule = checked(capacity.schedule(charge))?;
    let remaining = u128::from(debt - charge);
    let paid_flat = u128::from(funded) * u128::from(flat);
    // The general native solver handles fractional terminal flows. This signed
    // certificate accepts only an optimum whose market-to-member edges are integral.
    require!(paid_flat % remaining == 0, ProofError::UnsupportedBook);
    let paid_flat =
        u64::try_from(paid_flat / remaining).map_err(|_| ProofError::UnsupportedBook)?;
    let winner_cash = u128::from(funded)
        .checked_sub(u128::from(paid_flat) + gap)
        .ok_or(ProofError::UnsupportedBook)?;
    let cash = [
        u64::try_from(winner_cash).map_err(|_| ProofError::UnsupportedBook)?,
        0,
        checked(financial_core::cash_add(book.roots[2].cash, paid_flat))?,
        checked(financial_core::cash_add(book.roots[3].cash, eth))?,
        checked(financial_core::cash_add(book.roots[4].cash, sol))?,
    ];
    let retained: u128 = book.markets.iter().map(|m| u128::from(m.retained)).sum();
    let foreign_reserves =
        u128::from(book.markets[1].insurance) + u128::from(book.markets[2].insurance);
    require!(
        cash.iter().map(|&v| u128::from(v)).sum::<u128>() + retained + foreign_reserves
            == u128::from(book.allocated),
        ProofError::UnsupportedBook
    );
    Ok(Outcome {
        cash,
        charge,
        matched: schedule.matched,
    })
}
