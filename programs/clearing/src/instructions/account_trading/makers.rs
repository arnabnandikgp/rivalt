//! Account-bound maker admission and authenticated read-only CPI. Capital never crosses CPI.
use super::*;
use crate::constants::makers::{MAKER_A, MAKER_B};
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
};
use maker_interface::{
    AccountQuoteRequest, MakerState, QuoteRequest, QuoteResponse, ACCOUNT_VERSION,
};
use solana_sha256_hasher::hash;

#[event_cpi]
#[derive(Accounts)]
#[instruction(maker_id: u8)]
pub struct RegisterAccountMaker<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump, has_one = authority)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, has_one = venue, has_one = owner)]
    pub capital: Box<Account<'info, MarginAccountV3>>,
    #[account(init, payer = owner, space = 8 + MakerRegistrationV3::INIT_SPACE,
        seeds = [b"maker-v3", market.key().as_ref(), &[maker_id]], bump)]
    pub registration: Box<Account<'info, MakerRegistrationV3>>,
    #[account(init, payer = owner, space = 8 + CapitalBindingV3::INIT_SPACE,
        seeds = [b"capital-v3", capital.key().as_ref()], bump)]
    pub capital_binding: Account<'info, CapitalBindingV3>,
    pub pricing_program: Program<'info>,
    #[account(constraint = pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: strict owner/size/discriminator/PDA/identity decode below.
    pub config: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct UpdateAccountMaker<'info> {
    /// Both signers required only for code approval; sync is owner-only, quarantine authority-only.
    pub actor: Signer<'info>,
    pub co_signer: Option<Signer<'info>>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()], bump = capital.bump, has_one = venue)]
    pub capital: Box<Account<'info, MarginAccountV3>>,
    #[account(mut, seeds = [b"maker-v3", market.key().as_ref(), &[registration.maker_id]], bump = registration.bump,
        has_one = venue, has_one = market, has_one = capital, has_one = config, has_one = pricing_program, has_one = program_data)]
    pub registration: Box<Account<'info, MakerRegistrationV3>>,
    pub pricing_program: Program<'info>,
    #[account(constraint = pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: strict authenticated config decode below, not passed to any mutable CPI.
    pub config: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct PreviewAccountMaker<'info> {
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(seeds = [b"market-v3", venue.key().as_ref(), &[market.index]], bump = market.bump, has_one = venue)]
    pub market: Box<Account<'info, MarketV3>>,
    #[account(seeds = [b"margin-v3", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()], bump = capital.bump, has_one = venue)]
    pub capital: Box<Account<'info, MarginAccountV3>>,
    #[account(seeds = [b"maker-v3", market.key().as_ref(), &[registration.maker_id]], bump = registration.bump,
        has_one = venue, has_one = market, has_one = capital, has_one = config, has_one = pricing_program, has_one = program_data)]
    pub registration: Box<Account<'info, MakerRegistrationV3>>,
    pub pricing_program: Program<'info>,
    #[account(constraint = pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: authenticated read-only config.
    pub config: UncheckedAccount<'info>,
}

pub(crate) fn config_state(
    config: &AccountInfo,
    program: Pubkey,
    maker_id: u8,
    venue: &Account<VenueV3>,
    market: &Account<MarketV3>,
    capital: &Account<MarginAccountV3>,
) -> Result<MakerState> {
    require!(
        maker_id < 2 && program == if maker_id == 0 { MAKER_A } else { MAKER_B },
        ClearingError::MakerBinding
    );
    let (expected, bump) =
        Pubkey::find_program_address(&[b"maker-v3", capital.key().as_ref()], &program);
    require!(
        config.key == &expected
            && config.owner == &program
            && !config.is_writable
            && !config.executable,
        ClearingError::MakerBinding
    );
    let bytes = config.try_borrow_data()?;
    require!(
        bytes.len() == 8 + 32 + MakerState::INIT_SPACE
            && bytes[..8] == hash(b"account:MakerAccountConfig").to_bytes()[..8]
            && bytes[8..40] == venue.key().to_bytes(),
        ClearingError::MakerBinding
    );
    let state = MakerState::try_from_slice(&bytes[40..])
        .map_err(|_| error!(ClearingError::MakerBinding))?;
    require!(
        state.version == ACCOUNT_VERSION
            && state.maker_id == maker_id
            && state.domain == venue.domain
            && state.market == market.key()
            && state.capital == capital.key()
            && state.owner == capital.owner
            && state.bump == bump
            && state.quote_epoch > 0
            && state
                .expiry_slot
                .checked_sub(state.start_slot)
                .is_some_and(|duration| (maker_interface::MIN_EPOCH_SLOTS
                    ..=maker_interface::MAX_EPOCH_SLOTS)
                    .contains(&duration)),
        ClearingError::MakerBinding
    );
    Ok(state)
}

