#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
python3 tests/financial/test_maker_curve_contract.py
cargo test --locked -p maker-interface --lib canonical::tests
cargo test --locked -p maker-interface --test large_quantities
cargo build --locked -p maker-interface --bin curve-reference-driver
python3 tests/financial/check_maker_curve_parity.py --implementation rust
python3 tests/financial/test_account_contract.py
python3 tests/financial/test_clearing_network.py
cargo build --locked -p financial-core --features three-market-model --example three_market_default --example market_settlement
python3 tests/financial/test_market_indexed_default.py
python3 tests/financial/test_three_market_default.py
python3 tests/financial/test_three_market_reduction.py
cargo test --locked -p default-plan-selection --features three-market-search --lib three_market::tests
cargo build --locked -p default-plan-selection --features three-market-search --example three_market_competition
python3 tests/financial/test_three_market_competition.py
cargo test --locked -p financial-core --features three-market-model --lib market_settlement::
python3 tests/financial/test_bounded_clearing.py
python3 tests/financial/test_market_settlement.py
cargo test --locked -p financial-core --features parallel-market-prototype
cargo build --locked -p financial-core --bin reference-driver
python3 tests/financial/reference.py | tee .local/p02-financial.json
cargo build --locked -p financial-core --bin clearing-wide-driver --bin clearing-row-driver --bin clearing-atoms-driver
python3 tests/financial/test_clearing_wide.py
python3 tests/financial/test_clearing_rows.py
python3 tests/financial/test_clearing_atoms.py
cargo build --locked -p financial-core --bin scalable-wide-driver --bin scalable-settlement-driver --bin scalable-snapshot-driver --bin scalable-rate-driver
python3 tests/financial/test_scalable_wide.py
python3 tests/financial/test_normalized_pages.py
python3 tests/financial/test_paged_atom_division.py
python3 tests/financial/test_paged_rates.py
python3 tests/financial/test_paged_frozen_collections.py
python3 tests/financial/test_paged_flows.py
python3 tests/financial/test_paged_order.py
python3 tests/financial/test_paged_rounding.py
python3 tests/financial/test_cohort_denominator.py
python3 tests/financial/test_scalable_snapshot.py
python3 tests/financial/test_scalable_settlement.py
python3 tests/financial/test_settlement_liquidation_model.py
python3 tests/financial/test_adl_eligibility.py
cargo test --locked -p clearing-accounting --features surviving-profit attribution
cargo test --locked -p clearing-accounting --features surviving-profit --test position_history_storage --test market_slots
cargo test --locked -p financial-core --features closed-quantity-model --test closed_quantity_payout
cargo build --locked -p financial-core --features closed-quantity-model --example bounded_entry_comparison --example authenticated_entry_replay --example entry_cost_decisions
python3 tests/financial/test_bounded_entry.py
python3 tests/financial/test_entry_bounds.py
python3 tests/financial/test_fixed_entry.py
python3 tests/financial/test_authenticated_entry_replay.py
python3 tests/financial/test_payment_attribution.py
python3 tests/financial/test_freeze_cutoff.py
python3 tests/financial/test_cross_market_adl.py
python3 tests/financial/test_creditor_payout_floors.py
python3 tests/financial/test_joint_reductions.py
python3 tests/financial/test_joint_market_ties.py
python3 tests/financial/test_frozen_cash_allocation.py
python3 tests/financial/test_native_protected_receipts.py
python3 tests/financial/test_default_plan_certificate.py
python3 tests/financial/test_bounded_default_search.py
cargo test --locked -p default-plan-selection --lib --test proportional
cargo build --locked -p default-plan-selection --example measure --example single_lot_assignment
python3 tests/financial/check_shared_inventory.py
python3 tests/financial/test_metered_default_proof.py
python3 tests/financial/test_frozen_attribution_input.py
python3 tests/financial/test_scalable_clearing.py
python3 tests/financial/test_incremental_backing.py
cargo build --locked -p financial-core --bin backing-driver
python3 tests/financial/test_maintained_backing.py
python3 tests/financial/test_payout_coverage_summary.py

cargo test --locked -p default-plan-selection --features native-search --test multi_lot
cargo build --locked -p default-plan-selection --features native-search --example multi_lot_audit
python3 tests/financial/check_multi_lot_search.py
cargo build --locked -p default-plan-selection --features native-joint --example joint_reduction_audit
RIVALT_JOINT_AUDIT=target/debug/examples/joint_reduction_audit python3 tests/financial/test_populated_recovery_bound.py
python3 tests/financial/check_joint_reductions.py
python3 tests/financial/check_joint_search.py
cargo test --locked -p default-plan-selection --features keeper --bin rivalt-recovery-selector
