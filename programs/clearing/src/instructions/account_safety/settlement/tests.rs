use super::*;
use crate::state::records::Position;
use financial_core::SCALE;

struct Fixture {
    venue_key: Address,
    source_key: Address,
    venue: Venue,
    custody: Custody,
    safety: VenueSafety,
    registry: VenueRegistry,
    member_keys: Vec<Address>,
    storage: RecoveryStorage,
    resolution: Resolution,
    markets: [Market; 2],
    ledgers: [MarketLedger; 2],
    roots: [MarginAccount; 3],
}
impl Fixture {
    fn new() -> Self {
        let venue_key = Address::new_unique();
        let markets = [Address::new_unique(), Address::new_unique()];
        let members: Vec<_> = (0..3).map(|_| Address::new_unique()).collect();
        let registry = VenueRegistry {
            schema_version: crate::state::accounts::SCHEMA_VERSION,
            revision: 9,
            venue: venue_key,
            membership_epoch: 3,
            next_id: 3,
            registered_count: 3,
            financial_count: 3,
            live_index: crate::instructions::account_membership::members::index_root(&venue_key),
            ..Default::default()
        };
        let registry_hash = super::super::resolution::registry_hash(&registry).unwrap();
        let mut roots: [MarginAccount; 3] = core::array::from_fn(|index| MarginAccount {
            lifecycle: crate::state::accounts::MEMBER_FINANCIAL,
            activation_generation: 1,
            schema_version: crate::state::accounts::SCHEMA_VERSION,
            revision: 7,
            venue: venue_key,
            id: index as u64,
            owner: Address::new_unique(),
            mode: MODE_CROSS,
            isolated_market_index: CROSS_MARKET_SENTINEL,
            delegate_epoch: 1,
            cash: [3, 5, 4][index],
            ..Default::default()
        });
        // Independent arithmetic: claim = lots*price + virtual - lots*(F-checkpoint).
        // Expected rows: (-8.75,+8.125), (+9.75,0), (0,-8.125) tokens at scale 1e9.
        roots[0].positions = [
            Position {
                lots: 2,
                virtual_scaled: -205 * SCALE + SCALE / 4,
                funding_checkpoint_scaled: SCALE,
                generation: 11,
            },
            Position {
                lots: -1,
                virtual_scaled: 25 * SCALE + SCALE / 8,
                funding_checkpoint_scaled: 2 * SCALE,
                generation: 12,
            },
        ];
        roots[1].mode = MODE_ISOLATED;
        roots[1].isolated_market_index = 0;
        roots[1].subaccount_index = 1;
        roots[1].role = ROLE_MAKER;
        roots[1].positions[0] = Position {
            lots: -2,
            virtual_scaled: 206 * SCALE - SCALE / 4,
            funding_checkpoint_scaled: SCALE,
            generation: 21,
        };
        roots[2].mode = MODE_ISOLATED;
        roots[2].isolated_market_index = 1;
        roots[2].subaccount_index = 2;
        roots[2].role = ROLE_RECEIVER;
        roots[2].positions[1] = Position {
            lots: 1,
            virtual_scaled: -25 * SCALE - SCALE / 8,
            funding_checkpoint_scaled: 2 * SCALE,
            generation: 31,
        };
        Self {
            venue_key,
            source_key: Address::new_unique(),
            venue: Venue {
                schema_version: crate::state::accounts::SCHEMA_VERSION,
                revision: 1,
                profile_version: crate::state::accounts::PROFILE_VERSION,
                markets,
                market_count: 2,
                insurance_fee_share_bps: 2500,
                terms_epoch: 3,
                ..Default::default()
            },
            custody: Custody {
                schema_version: crate::state::accounts::SCHEMA_VERSION,
                revision: 1,
                venue: venue_key,
                allocated_vault: 27,
                ..Default::default()
            },
            safety: VenueSafety {
                schema_version: crate::state::accounts::SCHEMA_VERSION,
                revision: 1,
                venue: venue_key,
                mode: FROZEN,
                paused: true,
                epoch: 3,
                resolution_epoch: 2,
                ..Default::default()
            },
            resolution: Resolution {
                schema_version: crate::state::accounts::SCHEMA_VERSION,
                revision: 10,
                venue: venue_key,
                epoch: 2,
                stage: super::super::resolution::VALUE,
                count: 3,
                safety_epoch: 3,
                terms_epoch: 3,
                config_epochs: [4, 5],
                registry_hash,
                membership_epoch: registry.membership_epoch,
                live_index: registry.live_index,
                prices: [100, 20],
                funding: [3 * SCALE, 5 * SCALE],
                remaining_gross: [4, 2],
                allocated_before: 27,
                cash_before: 12,
                pools_before: [1, 0],
                insurance_before: [2, 3],
                fees_before: [4, 5],
                ..Default::default()
            },
            markets: core::array::from_fn(|index| Market {
                schema_version: crate::state::accounts::SCHEMA_VERSION,
                revision: 1,
                venue: venue_key,
                index: index as u8,
                lots_per_unit: [1_000_000, 100_000][index],
                cross_eligible: true,
                config_epoch: [4, 5][index],
                funding_index_scaled: [3 * SCALE, 5 * SCALE][index],
                gross_lots: [4, 2][index],
                ..Default::default()
            }),
            ledgers: core::array::from_fn(|index| MarketLedger {
                schema_version: crate::state::accounts::SCHEMA_VERSION,
                revision: 1,
                venue: venue_key,
                market_index: index as u8,
                market: markets[index],
                settlement: [1, 0][index],
                insurance: [2, 3][index],
                fees: [4, 5][index],
                ..Default::default()
            }),
            registry,
            member_keys: members,
            storage: RecoveryStorage { schema_version: SETTLEMENT_SCHEMA, revision: 1, venue: venue_key, ready_capacity: 64, locked_epoch: 2, completed_epoch: 1, ..Default::default() },
            roots,
        }
    }
    fn source(&self) -> FrozenSource<'_> {
        FrozenSource {
            venue_key: self.venue_key,
            source_key: self.source_key,
            venue: &self.venue,
            custody: &self.custody,
            safety: &self.safety,
            registry: &self.registry,
            storage: &self.storage,
            source: &self.resolution,
            markets: self.markets.each_ref(),
            ledgers: self.ledgers.each_ref(),
            actual_vault: 27,
        }
    }
    fn header(&self) -> PreparedSettlement {
        let mut header = PreparedSettlement { schema_version: SETTLEMENT_SCHEMA, revision: 1, ..Default::default() };
        self.source().initialize(&mut header).unwrap();
        header.revision = 1;
        header
    }
    fn value_state(&self) -> (PreparedSettlement, FrozenMarginPage) {
        let mut header = self.header();
        begin_value(&mut header).unwrap();
        let mut cursor = MembershipCursor::from_checkpoint(&header.state.membership, 3).unwrap();
        let mut counts = [0; 16];
        counts[0] = 3;
        for _level in (0..15).rev() {
            cursor.node(1, counts).unwrap();
        }
        cursor.page(7).unwrap();
        header.state.membership = cursor.checkpoint();
        let page = FrozenMarginPage {
            schema_version: crate::state::accounts::SCHEMA_VERSION,
            revision: 1,
            venue: self.venue_key,
            epoch: 2,
            ..Default::default()
        };
        (header, page)
    }
    fn entry(&self, index: usize) -> MemberEntry {
        MemberEntry {
            root: self.member_keys[index],
            lifecycle: MEMBER_FINANCIAL,
            activation_generation: 1,
        }
    }
}