pub(crate) fn module_hash(data: &Account<ProgramData>) -> Result<[u8; 32]> {
    let info = data.to_account_info();
    let bytes = info.try_borrow_data()?;
    require!(bytes.len() <= 1_048_576, ClearingError::MakerBinding);
    Ok(hash(&bytes).to_bytes())
}

fn capital_ready(capital: &MarginAccountV3, market: &MarketV3) -> Result<()> {
    market_view(market)?;
    book::validate(&*root_view(capital)?)?;
    require!(
        capital.role == ROLE_MAKER
            && capital.isolated_market_index == market.index
            && capital.venue == market.venue
            && capital.cash > 0,
        ClearingError::MakerCapital
    );
    Ok(())
}

fn event(
    venue: &Account<VenueV3>,
    custody: &mut Account<CustodyV3>,
    safety: &SafetyV3,
    market: &mut Account<MarketV3>,
    registration: &Account<MakerRegistrationV3>,
    operation: u8,
) -> Result<crate::events::AccountMakerChangedV3> {
    let clock = Clock::get()?;
    let mut view = market_view(market)?;
    shared_oracle::materialize(if safety.mode == ACTIVE { 2 } else { 0 }, &mut view, &clock)?;
    commit_market(market, &view)?;
    increment(&mut custody.sequence)?;
    increment(&mut market.config_epoch)?;
    Ok(crate::events::AccountMakerChangedV3 {
        venue: venue.key(),
        market: market.key(),
        sequence: custody.sequence,
        slot: clock.slot,
        market_state: crate::events::MarketSnapshotV3::from(&**market),
        registration: registration.key(),
        state: crate::events::MakerRegistrationSnapshotV3::from(&**registration),
        operation,
    })
}

pub fn register(
    ctx: Context<RegisterAccountMaker>,
    maker_id: u8,
    inventory_limit: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    profile(&accounts.venue, &accounts.custody, &accounts.safety)?;
    capital_ready(&accounts.capital, &accounts.market)?;
    require!(
        (1..=math::MAX_LOTS as u64).contains(&inventory_limit),
        ClearingError::MakerCapital
    );
    let state = config_state(
        &accounts.config,
        accounts.pricing_program.key(),
        maker_id,
        &accounts.venue,
        &accounts.market,
        &accounts.capital,
    )?;
    let slot = Clock::get()?.slot;
    require!(
        slot >= state.start_slot && slot < state.expiry_slot,
        ClearingError::MakerEpoch
    );
    accounts.registration.set_inner(MakerRegistrationV3 {
        schema_version: SCHEMA_VERSION,
        venue: accounts.venue.key(),
        market: accounts.market.key(),
        market_index: accounts.market.index,
        maker_id,
        capital: accounts.capital.key(),
        owner: accounts.owner.key(),
        pricing_program: accounts.pricing_program.key(),
        program_data: accounts.program_data.key(),
        config: accounts.config.key(),
        approved_hash: module_hash(&accounts.program_data)?,
        authority_epoch: 1,
        quote_epoch: state.quote_epoch,
        start_slot: state.start_slot,
        expiry_slot: state.expiry_slot,
        inventory_limit,
        buy_consumed: 0,
        sell_consumed: 0,
        quarantined: false,
        bump: ctx.bumps.registration,
    });
    accounts.capital_binding.set_inner(CapitalBindingV3 {
        schema_version: SCHEMA_VERSION,
        venue: accounts.venue.key(),
        capital: accounts.capital.key(),
        registration: accounts.registration.key(),
    });
    let emitted = event(
        &accounts.venue,
        &mut accounts.custody,
        &accounts.safety,
        &mut accounts.market,
        &accounts.registration,
        0,
    )?;
    emit_cpi!(emitted);
    Ok(())
}

