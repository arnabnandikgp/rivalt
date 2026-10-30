//! Canonical pricing authentication shared by routes and complete funding samples.
//! CPI receives only the fixed read-only config and price, never capital or vault.
use super::*;
use anchor_lang::solana_program::program::{get_return_data, invoke};
use maker_interface::canonical::{MakerQuoteRequest, MakerQuoteResponse};

/// Full code authentication is shared across instances of the same executable in
/// this instruction only. Every registration still compares its own approved hash.
#[derive(Default)]
pub(crate) struct CodeApprovalCache {
    entries: [Option<(Pubkey, Pubkey, [u8; 32])>; 2],
}

impl CodeApprovalCache {
    fn check(
        &mut self,
        program: Pubkey,
        data: &Account<ProgramData>,
        approved: [u8; 32],
    ) -> Result<()> {
        let digest = if let Some((_, _, digest)) =
            self.entries
                .iter()
                .flatten()
                .find(|(existing_program, existing_data, _)| {
                    *existing_program == program && *existing_data == data.key()
                }) {
            *digest
        } else {
            let digest = module_hash(data)?;
            let empty = self
                .entries
                .iter_mut()
                .find(|entry| entry.is_none())
                .ok_or(ClearingError::MakerBinding)?;
            *empty = Some((program, data.key(), digest));
            digest
        };
        require!(digest == approved, ClearingError::MakerUpgrade);
        Ok(())
    }
}

pub(crate) fn sealed_registry(
    registry: &Account<LiquidityRegistry>,
    venue: Pubkey,
    market: Pubkey,
) -> Result<()> {
    require!(
        registry.schema_version == 6
            && registry.venue == venue
            && registry.market == market
            && registry.sealed
            && registry.count == 3
            && registry
                .registrations
                .iter()
                .enumerate()
                .all(|(index, key)| *key != Pubkey::default()
                    && !registry.registrations[..index].contains(key)),
        ClearingError::MakerBinding
    );
    require_keys_eq!(
        registry.key(),
        Pubkey::create_program_address(
            &[b"liquidity-v4", market.as_ref(), &[registry.bump]],
            &crate::ID
        )
        .map_err(|_| error!(ClearingError::MakerBinding))?,
        ClearingError::MakerBinding
    );
    Ok(())
}

pub(crate) struct View<'account, 'info> {
    pub capital: &'account Account<'info, MarginAccount>,
    pub registration: &'account Account<'info, MakerRegistration>,
    pub program: &'account Program<'info>,
    pub data: &'account Account<'info, ProgramData>,
    pub config: &'account UncheckedAccount<'info>,
    pub price: &'account UncheckedAccount<'info>,
}

pub(crate) struct AuthenticatedCurve {
    pub config: CurveState,
    pub price: PriceState,
}

impl<'account, 'info> View<'account, 'info> {
    /// Wrong caller-selected identities reject the transaction; an unavailable
    /// authentic maker may instead produce an unqualified funding observation.
    pub(crate) fn bind(
        &self,
        venue: &Account<Venue>,
        market: &Account<Market>,
        registry: &Account<LiquidityRegistry>,
    ) -> Result<()> {
        sealed_registry(registry, venue.key(), market.key())?;
        capital_identity(self.capital, market)?;
        // Identity and quote inventory are needed for D74 funding. Financial
        // admission belongs to execution, not publication authentication.
        let registration = self.registration;
        require!(
            registration.schema_version == 6
                && registration.venue == venue.key()
                && registration.market == market.key()
                && registration.instance < 3
                && registry.registrations[usize::from(registration.instance)] == registration.key()
                && registration.capital == self.capital.key()
                && registration.owner == self.capital.owner
                && registration.pricing_program == self.program.key()
                && registration.program_data == self.data.key()
                && registration.config == self.config.key()
                && registration.price == self.price.key()
                && self.program.programdata_address()? == Some(self.data.key())
                && registration.authority_epoch > 0
                && registration.depth_epoch > 0
                && registration.buy_consumed <= canonical::MAX_DEPTH
                && registration.sell_consumed <= canonical::MAX_DEPTH
                && !self.config.is_writable
                && !self.price.is_writable,
            ClearingError::MakerBinding
        );
        require_keys_eq!(
            registration.key(),
            Pubkey::create_program_address(
                &[
                    b"maker-v4",
                    market.key().as_ref(),
                    &[registration.instance],
                    &[registration.bump]
                ],
                &crate::ID
            )
            .map_err(|_| error!(ClearingError::MakerBinding))?,
            ClearingError::MakerBinding
        );
        require_keys_eq!(
            self.capital.key(),
            Pubkey::create_program_address(
                &[
                    b"margin-v3",
                    self.capital.portfolio.as_ref(),
                    &self.capital.subaccount_index.to_le_bytes(),
                    &[self.capital.bump]
                ],
                &crate::ID
            )
            .map_err(|_| error!(ClearingError::MakerBinding))?,
            ClearingError::MakerBinding
        );
        Ok(())
    }

    #[inline(never)]
    pub(crate) fn authenticate(
        &self,
        venue: &Account<Venue>,
        market: &Account<Market>,
        registry: &Account<LiquidityRegistry>,
        cache: &mut CodeApprovalCache,
    ) -> Result<AuthenticatedCurve> {
        self.bind(venue, market, registry)?;
        require!(!self.registration.quarantined, ClearingError::MakerBinding);
        let (config, price) = config_and_price(
            self.config,
            self.price,
            self.program.key(),
            self.registration.instance,
            venue,
            market,
            self.capital,
        )?;
        cache.check(
            self.program.key(),
            self.data,
            self.registration.approved_hash,
        )?;
        Ok(AuthenticatedCurve { config, price })
    }

    pub(crate) fn request(
        &self,
        venue: &Account<Venue>,
        market: &Account<Market>,
        state: &AuthenticatedCurve,
        side: u8,
        lots: u64,
    ) -> MakerQuoteRequest {
        MakerQuoteRequest {
            version: canonical::VERSION,
            domain: venue.domain,
            market: market.key(),
            capital: self.capital.key(),
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
        let expected = canonical::quote(
            self.config.key(),
            &state.config,
            &state.price,
            request,
            clock.slot,
            clock.unix_timestamp,
        )
        .map_err(|_| error!(ClearingError::MakerQuote))?;
        let mut bytes = Vec::with_capacity(8 + canonical::REQUEST_BYTES);
        bytes.extend_from_slice(&hash(b"global:quote_v4").to_bytes()[..8]);
        request.serialize(&mut bytes)?;
        invoke(
            &Instruction {
                program_id: self.program.key(),
                accounts: vec![
                    AccountMeta::new_readonly(self.config.key(), false),
                    AccountMeta::new_readonly(self.price.key(), false),
                ],
                data: bytes,
            },
            &[
                self.config.to_account_info(),
                self.price.to_account_info(),
                self.program.to_account_info(),
            ],
        )?;
        let (producer, bytes) = get_return_data().ok_or(ClearingError::MakerResponse)?;
        canonical::validate_response(&expected, self.program.key(), producer, &bytes)
            .map_err(|_| error!(ClearingError::MakerResponse))?;
        Ok(expected)
    }
}
