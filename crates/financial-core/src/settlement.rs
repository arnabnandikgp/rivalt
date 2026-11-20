//! Ordinary booking moves whole atoms between funded cash and one market
//! claim. Default allocates a complete frozen book in `crate::clearing`.
use crate::{add, cash_add, cash_sub, scaled, sub, Error, Pools, Result, MAX_CASH, MAX_GROSS_LOTS, MAX_PARTICIPANTS};
use crate::margin::{Margin, MARKETS};

pub struct BookedClaim {
    pub cash: u64,
    pub virtual_scaled: i128,
    pub pool: u64,
}

/// The caller supplies the complete account's accrued claims at authenticated
/// reference prices. It independently certifies backing and checks post-payment IM.
pub fn book_claim(
    account: &Margin, claims: [i128; MARKETS], market: usize, amount: u64, gain: bool, pool: u64,
) -> Result<BookedClaim> {
    if !account.allows(market) || amount == 0 { return Err(Error::Bounds); }
    let change = scaled(amount)?;
    let position = account.positions[market];
    if gain {
        if claims[market] < change || pool < amount { return Err(Error::Entitlement); }
        Ok(BookedClaim {
            cash: cash_add(account.cash, amount)?,
            virtual_scaled: sub(position.virtual_scaled, change)?,
            pool: cash_sub(pool, amount)?,
        })
    } else {
        let debt = claims.into_iter().try_fold(0i128, |sum, claim| sub(sum, claim.min(0)))?;
        if scaled(account.cash)? < debt { return Err(Error::Cohort); }
        if claims[market] > -change { return Err(Error::Entitlement); }
        Ok(BookedClaim {
            cash: cash_sub(account.cash, amount)?,
            virtual_scaled: add(position.virtual_scaled, change)?,
            pool: cash_add(pool, amount)?,
        })
    }
}

/// Complete-cohort invariants; callers cannot establish solvency by selecting a
/// profitable subset. Claim aggregation never stores a derived claim as ordinary v.
pub fn reconcile_accounts(
    cohort: &[Margin],
    pools: Pools,
    prices: [u64; MARKETS],
    funding: [i128; MARKETS],
) -> Result<()> {
    if cohort.is_empty()
        || cohort.len() > MAX_PARTICIPANTS
        || [pools.vault, pools.settlement, pools.insurance, pools.fees]
            .iter()
            .any(|value| *value > MAX_CASH)
    {
        return Err(Error::Bounds);
    }
    let mut cash = 0;
    let mut lots = [0i128; MARKETS];
    let mut gross = [0u64; MARKETS];
    let mut claims = 0;
    for (index, root) in cohort.iter().enumerate() {
        root.validate()?;
        if cohort[..index].iter().any(|other| other.id == root.id) {
            return Err(Error::Invariant);
        }
        cash = cash_add(cash, root.cash)?;
        for market in 0..MARKETS {
            lots[market] = add(lots[market], i128::from(root.positions[market].lots))?;
            gross[market] = gross[market]
                .checked_add(root.positions[market].lots.unsigned_abs())
                .ok_or(Error::Overflow)?;
        }
        claims = root
            .claims(prices, funding)?
            .into_iter()
            .try_fold(claims, add)?;
    }
    if lots != [0; MARKETS]
        || gross.iter().any(|value| *value > MAX_GROSS_LOTS)
        || claims != scaled(pools.settlement)?
        || cash_add(
            cash_add(cash_add(cash, pools.settlement)?, pools.insurance)?,
            pools.fees,
        )? != pools.vault
    {
        return Err(Error::Invariant);
    }
    Ok(())
}
