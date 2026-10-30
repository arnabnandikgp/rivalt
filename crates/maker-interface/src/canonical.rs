//! Canonical profile-4 quotes. Clearing remains responsible for authenticating
//! inventory/consumption, full account admission and every financial mutation.
use super::{QuoteError, QuoteResult};
use anchor_lang::prelude::*;
use financial_core::{MAX_LOTS, MAX_PRICE};

pub const VERSION: u16 = 4;
pub const CAPABILITY: u16 = 1;
pub const MAX_REGIONS: usize = 8;
pub const MAX_DEPTH: u64 = 4_096;
pub const MAX_TTL_SLOTS: u16 = 150;
pub const TTL_SECONDS: i64 = 6;
pub const REQUEST_BYTES: usize = 156;
pub const RESPONSE_BYTES: usize = 204;

mod ladder;
pub use ladder::QuoteLadder;

#[derive(
    AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, Default, PartialEq, Eq,
)]
pub struct PriceRegion {
    pub end_lots: u64,
    pub offset: u64,
    pub slope: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Debug, Default, PartialEq, Eq)]
pub struct LiquidityShape {
    /// 0 disabled, 1 enabled, 3 enabled and maker-inventory reduce-only.
    pub mode: u8,
    pub ttl_slots: u16,
    pub target: i64,
    pub skew_step: u64,
    pub skew_tick: u64,
    pub long_cap: u64,
    pub short_cap: u64,
    pub bid_count: u8,
    pub ask_count: u8,
    pub bids: [PriceRegion; MAX_REGIONS],
    pub asks: [PriceRegion; MAX_REGIONS],
}

impl LiquidityShape {
    pub fn validate(&self) -> QuoteResult<()> {
        if !matches!(self.mode, 0 | 1 | 3)
            || !(1..=MAX_TTL_SLOTS).contains(&self.ttl_slots)
            || self.target.unsigned_abs() > MAX_LOTS as u64
            || !(1..=MAX_LOTS as u64).contains(&self.skew_step)
            || self.skew_tick > 1_000
            || self.long_cap > MAX_LOTS as u64
            || self.short_cap > MAX_LOTS as u64
            || (self.bid_count == 0 && self.ask_count == 0)
        {
            return Err(QuoteError::Bounds);
        }
        validate_regions(&self.bids, self.bid_count)?;
        validate_regions(&self.asks, self.ask_count)
    }

    fn side_regions(&self, side: u8) -> QuoteResult<&[PriceRegion]> {
        let (regions, count) = match side {
            0 => (&self.asks, self.ask_count),
            1 => (&self.bids, self.bid_count),
            _ => return Err(QuoteError::Bounds),
        };
        regions.get(..usize::from(count)).ok_or(QuoteError::Bounds)
    }
}

fn validate_regions(regions: &[PriceRegion; MAX_REGIONS], count: u8) -> QuoteResult<()> {
    if usize::from(count) > MAX_REGIONS {
        return Err(QuoteError::Bounds);
    }
    let mut start = 0;
    let mut previous_offset = 0;
    for (index, region) in regions.iter().enumerate() {
        if index >= usize::from(count) {
            if *region != PriceRegion::default() {
                return Err(QuoteError::Bounds);
            }
            continue;
        }
        if region.end_lots <= start
            || region.end_lots > MAX_DEPTH
            || region.offset < previous_offset
            || region.offset > MAX_PRICE
            || region.slope > 1_000
        {
            return Err(QuoteError::Bounds);
        }
        let width = region
            .end_lots
            .checked_sub(start)
            .ok_or(QuoteError::Arithmetic)?;
        previous_offset = region
            .slope
            .checked_mul(width.checked_sub(1).ok_or(QuoteError::Arithmetic)?)
            .and_then(|rising| region.offset.checked_add(rising))
            .ok_or(QuoteError::Arithmetic)?;
        if previous_offset > MAX_PRICE {
            return Err(QuoteError::Bounds);
        }
        start = region.end_lots;
    }
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Debug, PartialEq, Eq)]
pub struct CurveState {
    pub schema_version: u16,
    pub venue: Pubkey,
    pub market: Pubkey,
    pub capital: Pubkey,
    pub controller: Pubkey,
    pub owner: Pubkey,
    pub updater: Pubkey,
    pub updater_expiry_slot: u64,
    pub control_epoch: u64,
    pub shape_epoch: u64,
    pub domain: [u8; 32],
    pub instance: u8,
    pub capability: u16,
    pub shape: LiquidityShape,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Debug, PartialEq, Eq)]