/// operation: 0 joint code approval, 1 owner epoch sync, 2 authority quarantine.
pub fn update(ctx: Context<UpdateAccountMaker>, operation: u8) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    profile(&accounts.venue, &accounts.custody, &accounts.safety)?;
    require!(
        accounts.registration.owner == accounts.capital.owner
            && accounts.registration.market_index == accounts.market.index,
        ClearingError::MakerBinding
    );
    if operation == 2 {
        require!(
            accounts.actor.key() == accounts.venue.authority && accounts.co_signer.is_none(),
            ClearingError::Authority
        );
        accounts.registration.quarantined = true;
        accounts.registration.authority_epoch = accounts
            .registration
            .authority_epoch
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?;
    } else {
        require!(
            accounts.actor.key() == accounts.capital.owner,
            ClearingError::Authority
        );
        capital_ready(&accounts.capital, &accounts.market)?;
        let state = config_state(
            &accounts.config,
            accounts.pricing_program.key(),
            accounts.registration.maker_id,
            &accounts.venue,
            &accounts.market,
            &accounts.capital,
        )?;
        let registration = &mut accounts.registration;
        if operation == 0 {
            require!(
                accounts
                    .co_signer
                    .as_ref()
                    .is_some_and(|signer| signer.key() == accounts.venue.authority)
                    && state.quote_epoch >= registration.quote_epoch,
                ClearingError::Authority
            );
            registration.approved_hash = module_hash(&accounts.program_data)?;
            registration.authority_epoch = registration
                .authority_epoch
                .checked_add(1)
                .ok_or(ClearingError::Arithmetic)?;
            registration.quarantined = false;
        } else {
            require!(
                operation == 1 && accounts.co_signer.is_none() && !registration.quarantined,
                ClearingError::MakerEpoch
            );
            require!(
                module_hash(&accounts.program_data)? == registration.approved_hash,
                ClearingError::MakerUpgrade
            );
            let slot = Clock::get()?.slot;
            require!(
                state.quote_epoch > registration.quote_epoch
                    && state.start_slot >= registration.expiry_slot
                    && slot >= state.start_slot
                    && slot < state.expiry_slot,
                ClearingError::MakerEpoch
            );
            registration.quote_epoch = state.quote_epoch;
            registration.start_slot = state.start_slot;
            registration.expiry_slot = state.expiry_slot;
            registration.buy_consumed = 0;
            registration.sell_consumed = 0;
        }
    }
    let emitted = event(
        &accounts.venue,
        &mut accounts.custody,
        &accounts.safety,
        &mut accounts.market,
        &accounts.registration,
        operation + 1,
    )?;
    emit_cpi!(emitted);
    Ok(())
}

pub(crate) struct View<'a, 'info> {
    pub capital: &'a Account<'info, MarginAccountV3>,
    pub registration: &'a Account<'info, MakerRegistrationV3>,
    pub program: &'a Program<'info>,
    pub data: &'a Account<'info, ProgramData>,
    pub config: &'a UncheckedAccount<'info>,
}

