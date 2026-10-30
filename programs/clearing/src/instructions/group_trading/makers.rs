//! Group-bound maker admission and authenticated read-only CPI. Capital never crosses CPI.
use super::*;
use crate::constants::makers::{MAKER_A, MAKER_B};
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
};
use maker_interface::{GroupQuoteRequest, MakerState, QuoteRequest, QuoteResponse, GROUP_VERSION};
use solana_sha256_hasher::hash;

#[event_cpi]
#[derive(Accounts)]
#[instruction(maker_id: u8)]
pub struct RegisterGroupMaker<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", &group.domain], bump = group.bump, has_one = authority)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[market.index]], bump = market.bump, has_one = group)]
    pub market: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"margin-v2", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()],
        bump = capital.bump, has_one = group, has_one = owner)]
    pub capital: Box<Account<'info, MarginAccountV2>>,
    #[account(init, payer = owner, space = 8 + MakerRegistrationV2::INIT_SPACE,
        seeds = [b"registration-v2", market.key().as_ref(), &[maker_id]], bump)]
    pub registration: Box<Account<'info, MakerRegistrationV2>>,
    #[account(init, payer = owner, space = 8 + CapitalBindingV2::INIT_SPACE,
        seeds = [b"binding-v2", group.key().as_ref(), capital.key().as_ref()], bump)]
    pub group_binding: Account<'info, CapitalBindingV2>,
    pub pricing_program: Program<'info>,
    #[account(constraint = pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: strict owner/size/discriminator/PDA/identity decode below.
    pub config: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct UpdateGroupMaker<'info> {
    /// Both signers required only for code approval; sync is owner-only, quarantine authority-only.
    pub actor: Signer<'info>,
    pub co_signer: Option<Signer<'info>>,
    #[account(mut, seeds = [b"group-v2", &group.domain], bump = group.bump)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[market.index]], bump = market.bump, has_one = group)]
    pub market: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"margin-v2", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()], bump = capital.bump, has_one = group)]
    pub capital: Box<Account<'info, MarginAccountV2>>,
    #[account(mut, seeds = [b"registration-v2", market.key().as_ref(), &[registration.maker_id]], bump = registration.bump,
        has_one = group, has_one = market, has_one = capital, has_one = config, has_one = pricing_program, has_one = program_data)]
    pub registration: Box<Account<'info, MakerRegistrationV2>>,
    pub pricing_program: Program<'info>,
    #[account(constraint = pricing_program.programdata_address()? == Some(program_data.key()) @ ClearingError::MakerBinding)]
    pub program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: strict authenticated config decode below, not passed to any mutable CPI.
    pub config: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct PreviewGroupMaker<'info> {
    #[account(seeds = [b"group-v2", &group.domain], bump = group.bump)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(seeds = [b"market-v2", group.key().as_ref(), &[market.index]], bump = market.bump, has_one = group)]
    pub market: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"margin-v2", capital.portfolio.as_ref(), &capital.subaccount_index.to_le_bytes()], bump = capital.bump, has_one = group)]
    pub capital: Box<Account<'info, MarginAccountV2>>,
    #[account(seeds = [b"registration-v2", market.key().as_ref(), &[registration.maker_id]], bump = registration.bump,
        has_one = group, has_one = market, has_one = capital, has_one = config, has_one = pricing_program, has_one = program_data)]
    pub registration: Box<Account<'info, MakerRegistrationV2>>,
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
    group: &Account<ClearingGroupV2>,
    market: &Account<GroupMarketV2>,
    capital: &Account<MarginAccountV2>,
) -> Result<MakerState> {
    require!(
        maker_id < 2 && program == if maker_id == 0 { MAKER_A } else { MAKER_B },
        ClearingError::MakerBinding
    );
    let (expected, bump) =
        Pubkey::find_program_address(&[b"maker-v2", capital.key().as_ref()], &program);
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
            && bytes[..8] == hash(b"account:MakerGroupConfig").to_bytes()[..8]
            && bytes[8..40] == group.key().to_bytes(),
        ClearingError::MakerBinding
    );
    let state = MakerState::try_from_slice(&bytes[40..])
        .map_err(|_| error!(ClearingError::MakerBinding))?;
    require!(
        state.version == GROUP_VERSION
            && state.maker_id == maker_id
            && state.domain == group.domain
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

fn capital_ready(capital: &MarginAccountV2, market: &GroupMarketV2) -> Result<()> {
    model(capital)?;
    book::validate(capital)?;
    require!(
        capital.role == ROLE_MAKER
            && capital.isolated_market_index == market.index
            && capital.group == market.group
            && capital.cash > 0,
        ClearingError::MakerCapital
    );
    Ok(())
}

fn event(
    group: &mut Account<ClearingGroupV2>,
    market: &mut Account<GroupMarketV2>,
    registration: &Account<MakerRegistrationV2>,
    operation: u8,
) -> Result<crate::events::GroupMakerChangedV2> {
    group.sequence = group
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    market.config_epoch = market
        .config_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    // Terms changed: future pending coverage is no longer authenticated. Materialized F stays fixed.
    Ok(crate::events::GroupMakerChangedV2 {
        group: group.key(),
        market: market.key(),
        sequence: group.sequence,
        slot: Clock::get()?.slot,
        config_epoch: market.config_epoch,
        registration: registration.key(),
        state: crate::events::LegacyMakerRegistrationSnapshotV2::from(&**registration),
        operation,
    })
}

pub fn register(
    ctx: Context<RegisterGroupMaker>,
    maker_id: u8,
    inventory_limit: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    profile(&accounts.group)?;
    capital_ready(&accounts.capital, &accounts.market)?;
    require!(
        (1..=math::MAX_LOTS as u64).contains(&inventory_limit),
        ClearingError::MakerCapital
    );
    let state = config_state(
        &accounts.config,
        accounts.pricing_program.key(),
        maker_id,
        &accounts.group,
        &accounts.market,
        &accounts.capital,
    )?;
    let slot = Clock::get()?.slot;
    require!(
        slot >= state.start_slot && slot < state.expiry_slot,
        ClearingError::MakerEpoch
    );
    accounts.registration.set_inner(MakerRegistrationV2 {
        schema_version: SCHEMA_VERSION,
        group: accounts.group.key(),
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
    accounts.group_binding.set_inner(CapitalBindingV2 {
        schema_version: SCHEMA_VERSION,
        group: accounts.group.key(),
        capital: accounts.capital.key(),
        registration: accounts.registration.key(),
    });
    let emitted = event(
        &mut accounts.group,
        &mut accounts.market,
        &accounts.registration,
        0,
    )?;
    emit_cpi!(emitted);
    Ok(())
}

/// operation: 0 joint code approval, 1 owner epoch sync, 2 authority quarantine.
pub fn update(ctx: Context<UpdateGroupMaker>, operation: u8) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    profile(&accounts.group)?;
    require!(
        accounts.registration.owner == accounts.capital.owner
            && accounts.registration.market_index == accounts.market.index,
        ClearingError::MakerBinding
    );
    if operation == 2 {
        require!(
            accounts.actor.key() == accounts.group.authority && accounts.co_signer.is_none(),
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
            &accounts.group,
            &accounts.market,
            &accounts.capital,
        )?;
        let registration = &mut accounts.registration;
        if operation == 0 {
            require!(
                accounts
                    .co_signer
                    .as_ref()
                    .is_some_and(|signer| signer.key() == accounts.group.authority)
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
        &mut accounts.group,
        &mut accounts.market,
        &accounts.registration,
        operation + 1,
    )?;
    emit_cpi!(emitted);
    Ok(())
}

pub(crate) struct View<'a, 'info> {
    pub capital: &'a Account<'info, MarginAccountV2>,
    pub registration: &'a Account<'info, MakerRegistrationV2>,
    pub program: &'a Program<'info>,
    pub data: &'a Account<'info, ProgramData>,
    pub config: &'a UncheckedAccount<'info>,
}

impl<'a, 'info> View<'a, 'info> {
    pub(crate) fn authenticate(
        &self,
        group: &Account<ClearingGroupV2>,
        market: &Account<GroupMarketV2>,
    ) -> Result<MakerState> {
        let registration = self.registration;
        capital_ready(self.capital, market)?;
        require!(
            registration.schema_version == SCHEMA_VERSION
                && registration.group == group.key()
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
                    b"registration-v2",
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
                    b"margin-v2",
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
            group,
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
        group: &Account<ClearingGroupV2>,
        market: &Account<GroupMarketV2>,
        side: u8,
        lots: u64,
        reference: u64,
        slot: u64,
    ) -> GroupQuoteRequest {
        let registration = self.registration;
        GroupQuoteRequest {
            group: group.key(),
            quote: QuoteRequest {
                version: GROUP_VERSION,
                domain: group.domain,
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
        request: &GroupQuoteRequest,
    ) -> Result<QuoteResponse> {
        let expected = maker_interface::group_quote(request.group, state, request)
            .map_err(|_| error!(ClearingError::MakerQuote))?;
        let mut bytes = hash(b"global:quote_group").to_bytes()[..8].to_vec();
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
    ctx: Context<PreviewGroupMaker>,
    args: crate::instructions::PreviewArgs,
) -> Result<QuoteResponse> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    profile(&ctx.accounts.group)?;
    let accounts = &ctx.accounts;
    let view = View {
        capital: &accounts.capital,
        registration: &accounts.registration,
        program: &accounts.pricing_program,
        data: &accounts.program_data,
        config: &accounts.config,
    };
    let state = view.authenticate(&accounts.group, &accounts.market)?;
    require!(
        args.quote_epoch == state.quote_epoch
            && args.authority_epoch == accounts.registration.authority_epoch
            && args.terms_epoch == accounts.market.terms_epoch
            && args.config_epoch == accounts.market.config_epoch,
        ClearingError::MakerEpoch
    );
    let request = view.request(
        &accounts.group,
        &accounts.market,
        args.side,
        args.lots,
        args.reference_price,
        Clock::get()?.slot,
    );
    view.quote(&state, &request)
}
