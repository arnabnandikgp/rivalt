use crate::{
    event_cpi::Payloads, events::MarketListingRegistered, state::accounts::*, ClearingError,
};
use anchor_lang::{prelude::*, AccountDeserialize};
use oracle_fixture::Feed;

#[event_cpi]
#[derive(Accounts)]
#[instruction(market_id: u16, symbol: [u8; 8])]
pub struct RegisterMarketListing {
    #[account(mut)]
    pub authority: Signer,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(init, payer = authority, space = 8 + MarketListing::INIT_SPACE,
        seeds = [b"market-listing", venue.address().as_ref(), &market_id.to_le_bytes()], bump)]
    pub listing: Box<BorshAccount<MarketListing>>,
    #[account(init, payer = authority, space = 8 + ListedSymbol::INIT_SPACE,
        seeds = [b"listed-symbol", venue.address().as_ref(), &symbol], bump)]
    pub symbol_binding: Box<BorshAccount<ListedSymbol>>,
    /// CHECK: Address, owner, discriminator, publisher and feed ID are verified below.
    pub oracle_feed: UncheckedAccount,
    pub system_program: Program<System>,
}

// Local test feeds identify the USD index by its canonical symbol, for example
// SOL/USD followed by zero padding. The signed publisher and feed ID select one PDA.
fn feed_id(symbol: &[u8; 8]) -> Result<[u8; 32]> {
    let len = symbol
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(symbol.len());
    require!(
        len > 0
            && symbol[0].is_ascii_uppercase()
            && symbol[..len]
                .iter()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
            && symbol[len..].iter().all(|byte| *byte == 0)
            && !matches!(&symbol[..len], b"BTC" | b"ETH"),
        ClearingError::Profile
    );
    let mut id = [0; 32];
    id[..len].copy_from_slice(&symbol[..len]);
    id[len..len + 4].copy_from_slice(b"/USD");
    Ok(id)
}

pub fn register(
    ctx: &mut Context<RegisterMarketListing>,
    events: &mut Payloads,
    market_id: u16,
    symbol: [u8; 8],
    lots_per_unit: u64,
    oracle_publisher: Address,
) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    let venue = &accounts.venue;
    crate::instructions::account_trading::base_identity(venue, &accounts.safety)?;
    require!(!accounts.safety.paused, ClearingError::Paused);
    require_keys_eq!(
        *accounts.authority.address(),
        venue.authority,
        ClearingError::Authority
    );
    require!(
        usize::from(market_id) >= MARKET_COUNT && lots_per_unit > 0,
        ClearingError::Profile
    );
    let id = feed_id(&symbol)?;
    require!(
        oracle_publisher != Address::default(),
        ClearingError::OracleSource
    );
    let (expected, bump) = find_program_address(
        &[b"feed", oracle_publisher.as_ref(), &id],
        &oracle_fixture::ID,
    );
    let account = accounts.oracle_feed.account();
    crate::engine::sources::binding(account, expected, 0)?;
    let bytes = account.try_borrow()?;
    require!(
        bytes.len() == 8 + Feed::INIT_SPACE,
        ClearingError::OracleSource
    );
    let feed = Feed::try_deserialize(&mut &bytes[..])?;
    require!(
        feed.authority == oracle_publisher && feed.feed_id == id && feed.bump == bump,
        ClearingError::OracleSource
    );
    let listing_key = *accounts.listing.address();
    **accounts.listing = MarketListing {
        schema_version: LISTING_SCHEMA,
        revision: 0,
        venue: *venue.address(),
        market_id,
        symbol,
        lots_per_unit,
        quote_mint: venue.quote_mint,
        oracle_publisher,
        oracle_feed: expected,
        status: LISTING_INACTIVE,
        bump: ctx.bumps.listing,
    };
    **accounts.symbol_binding = ListedSymbol {
        schema_version: LISTING_SCHEMA,
        revision: 0,
        listing: listing_key,
        bump: ctx.bumps.symbol_binding,
    };
    events.emit(
        &MarketListingRegistered {
            venue: *venue.address(),
            slot: Clock::get()?.slot,
            listing: listing_key,
            symbol_binding: *accounts.symbol_binding.address(),
            market_id,
            symbol,
            lots_per_unit,
            quote_mint: venue.quote_mint,
            oracle_publisher,
            oracle_feed: expected,
            status: LISTING_INACTIVE,
        },
        accounts.event_authority.account().clone(),
    )
}
