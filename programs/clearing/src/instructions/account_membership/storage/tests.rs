use super::*;
use crate::test_support::TestAccount;
use financial_core::clearing::scalable::recovery_storage::RecoveryLayout;

fn rent() -> Rent {
    Rent::from_bytes(&6960u64.to_le_bytes()).unwrap()
}
fn allocation(venue: Address, kind: Allocation, epoch: u64) -> (TestAccount, TestAccount) {
    // Independent literal seed/offset and rent construction, not production
    // allocation_shape/address. Dirty old payloads intentionally remain: proving
    // funded physical capacity must not claim they are current-epoch results.
    let (prefix, indices, discriminator, length, bump_offset) = match kind {
        Allocation::Prepared => (
            b"prepared-settlement".as_slice(),
            vec![],
            PreparedSettlement::DISCRIMINATOR,
            1463,
            1462,
        ),
        Allocation::Rates => (
            b"settlement-rates".as_slice(),
            vec![],
            SettlementRates::DISCRIMINATOR,
            1204,
            1203,
        ),
        Allocation::Plan => (
            b"settlement-plan".as_slice(),
            vec![],
            SettlementPlan::DISCRIMINATOR,
            1181,
            1180,
        ),
        Allocation::FrozenRows { page } => (
            b"frozen-margin-page".as_slice(),
            vec![page.to_le_bytes().to_vec()],
            FrozenMarginPage::DISCRIMINATOR,
            1156,
            1155,
        ),
        Allocation::Limbs { register, page } => (
            b"resolution-limbs".as_slice(),
            vec![register.to_le_bytes().to_vec(), page.to_le_bytes().to_vec()],
            SettlementLimbPage::DISCRIMINATOR,
            2129,
            80,
        ),
    };
    let mut seeds = vec![prefix, venue.as_ref()];
    for index in &indices {
        seeds.push(index.as_slice());
    }
    let (key, bump) = find_program_address(&seeds, &crate::ID);
    let mut bytes = vec![0x55; length];
    bytes[..8].copy_from_slice(discriminator);
    bytes[8..10].copy_from_slice(&9u16.to_le_bytes());
    bytes[10..18].copy_from_slice(&11u64.to_le_bytes());
    bytes[18..50].copy_from_slice(venue.as_ref());
    bytes[50..58].copy_from_slice(&epoch.to_le_bytes());
    bytes[bump_offset] = bump;
    match kind {
        Allocation::FrozenRows { page } => bytes[58..66].copy_from_slice(&page.to_le_bytes()),
        Allocation::Limbs { register, page } => {
            bytes[66..70].copy_from_slice(&register.to_le_bytes());
            bytes[70..78].copy_from_slice(&page.to_le_bytes());
        }
        _ => {}
    }
    let (receipt_key, receipt_bump) = find_program_address(
        &[b"storage-funding", venue.as_ref(), key.as_ref()],
        &crate::ID,
    );
    let mut receipt_bytes = StorageFunding::DISCRIMINATOR.to_vec();
    receipt_bytes.extend_from_slice(&9u16.to_le_bytes());
    receipt_bytes.extend_from_slice(&1u64.to_le_bytes());
    receipt_bytes.extend_from_slice(venue.as_ref());
    receipt_bytes.extend_from_slice(key.as_ref());
    receipt_bytes.extend_from_slice(&[23; 32]);
    receipt_bytes.extend_from_slice(&((length as u64 + 128) * 6960).to_le_bytes());
    receipt_bytes.push(receipt_bump);
    let mut allocation = TestAccount::new(key, crate::ID, &bytes, true, false);
    let mut receipt = TestAccount::new(receipt_key, crate::ID, &receipt_bytes, true, false);
    allocation.view().set_lamports((length as u64 + 128) * 6960);
    receipt.view().set_lamports((123 + 128) * 6960);
    (allocation, receipt)
}