pub struct PriceState {
    pub schema_version: u16,
    pub config: Pubkey,
    pub control_epoch: u64,
    pub sequence: u64,
    pub anchor: u64,
    pub updated_slot: u64,
    pub updated_time: i64,
    pub bump: u8,
}

/// Borsh discriminants 0..3, with no extra vector-length prefix on the payload.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum CurveControl {
    Shape(LiquidityShape),
    Updater { updater: Pubkey, expiry_slot: u64 },
    Mode { mode: u8 },
    Invalidate,
}

impl CurveControl {
    pub fn operation(&self) -> u8 {
        match self {
            Self::Shape(_) => 0,
            Self::Updater { .. } => 1,
            Self::Mode { .. } => 2,
            Self::Invalidate => 3,
        }
    }
}

/// Instruction caller must authenticate the dedicated clearing controller signer.
/// Never receives or mutates clearing consumption, capital, cash or funding state.
pub fn control(
    config: &CurveState,
    expected_control: u64,
    expected_shape: u64,
    action: CurveControl,
    slot: u64,
) -> QuoteResult<CurveState> {
    if config.schema_version != VERSION
        || config.capability != CAPABILITY
        || config.control_epoch == 0
        || config.shape_epoch == 0
        || config.control_epoch != expected_control
        || config.shape_epoch != expected_shape
    {
        return Err(QuoteError::Binding);
    }
    let mut next = config.clone();
    match action {
        CurveControl::Shape(shape) => {
            shape.validate()?;
            // Enabling must always use the explicit mode transition and invalidate
            // the old publication. A shape payload cannot bypass that transition.
            if shape.mode != config.shape.mode {
                return Err(QuoteError::Binding);
            }
            next.shape = shape;
            next.shape_epoch = config
                .shape_epoch
                .checked_add(1)
                .ok_or(QuoteError::Arithmetic)?;
        }
        CurveControl::Updater {
            updater,
            expiry_slot,
        } => {
            if (updater == Pubkey::default() && expiry_slot != 0)
                || (updater != Pubkey::default() && expiry_slot <= slot)
            {
                return Err(QuoteError::Lifetime);
            }
            next.updater = updater;
            next.updater_expiry_slot = expiry_slot;
            next.control_epoch = config
                .control_epoch
                .checked_add(1)
                .ok_or(QuoteError::Arithmetic)?;
        }
        CurveControl::Mode { mode } => {
            if !matches!(mode, 0 | 1 | 3) {
                return Err(QuoteError::Bounds);
            }
            next.shape.mode = mode;
            next.shape_epoch = config
                .shape_epoch
                .checked_add(1)
                .ok_or(QuoteError::Arithmetic)?;
            if config.shape.mode == 0 && mode != 0 {
                next.control_epoch = config
                    .control_epoch
                    .checked_add(1)
                    .ok_or(QuoteError::Arithmetic)?;
            }
        }
        CurveControl::Invalidate => {
            next.control_epoch = config
                .control_epoch
                .checked_add(1)
                .ok_or(QuoteError::Arithmetic)?;
        }
    }
    next.shape.validate()?;
    Ok(next)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct MakerQuoteRequest {
    pub version: u16,
    pub domain: [u8; 32],
    pub market: Pubkey,
    pub capital: Pubkey,
    pub instance: u8,
    pub authority_epoch: u64,
    pub control_epoch: u64,
    pub shape_epoch: u64,
    pub depth_epoch: u64,
    pub side: u8,
    pub lots: u64,
    pub inventory: i64,
    pub consumed: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct MakerQuoteResponse {
    pub request: MakerQuoteRequest,
    pub price_sequence: u64,
    pub anchor: u64,
    pub gross: u64,
    pub remaining: u64,
    pub valid_until_slot: u64,
    pub valid_until_time: i64,
}

fn add(left: i128, right: i128) -> QuoteResult<i128> {
    left.checked_add(right).ok_or(QuoteError::Arithmetic)
}
fn sub(left: i128, right: i128) -> QuoteResult<i128> {
    left.checked_sub(right).ok_or(QuoteError::Arithmetic)
}
fn mul(left: i128, right: i128) -> QuoteResult<i128> {
    left.checked_mul(right).ok_or(QuoteError::Arithmetic)
}

/// Sum offsets at quantity indices [0, quantity), including jumps at boundaries.
fn offset_prefix(regions: &[PriceRegion], quantity: u64) -> QuoteResult<i128> {
    if quantity > regions.last().map_or(0, |region| region.end_lots) {
        return Err(QuoteError::Capacity);
    }
    let mut start = 0;
    let mut total = 0u64;
    for region in regions {
        if quantity <= start {
            break;
        }
        let width = quantity
            .min(region.end_lots)
            .checked_sub(start)
            .ok_or(QuoteError::Arithmetic)?;
        // Validated depth <=4096, offset <=1e6, slope <=1000. Keep every
        // operation checked; the complete spread prefix is well within u64.
        let rising = region
            .slope
            .checked_mul(width)
            .and_then(|value| value.checked_mul(width - 1))
            .ok_or(QuoteError::Arithmetic)?
            / 2;
        total = width
            .checked_mul(region.offset)
            .and_then(|value| value.checked_add(rising))
            .and_then(|value| total.checked_add(value))
            .ok_or(QuoteError::Arithmetic)?;
        start = region.end_lots;
    }
    Ok(i128::from(total))
}

fn potential(shape: &LiquidityShape, inventory: i128) -> QuoteResult<i128> {
    let distance = sub(inventory, i128::from(shape.target))?
        .checked_abs()
        .ok_or(QuoteError::Arithmetic)?;
    // Validated inventory/target are each bounded by MAX_LOTS (1e8), and
    // available() also bounds post-trade inventory. Distance therefore fits u64.
    // Divide that bounded distance at native width; retain wide checked products
    // because the potential itself can exceed u64 at the permitted extremes.
    let distance = u64::try_from(distance).map_err(|_| QuoteError::Arithmetic)?;
    let quotient = distance
        .checked_div(shape.skew_step)
        .ok_or(QuoteError::Arithmetic)?;
    let remainder = distance
        .checked_rem(shape.skew_step)
        .ok_or(QuoteError::Arithmetic)?;
    if quotient == 0 {
        return Ok(0);
    }
    // Before applying tick, sum(floor(j/step)) <= distance*(distance-1)/2
    // <= 19,999,999,900,000,000. Only the final tick product needs i128.
    let triangles = shape
        .skew_step
        .checked_mul(quotient)
        .and_then(|value| value.checked_mul(quotient - 1))
        .ok_or(QuoteError::Arithmetic)?
        / 2;
    let prefix = quotient
        .checked_mul(remainder)
        .and_then(|value| triangles.checked_add(value))
        .ok_or(QuoteError::Arithmetic)?;
    mul(i128::from(shape.skew_tick), i128::from(prefix))
}

/// Exact single-lot change of the convex potential. Endpoint validation needs
/// this increment, not two complete prefix sums and their wide division.
fn potential_marginal(shape: &LiquidityShape, inventory: i128, direction: i128) -> QuoteResult<i128> {
    let before = sub(inventory, i128::from(shape.target))?;
    let after = add(before, direction)?;
    let before_distance = before.checked_abs().ok_or(QuoteError::Arithmetic)?;
    let after_distance = after.checked_abs().ok_or(QuoteError::Arithmetic)?;
    let distance = before_distance.max(after_distance);
    let distance = u64::try_from(sub(distance, 1)?).map_err(|_| QuoteError::Arithmetic)?;
    let steps = distance
        .checked_div(shape.skew_step)
        .ok_or(QuoteError::Arithmetic)?;
    let increment = mul(i128::from(shape.skew_tick), i128::from(steps))?;
    if after_distance > before_distance {
        Ok(increment)
    } else {
        sub(0, increment)
    }
}

/// Direct marginal inside its region. Computing two prefixes here would visit
/// every earlier region twice even though those terms cancel exactly.
fn offset_marginal(regions: &[PriceRegion], index: u64) -> QuoteResult<i128> {
    let mut start = 0;
    for region in regions {
        if index < region.end_lots {
            let distance = index.checked_sub(start).ok_or(QuoteError::Arithmetic)?;
            return add(
                i128::from(region.offset),
                mul(i128::from(region.slope), i128::from(distance))?,
            );
        }
        start = region.end_lots;
    }
    Err(QuoteError::Capacity)
}

/// This is only a quantity upper bound; it confers no financial admission.
fn available(shape: &LiquidityShape, side: u8, inventory: i64, consumed: u64) -> QuoteResult<u64> {
    if inventory.unsigned_abs() > MAX_LOTS as u64 || consumed > MAX_DEPTH {
        return Err(QuoteError::Bounds);
    }
    let regions = shape.side_regions(side)?;
    let depth = regions.last().map_or(0, |region| region.end_lots);
    let remaining = if depth > consumed {
        depth - consumed
    } else {
        0
    };
    let mut headroom = if side == 0 {
        add(i128::from(inventory), i128::from(shape.short_cap))?
    } else {
        sub(i128::from(shape.long_cap), i128::from(inventory))?
    };
    if shape.mode == 3 {
        let reducing = if side == 0 {
            i128::from(inventory)
        } else {
            -i128::from(inventory)
        };
        headroom = headroom.min(reducing.max(0));
    }
    u64::try_from(i128::from(remaining).min(headroom).max(0)).map_err(|_| QuoteError::Arithmetic)
}

/// Exact quote arithmetic, used by admitted maker programs and clearing validation.
/// Neither this function nor a direct maker quote authenticates supplied capital state.
pub fn quote_amount(
    shape: &LiquidityShape,
    anchor: u64,
    side: u8,
    lots: u64,
    inventory: i64,
    consumed: u64,
) -> QuoteResult<(u64, u64)> {
    shape.validate()?;
    quote_validated_amount(shape, anchor, side, lots, inventory, consumed)
}

/// Internal only: the public amount API or validate_publication has already
/// validated this exact immutable shape. No account or risk check is skipped.
fn quote_validated_amount(
    shape: &LiquidityShape,
    anchor: u64,
    side: u8,
    lots: u64,
    inventory: i64,
    consumed: u64,
) -> QuoteResult<(u64, u64)> {
    if shape.mode == 0 || !(1..=MAX_PRICE).contains(&anchor) {
        return Err(QuoteError::Bounds);
    }
    let capacity = available(shape, side, inventory, consumed)?;
    if lots == 0 || lots > capacity {
        return Err(QuoteError::Capacity);
    }
    let regions = shape.side_regions(side)?;
    let direction = if side == 0 { -1 } else { 1 };
    let before = i128::from(inventory);
    let after = add(before, mul(direction, i128::from(lots))?)?;
    let end = consumed.checked_add(lots).ok_or(QuoteError::Arithmetic)?;
    let offsets = sub(
        offset_prefix(regions, end)?,
        offset_prefix(regions, consumed)?,
    )?;
    let skew = sub(potential(shape, after)?, potential(shape, before)?)?;
    let gross = sub(
        mul(i128::from(anchor), i128::from(lots))?,
        mul(direction, add(offsets, skew)?)?,
    )?;
    // Region ordering plus a convex potential gives monotone marginals. Validate
    // both endpoints, not just the average, against the global price bounds.
    for index in [0, lots - 1] {
        let current = add(before, mul(direction, i128::from(index))?)?;
        let prefix_index = consumed.checked_add(index).ok_or(QuoteError::Arithmetic)?;
        let spread = offset_marginal(regions, prefix_index)?;
        let change = potential_marginal(shape, current, direction)?;
        let marginal = sub(i128::from(anchor), mul(direction, add(spread, change)?)?)?;
        if !(1..=i128::from(MAX_PRICE)).contains(&marginal) {
            return Err(QuoteError::Bounds);
        }
    }
    Ok((
        u64::try_from(gross).map_err(|_| QuoteError::Arithmetic)?,
        capacity - lots,
    ))
}

/// Validate a required publication without inventing a positive-size trade.
/// Complete funding coverage includes valid zero-capacity/one-sided makers.
pub fn validate_publication(
    config_key: Pubkey,
    config: &CurveState,
    price: &PriceState,
    slot: u64,
    now: i64,
) -> QuoteResult<(u64, i64)> {
    if config.schema_version != VERSION
        || price.schema_version != VERSION
        || config.capability != CAPABILITY
        || config.instance > 2
        || price.config != config_key
        || config.control_epoch == 0
        || config.shape_epoch == 0
        || price.control_epoch != config.control_epoch
    {
        return Err(QuoteError::Binding);
    }
    config.shape.validate()?;
    if config.shape.mode == 0 || !(1..=MAX_PRICE).contains(&price.anchor) {
        return Err(QuoteError::Bounds);
    }
    let valid_until_slot = price
        .updated_slot
        .checked_add(u64::from(config.shape.ttl_slots))
        .ok_or(QuoteError::Arithmetic)?;
    let valid_until_time = price
        .updated_time
        .checked_add(TTL_SECONDS)
        .ok_or(QuoteError::Arithmetic)?;
    if price.sequence == 0
        || price.updated_time < 0
        || slot < price.updated_slot
        || now < price.updated_time
        || slot >= valid_until_slot
        || now >= valid_until_time
    {
        return Err(QuoteError::Lifetime);
    }
    Ok((valid_until_slot, valid_until_time))
}

pub fn quote(
    config_key: Pubkey,
    config: &CurveState,
    price: &PriceState,
    request: &MakerQuoteRequest,
    slot: u64,
    now: i64,
) -> QuoteResult<MakerQuoteResponse> {
    if request.version != VERSION
        || request.instance != config.instance
        || config.domain != request.domain
        || config.market != request.market
        || config.capital != request.capital
        || request.control_epoch != config.control_epoch
        || request.shape_epoch != config.shape_epoch
        || request.authority_epoch == 0
        || request.depth_epoch == 0
    {
        return Err(QuoteError::Binding);
    }
    let (valid_until_slot, valid_until_time) =
        validate_publication(config_key, config, price, slot, now)?;
    let (gross, remaining) = quote_validated_amount(
        &config.shape,
        price.anchor,
        request.side,
        request.lots,
        request.inventory,
        request.consumed,
    )?;
    Ok(MakerQuoteResponse {
        request: request.clone(),
        price_sequence: price.sequence,
        anchor: price.anchor,
        gross,
        remaining,
        valid_until_slot,
        valid_until_time,
    })
}

/// Return a new publication only after every authority/CAS/bound check succeeds.
/// The instruction supplies actual Clock values and authenticates account ownership.
pub fn reprice(
    config_key: Pubkey,
    config: &CurveState,
    price: &PriceState,
    actor: Pubkey,
    expected_control: u64,
    expected_sequence: u64,
    anchor: u64,
    slot: u64,
    now: i64,
) -> QuoteResult<PriceState> {
    config.shape.validate()?;
    if config.schema_version != VERSION
        || price.schema_version != VERSION
        || config.capability != CAPABILITY
        || config.control_epoch == 0
        || price.config != config_key
        || expected_control != config.control_epoch
        || expected_sequence != price.sequence
        || (actor != config.owner
            && (actor != config.updater || slot >= config.updater_expiry_slot))
    {
        return Err(QuoteError::Binding);
    }
    if !(1..=MAX_PRICE).contains(&anchor) || now < 0 {
        return Err(QuoteError::Bounds);
    }
    slot.checked_add(u64::from(config.shape.ttl_slots))
        .ok_or(QuoteError::Arithmetic)?;
    now.checked_add(TTL_SECONDS).ok_or(QuoteError::Arithmetic)?;
    let sequence = price
        .sequence
        .checked_add(1)
        .ok_or(QuoteError::Arithmetic)?;
    Ok(PriceState {
        control_epoch: config.control_epoch,
        sequence,
        anchor,
        updated_slot: slot,
        updated_time: now,
        ..price.clone()
    })
}

pub fn validate_response(
    expected: &MakerQuoteResponse,
    program: Pubkey,
    producer: Pubkey,
    bytes: &[u8],
) -> QuoteResult<()> {
    if program != producer {
        return Err(QuoteError::Producer);
    }
    if bytes.len() != RESPONSE_BYTES {
        return Err(QuoteError::Response);
    }
    let actual = MakerQuoteResponse::try_from_slice(bytes).map_err(|_| QuoteError::Response)?;
    if actual != *expected {
        return Err(QuoteError::Response);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_width_division_preserves_wide_potential_and_target_turn() {
        let mut shape = LiquidityShape {
            target: -100_000_000,
            skew_step: 1,
            skew_tick: 1000,
            ..Default::default()
        };
        // 1000 * sum(0..200_000_000); deliberately larger than u64::MAX.
        assert_eq!(
            potential(&shape, 100_000_000).unwrap(),
            19_999_999_900_000_000_000
        );
        shape.target = 0;
        shape.skew_step = 2;
        shape.skew_tick = 2;
        for (distance, expected) in [0, 0, 0, 2, 4, 8, 12].into_iter().enumerate() {
            assert_eq!(potential(&shape, distance as i128).unwrap(), expected);
            assert_eq!(potential(&shape, -(distance as i128)).unwrap(), expected);
        }
        shape.skew_step = 0;
        assert_eq!(potential(&shape, 1), Err(QuoteError::Arithmetic));
    }

    fn wire<T: AnchorSerialize>(value: &T) -> Vec<u8> {
        let mut bytes = Vec::new();
        value.serialize(&mut bytes).unwrap();
        bytes
    }

    fn fixture() -> (Pubkey, CurveState, PriceState, MakerQuoteRequest) {
        let mut shape = LiquidityShape {
            mode: 1,
            ttl_slots: 150,
            skew_step: 2,
            skew_tick: 2,
            long_cap: MAX_LOTS as u64,
            short_cap: MAX_LOTS as u64,
            bid_count: 2,
            ask_count: 2,
            ..LiquidityShape::default()
        };
        shape.bids[..2].copy_from_slice(&[
            PriceRegion {
                end_lots: 3,
                offset: 2,
                slope: 1,
            },
            PriceRegion {
                end_lots: 8,
                offset: 8,
                slope: 0,
            },
        ]);
        shape.asks[..2].copy_from_slice(&[
            PriceRegion {
                end_lots: 3,
                offset: 3,
                slope: 2,
            },
            PriceRegion {
                end_lots: 8,
                offset: 12,
                slope: 0,
            },
        ]);
        let key = Pubkey::new_from_array([1; 32]);
        let config = CurveState {
            schema_version: VERSION,
            venue: key,
            market: key,
            capital: key,
            controller: key,
            owner: key,
            updater: Pubkey::new_from_array([2; 32]),
            updater_expiry_slot: 200,
            control_epoch: 1,
            shape_epoch: 1,
            domain: [3; 32],
            instance: 2,
            capability: CAPABILITY,
            shape,
            bump: 0,
        };
        let price = PriceState {
            schema_version: VERSION,
            config: key,
            control_epoch: 1,
            sequence: 1,
            anchor: 100,
            updated_slot: 10,
            updated_time: 20,
            bump: 0,
        };
        let request = MakerQuoteRequest {
            version: VERSION,
            domain: config.domain,
            market: key,
            capital: key,
            instance: 2,
            authority_epoch: 1,
            control_epoch: 1,
            shape_epoch: 1,
            depth_epoch: 1,
            side: 0,
            lots: 3,
            inventory: 0,
            consumed: 0,
        };
        (key, config, price, request)
    }

    #[test]
    fn required_zero_capacity_publications_remain_authenticated_and_expire_normally() {
        let (key, mut config, mut price, request) = fixture();
        config.shape.long_cap = 0;
        config.shape.short_cap = 0;
        assert_eq!(
            validate_publication(key, &config, &price, 11, 21).unwrap(),
            (160, 26)
        );
        assert!(quote(key, &config, &price, &request, 11, 21).is_err());
        assert!(validate_publication(key, &config, &price, 160, 21).is_err());
        assert!(validate_publication(key, &config, &price, 11, 26).is_err());
        price.control_epoch = 0;
        assert!(validate_publication(key, &config, &price, 11, 21).is_err());
        price.control_epoch = 1;
        config.shape.mode = 0;
        assert!(validate_publication(key, &config, &price, 11, 21).is_err());
    }

    #[test]
    fn canonical_literal_quotes_and_payload_lengths() {
        let (key, config, price, mut request) = fixture();
        for (side, lots, inventory, consumed, gross) in [
            (0, 3, 0, 0, 317),
            (0, 4, 0, 0, 431),
            (1, 3, 0, 0, 289),
            (0, 3, 3, 0, 313),
            (1, 3, -3, 0, 293),
            (0, 1, -3, 3, 114),
        ] {
            request.side = side;
            request.lots = lots;
            request.inventory = inventory;
            request.consumed = consumed;
            let response = quote(key, &config, &price, &request, 11, 21).unwrap();
            assert_eq!(response.gross, gross);
            assert_eq!(wire(&response).len(), 204);
        }
        assert_eq!(wire(&config.shape).len(), 429);
        assert_eq!(wire(&config).len(), 683);
        assert_eq!(wire(&price).len(), 75);
        assert_eq!(wire(&request).len(), 156);
    }

    #[test]
    fn canonical_expiry_and_every_security_binding_fail_closed() {
        let (key, config, price, request) = fixture();
        assert!(quote(key, &config, &price, &request, 159, 25).is_ok());
        for (slot, time) in [(160, 25), (159, 26), (9, 20), (10, 19)] {
            assert_eq!(
                quote(key, &config, &price, &request, slot, time),
                Err(QuoteError::Lifetime)
            );
        }
        let mut bad = request.clone();
        bad.shape_epoch += 1;
        assert_eq!(
            quote(key, &config, &price, &bad, 11, 21),
            Err(QuoteError::Binding)
        );
        bad = request.clone();
        bad.control_epoch += 1;
        assert_eq!(
            quote(key, &config, &price, &bad, 11, 21),
            Err(QuoteError::Binding)
        );
        bad = request.clone();
        bad.capital = Pubkey::default();
        assert_eq!(
            quote(key, &config, &price, &bad, 11, 21),
            Err(QuoteError::Binding)
        );
        let mut disabled = config.clone();
        disabled.shape.mode = 0;
        assert!(quote(key, &disabled, &price, &request, 11, 21).is_err());
    }

    #[test]
    fn canonical_unused_regions_and_marginal_bounds_reject() {
        let (key, config, price, request) = fixture();
        let mut bad = config.clone();
        bad.shape.asks[7].offset = 1;
        assert!(quote(key, &bad, &price, &request, 11, 21).is_err());
        bad = config.clone();
        bad.shape.asks[1].offset = 6;
        assert!(bad.shape.validate().is_err());
        let mut low = price.clone();
        low.anchor = 1;
        let mut sell = request.clone();
        sell.side = 1;
        assert!(quote(key, &config, &low, &sell, 11, 21).is_err());
    }

    #[test]
    fn canonical_reprice_checks_authority_cas_and_overflow() {
        let (key, config, price, request) = fixture();
        let published = reprice(key, &config, &price, config.updater, 1, 1, 102, 11, 21).unwrap();
        assert_eq!(published.sequence, 2);
        assert_eq!(
            quote(key, &config, &published, &request, 11, 21)
                .unwrap()
                .gross,
            323
        );
        assert!(reprice(key, &config, &published, config.updater, 1, 1, 102, 12, 22).is_err());
        assert!(reprice(key, &config, &price, config.updater, 1, 1, 102, 200, 21).is_err());
        assert!(reprice(key, &config, &price, config.owner, 1, 1, 102, 200, 21).is_ok());
        assert!(reprice(key, &config, &price, Pubkey::default(), 1, 1, 102, 11, 21).is_err());
        let mut exhausted = price.clone();
        exhausted.sequence = u64::MAX;
        assert_eq!(
            reprice(
                key,
                &config,
                &exhausted,
                config.owner,
                1,
                u64::MAX,
                102,
                11,
                21
            ),
            Err(QuoteError::Arithmetic)
        );
    }

    #[test]
    fn canonical_response_authentication_is_exact() {
        let (key, config, price, request) = fixture();
        let response = quote(key, &config, &price, &request, 11, 21).unwrap();
        let bytes = wire(&response);
        assert!(validate_response(&response, key, key, &bytes).is_ok());
        assert!(validate_response(&response, key, Pubkey::default(), &bytes).is_err());
        let mut changed = bytes.clone();
        changed[REQUEST_BYTES] ^= 1;
        assert!(validate_response(&response, key, key, &changed).is_err());
        let mut trailing = bytes;
        trailing.push(0);
        assert!(validate_response(&response, key, key, &trailing).is_err());
    }

    #[test]
    fn canonical_controls_require_fresh_publication_after_enable_or_revocation() {
        let (key, config, price, request) = fixture();
        let disabled = control(&config, 1, 1, CurveControl::Mode { mode: 0 }, 11).unwrap();
        assert_eq!((disabled.control_epoch, disabled.shape_epoch), (1, 2));
        let mut enabling_shape = disabled.shape.clone();
        enabling_shape.mode = 1;
        assert!(control(&disabled, 1, 2, CurveControl::Shape(enabling_shape), 11).is_err());
        let enabled = control(&disabled, 1, 2, CurveControl::Mode { mode: 1 }, 11).unwrap();
        assert_eq!((enabled.control_epoch, enabled.shape_epoch), (2, 3));
        let mut current = request.clone();
        current.control_epoch = 2;
        current.shape_epoch = 3;
        assert_eq!(
            quote(key, &enabled, &price, &current, 11, 21),
            Err(QuoteError::Binding)
        );
        let fresh = reprice(key, &enabled, &price, enabled.owner, 2, 1, 100, 11, 21).unwrap();
        assert!(quote(key, &enabled, &fresh, &current, 11, 21).is_ok());
        let revoked = control(
            &enabled,
            2,
            3,
            CurveControl::Updater {
                updater: Pubkey::default(),
                expiry_slot: 0,
            },
            11,
        )
        .unwrap();
        assert_eq!(revoked.control_epoch, 3);
        assert!(reprice(key, &revoked, &fresh, config.updater, 3, 2, 100, 12, 22).is_err());
        assert!(control(&revoked, 2, 3, CurveControl::Invalidate, 12).is_err());
    }

    #[test]
    fn canonical_control_payload_is_tagged_without_a_vector_prefix() {
        let (_, config, _, _) = fixture();
        let shape = wire(&CurveControl::Shape(config.shape.clone()));
        assert_eq!(shape.len(), 430);
        assert_eq!(shape[0], 0);
        assert_eq!(shape[1..], wire(&config.shape));
        assert_eq!(wire(&CurveControl::Mode { mode: 3 }), [2, 3]);
        assert_eq!(wire(&CurveControl::Invalidate), [3]);
    }
}
