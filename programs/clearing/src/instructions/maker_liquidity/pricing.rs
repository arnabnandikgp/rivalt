//! Canonical pricing authentication shared by routes and complete funding samples.
//! CPI receives only the fixed read-only config and price, never capital or vault.
use super::*;
use crate::{ProgramData, UpgradeableProgramAddress};
use anchor_lang::solana_program::program::{get_return_data, invoke};
use maker_interface::canonical::{MakerQuoteRequest, MakerQuoteResponse};

/// Full code authentication is shared across instances of the same executable in
/// this instruction only. Every registration still compares its own approved hash.
#[derive(Default)]
pub(crate) struct CodeApprovalCache {
    entries: Vec<(Address, Address, [u8; 32])>,
}

impl CodeApprovalCache {
    fn check(
        &mut self,
        program: Address,
        data: &BorshAccount<ProgramData>,
        approved: [u8; 32],
    ) -> Result<()> {
        self.check_digest(program, *data.address(), approved, || module_hash(data))
    }

    fn check_digest(
        &mut self,
        program: Address,
        data: Address,
        approved: [u8; 32],
        hash: impl FnOnce() -> Result<[u8; 32]>,
    ) -> Result<()> {
        let digest = match self.entries.iter().find(|(key, account, _)| *key == program && *account == data) {
            Some((_, _, digest)) => *digest,
            None => {
                let digest = hash()?;
                self.entries.push((program, data, digest));
                digest
            }
        };
        require!(digest == approved, ClearingError::MakerUpgrade);
        Ok(())
    }
}

#[cfg(test)]
mod cache_tests {
    use super::*;

    #[test]
    fn each_distinct_executable_is_hashed_once_and_every_approval_is_checked() {
        let mut cache = CodeApprovalCache::default();
        for id in 1..=8 {
            let program = Address::new_from_array([id; 32]);
            let data = Address::new_from_array([id + 8; 32]);
            cache.check_digest(program, data, [id; 32], || Ok([id; 32])).unwrap();
        }
        for &(program, data, digest) in &cache.entries.clone() {
            cache.check_digest(program, data, digest, || panic!("cached executable")).unwrap();
            assert!(cache.check_digest(program, data, [0; 32], || panic!("cached executable")).is_err());
        }
    }
}

pub(crate) fn sealed_registry(
    registry: &BorshAccount<LiquidityRegistry>,
    venue: Address,
    market: Address,
) -> Result<()> {
    require!(
        registry.schema_version == crate::state::accounts::SCHEMA_VERSION
            && registry.venue == venue
            && registry.market == market
            && registry.sealed
            && (3..=canonical::REGISTRATION_LIMIT).contains(&registry.count)
            && registry
                .registrations
                .iter()
                .enumerate()
                .all(|(index, key)| *key != Address::default()
                    && !registry.registrations[..index].contains(key)),
        ClearingError::MakerBinding
    );
    require_keys_eq!(
        registry.address().to_owned(),
        create_program_address(
            &[b"liquidity-v4", market.as_ref(), &[registry.bump]],
            &crate::ID
        )
        .map_err(|_| ProgramError::from(ClearingError::MakerBinding))?,
        ClearingError::MakerBinding
    );
    Ok(())
}

pub(crate) struct View<'account> {
    pub capital: &'account BorshAccount<MarginAccount>,
    pub registration: &'account BorshAccount<MakerRegistration>,
    pub program: &'account UncheckedAccount,
    pub data: &'account BorshAccount<ProgramData>,
    pub config: &'account UncheckedAccount,
    pub price: &'account UncheckedAccount,
}

pub(crate) struct AuthenticatedCurve {
    pub config: CurveState,
    pub price: PriceState,
}

impl<'account> View<'account> {
    /// Wrong caller-selected identities reject the transaction; an unavailable
    /// authentic maker may instead produce an unqualified funding observation.
    pub(crate) fn bind(
        &self,
        venue: &BorshAccount<Venue>,
        market: &BorshAccount<Market>,
        registry: &BorshAccount<LiquidityRegistry>,
    ) -> Result<()> {
        capital_identity(self.capital, market)?;
        self.registration_identity(venue, *market.address(), registry)
    }

    fn registration_identity(
        &self,
        venue: &BorshAccount<Venue>,
        market: Address,
        registry: &BorshAccount<LiquidityRegistry>,
    ) -> Result<()> {
        sealed_registry(registry, *venue.address(), market)?;
        // Identity and quote inventory are needed for D74 funding. Financial
        // admission belongs to execution, not publication authentication.
        let registration = self.registration;
        require!(
            registration.schema_version == crate::state::accounts::SCHEMA_VERSION
                && registration.venue == venue.address().to_owned()
                && registration.market == market
                && registration.instance < registry.count
                && registry
                    .registrations
                    .get(usize::from(registration.instance))
                    .is_none_or(|stored| stored == registration.address())
                && registration.capital == self.capital.address().to_owned()
                && registration.owner == self.capital.owner
                && registration.pricing_program == self.program.address().to_owned()
                && registration.program_data == self.data.address().to_owned()
                && registration.config == self.config.address().to_owned()
                && registration.price == self.price.address().to_owned()
                && self.program.programdata_address()? == Some(self.data.address().to_owned())
                && registration.authority_epoch > 0
                && registration.depth_epoch > 0
                && registration.buy_consumed <= canonical::MAX_DEPTH
                && registration.sell_consumed <= canonical::MAX_DEPTH
                && !self.config.is_writable()
                && !self.price.is_writable(),
            ClearingError::MakerBinding
        );
        require_keys_eq!(
            registration.address().to_owned(),
            create_program_address(
                &[
                    b"maker-v4",
                    market.as_ref(),
                    &[registration.instance],
                    &[registration.bump]
                ],
                &crate::ID
            )
            .map_err(|_| ProgramError::from(ClearingError::MakerBinding))?,
            ClearingError::MakerBinding
        );
        require_keys_eq!(
            self.capital.address().to_owned(),
            create_program_address(
                &[
                    b"margin-v3",
                    self.capital.portfolio.as_ref(),
                    &self.capital.subaccount_index.to_le_bytes(),
                    &[self.capital.bump]
                ],
                &crate::ID
            )
            .map_err(|_| ProgramError::from(ClearingError::MakerBinding))?,
            ClearingError::MakerBinding
        );
        Ok(())
    }