#[cfg(feature = "liquidity-execution-qualification")]
#[test]
fn prepared_source_binds_the_actual_freeze_and_all_economic_buckets() {
    let fixture = Fixture::new();
    let header = fixture.header();
    fixture.source().matches(&header).unwrap();
    for case in 0..22 {
        let mut changed = Fixture::new();
        let header = changed.header();
        match case {
            0 => changed.resolution.revision += 1,
            1 => changed.resolution.cursor = 1,
            2 => changed.resolution.stage = super::super::resolution::VERIFY,
            3 => changed.safety.mode = ACTIVE,
            4 => changed.safety.paused = false,
            5 => changed.safety.epoch += 1,
            6 => changed.safety.resolution_epoch += 1,
            7 => changed.venue.terms_epoch += 1,
            8 => changed.venue.profile_version += 1,
            9 => changed.registry.live_index = Address::new_unique(),
            10 => changed.registry.financial_count += 1,
            11 => changed.storage.locked_epoch += 1,
            12 => changed.registry.membership_epoch += 1,
            13 => changed.registry.revision += 1,
            14 => changed.markets[0].config_epoch += 1,
            15 => changed.markets[1].funding_index_scaled += 1,
            16 => changed.markets[0].gross_lots += 1,
            17 => changed.ledgers[0].settlement += 1,
            18 => changed.ledgers[1].insurance += 1,
            19 => changed.ledgers[0].fees += 1,
            20 => changed.custody.allocated_vault += 1,
            _ => changed.source_key = Address::new_unique(),
        }
        assert!(changed.source().matches(&header).is_err(), "case {case}");
    }
    let mut source = fixture.source();
    source.actual_vault = 26;
    assert!(source.matches(&header).is_err());
    // An unsolicited donation cannot mint accounting cash or invalidate recovery.
    source.actual_vault = 28;
    source.matches(&header).unwrap();
}

