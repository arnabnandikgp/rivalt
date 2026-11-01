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
    entries: [Option<(Address, Address, [u8; 32])>; 2],
}

impl CodeApprovalCache {
    fn check(
        &mut self,
        program: Address,
        data: &BorshAccount<ProgramData>,
        approved: [u8; 32],
    ) -> Result<()> {
        let digest = if let Some((_, _, digest)) =
            self.entries
                .iter()
                .flatten()
                .find(|(existing_program, existing_data, _)| {
                    *existing_program == program && *existing_data == data.address().to_owned()
                }) {
            *digest
        } else {
            let digest = module_hash(data)?;
            let empty = self
                .entries
                .iter_mut()
                .find(|entry| entry.is_none())
                .ok_or(ClearingError::MakerBinding)?;
            *empty = Some((program, data.address().to_owned(), digest));
            digest
        };
        require!(digest == approved, ClearingError::MakerUpgrade);
        Ok(())
    }
}

pub(crate) fn sealed_registry(
    registry: &BorshAccount<LiquidityRegistry>,
    venue: Address,
    market: Address,
) -> Result<()> {
    require!(
        registry.schema_version == 8
            && registry.venue == venue
            && registry.market == market
            && registry.sealed
            && registry.count == 3
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
        sealed_registry(
            registry,
            venue.address().to_owned(),
            market.address().to_owned(),
        )?;
        capital_identity(self.capital, market)?;
        // Identity and quote inventory are needed for D74 funding. Financial
        // admission belongs to execution, not publication authentication.
        let registration = self.registration;
        require!(
            registration.schema_version == 8
                && registration.venue == venue.address().to_owned()
                && registration.market == market.address().to_owned()
                && registration.instance < 3
                && registry.registrations[usize::from(registration.instance)]
                    == registration.address().to_owned()
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
                    market.address().as_ref(),
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
        MakerQuoteRequest {
            version: canonical::VERSION,
            domain: venue.domain,
            market: market.address().to_owned(),
            capital: self.capital.address().to_owned(),
            instance: self.registration.instance,
            authority_epoch: self.registration.authority_epoch,
            control_epoch: state.config.control_epoch,
            shape_epoch: state.config.shape_epoch,
            depth_epoch: self.registration.depth_epoch,
            side,
            lots,
            inventory: self.capital.positions[usize::from(market.index)].lots,
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