impl<'a, 'info> View<'a, 'info> {
    pub(crate) fn authenticate(
        &self,
        venue: &Account<VenueV3>,
        market: &Account<MarketV3>,
    ) -> Result<MakerState> {
        let registration = self.registration;
        capital_ready(self.capital, market)?;
        require!(
            registration.schema_version == SCHEMA_VERSION
                && registration.venue == venue.key()
                && registration.market == market.key()
                && registration.market_index == market.index
                && registration.capital == self.capital.key()
                && registration.owner == self.capital.owner
                && registration.pricing_program == self.program.key()
                && registration.program_data == self.data.key()
                && registration.config == self.config.key()
                && self.program.programdata_address()? == Some(self.data.key())
                && !registration.quarantined
                && registration.authority_epoch > 0,
            ClearingError::MakerBinding
        );
        require_keys_eq!(
            self.registration.key(),
            Pubkey::create_program_address(
                &[
                    b"maker-v3",
                    market.key().as_ref(),
                    &[registration.maker_id],
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
        require!(
            module_hash(self.data)? == registration.approved_hash,
            ClearingError::MakerUpgrade
        );
        let state = config_state(
            self.config,
            self.program.key(),
            registration.maker_id,
            venue,
            market,
            self.capital,
        )?;
        require!(
            state.quote_epoch == registration.quote_epoch
                && state.start_slot == registration.start_slot
                && state.expiry_slot == registration.expiry_slot,
            ClearingError::MakerEpoch
        );
        Ok(state)
    }

    pub(crate) fn request(
        &self,
        venue: &Account<VenueV3>,
        market: &Account<MarketV3>,
        side: u8,
        lots: u64,
        reference: u64,
        slot: u64,
    ) -> AccountQuoteRequest {
        let registration = self.registration;
        AccountQuoteRequest {
            venue: venue.key(),
            quote: QuoteRequest {
                version: ACCOUNT_VERSION,
                domain: venue.domain,
                market: market.key(),
                capital: self.capital.key(),
                quote_epoch: registration.quote_epoch,
                authority_epoch: registration.authority_epoch,
                terms_epoch: market.terms_epoch,
                market_config_epoch: market.config_epoch,
                side,
                lots,
                inventory: self.capital.positions[usize::from(market.index)].lots,
                cash: self.capital.cash,
                inventory_limit: registration.inventory_limit,
                consumed: if side == 0 {
                    registration.buy_consumed
                } else {
                    registration.sell_consumed
                },
                reference_price: reference,
                slot,
            },
        }
    }

    pub(crate) fn quote(
        &self,
        state: &MakerState,
        request: &AccountQuoteRequest,
    ) -> Result<QuoteResponse> {
        let expected = maker_interface::account_quote(request.venue, state, request)
            .map_err(|_| error!(ClearingError::MakerQuote))?;
        let mut bytes = hash(b"global:quote_account").to_bytes()[..8].to_vec();
        request.serialize(&mut bytes)?;
        invoke(
            &Instruction {
                program_id: self.program.key(),
                accounts: vec![AccountMeta::new_readonly(self.config.key(), false)],
                data: bytes,
            },
            &[
                self.config.to_account_info(),
                self.program.to_account_info(),
            ],
        )?;
        let (producer, bytes) = get_return_data().ok_or(ClearingError::MakerResponse)?;
        maker_interface::validate_response(&self.program.key(), &producer, &bytes, &expected)
            .map_err(|_| error!(ClearingError::MakerResponse))
    }
}

pub fn preview(
    ctx: Context<PreviewAccountMaker>,
    args: crate::instructions::PreviewArgs,
) -> Result<QuoteResponse> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    profile(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    let accounts = &ctx.accounts;
    let view = View {
        capital: &accounts.capital,
        registration: &accounts.registration,
        program: &accounts.pricing_program,
        data: &accounts.program_data,
        config: &accounts.config,
    };
    let state = view.authenticate(&accounts.venue, &accounts.market)?;
    require!(
        args.quote_epoch == state.quote_epoch
            && args.authority_epoch == accounts.registration.authority_epoch
            && args.terms_epoch == accounts.market.terms_epoch
            && args.config_epoch == accounts.market.config_epoch,
        ClearingError::MakerEpoch
    );
    let request = view.request(
        &accounts.venue,
        &accounts.market,
        args.side,
        args.lots,
        args.reference_price,
        Clock::get()?.slot,
    );
    view.quote(&state, &request)
}