#[cfg(feature = "liquidity-execution-qualification")]
#[test]
fn actual_margin_model_values_both_markets_preserving_fractional_claims_and_cash() {
    let fixture = Fixture::new();
    let (mut header, mut page) = fixture.value_state();
    let expected = [
        [-8_750_000_000, 8_125_000_000],
        [9_750_000_000, 0],
        [0, -8_125_000_000],
    ];
    for index in 0..3 {
        value_member(
            &mut header,
            &mut page,
            fixture.member_keys[index],
            &fixture.entry(index),
            &fixture.roots[index],
        )
        .unwrap();
        assert_eq!(page.rows[index].claims, expected[index]);
        assert_eq!(page.rows[index].collected, [3, 0, 4][index]);
        assert_eq!(page.rows[index].cash, [3, 5, 4][index]);
        assert_eq!(page.rows[index].original_revision, 7);
        assert_eq!(page.rows[index].id, index as u64);
        assert_eq!(page.rows[index].activation_generation, 1);
    }
    // Rows alone do not prove completeness: all ancestor counts must close.
    assert!(finish_value(&mut header).is_err());
    let mut cursor = MembershipCursor::from_checkpoint(&header.state.membership, 3).unwrap();
    let mut counts = [0; 16];
    counts[0] = 3;
    for _level in 0..15 {
        cursor.node(1, counts).unwrap();
    }
    header.state.membership = cursor.checkpoint();
    finish_value(&mut header).unwrap();
    assert_eq!(header.stage, DENOMINATOR);
    assert_eq!(page.row_count, 3);
    let totals = SnapshotScan::from_checkpoint(&header.state.valuation, snapshot_binding(&header))
        .unwrap()
        .result()
        .unwrap();
    assert_eq!(totals.cash, 12);
    assert_eq!(
        totals.positive.map(|value| value.words()),
        [[9_750_000_000, 0, 0], [8_125_000_000, 0, 0]]
    );
    assert_eq!(fixture.roots.map(|root| root.cash), [3, 5, 4]);
}