    #[inline(never)]
    pub(crate) fn authenticate(
        &self,
        venue: &BorshAccount<Venue>,
        market: &BorshAccount<Market>,
        registry: &BorshAccount<LiquidityRegistry>,
        cache: &mut CodeApprovalCache,
    ) -> Result<AuthenticatedCurve> {
        profile_cu!("maker-auth-enter");
        self.bind(venue, market, registry)?;
        self.read_approved_curve(venue, *market.address(), cache)
    }

    #[cfg(feature = "listed-margin-storage")]
    pub(super) fn bind_listing(
        &self,
        venue: &BorshAccount<Venue>,
        listing: &BorshAccount<MarketListing>,
        registry: &BorshAccount<LiquidityRegistry>,
    ) -> Result<()> {
        require!(
            listing.schema_version == LISTING_SCHEMA
                && listing.venue == *venue.address()
                && listing.quote_mint == venue.quote_mint
                && usize::from(listing.market_id) >= MARKET_COUNT
                && listing.status == LISTING_QUALIFICATION,
            ClearingError::MakerBinding
        );
        require!(
            self.capital.schema_version == SCHEMA_VERSION
                && self.capital.venue == *venue.address()
                && self.capital.mode == MODE_ISOLATED
                && self.capital.role == ROLE_MAKER
                && self.capital.isolated_market_index == LISTED_CAPITAL_TAG,
            ClearingError::MakerCapital
        );
        self.registration_identity(venue, *listing.address(), registry)
    }

    #[inline(never)]
    pub(super) fn read_approved_curve(
        &self,
        venue: &BorshAccount<Venue>,
        market: Address,
        cache: &mut CodeApprovalCache,
    ) -> Result<AuthenticatedCurve> {
        require!(!self.registration.quarantined, ClearingError::MakerBinding);
        let (config, price) = config_and_price(
            self.config,
            self.price,
            self.program.address().to_owned(),
            self.registration.instance,
            venue,
            market,
            self.capital,
        )?;
        cache.check(
            self.program.address().to_owned(),
            self.data,
            self.registration.approved_hash,
        )?;
        profile_cu!("maker-auth-exit");
        Ok(AuthenticatedCurve { config, price })
    }

    pub(crate) fn request(
        &self,
        venue: &BorshAccount<Venue>,
        market: &BorshAccount<Market>,
        state: &AuthenticatedCurve,
        side: u8,
        lots: u64,
    ) -> MakerQuoteRequest {
        self.inventory_request(
            venue,
            *market.address(),
            self.capital.positions[usize::from(market.index)].lots,
            state,
            side,
            lots,
        )
    }

    pub(crate) fn inventory_request(
        &self,
        venue: &BorshAccount<Venue>,
        market: Address,
        inventory: i64,
        state: &AuthenticatedCurve,
        side: u8,
        lots: u64,
    ) -> MakerQuoteRequest {
        MakerQuoteRequest {
            version: canonical::VERSION,
            domain: venue.domain,
            market,
            capital: self.capital.address().to_owned(),
            instance: self.registration.instance,
            authority_epoch: self.registration.authority_epoch,
            control_epoch: state.config.control_epoch,
            shape_epoch: state.config.shape_epoch,
            depth_epoch: self.registration.depth_epoch,
            side,
            lots,
            inventory,
            consumed: if side == 0 {
                self.registration.buy_consumed
            } else {
                self.registration.sell_consumed
            },
        }
    }

    pub(crate) fn quote(
        &self,
        state: &AuthenticatedCurve,
        request: &MakerQuoteRequest,
        clock: &Clock,
    ) -> Result<MakerQuoteResponse> {
        profile_cu!("canonical-quote-enter");
        let expected = canonical::quote(
            self.config.address().to_owned(),
            &state.config,
            &state.price,
            request,
            clock.slot,
            clock.unix_timestamp,
        )
        .map_err(|_| ProgramError::from(ClearingError::MakerQuote))?;
        profile_cu!("canonical-quote-exit");
        let mut bytes = Vec::with_capacity(8 + canonical::REQUEST_BYTES);
        bytes.extend_from_slice(&hash(b"global:quote_curve").to_bytes()[..8]);
        crate::wire::write(request, &mut bytes)?;
        profile_cu!("maker-cpi-enter");
        invoke(
            &Instruction {
                program_id: self.program.address().to_owned(),
                accounts: vec![
                    AccountMeta::new_readonly(self.config.address().to_owned(), false),
                    AccountMeta::new_readonly(self.price.address().to_owned(), false),
                ],
                data: bytes,
            },
            &[
                self.config.to_cpi_handle(),
                self.price.to_cpi_handle(),
                self.program.to_cpi_handle(),
            ],
        )?;
        profile_cu!("maker-cpi-exit");
        let (producer, bytes) = get_return_data().ok_or(ClearingError::MakerResponse)?;
        canonical::validate_response(
            &expected,
            self.program.address().to_owned(),
            producer,
            &bytes,
        )
        .map_err(|_| ProgramError::from(ClearingError::MakerResponse))?;
        profile_cu!("maker-response-validated");
        Ok(expected)
    }
}
