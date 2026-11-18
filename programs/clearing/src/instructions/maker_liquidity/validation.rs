use super::*;
use crate::{ProgramData, UpgradeableProgramAddress};

pub(crate) fn execution_base(venue: &Venue, safety: &VenueSafety, market: &Market) -> Result<()> {
    require!(
        cfg!(feature = "liquidity-execution-qualification")
            && venue.schema_version == crate::state::accounts::SCHEMA_VERSION
            && venue.profile_version == crate::state::accounts::PROFILE_VERSION
            && venue.market_count == 2
            && venue.insurance_fee_share_bps == 2500
            && safety.schema_version == crate::state::accounts::SCHEMA_VERSION
            && matches!(safety.mode, CUSTODY | ACTIVE)
            && market.schema_version == crate::state::accounts::SCHEMA_VERSION
            && market.index < 2,
        ClearingError::Profile
    );
    Ok(())
}

pub(crate) fn execution_profile(
    venue: &Venue,
    safety: &VenueSafety,
    market: &Market,
) -> Result<()> {
    execution_base(venue, safety, market)?;
    require!(!safety.paused, ClearingError::Paused);
    Ok(())
}

/// P30 binaries remain custody-only. P32's separate candidate can coordinate
/// controls with held funding, but frozen/default resolution still rejects them.
pub(crate) fn control_base(venue: &Venue, safety: &VenueSafety, market: &Market) -> Result<()> {
    if cfg!(feature = "liquidity-execution-qualification") {
        execution_base(venue, safety, market)
    } else {
        custody_base(venue, safety, market)
    }
}

pub(crate) fn custody_only(venue: &Venue, safety: &VenueSafety, market: &Market) -> Result<()> {
    custody_base(venue, safety, market)?;
    require!(!safety.paused, ClearingError::Paused);
    Ok(())
}

pub(crate) fn custody_base(venue: &Venue, safety: &VenueSafety, market: &Market) -> Result<()> {
    require!(
        cfg!(feature = "liquidity-execution-qualification")
            && venue.schema_version == crate::state::accounts::SCHEMA_VERSION
            && venue.profile_version == crate::state::accounts::PROFILE_VERSION
            && venue.market_count == 2
            && venue.insurance_fee_share_bps == 2500
            && safety.schema_version == crate::state::accounts::SCHEMA_VERSION
            && safety.mode == CUSTODY
            && market.schema_version == crate::state::accounts::SCHEMA_VERSION
            && market.index < 2
            && market.funding_index_scaled == 0
            && market.gross_lots == 0
            && market.oracle.held_until <= market.oracle.sampled_at,
        ClearingError::Profile
    );
    Ok(())
}

pub(crate) fn capital_identity(capital: &MarginAccount, market: &Market) -> Result<()> {
    require!(
        capital.schema_version == crate::state::accounts::SCHEMA_VERSION
            && capital.venue == market.venue
            && capital.mode == MODE_ISOLATED
            && capital.role == ROLE_MAKER
            && capital.isolated_market_index == market.index,
        ClearingError::MakerCapital
    );
    Ok(())
}

pub(crate) fn config_and_price(
    config: &AccountView,
    price: &AccountView,
    program: Address,
    instance: u8,
    venue: &BorshAccount<Venue>,
    market: &BorshAccount<Market>,
    capital: &BorshAccount<MarginAccount>,
) -> Result<(CurveState, PriceState)> {
    require!(
        (program == MAKER_A || program == MAKER_B)
            && instance < 3
            && *config.owner() == program
            && *price.owner() == program
            && !config.executable()
            && !price.executable()
            && !price.is_writable(),
        ClearingError::MakerBinding
    );
    let (config_key, config_bump) =
        find_program_address(&[b"curve-v4", capital.address().as_ref()], &program);
    let (price_key, price_bump) =
        find_program_address(&[b"price-v4", config_key.as_ref()], &program);
    require_keys_eq!(*config.address(), config_key, ClearingError::MakerBinding);
    require_keys_eq!(*price.address(), price_key, ClearingError::MakerBinding);
    let config_bytes = config.try_borrow()?;
    let price_bytes = price.try_borrow()?;
    require!(
        config_bytes.len() == 691
            && price_bytes.len() == 83
            && config_bytes[..8] == hash(b"account:MakerCurve").to_bytes()[..8]
            && price_bytes[..8] == hash(b"account:MakerPrice").to_bytes()[..8],
        ClearingError::MakerBinding
    );
    let curve = crate::wire::read::<CurveState>(&config_bytes[8..])
        .map_err(|_| ProgramError::from(ClearingError::MakerBinding))?;
    let publication = crate::wire::read::<PriceState>(&price_bytes[8..])
        .map_err(|_| ProgramError::from(ClearingError::MakerBinding))?;
    let controller = find_program_address(
        &[
            b"liquidity-control-v4",
            venue.address().as_ref(),
            capital.address().as_ref(),
        ],
        &crate::ID,
    )
    .0;
    require!(
        curve.schema_version == canonical::ACCOUNT_SCHEMA
            && curve.venue == venue.address().to_owned()
            && curve.market == market.address().to_owned()
            && curve.capital == capital.address().to_owned()
            && curve.owner == capital.owner
            && curve.controller == controller
            && curve.domain == venue.domain
            && curve.instance == instance
            && curve.capability == canonical::CAPABILITY
            && curve.control_epoch > 0
            && curve.shape_epoch > 0
            && curve.bump == config_bump
            && publication.schema_version == canonical::ACCOUNT_SCHEMA
            && publication.config == config_key
            && publication.bump == price_bump
            && publication.control_epoch > 0
            && publication.control_epoch <= curve.control_epoch,
        ClearingError::MakerBinding
    );
    curve
        .shape
        .validate()
        .map_err(|_| ProgramError::from(ClearingError::MakerBinding))?;
    if publication.sequence == 0 {
        require!(
            publication.anchor == 0
                && publication.updated_slot == 0
                && publication.updated_time == 0,
            ClearingError::MakerBinding
        );
    } else {
        require!(
            (1..=financial_core::MAX_PRICE).contains(&publication.anchor)
                && publication.updated_time >= 0,
            ClearingError::MakerBinding
        );
    }
    Ok((curve, publication))
}