#[cfg(feature = "liquidity-execution-qualification")]
#[test]
fn valuation_rejects_reorder_identity_generation_and_conservation_without_prefix_mutation() {
    let fixture = Fixture::new();
    for case in 0..11 {
        let (mut header, mut page) = fixture.value_state();
        let mut root = fixture.roots[0].clone();
        let mut entry = fixture.entry(0);
        match case {
            0 => root.id = 1,
            1 => root.venue = Address::new_unique(),
            2 => entry.activation_generation = 2,
            3 => entry.lifecycle = MEMBER_REGISTERED,
            4 => entry.root = Address::new_unique(),
            5 => root.delegate_epoch = 0,
            6 => page.epoch += 1,
            7 => page.row_count = 1,
            8 => root.cash = 13,
            9 => root.positions[0].lots = 5,
            _ => root.revision = 0,
        }
        let before_member = header.state.membership;
        let before_value = header.state.valuation;
        assert!(
            value_member(
                &mut header,
                &mut page,
                fixture.member_keys[0],
                &entry,
                &root
            )
            .is_err(),
            "case {case}"
        );
        assert_eq!(header.state.membership, before_member);
        assert_eq!(header.state.valuation, before_value);
        assert_eq!(page.rows[0].member, Address::default());
    }
    let (mut header, mut page) = fixture.value_state();
    for index in 0..2 {
        value_member(
            &mut header,
            &mut page,
            fixture.member_keys[index],
            &fixture.entry(index),
            &fixture.roots[index],
        )
        .unwrap();
    }
    let before = header.state.valuation;
    let mut last = fixture.roots[2].clone();
    last.positions[1].virtual_scaled += 1;
    assert!(value_member(
        &mut header,
        &mut page,
        fixture.member_keys[2],
        &fixture.entry(2),
        &last
    )
    .is_err());
    assert_eq!(header.state.valuation, before);
    assert_eq!(page.row_count, 2);
}

#[cfg(feature = "liquidity-execution-qualification")]
#[test]
fn prepared_and_frozen_row_layout_offsets_are_literal() {
    let fixture = Fixture::new();
    let header = fixture.header();
    let mut bytes = Vec::new();
    crate::wire::write_discriminated(&header, &mut bytes).unwrap();
    assert_eq!(bytes.len(), 1460);
    assert_eq!(8 + PreparedSettlement::INIT_SPACE, 1460);
    assert_eq!(
        &bytes[..8],
        &solana_sha256_hasher::hash(b"account:PreparedSettlement").to_bytes()[..8]
    );
    assert_eq!(&bytes[50..58], &2u64.to_le_bytes());
    assert_eq!(&bytes[90..98], &10u64.to_le_bytes());
    assert_eq!(&bytes[146..154], &3u64.to_le_bytes());
    assert_eq!(&bytes[186..194], &100u64.to_le_bytes());
    assert_eq!(&bytes[202..218], &(3 * SCALE).to_le_bytes());
    assert_eq!(&bytes[234..242], &27u64.to_le_bytes());
    assert_eq!(bytes[306], PREPARE_INDEX);
    let (mut header, mut page) = fixture.value_state();
    value_member(
        &mut header,
        &mut page,
        fixture.member_keys[0],
        &fixture.entry(0),
        &fixture.roots[0],
    )
    .unwrap();
    bytes.clear();
    crate::wire::write_discriminated(&page, &mut bytes).unwrap();
    assert_eq!(bytes.len(), 1156);
    assert_eq!(8 + FrozenMarginPage::INIT_SPACE, 1156);
    assert_eq!(bytes[66], 1);
    assert_eq!(&bytes[75..107], fixture.member_keys[0].as_ref());
    assert_eq!(&bytes[163..179], &(-8_750_000_000i128).to_le_bytes());
    assert_eq!(&bytes[195..203], &3u64.to_le_bytes());
}

