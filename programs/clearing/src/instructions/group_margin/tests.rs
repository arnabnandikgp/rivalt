use super::*;

fn margin_root() -> MarginAccountV2 {
    MarginAccountV2 {
        schema_version: 2,
        mode: MODE_CROSS,
        isolated_market_index: 255,
        owner: Pubkey::new_from_array([1; 32]),
        delegate_epoch: 1,
        cash: 1_000,
        ..MarginAccountV2::default()
    }
}

#[test]
fn owner_and_exclusive_delegate_authority_are_root_scoped() {
    let mut root = margin_root();
    let delegate = Pubkey::new_from_array([2; 32]);
    assert_eq!(trade_authority(&root, root.owner, 100).unwrap(), 0);
    assert!(trade_authority(&root, delegate, 100).is_err());
    root.delegate = delegate;
    root.delegate_expiry_slot = 101;
    root.delegate_epoch = 2;
    assert_eq!(trade_authority(&root, delegate, 100).unwrap(), 2);
    assert!(trade_authority(&root, delegate, 101).is_err());
    assert!(live_order_authority(&root, 2, 100));
    assert!(!live_order_authority(&root, 2, 101));
    assert!(live_order_authority(&root, 0, 101));
    root.delegate_epoch = 3;
    assert!(!live_order_authority(&root, 2, 100));
    assert!(trade_authority(
        &MarginAccountV2 {
            id: 1,
            ..margin_root()
        },
        delegate,
        100
    )
    .is_err());
}

#[test]
fn malformed_authority_and_cross_maker_identity_reject() {
    let mut root = margin_root();
    root.role = ROLE_MAKER;
    assert!(model(&root).is_err());
    root.role = ROLE_TRADER;
    root.delegate_epoch = 0;
    assert!(model(&root).is_err());
    root.delegate_epoch = 1;
    root.delegate_expiry_slot = 100;
    assert!(model(&root).is_err());
    root.delegate = root.owner;
    assert!(model(&root).is_err());
    root.delegate = Pubkey::new_unique();
    assert!(model(&root).is_ok());
}

#[test]
fn complete_dependencies_reject_omission_reordering_alias_and_foreign_group() {
    let group_key = Pubkey::new_unique();
    let keys = [0u8, 1].map(|index| {
        Pubkey::find_program_address(&[b"market-v2", group_key.as_ref(), &[index]], &crate::ID).0
    });
    let group = ClearingGroupV2 {
        schema_version: 2,
        profile_version: 2,
        market_count: 2,
        markets: keys,
        ..ClearingGroupV2::default()
    };
    let market_states = [0u8, 1].map(|index| GroupMarketV2 {
        schema_version: 2,
        group: group_key,
        index,
        lots_per_unit: [1_000_000, 100_000][usize::from(index)],
        ..GroupMarketV2::default()
    });
    let dependencies = [(keys[0], &market_states[0]), (keys[1], &market_states[1])];
    assert!(markets(&group, group_key, &dependencies).is_ok());
    assert!(markets(&group, group_key, &dependencies[..1]).is_err());
    assert!(markets(&group, group_key, &[dependencies[1], dependencies[0]]).is_err());
    assert!(markets(&group, group_key, &[dependencies[0], dependencies[0]]).is_err());
    assert!(markets(&group, Pubkey::new_unique(), &dependencies).is_err());
    let mut foreign = market_states[1].clone();
    foreign.group = Pubkey::new_unique();
    assert!(markets(&group, group_key, &[dependencies[0], (keys[1], &foreign)]).is_err());
    assert!(markets(
        &group,
        group_key,
        &[dependencies[0], dependencies[1], dependencies[0]]
    )
    .is_err());
}

#[test]
fn generic_model_does_not_grant_cross_trading() {
    let root = margin_root();
    assert!(model(&root).is_ok());
    for mode in [0, 1, 2, 3] {
        let group = ClearingGroupV2 {
            schema_version: 2,
            profile_version: 2,
            market_count: 2,
            mode,
            ..ClearingGroupV2::default()
        };
        assert!(trading(&group, &root).is_err());
    }
}
