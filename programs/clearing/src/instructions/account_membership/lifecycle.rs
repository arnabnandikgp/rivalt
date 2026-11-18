//! Root-only lifecycle rules. Public handlers must additionally authenticate the
//! owner, portfolio/member page, unfrozen safety, full index path and funded
//! capacity. These helpers cannot grant membership by themselves.
use crate::{state::accounts::*, ClearingError};
use anchor_lang::prelude::*;

pub(crate) fn empty(root: &MarginAccount) -> Result<()> {
    crate::engine::account::structural_model(root)?;
    require!(root.schema_version == SCHEMA_VERSION
        && valid_identity(0, root.subaccount_index, root.mode, root.isolated_market_index, root.role)
        && root.cash == 0 && root.reserved == 0
        && root.delegate == Address::default() && root.delegate_expiry_slot == 0 && root.delegate_epoch > 0
        && root.positions.iter().all(|position| position.lots == 0 && position.virtual_scaled == 0)
        && root.book.orders.iter().all(|entry| !entry.order.active() && entry.order.reserve == 0)
        && root.book.protections.iter().all(|entry| entry.protection.remaining == 0),
        ClearingError::Resolution);
    // Historical generations, funding checkpoints, order IDs and filled/cancelled
    // records are not obligations. Never reset them to manufacture emptiness.
    Ok(())
}

/// Disabled/quarantined makers still own their binding and obligations. Until a
/// separately verified maker-retirement path exists, any owned binding prevents
/// deactivation/retirement. A dust-funded empty system PDA is not a live binding.
pub(crate) fn unbound(root_key: &Address, binding: &AccountView) -> Result<()> {
    let expected = find_program_address(&[b"capital-v3", root_key.as_ref()], &crate::ID).0;
    require_keys_eq!(*binding.address(), expected, ClearingError::Resolution);
    require!(binding.owner() == &anchor_lang::system_program::ID
        && binding.data_len() == 0 && !binding.executable() && !binding.is_signer(), ClearingError::Resolution);
    Ok(())
}

pub(crate) fn transition(root: &mut MarginAccount, next: u8) -> Result<()> {
    empty(root)?;
    require!(matches!((root.lifecycle, next),
        (MEMBER_REGISTERED, MEMBER_FINANCIAL) | (MEMBER_FINANCIAL, MEMBER_REGISTERED)
            | (MEMBER_REGISTERED, MEMBER_RETIRED)), ClearingError::Resolution);
    require!(root.lifecycle != MEMBER_FINANCIAL || root.activation_generation > 0, ClearingError::Resolution);
    let nonce = root.nonce.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    let version = root.state_version.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    let delegate_epoch = root.delegate_epoch.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    let generation = if next == MEMBER_FINANCIAL {
        root.activation_generation.checked_add(1).ok_or(ClearingError::Arithmetic)?
    } else { root.activation_generation };
    root.nonce = nonce;
    root.state_version = version;
    root.delegate_epoch = delegate_epoch;
    root.activation_generation = generation;
    root.lifecycle = next;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestAccount;
    fn root() -> MarginAccount {
        let mut root=MarginAccount {schema_version:SCHEMA_VERSION, subaccount_index:0, id:1u64<<53,
            mode:MODE_CROSS, isolated_market_index:CROSS_MARKET_SENTINEL, role:ROLE_TRADER,
            delegate_epoch:1,lifecycle:MEMBER_REGISTERED,..Default::default()};
        root.positions[0].funding_checkpoint_scaled=123;
        root.positions[0].generation=17;
        root.book.last_order_id=41;root.book.last_group_id=23;
        root
    }
    fn encoded(root:&MarginAccount)->Vec<u8> {
        let mut bytes=Vec::new();crate::wire::write(root,&mut bytes).unwrap();bytes
    }
    #[test]
    fn reentry_fences_old_authority_and_retirement_never_revives_identity() {
        let mut account=root();
        for expected_generation in [1,2,3] {
            transition(&mut account,MEMBER_FINANCIAL).unwrap();
            assert_eq!(account.activation_generation,expected_generation);
            assert!(crate::engine::account::model(&account).is_ok());
            transition(&mut account,MEMBER_REGISTERED).unwrap();
            assert!(crate::engine::account::model(&account).is_err());
        }
        assert_eq!((account.nonce,account.state_version,account.delegate_epoch),(6,6,7));
        transition(&mut account,MEMBER_RETIRED).unwrap();
        assert_eq!((account.nonce,account.state_version,account.delegate_epoch),(7,7,8));
        assert_eq!(account.activation_generation,3);
        assert_eq!(account.positions[0].generation,17);
        assert_eq!(account.positions[0].funding_checkpoint_scaled,123);
        assert_eq!((account.book.last_order_id,account.book.last_group_id),(41,23));
        for next in [MEMBER_REGISTERED,MEMBER_FINANCIAL,MEMBER_RETIRED] {
            let before=encoded(&account);assert!(transition(&mut account,next).is_err());assert_eq!(encoded(&account),before);
        }
    }
    #[test]
    fn every_residual_obligation_or_exhausted_counter_blocks_atomically() {
        for mutation in 0..16 {
            let mut account=root();account.lifecycle=MEMBER_FINANCIAL;account.activation_generation=1;
            match mutation {
                0=>account.cash=1,1=>account.positions[0].lots=1,2=>account.positions[1].lots=-1,
                3=>account.positions[0].virtual_scaled=1,4=>account.positions[1].virtual_scaled=-1,
                5=>{account.positions[0].virtual_scaled=1;account.positions[1].virtual_scaled=-1;},
                6=>account.reserved=1,7=>account.book.orders[0].order.reserve=1,
                8=>account.book.orders[1].order.state=crate::constants::orders::OPEN,
                9=>account.book.orders[2].order.state=crate::constants::orders::PARTIAL,
                10=>account.book.protections[1].protection.remaining=1,
                11=>account.delegate=Address::new_unique(),12=>account.delegate_expiry_slot=1,
                13=>account.nonce=u64::MAX,14=>account.state_version=u64::MAX,15=>account.delegate_epoch=u64::MAX,
                _=>unreachable!(),
            }
            let before=encoded(&account);assert!(transition(&mut account,MEMBER_REGISTERED).is_err(),"mutation {mutation}");
            assert_eq!(encoded(&account),before);
        }
        let mut account=root();account.activation_generation=u64::MAX;
        let before=encoded(&account);assert!(transition(&mut account,MEMBER_FINANCIAL).is_err());assert_eq!(encoded(&account),before);
    }
    #[test]
    fn actual_binding_address_owner_and_data_are_required_not_a_disabled_flag() {
        let root_key=Address::new_unique();
        let key=find_program_address(&[b"capital-v3",root_key.as_ref()],&crate::ID).0;
        let mut absent=TestAccount::new(key,anchor_lang::system_program::ID,&[],false,false);
        unbound(&root_key,&absent.view()).unwrap();
        for (address,owner,data) in [(Address::new_unique(),anchor_lang::system_program::ID,vec![]),
            (key,crate::ID,vec![0;114]),(key,anchor_lang::system_program::ID,vec![0])]{
            let mut bad=TestAccount::new(address,owner,&data,false,false);assert!(unbound(&root_key,&bad.view()).is_err());
        }
    }
}