#[test]
fn rate_proposal_layout_separates_attempt_budget_and_word_progress() {
    let mut rates = SettlementRates {
        schema_version: crate::state::accounts::SCHEMA_VERSION,
        revision: 7,
        epoch: 3,
        attempt: 11,
        stage: 2,
        last_progress_slot: 99,
        factor: [13, 0, 0, 0, 0],
        lengths: [2, 3],
        uploaded: [2, 1],
        ..Default::default()
    };
    rates.state.insurance =
        financial_core::clearing::scalable::insurance_rounds::InsuranceRounds::new([17, 19])
            .unwrap()
            .checkpoint();
    let mut bytes = Vec::new();
    crate::wire::write_discriminated(&rates, &mut bytes).unwrap();
    assert_eq!(bytes.len(), 1204);
    assert_eq!(8 + SettlementRates::INIT_SPACE, 1204);
    assert_eq!(
        &bytes[..8],
        &solana_sha256_hasher::hash(b"account:SettlementRates").to_bytes()[..8]
    );
    assert_eq!(&bytes[58..66], &11u64.to_le_bytes());
    assert_eq!(bytes[66], 2);
    assert_eq!(&bytes[99..107], &99u64.to_le_bytes());
    assert_eq!(&bytes[107..115], &13u64.to_le_bytes());
    assert_eq!(&bytes[147..155], &2u64.to_le_bytes());
    assert_eq!(&bytes[171..179], &1u64.to_le_bytes());
    assert_eq!(&bytes[179..243], &rates.state.insurance);
    assert_eq!(&bytes[243..1203], &[0; 960]);
}

#[cfg(not(feature = "liquidity-execution-qualification"))]
#[test]
fn default_build_rejects_frozen_preparation_before_any_state_write() {
    // The same otherwise-valid source succeeds in the qualification tests.
    let fixture = Fixture::new();
    let mut header = PreparedSettlement::default();
    let mut before = Vec::new();
    crate::wire::write_discriminated(&header, &mut before).unwrap();
    assert!(fixture.source().validate().is_err());
    assert!(fixture.source().initialize(&mut header).is_err());
    let mut after = Vec::new();
    crate::wire::write_discriminated(&header, &mut after).unwrap();
    assert_eq!(after, before);
}

#[test]
#[cfg(feature = "liquidity-execution-qualification")]
fn adopted_source_fences_legacy_and_authenticates_partial_exposure_and_final_buckets() {
    let mut fixture = Fixture::new();
    let header = fixture.header();
    let plan = SettlementPlan {
        adoption_revision: 11,
        insurance_spent: [1, 2],
        ..Default::default()
    };
    assert!(fixture
        .source()
        .adopted(&header, &plan, [4, 2], false)
        .is_err());
    fixture.resolution.stage = PAGED_APPLY;
    fixture.resolution.revision += 1;
    assert!(fixture.source().matches(&header).is_err());
    fixture
        .source()
        .adopted(&header, &plan, [4, 2], false)
        .unwrap();
    fixture.markets[0].gross_lots = 2;
    assert!(fixture
        .source()
        .adopted(&header, &plan, [4, 2], false)
        .is_err());
    fixture
        .source()
        .adopted(&header, &plan, [2, 2], false)
        .unwrap();
    fixture.ledgers[0].insurance -= 1;
    assert!(fixture
        .source()
        .adopted(&header, &plan, [2, 2], false)
        .is_err());
    fixture.ledgers[0].insurance += 1;
    fixture.resolution.revision += 1;
    assert!(fixture
        .source()
        .adopted(&header, &plan, [2, 2], false)
        .is_err());
    fixture.resolution.revision -= 1;
    for market in 0..2 {
        fixture.markets[market].gross_lots = 0;
        fixture.ledgers[market].insurance -= plan.insurance_spent[market];
        fixture.ledgers[market].settlement = 0;
    }
    fixture
        .source()
        .adopted(&header, &plan, [0; 2], true)
        .unwrap();
    fixture.ledgers[1].fees -= 1;
    assert!(fixture
        .source()
        .adopted(&header, &plan, [0; 2], true)
        .is_err());
    fixture.ledgers[1].fees += 1;
    fixture.custody.allocated_vault -= 1;
    assert!(fixture
        .source()
        .adopted(&header, &plan, [0; 2], true)
        .is_err());
}