pub(crate) fn authenticated_control(
    accounts: &ControlLiquidity,
    authority: u64,
    check_hash: bool,
) -> Result<CurveState> {
    control_base(&accounts.venue, &accounts.safety, &accounts.market)?;
    require!(!accounts.safety.paused, ClearingError::Paused);
    capital_identity(&accounts.capital, &accounts.market)?;
    require!(
        accounts.registration.schema_version == crate::state::accounts::SCHEMA_VERSION
            && accounts.registration.authority_epoch == authority
            && authority > 0
            && accounts.registration.depth_epoch > 0
            && accounts.registration.owner == accounts.capital.owner,
        ClearingError::MakerBinding
    );
    let (config, _) = config_and_price(
        &accounts.config,
        &accounts.price,
        accounts.pricing_program.address().to_owned(),
        accounts.registration.instance,
        &accounts.venue,
        &accounts.market,
        &accounts.capital,
    )?;
    if check_hash {
        require!(
            module_hash(&accounts.program_data)? == accounts.registration.approved_hash,
            ClearingError::MakerBinding
        );
    }
    Ok(config)
}

/// The complete pre-CPI binding/hash/shape validation has already run. Only the
/// curve is writable in this CPI; the runtime protects its read-only price and
/// clearing dependencies. Verify its owner/layout and the ENTIRE expected next
/// state, including all identity fields, instead of searching the same PDAs again.
pub(crate) fn verify_control_result(
    config: &AccountView,
    program: Address,
    expected: &CurveState,
) -> Result<()> {
    require!(
        *config.owner() == program && !config.executable(),
        ClearingError::MakerBinding
    );
    let bytes = config.try_borrow()?;
    require!(
        bytes.len() == 691 && bytes[..8] == hash(b"account:MakerCurve").to_bytes()[..8],
        ClearingError::MakerBinding
    );
    let actual = crate::wire::read::<CurveState>(&bytes[8..])
        .map_err(|_| ProgramError::from(ClearingError::MakerBinding))?;
    require!(actual == *expected, ClearingError::MakerBinding);
    Ok(())
}

#[cfg(test)]
mod control_result_tests {
    use super::*;

    #[test]
    fn post_cpi_verification_rejects_every_changed_byte_and_foreign_layout_or_owner() {
        let mut shape = canonical::LiquidityShape {
            mode: 1,
            ttl_slots: 150,
            skew_step: 1,
            long_cap: 100,
            short_cap: 100,
            bid_count: 1,
            ask_count: 1,
            ..Default::default()
        };
        shape.bids[0] = canonical::PriceRegion {
            end_lots: 100,
            offset: 1,
            slope: 0,
        };
        shape.asks[0] = canonical::PriceRegion {
            end_lots: 100,
            offset: 2,
            slope: 0,
        };
        shape.validate().unwrap();
        let expected = CurveState {
            schema_version: canonical::ACCOUNT_SCHEMA,
            venue: Address::new_unique(),
            market: Address::new_unique(),
            capital: Address::new_unique(),
            controller: Address::new_unique(),
            owner: Address::new_unique(),
            updater: Address::new_unique(),
            updater_expiry_slot: 1000,
            control_epoch: 2,
            shape_epoch: 2,
            domain: [17; 32],
            instance: 1,
            capability: 1,
            shape,
            bump: 252,
        };
        let mut encoded = hash(b"account:MakerCurve").to_bytes()[..8].to_vec();
        crate::wire::write(&expected, &mut encoded).unwrap();
        assert_eq!(encoded.len(), 691);
        let check = |bytes: &mut [u8], owner: Address, executable: bool| {
            let key = Address::new_unique();
            let mut backing =
                crate::test_support::TestAccount::new(key, owner, bytes, true, executable);
            let info = backing.view();
            verify_control_result(&info, MAKER_A, &expected)
        };
        assert!(check(&mut encoded.clone(), MAKER_A, false).is_ok());
        for position in 0..encoded.len() {
            let mut changed = encoded.clone();
            changed[position] ^= 1;
            assert!(
                check(&mut changed, MAKER_A, false).is_err(),
                "unchecked byte {position}"
            );
        }
        assert!(check(&mut encoded.clone(), MAKER_B, false).is_err());
        assert!(check(&mut encoded.clone(), MAKER_A, true).is_err());
        assert!(check(&mut encoded[..690], MAKER_A, false).is_err());
    }
}

pub(crate) fn module_hash(data: &BorshAccount<ProgramData>) -> Result<[u8; 32]> {
    let info = data.account().clone();
    let bytes = info.try_borrow()?;
    require!(bytes.len() <= 1_048_576, ClearingError::MakerBinding);
    profile_cu!("code-hash-enter");
    let digest = hash(&bytes).to_bytes();
    profile_cu!("code-hash-exit");
    Ok(digest)
}
