//! Upgradeable-loader identities, separate from Rivalt's owned account layouts.
use anchor_lang::prelude::*;

pub const UPGRADEABLE_LOADER: Address =
    Address::from_str_const("BPFLoaderUpgradeab1e11111111111111111111111");

/// Loader enum variant 3 followed by its fixed metadata prefix. Program code
/// remains trailing data and is authenticated in full by the maker hash check.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, IdlType)]
pub struct ProgramData {
    pub slot: u64,
    pub upgrade_authority_address: Option<Address>,
}
impl Owner for ProgramData {
    const OWNER: Address = UPGRADEABLE_LOADER;
}
impl Discriminator for ProgramData {
    const DISCRIMINATOR: &'static [u8] = &[3, 0, 0, 0];
}

pub struct ClearingProgram;
impl Id for ClearingProgram {
    fn id() -> Address {
        crate::ID
    }
    #[cfg(not(feature = "devnet-test-profile"))]
    const IDL_ADDRESS: &'static str = "Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo";
    #[cfg(feature = "devnet-test-profile")]
    const IDL_ADDRESS: &'static str = "BbLhJdwymg9aGCtdrcxkFsBwP3L8N9NbGJucq37sS2jv";
}

/// Validate the loader-owned executable program header before using its data
/// address. There is no caller-supplied ProgramData identity or assumed PDA link.
pub trait UpgradeableProgramAddress: AnchorAccount {
    fn programdata_address(&self) -> Result<Option<Address>> {
        let view = self.account();
        require!(view.executable(), crate::ClearingError::MakerBinding);
        if view.owner() != &UPGRADEABLE_LOADER {
            return Ok(None);
        }
        let bytes = view.try_borrow()?;
        require!(
            bytes.len() == 36 && bytes[..4] == [2, 0, 0, 0],
            crate::ClearingError::MakerBinding
        );
        Ok(Some(Address::new_from_array(
            bytes[4..36]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        )))
    }
}
impl<T: AnchorAccount> UpgradeableProgramAddress for T {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestAccount;

    #[test]
    fn program_header_requires_executable_loader_and_exact_variant() {
        let expected = Address::new_from_array([23; 32]);
        let mut bytes = vec![2, 0, 0, 0];
        bytes.extend_from_slice(expected.as_ref());
        let check = |data: &[u8], owner: Address, executable| {
            let mut backing =
                TestAccount::new(Address::new_unique(), owner, data, false, executable);
            UncheckedAccount::load(backing.view())
                .unwrap()
                .programdata_address()
        };
        assert_eq!(
            check(&bytes, UPGRADEABLE_LOADER, true).unwrap(),
            Some(expected)
        );
        assert!(check(&bytes, UPGRADEABLE_LOADER, false).is_err());
        assert_eq!(check(&bytes, Address::new_unique(), true).unwrap(), None);
        for length in 0..bytes.len() {
            assert!(check(&bytes[..length], UPGRADEABLE_LOADER, true).is_err());
        }
        bytes.push(0);
        assert!(check(&bytes, UPGRADEABLE_LOADER, true).is_err());
        bytes.pop();
        bytes[0] = 3;
        assert!(check(&bytes, UPGRADEABLE_LOADER, true).is_err());
    }

    #[test]
    fn program_data_authenticates_owner_variant_and_preserves_code_tail() {
        let authority = Address::new_from_array([29; 32]);
        let mut bytes = vec![3, 0, 0, 0];
        bytes.extend_from_slice(&37u64.to_le_bytes());
        bytes.push(1);
        bytes.extend_from_slice(authority.as_ref());
        bytes.extend_from_slice(&[41; 100]); // executable bytes follow metadata
        let check = |data: &[u8], owner: Address| {
            let mut backing = TestAccount::new(Address::new_unique(), owner, data, false, false);
            let account = BorshAccount::<ProgramData>::load(backing.view())?;
            assert_eq!(account.slot, 37);
            assert_eq!(account.upgrade_authority_address, Some(authority));
            assert_eq!(&account.account().try_borrow()?[45..], &[41; 100]);
            Ok::<_, ProgramError>(())
        };
        assert!(check(&bytes, UPGRADEABLE_LOADER).is_ok());
        assert!(check(&bytes, crate::ID).is_err());
        for length in 0..45 {
            assert!(check(&bytes[..length], UPGRADEABLE_LOADER).is_err());
        }
        for tag in [0, 2, 4] {
            let mut changed = bytes.clone();
            changed[0] = tag;
            assert!(check(&changed, UPGRADEABLE_LOADER).is_err());
        }
        let mut changed = bytes.clone();
        changed[12] = 2;
        assert!(check(&changed, UPGRADEABLE_LOADER).is_err());
    }
}
