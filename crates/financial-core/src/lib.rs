//! Rivalt synthetic profile 1. All quote amounts are atoms unless named `scaled`.
//! No runtime, oracle, token, or authority assumptions are supplied by this crate.
pub mod route;

pub const SCALE: i128 = 1_000_000_000;
pub const LOTS_PER_BTC: i64 = 1_000_000;
pub const MAX_LOTS: i64 = 100_000_000;
pub const MAX_GROSS_LOTS: u64 = 200_000_000;
pub const MAX_PRICE: u64 = 1_000_000;
pub const MAX_CASH: u64 = 1_000_000_000_000_000;
pub const MAX_SCALED: i128 = 100_000_000_000_000_000_000_000_000;
pub const MAX_FUNDING: i128 = 1_000_000_000_000_000;
pub const MAX_PARTICIPANTS: usize = 64;
pub const IM_BPS: u64 = 1_000;
pub const MM_BPS: u64 = 500;
pub const MIN_ORDER_ATOMS: u64 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    Bounds,
    Overflow,
    InsufficientCash,
    Entitlement,
    Health,
    Cohort,
    Invariant,
    Generation,
}
pub type Result<T> = core::result::Result<T, Error>;

fn add(a: i128, b: i128) -> Result<i128> {
    a.checked_add(b).ok_or(Error::Overflow)
}
fn sub(a: i128, b: i128) -> Result<i128> {
    a.checked_sub(b).ok_or(Error::Overflow)
}
fn mul(a: i128, b: i128) -> Result<i128> {
    a.checked_mul(b).ok_or(Error::Overflow)
}
pub fn cash_add(a: u64, b: u64) -> Result<u64> {
    let n = a.checked_add(b).ok_or(Error::Overflow)?;
    if n > MAX_CASH {
        return Err(Error::Bounds);
    }
    Ok(n)
}
pub fn cash_sub(a: u64, b: u64) -> Result<u64> {
    if a > MAX_CASH || b > MAX_CASH {
        return Err(Error::Bounds);
    }
    a.checked_sub(b).ok_or(Error::InsufficientCash)
}
pub fn scaled(atoms: u64) -> Result<i128> {
    mul(i128::from(atoms), SCALE)
}
pub fn fee_total(notional: u64) -> Result<u64> {
    if notional > MAX_CASH {
        return Err(Error::Bounds);
    }
    Ok(notional / 5_000 + u64::from(notional % 5_000 != 0))
}
pub fn fee_increment(prefix: u64, notional: u64) -> Result<(u64, u64)> {
    let next = cash_add(prefix, notional)?;
    Ok((next, fee_total(next)? - fee_total(prefix)?))
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Participant {
    pub id: u16,
    pub cash: u64,
    pub lots: i64,
    pub virtual_scaled: i128,
    pub funding_checkpoint: i128,
    pub generation: u64,
    pub reserved: u64,
}
impl Participant {
    pub fn validate(&self) -> Result<()> {
        if self.cash > MAX_CASH
            || self.reserved > MAX_CASH
            || self.lots.unsigned_abs() > MAX_LOTS as u64
            || self.virtual_scaled.unsigned_abs() > MAX_SCALED as u128
            || self.funding_checkpoint.unsigned_abs() > MAX_FUNDING as u128
            || (self.lots != 0 && self.generation == u64::MAX)
        {
            return Err(Error::Bounds);
        }
        Ok(())
    }
    pub fn accrued(&self, funding: i128) -> Result<Self> {
        self.validate()?;
        if funding.unsigned_abs() > MAX_FUNDING as u128 {
            return Err(Error::Bounds);
        }
        let mut next = *self;
        next.virtual_scaled = sub(
            self.virtual_scaled,
            mul(
                i128::from(self.lots),
                sub(funding, self.funding_checkpoint)?,
            )?,
        )?;
        next.funding_checkpoint = funding;
        next.validate()?;
        Ok(next)
    }
    pub fn unpaid(&self, price: u64, funding: i128) -> Result<i128> {
        self.validate()?;
        if price == 0 || price > MAX_PRICE || funding.unsigned_abs() > MAX_FUNDING as u128 {
            return Err(Error::Bounds);
        }
        // Derived valuation has headroom beyond the ordinary stored-v bound.
        // Default must remain calculable at that bound even if an ordinary
        // accrual/fill cannot store another unit of exposure.
        let accrued = sub(
            self.virtual_scaled,
            mul(
                i128::from(self.lots),
                sub(funding, self.funding_checkpoint)?,
            )?,
        )?;
        add(accrued, mul(i128::from(self.lots), scaled(price)?)?)
    }
    pub fn risk_equity(&self, lower: u64, upper: u64, funding: i128) -> Result<i128> {
        if lower == 0 || lower > upper || upper > MAX_PRICE {
            return Err(Error::Bounds);
        }
        let price = if self.lots < 0 { upper } else { lower };
        add(scaled(self.cash)?, self.unpaid(price, funding)?.min(0))
    }
    pub fn margin(&self, upper: u64, bps: u64) -> Result<u64> {
        self.validate()?;
        if upper == 0 || upper > MAX_PRICE || bps > 10_000 {
            return Err(Error::Bounds);
        }
        let numerator = u128::from(self.lots.unsigned_abs()) * u128::from(upper) * u128::from(bps);
        u64::try_from(numerator.div_ceil(10_000)).map_err(|_| Error::Overflow)
    }
    pub fn admissible(&self, lower: u64, upper: u64, funding: i128) -> Result<()> {
        let required = cash_add(self.margin(upper, IM_BPS)?, self.reserved)?;
        if self.risk_equity(lower, upper, funding)? < scaled(required)? {
            return Err(Error::Health);
        }
        Ok(())
    }
    pub fn withdraw(&self, amount: u64, lower: u64, upper: u64, funding: i128) -> Result<Self> {
        if amount == 0 {
            return Err(Error::Bounds);
        }
        let mut next = self.accrued(funding)?;
        next.cash = cash_sub(next.cash, amount)?;
        next.admissible(lower, upper, funding)?;
        Ok(next)
    }
    pub fn reserve(&self, reserve: u64, lower: u64, upper: u64, funding: i128) -> Result<Self> {
        let mut next = self.accrued(funding)?;
        next.reserved = reserve;
        next.admissible(lower, upper, funding)?;
        Ok(next)
    }
    /// Generation advances on flat/open and flip boundaries. Old protection never revives.
    pub fn with_lots(&self, lots: i64) -> Result<Self> {
        let mut next = *self;
        if self.lots != lots && (self.lots == 0 || lots == 0 || self.lots.signum() != lots.signum())
        {
            next.generation = next.generation.checked_add(1).ok_or(Error::Overflow)?;
        }
        next.lots = lots;
        next.validate()?;
        Ok(next)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Pools {
    pub vault: u64,
    pub settlement: u64,
    pub insurance: u64,
    pub fees: u64,
}

/// Paired candidate states; callers commit only after every route leg and health check passes.
pub fn fill(
    buyer: Participant,
    seller: Participant,
    lots: u64,
    notional: u64,
    funding: i128,
) -> Result<(Participant, Participant)> {
    if buyer.id == seller.id
        || lots == 0
        || lots > MAX_LOTS as u64
        || notional == 0
        || notional > MAX_CASH
    {
        return Err(Error::Bounds);
    }
    let b = buyer.accrued(funding)?;
    let s = seller.accrued(funding)?;
    let mut b = b.with_lots(b.lots.checked_add(lots as i64).ok_or(Error::Overflow)?)?;
    let mut s = s.with_lots(s.lots.checked_sub(lots as i64).ok_or(Error::Overflow)?)?;
    b.virtual_scaled = sub(b.virtual_scaled, scaled(notional)?)?;
    s.virtual_scaled = add(s.virtual_scaled, scaled(notional)?)?;
    b.validate()?;
    s.validate()?;
    Ok((b, s))
}
pub fn charge_fee(
    p: Participant,
    pools: Pools,
    prefix: u64,
    notional: u64,
) -> Result<(Participant, Pools, u64)> {
    p.validate()?;
    let (prefix, fee) = fee_increment(prefix, notional)?;
    let mut next = p;
    let mut pools = pools;
    next.cash = cash_sub(next.cash, fee)?;
    pools.fees = cash_add(pools.fees, fee)?;
    Ok((next, pools, prefix))
}
pub fn collect(
    p: Participant,
    pools: Pools,
    amount: u64,
    price: u64,
    funding: i128,
) -> Result<(Participant, Pools)> {
    let mut p = p.accrued(funding)?;
    if amount == 0 || scaled(amount)? > -p.unpaid(price, funding)?.min(0) {
        return Err(Error::Entitlement);
    }
    let mut pools = pools;
    p.cash = cash_sub(p.cash, amount)?;
    p.virtual_scaled = add(p.virtual_scaled, scaled(amount)?)?;
    pools.settlement = cash_add(pools.settlement, amount)?;
    p.validate()?;
    Ok((p, pools))
}
pub fn settle(
    p: Participant,
    pools: Pools,
    amount: u64,
    price: u64,
    funding: i128,
) -> Result<(Participant, Pools)> {
    let mut p = p.accrued(funding)?;
    if amount == 0 || scaled(amount)? > p.unpaid(price, funding)? {
        return Err(Error::Entitlement);
    }
    let mut pools = pools;
    pools.settlement = cash_sub(pools.settlement, amount)?;
    p.cash = cash_add(p.cash, amount)?;
    p.virtual_scaled = sub(p.virtual_scaled, scaled(amount)?)?;
    p.validate()?;
    Ok((p, pools))
}
pub fn reconcile(cohort: &[Participant], pools: Pools, price: u64, funding: i128) -> Result<()> {
    validate_cohort(cohort)?;
    if [pools.vault, pools.settlement, pools.insurance, pools.fees]
        .iter()
        .any(|n| *n > MAX_CASH)
    {
        return Err(Error::Bounds);
    }
    let mut cash =
        u128::from(pools.settlement) + u128::from(pools.insurance) + u128::from(pools.fees);
    let (mut lots, mut unpaid) = (0i128, 0i128);
    for p in cohort {
        p.validate()?;
        cash += u128::from(p.cash);
        lots = add(lots, i128::from(p.lots))?;
        unpaid = add(unpaid, p.unpaid(price, funding)?)?;
    }
    if cash != u128::from(pools.vault) || lots != 0 || unpaid != scaled(pools.settlement)? {
        return Err(Error::Invariant);
    }
    Ok(())
}

/// Admission cap separate from reconciliation: distressed positions still reconcile.
pub fn exposure_capacity(cohort: &[Participant]) -> Result<()> {
    validate_cohort(cohort)?;
    let mut gross = 0u64;
    for p in cohort {
        p.validate()?;
        gross = gross
            .checked_add(p.lots.unsigned_abs())
            .ok_or(Error::Overflow)?;
    }
    if gross > MAX_GROSS_LOTS {
        return Err(Error::Bounds);
    }
    Ok(())
}
fn validate_cohort(cohort: &[Participant]) -> Result<()> {
    if cohort.is_empty() || cohort.len() > MAX_PARTICIPANTS {
        return Err(Error::Cohort);
    }
    for (i, p) in cohort.iter().enumerate() {
        if p.id as usize >= MAX_PARTICIPANTS || cohort[..i].iter().any(|other| other.id == p.id) {
            return Err(Error::Cohort);
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Protection {
    pub generation: u64,
    pub side: i8,
    pub remaining: u64,
}
impl Protection {
    pub fn consume(self, p: &Participant, child_remaining: u64, lots: u64) -> Result<Self> {
        if p.generation != self.generation || p.lots.signum() != i64::from(self.side) || p.lots == 0
        {
            return Err(Error::Generation);
        }
        let available = self
            .remaining
            .min(p.lots.unsigned_abs())
            .min(child_remaining);
        if lots == 0 || lots > available {
            return Err(Error::Bounds);
        }
        Ok(Self {
            remaining: self.remaining - lots,
            ..self
        })
    }
}

/// Exact a*b/d without a*b overflow, for b <= d <= 64 * (MAX_SCALED + max mark).
/// Each bit keeps r < d, so 2*r+b < 3*d < 2^96. Quotient never exceeds a.
pub fn mul_div_rem(a: u128, b: u128, d: u128) -> Result<(u128, u128)> {
    if d == 0 || b > d || d > (1u128 << 96) / 3 {
        return Err(Error::Bounds);
    }
    let (mut q, mut r) = (0u128, 0u128);
    for bit in (0..128).rev() {
        let value = r * 2 + if (a >> bit) & 1 == 1 { b } else { 0 };
        q = q
            .checked_mul(2)
            .and_then(|v| v.checked_add(value / d))
            .ok_or(Error::Overflow)?;
        r = value % d;
    }
    Ok((q, r))
}
/// Largest remainder in the caller's integer unit; deterministic stable-ID ties.
pub fn apportion(total: u128, weights: &[(u16, u128)]) -> Result<Vec<u128>> {
    if weights.is_empty() || weights.len() > MAX_PARTICIPANTS {
        return Err(Error::Cohort);
    }
    let mut denominator = 0u128;
    for (i, (id, w)) in weights.iter().enumerate() {
        if *id as usize >= MAX_PARTICIPANTS || weights[..i].iter().any(|(other, _)| other == id) {
            return Err(Error::Cohort);
        }
        denominator = denominator.checked_add(*w).ok_or(Error::Overflow)?;
    }
    if denominator == 0 {
        return if total == 0 {
            Ok(vec![0; weights.len()])
        } else {
            Err(Error::Entitlement)
        };
    }
    if total > denominator {
        return Err(Error::Entitlement);
    }
    let mut allocations = Vec::with_capacity(weights.len());
    let mut rank = Vec::with_capacity(weights.len());
    let mut assigned = 0;
    for (i, &(id, w)) in weights.iter().enumerate() {
        let (q, r) = mul_div_rem(total, w, denominator)?;
        allocations.push(q);
        rank.push((i, r, id));
        assigned += q;
    }
    rank.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.2.cmp(&b.2)));
    let remainder = usize::try_from(total - assigned).map_err(|_| Error::Overflow)?;
    if remainder > rank.len() {
        return Err(Error::Invariant);
    }
    for &(i, _, _) in rank.iter().take(remainder) {
        allocations[i] += 1;
    }
    Ok(allocations)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefaultResult {
    pub participants: Vec<Participant>,
    pub pools: Pools,
    pub collected: Vec<u64>,
    pub insured_scaled: Vec<i128>,
    pub impaired_scaled: Vec<i128>,
    /// Explicit terminal claim transfers, sum exactly zero; each abs < one atom.
    pub rounding_scaled: Vec<i128>,
    pub paid: Vec<u64>,
}
/// Pure whole-cohort closeout math. Operational freeze/pages/authority arrive in P09.
/// Input must already be the *complete* registry; this pure function cannot authenticate it.
pub fn closeout(
    cohort: &[Participant],
    pools: Pools,
    price: u64,
    funding: i128,
) -> Result<DefaultResult> {
    reconcile(cohort, pools, price, funding)?;
    let mut out = DefaultResult {
        participants: cohort.to_vec(),
        pools,
        collected: vec![0; cohort.len()],
        insured_scaled: vec![0; cohort.len()],
        impaired_scaled: vec![0; cohort.len()],
        rounding_scaled: vec![0; cohort.len()],
        paid: vec![0; cohort.len()],
    };
    for (i, old) in cohort.iter().enumerate() {
        let mut p = old.with_lots(0)?;
        p.virtual_scaled = old.unpaid(price, funding)?;
        p.funding_checkpoint = funding;
        p.reserved = 0;
        // These temporary valued claims have the larger derived-claim bound,
        // not the ordinary open-position stored-v bound. Final returned v is 0.
        let collectable = u64::try_from((-p.virtual_scaled.min(0)) / SCALE)
            .map_err(|_| Error::Overflow)?
            .min(p.cash);
        if collectable != 0 {
            p.cash = cash_sub(p.cash, collectable)?;
            p.virtual_scaled = add(p.virtual_scaled, scaled(collectable)?)?;
            out.pools.settlement = cash_add(out.pools.settlement, collectable)?;
        }
        out.collected[i] = collectable;
        out.participants[i] = p;
    }
    let debt_weights: Vec<_> = out
        .participants
        .iter()
        .map(|p| (p.id, (-p.virtual_scaled.min(0)) as u128))
        .collect();
    let debt: u128 = debt_weights.iter().map(|(_, w)| w).sum();
    // Only whole atoms can move from I to P; any residual fraction enters impairment.
    let insured = (debt / SCALE as u128).min(u128::from(out.pools.insurance)) as u64;
    out.pools.insurance -= insured;
    out.pools.settlement = cash_add(out.pools.settlement, insured)?;
    let insurance = apportion(scaled(insured)? as u128, &debt_weights)?;
    for (i, amount) in insurance.into_iter().enumerate() {
        out.insured_scaled[i] = amount as i128;
        out.participants[i].virtual_scaled =
            add(out.participants[i].virtual_scaled, amount as i128)?;
    }
    let remaining_debt = debt - scaled(insured)? as u128;
    let claim_weights: Vec<_> = out
        .participants
        .iter()
        .map(|p| (p.id, p.virtual_scaled.max(0) as u128))
        .collect();
    let impairments = apportion(remaining_debt, &claim_weights)?;
    for (i, amount) in impairments.into_iter().enumerate() {
        out.impaired_scaled[i] = amount as i128;
        out.participants[i].virtual_scaled =
            sub(out.participants[i].virtual_scaled.max(0), amount as i128)?;
    }
    // Entitlements now sum to P*SCALE. Floor each and distribute the remaining
    // cash atoms by fractional remainder and stable ID. No cash bucket is created.
    let claims: Vec<_> = out
        .participants
        .iter()
        .map(|p| (p.id, p.virtual_scaled as u128))
        .collect();
    let payments = apportion(u128::from(out.pools.settlement), &claims)?;
    for (i, payment) in payments.into_iter().enumerate() {
        let payment = u64::try_from(payment).map_err(|_| Error::Overflow)?;
        let p = &mut out.participants[i];
        out.rounding_scaled[i] = sub(scaled(payment)?, p.virtual_scaled)?;
        if out.rounding_scaled[i].unsigned_abs() >= SCALE as u128 {
            return Err(Error::Invariant);
        }
        p.cash = cash_add(p.cash, payment)?;
        p.virtual_scaled = 0;
        out.paid[i] = payment;
    }
    out.pools.settlement = 0;
    if out.rounding_scaled.iter().sum::<i128>() != 0 {
        return Err(Error::Invariant);
    }
    reconcile(&out.participants, out.pools, price, funding)?;
    Ok(out)
}