#[test]
fn capacity_requires_every_real_pda_and_receipt_and_reuses_only_finished_epochs() {
    let venue = Address::new_unique();
    let mut state = Provisioning {
        completed_epoch: 4,
        ..Default::default()
    }
    .begin(128)
    .unwrap();
    let layout = RecoveryLayout::new(128).unwrap();
    for ordinal in 0..layout.allocations() {
        let kind = layout.allocation(ordinal).unwrap();
        let (mut allocation, mut receipt) = allocation(venue, kind, 4);
        let allocation = allocation.view();
        let receipt = receipt.view();
        assert!(state.admits(1).is_err());
        assert!(verify_funded_allocation(
            &venue,
            state,
            1,
            ordinal,
            &receipt,
            &allocation,
            &rent()
        )
        .is_err());
        let before = allocation.try_borrow().unwrap().to_vec();
        state = verify_funded_allocation(&venue, state, 1, ordinal, &allocation, &receipt, &rent())
            .unwrap();
        assert_eq!(&*allocation.try_borrow().unwrap(), before.as_slice());
        assert!(verify_funded_allocation(
            &venue,
            state,
            1,
            ordinal,
            &allocation,
            &receipt,
            &rent()
        )
        .is_err());
    }
    assert_eq!(state.ready_capacity, 128);
    state.admits(128).unwrap();
    assert!(state.admits(129).is_err());
}

#[test]
fn forged_shape_payer_epoch_rent_and_receipt_cannot_earn_capacity() {
    let venue = Address::new_unique();
    let state = Provisioning::default().begin(1).unwrap();
    let (mut original, mut original_receipt) = allocation(venue, Allocation::Prepared, 0);
    let original = original.view();
    let original_receipt = original_receipt.view();
    let bytes = original.try_borrow().unwrap().to_vec();
    let receipt_bytes = original_receipt.try_borrow().unwrap().to_vec();
    for offset in [0, 8, 10, 18, 50, 1462] {
        let mut corrupt = bytes.clone();
        if offset == 10 {
            corrupt[10..18].fill(0);
        } else {
            corrupt[offset] ^= 1;
        }
        let mut bad = TestAccount::new(*original.address(), crate::ID, &corrupt, true, false);
        bad.view().set_lamports(original.lamports());
        assert!(
            verify_funded_allocation(&venue, state, 1, 0, &bad.view(), &original_receipt, &rent())
                .is_err(),
            "allocation offset {offset}"
        );
    }
    for offset in [0, 8, 10, 18, 50, 82, 114, 122] {
        let mut corrupt = receipt_bytes.clone();
        match offset {
            10 => corrupt[10..18].fill(0),
            82 => corrupt[82..114].fill(0),
            114 => corrupt[114..122].fill(255),
            _ => corrupt[offset] ^= 1,
        }
        let mut bad = TestAccount::new(
            *original_receipt.address(),
            crate::ID,
            &corrupt,
            true,
            false,
        );
        bad.view().set_lamports(original_receipt.lamports());
        assert!(
            verify_funded_allocation(&venue, state, 1, 0, &original, &bad.view(), &rent()).is_err(),
            "receipt offset {offset}"
        );
    }
    for (owner, executable, key, balance) in [
        (
            Address::new_unique(),
            false,
            *original.address(),
            original.lamports(),
        ),
        (crate::ID, true, *original.address(), original.lamports()),
        (crate::ID, false, Address::new_unique(), original.lamports()),
        (
            crate::ID,
            false,
            *original.address(),
            original.lamports() - 1,
        ),
    ] {
        let mut bad = TestAccount::new(key, owner, &bytes, true, executable);
        bad.view().set_lamports(balance);
        assert!(verify_funded_allocation(
            &venue,
            state,
            1,
            0,
            &bad.view(),
            &original_receipt,
            &rent()
        )
        .is_err());
    }
    let (mut future, mut future_receipt) = allocation(venue, Allocation::Prepared, 1);
    assert!(verify_funded_allocation(
        &venue,
        state,
        1,
        0,
        &future.view(),
        &future_receipt.view(),
        &rent()
    )
    .is_err());
    let mut poor_receipt = TestAccount::new(
        *original_receipt.address(),
        crate::ID,
        &receipt_bytes,
        true,
        false,
    );
    poor_receipt
        .view()
        .set_lamports(original_receipt.lamports() - 1);
    assert!(verify_funded_allocation(
        &venue,
        state,
        1,
        0,
        &original,
        &poor_receipt.view(),
        &rent()
    )
    .is_err());
}
