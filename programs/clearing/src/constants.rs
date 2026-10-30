//! Protocol versions, bounded test-profile limits and deployment bindings.

pub mod orders {
    pub const OPEN: u8 = 1;
    pub const PARTIAL: u8 = 2;
    pub const FILLED: u8 = 3;
    pub const CANCELLED: u8 = 4;
    pub const EXPIRED: u8 = 5;
    pub const INVALIDATED: u8 = 6;
    pub const MAX_ORDER_SLOTS: u64 = 216_000;
}

pub mod makers {
    use anchor_lang::prelude::*;
    #[cfg(not(feature = "devnet-test-profile"))]
    pub const MAKER_A: Pubkey = pubkey!("7Kp4Y5yeBiuS9NYmw67quMLRto5Y9CcUQ29VjLviHggU");

    #[cfg(not(feature = "devnet-test-profile"))]
    pub const MAKER_B: Pubkey = pubkey!("F3ETRB1fPHjJ2KQYuL8SomC1auBpWK5VtVqFwAU7k2Yc");

    #[cfg(feature = "devnet-test-profile")]
    pub const MAKER_A: Pubkey = pubkey!("C2dhcKi2FQTsJgHiAYYb8hGeqYWdcUQr9MB4kU6AdLJG");

    #[cfg(feature = "devnet-test-profile")]
    pub const MAKER_B: Pubkey = pubkey!("8gBGZLMdws9ci5ax8ASmK46WPigHguFYvm8azK8q6Ckc");
}

pub mod routes {
    pub const MAX_ROUTE_LOTS: u64 = 4_608;
    pub const MAX_INTENT_SLOTS: u64 = 150;
}
