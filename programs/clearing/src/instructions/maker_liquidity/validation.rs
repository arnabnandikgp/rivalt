use super::*;

pub(crate) fn custody_only(
    venue: &VenueV3,
    custody: &CustodyV3,
    safety: &SafetyV3,
    market: &MarketV3,
) -> Result<()> {
    custody_base(venue, custody, safety, market)?;
    require!(!safety.paused, ClearingError::Paused);
    Ok(())
}

pub(crate) fn custody_base(
    venue: &VenueV3,
    custody: &CustodyV3,
    safety: &SafetyV3,
    market: &MarketV3,
) -> Result<()> {
    require!(
        cfg!(feature = "maker-liquidity-qualification")
            && venue.schema_version == 3
            && venue.profile_version == 4
            && venue.market_count == 2
            && venue.insurance_fee_share_bps == 2500
            && custody.schema_version == 3
            && safety.schema_version == 3
            && safety.mode == CUSTODY
            && market.schema_version == 3
            && market.index < 2
            && market.funding_index_scaled == 0
            && market.gross_lots == 0
            && market.oracle.held_until <= market.oracle.sampled_at,
        ClearingError::Profile
    );
    Ok(())
}

pub(crate) fn capital_identity(capital: &MarginAccountV3, market: &MarketV3) -> Result<()> {
    require!(
        capital.schema_version == 3
            && capital.venue == market.venue
            && capital.mode == MODE_ISOLATED
            && capital.role == ROLE_MAKER
            && capital.isolated_market_index == market.index,
        ClearingError::MakerCapital
    );
    Ok(())
}

pub(crate) fn config_and_price(
    config: &AccountInfo,
    price: &AccountInfo,
    program: Pubkey,
    instance: u8,
    venue: &Account<VenueV3>,
    market: &Account<MarketV3>,
    capital: &Account<MarginAccountV3>,
) -> Result<(CurveStateV4, PriceStateV4)> {
    require!(
        (program == MAKER_A || program == MAKER_B)
            && instance < 3
            && *config.owner == program
            && *price.owner == program
            && !config.executable
            && !price.executable
            && !price.is_writable,
        ClearingError::MakerBinding
    );
    let (config_key, config_bump) =
        Pubkey::find_program_address(&[b"curve-v4", capital.key().as_ref()], &program);
    let (price_key, price_bump) =
        Pubkey::find_program_address(&[b"price-v4", config_key.as_ref()], &program);
    require_keys_eq!(*config.key, config_key, ClearingError::MakerBinding);
    require_keys_eq!(*price.key, price_key, ClearingError::MakerBinding);
    let config_bytes = config.try_borrow_data()?;
    let price_bytes = price.try_borrow_data()?;
    require!(
        config_bytes.len() == 691
            && price_bytes.len() == 83
            && config_bytes[..8] == hash(b"account:MakerCurveV4").to_bytes()[..8]
            && price_bytes[..8] == hash(b"account:MakerPriceV4").to_bytes()[..8],
        ClearingError::MakerBinding
    );
    let curve = CurveStateV4::try_from_slice(&config_bytes[8..])
        .map_err(|_| error!(ClearingError::MakerBinding))?;
    let publication = PriceStateV4::try_from_slice(&price_bytes[8..])
        .map_err(|_| error!(ClearingError::MakerBinding))?;
    let controller = Pubkey::find_program_address(
        &[
            b"liquidity-control-v4",
            venue.key().as_ref(),
            capital.key().as_ref(),
        ],
        &crate::ID,
    )
    .0;
    require!(
        curve.schema_version == 4
            && curve.venue == venue.key()
            && curve.market == market.key()
            && curve.capital == capital.key()
            && curve.owner == capital.owner
            && curve.controller == controller
            && curve.domain == venue.domain
            && curve.instance == instance
            && curve.capability == canonical::CAPABILITY
            && curve.control_epoch > 0
            && curve.shape_epoch > 0
            && curve.bump == config_bump
            && publication.schema_version == 4
            && publication.config == config_key
            && publication.bump == price_bump
            && publication.control_epoch > 0
            && publication.control_epoch <= curve.control_epoch,
        ClearingError::MakerBinding
    );
    curve
        .shape
        .validate()
        .map_err(|_| error!(ClearingError::MakerBinding))?;
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
    accounts: &ControlLiquidityV4,
    authority: u64,
    check_hash: bool,
) -> Result<CurveStateV4> {
    custody_only(
        &accounts.venue,
        &accounts.custody,
        &accounts.safety,
        &accounts.market,
    )?;
    capital_identity(&accounts.capital, &accounts.market)?;
    require!(
        accounts.registration.schema_version == 4
            && accounts.registration.authority_epoch == authority
            && authority > 0
            && accounts.registration.depth_epoch > 0
            && accounts.registration.owner == accounts.capital.owner,
        ClearingError::MakerBinding
    );
    let (config, _) = config_and_price(
        &accounts.config,
        &accounts.price,
        accounts.pricing_program.key(),
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
