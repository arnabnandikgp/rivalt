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
python3 tests/financial/test_bounded_clearing.py
python3 tests/financial/test_market_settlement.py
cargo test --locked -p financial-core
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
python3 tests/financial/test_paged_flows.py
python3 tests/financial/test_paged_order.py
python3 tests/financial/test_paged_rounding.py
python3 tests/financial/test_cohort_denominator.py
python3 tests/financial/test_scalable_snapshot.py
python3 tests/financial/test_scalable_settlement.py
python3 tests/financial/test_settlement_liquidation_model.py
python3 tests/financial/test_adl_eligibility.py
python3 tests/financial/test_payment_attribution.py
python3 tests/financial/test_freeze_cutoff.py
python3 tests/financial/test_cross_market_adl.py
python3 tests/financial/test_creditor_payout_floors.py
python3 tests/financial/test_joint_reductions.py
python3 tests/financial/test_default_plan_certificate.py
python3 tests/financial/test_bounded_default_search.py
cargo build --locked -p default-plan-selection --example measure
python3 tests/financial/test_metered_default_proof.py
python3 tests/financial/test_frozen_attribution_input.py
python3 tests/financial/test_scalable_clearing.py
python3 tests/financial/test_incremental_backing.py
cargo build --locked -p financial-core --bin backing-driver
python3 tests/financial/test_maintained_backing.py
