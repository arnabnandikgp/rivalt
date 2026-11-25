#!/usr/bin/env bash
# Dedicated canonical membership/default verifier probe. This does not admit a candidate to normal runtime.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export RIVALT_SETTLEMENT_ARTIFACT_DIR="${RIVALT_SETTLEMENT_ARTIFACT_DIR:?explicit pinned candidate required}"
export RIVALT_ARTIFACT_DIR="${RIVALT_ARTIFACT_DIR:-.local/anchor-rc2/current}"
node --import tsx ops/verify-liquidity-artifacts.ts "$RIVALT_ARTIFACT_DIR"
if [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == execution-router* ]]; then
  node --import tsx --input-type=module -e 'import {routerBuild} from "./tests/rpc-contract/execution-router-build.ts"; routerBuild()'
elif [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-partitioned-population || "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-populated-rates || "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-original-budgets || "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-foreign-caps || "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-winner-allocations || "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-pair-schedule || "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-joint-settlement ]]; then
  node --import tsx --input-type=module -e 'import {verifyPartitionedBuild} from "./tests/rpc-contract/profit-attribution-build.ts";verifyPartitionedBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR,process.env.RIVALT_SETTLEMENT_PROBE);'
elif [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-successor-* ]]; then
  node --import tsx --input-type=module -e 'import {verifyProfitBuild} from "./tests/rpc-contract/profit-attribution-build.ts";verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR,false,false,false,false,"successor");'
  if [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-successor-recovery ]]; then
    [[ "${RIVALT_FROZEN_PLAN_PROOF:-0}" == 1 && "${RIVALT_RECOVERY_SCHEDULE_BUDGET:-}" =~ ^[1-9][0-9]*$ ]]
    [[ "${RIVALT_FROZEN_PLAN_CASE:-}" == paged-wallet || "${RIVALT_FROZEN_PLAN_CASE:-}" == paged-insurance ]]
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts";new SettlementPages(undefined,process.env.RIVALT_SUCCESSOR_BUILD??"local-successor-candidate");'
  fi
elif [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-owned-integrated || "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-integrated-* ]]; then
  node --import tsx --input-type=module -e 'import {verifyProfitBuild} from "./tests/rpc-contract/profit-attribution-build.ts";verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR,false,false,false,false,"integrated");'
  if [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-owned-integrated ]]; then
    test "${RIVALT_FROZEN_PLAN_PROOF:-0}" = 1
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts";new SettlementPages(undefined,"integrated-recovery-candidate");'
  fi
elif [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-owned-paged ]]; then
  test "${RIVALT_FROZEN_PLAN_PROOF:-0}" = 1 && [[ "${RIVALT_FROZEN_PLAN_CASE:-}" == paged-wallet || "${RIVALT_FROZEN_PLAN_CASE:-}" == paged-insurance ]]
  node --import tsx --input-type=module -e 'import {verifyProfitBuild} from "./tests/rpc-contract/profit-attribution-build.ts";verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR,false,false,false,false,"paged");'
  node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts";new SettlementPages(undefined,"paged-recovery-candidate");'
elif [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-owned-* ]]; then
  test "${RIVALT_FROZEN_PLAN_PROOF:-0}" = 1
  node --import tsx --input-type=module -e 'import {verifyProfitBuild} from "./tests/rpc-contract/profit-attribution-build.ts";verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR,false,false,false,false,"owned");'
  node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts";new SettlementPages(undefined,"recovery-search-candidate");'
elif [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution* ]]; then
  node --import tsx --input-type=module -e 'import {verifyProfitBuild} from "./tests/rpc-contract/profit-attribution-build.ts"; verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR,process.env.RIVALT_SETTLEMENT_PROBE.includes("sponsor"),process.env.RIVALT_SETTLEMENT_PROBE.includes("verified-pair"), process.env.RIVALT_SETTLEMENT_PROBE.includes("btc-residual"),process.env.RIVALT_SETTLEMENT_PROBE.includes("btc-allocation"),process.env.RIVALT_SETTLEMENT_PROBE.startsWith("profit-attribution-ledger-")?"ledger":["profit-attribution-market-lanes","profit-attribution-market-lane-funding","profit-attribution-market-lane-payout"].includes(process.env.RIVALT_SETTLEMENT_PROBE)?"lane":process.env.RIVALT_SETTLEMENT_PROBE==="profit-attribution-checked-funding"?"funding":["profit-attribution-bounded-market","profit-attribution-bounded-market-apply","profit-attribution-bounded-market-receiver","profit-attribution-cross-fill-funding"].includes(process.env.RIVALT_SETTLEMENT_PROBE)?"market":["profit-attribution-fee-lanes","profit-attribution-fee-lanes-apply","profit-attribution-cross-maker-capacity"].includes(process.env.RIVALT_SETTLEMENT_PROBE)?"fees":(process.env.RIVALT_SETTLEMENT_PROBE==="profit-attribution-route-locks" || process.env.RIVALT_SETTLEMENT_PROBE.startsWith("profit-attribution-multi-lot-")&&process.env.RIVALT_SETTLEMENT_PROBE!=="profit-attribution-multi-lot-search")?"multi":["profit-attribution-inventory-book-expanded","profit-attribution-inventory-book-expanded-apply","profit-attribution-multi-lot-search"].includes(process.env.RIVALT_SETTLEMENT_PROBE)?"capacity":["profit-attribution-inventory-book-apply","profit-attribution-inventory-book-capacity"].includes(process.env.RIVALT_SETTLEMENT_PROBE)?"book":(process.env.RIVALT_SETTLEMENT_PROBE.startsWith("profit-attribution-scarce-inventory-") && process.env.RIVALT_SETTLEMENT_PROBE.endsWith("-apply"))?"partial":process.env.RIVALT_SETTLEMENT_PROBE==="profit-attribution-shared-inventory-apply"?"shared":process.env.RIVALT_SETTLEMENT_PROBE==="profit-attribution-foreign-winner-apply"?"foreign":["profit-attribution-linked-allocation","profit-attribution-foreign-winner-gate"].includes(process.env.RIVALT_SETTLEMENT_PROBE)?"allocation":["profit-attribution-linked-flat-apply","profit-attribution-linked-contested"].includes(process.env.RIVALT_SETTLEMENT_PROBE)?"flat":process.env.RIVALT_SETTLEMENT_PROBE==="profit-attribution-linked-apply");'
  if [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-scarce-inventory-*-apply ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"partial-inventory-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-bounded-market-apply ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"bounded-market-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-fee-lanes-apply ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"aggregate-fee-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-multi-lot-apply || "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-multi-lot-tie ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"multi-lot-book-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-inventory-book-expanded || "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-inventory-book-expanded-apply || "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-multi-lot-search ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"book-capacity-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-inventory-book-apply || "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-inventory-book-capacity ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"book-inventory-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-shared-inventory-apply ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"shared-inventory-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-foreign-winner-apply ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"foreign-creditor-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-linked-allocation || "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-foreign-winner-gate ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"linked-allocation-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-linked-flat-apply || "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-linked-contested ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"linked-flat-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-linked-apply ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"linked-pair-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-btc-allocation* ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"btc-allocation-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-btc-residual* ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"btc-residual-candidate");'
  elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-verified-pair* ]]; then
    node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"verified-pair-candidate");'
  fi
elif [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == maker-liquidation ]]; then
  node --import tsx --input-type=module -e 'import {verifyLiquidationBuild} from "./tests/rpc-contract/maker-liquidation-build.ts"; verifyLiquidationBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR);'
elif [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == whole-account-risk ]]; then
  node --import tsx --input-type=module -e 'import {verifyRiskBuild} from "./tests/rpc-contract/risk-build.ts"; verifyRiskBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR);'
else
  node --import tsx --input-type=module -e 'import {verifyBackingBuild} from "./tests/rpc-contract/backing-artifacts.ts"; verifyBackingBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR);'
fi

if [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == default-worker ]]; then
  node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages();'
fi

if [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == account-clients ]]; then
  node --import tsx tests/browser/preflight.ts
fi

if [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution-joint-settlement ]]; then
  CARGO_INCREMENTAL=0 cargo build --locked --offline -p clearing --example settlement-plan-pages --features state-only,populated-recovery-qualification
  CARGO_INCREMENTAL=0 cargo build --locked --offline -p rivalt-settlement-pages --features clearing/populated-recovery-qualification
elif [[ "${RIVALT_SETTLEMENT_PLAN:-0}" == 1 ]]; then
  cargo build --locked -p clearing --example settlement-plan-pages --features state-only
fi
test "$(surfpool --version)" = 'surfpool 1.7.0'
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-18951}"
export RIVALT_WS_PORT="${RIVALT_WS_PORT:-18952}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT"
export RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/scalable-settlement/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
test ! -e "$RIVALT_RUN_DIR"
python3 ops/check-ports.py "$RIVALT_RPC_PORT" "$RIVALT_WS_PORT"
mkdir -p "$RIVALT_RUN_DIR"
if command -v caffeinate >/dev/null; then caffeinate -i -w $$ & fi
surfpool start --offline --no-deploy --no-tui --no-studio --disable-instruction-profiling \
  --port "$RIVALT_RPC_PORT" --ws-port "$RIVALT_WS_PORT" --slot-time 50 \
  --airdrop-keypair-path .local/keys/payer.json --log-path "$RIVALT_RUN_DIR/logs" \
  > "$RIVALT_RUN_DIR/surfpool.log" 2>&1 &
RIVALT_SETTLEMENT_SURFPOOL_PID=$!
trap 'if [[ -n "${RIVALT_PG_CONTAINER:-}" ]]; then container stop "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; fi; kill "$RIVALT_SETTLEMENT_SURFPOOL_PID" 2>/dev/null || true; wait "$RIVALT_SETTLEMENT_SURFPOOL_PID" 2>/dev/null || true' EXIT
ready=0
for _ in {1..100}; do
  kill -0 "$RIVALT_SETTLEMENT_SURFPOOL_PID" 2>/dev/null || { echo 'Owned Surfpool exited' >&2; exit 1; }
  if curl -fsS --connect-timeout 1 --max-time 2 "$RIVALT_RPC_URL" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | rg -q '"ok"'; then ready=1; break; fi
  sleep 0.1
done
[[ "$ready" == 1 ]] || { echo 'Owned Surfpool not ready' >&2; exit 1; }
for component in clearing maker_a maker_b oracle_fixture; do
  key_name="${component//_/-}"
  artifact="$RIVALT_ARTIFACT_DIR/$component.so"
  if [[ "$component" != oracle_fixture ]]; then artifact="$RIVALT_SETTLEMENT_ARTIFACT_DIR/$component.so"; fi
  solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/$component-buffer.json" >/dev/null
  solana program deploy "$artifact" --buffer "$RIVALT_RUN_DIR/$component-buffer.json" \
    --program-id ".local/keys/$key_name.json" --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" \
    --use-rpc --max-sign-attempts 20 --output json > "$RIVALT_RUN_DIR/$component-deployment.json"
done
if [[ "${RIVALT_SETTLEMENT_PROBE:-default}" == execution-router* || "${RIVALT_SETTLEMENT_PROBE:-default}" == profit-attribution* || "${RIVALT_SETTLEMENT_APPLY:-0}" == 1 || "${RIVALT_SETTLEMENT_PROBE:-default}" == maintained-backing* || "${RIVALT_SETTLEMENT_PROBE:-default}" == whole-account-risk || "${RIVALT_SETTLEMENT_PROBE:-default}" == maker-liquidation || "${RIVALT_SETTLEMENT_PROBE:-default}" == freeze-cutoff || "${RIVALT_SETTLEMENT_PROBE:-default}" == backing-worker || "${RIVALT_SETTLEMENT_PROBE:-default}" == default-worker || "${RIVALT_SETTLEMENT_PROBE:-default}" == account-clients ]]; then source ops/postgres.sh; fi
if [[ "${RIVALT_FROZEN_PLAN_PROOF:-0}" == 1 && ( "$RIVALT_SETTLEMENT_PROBE" != profit-attribution-owned-* && "$RIVALT_SETTLEMENT_PROBE" != profit-attribution-successor-recovery || "${RIVALT_FROZEN_PLAN_CASE:-}" == paged-meter || "${RIVALT_FROZEN_PLAN_CASE:-}" == paged-coverage ) ]]; then bash ops/deploy-frozen-plan-probe.sh; fi
case "${RIVALT_SETTLEMENT_PROBE:-default}" in
  execution-router-bounded-entry-inventory|execution-router-mixed-storage) node --import tsx tests/rpc-contract/maker-storage-rpc.ts ;;
  execution-router-feasible-books) node --import tsx tests/rpc-contract/feasible-book-rpc.ts ;;
  execution-router-matched-makers) node --import tsx tests/rpc-contract/comparison-rpc.ts ;;
  execution-router-multi-price-limits) node --import tsx tests/rpc-contract/multi-price-limits-rpc.ts ;;
  execution-router-multi-width) node --import tsx tests/rpc-contract/multi-width-rpc.ts ;;
  execution-router-multi-fills) node --import tsx tests/rpc-contract/multi-maker-rpc.ts ;;
  execution-router-wide-fills) node --import tsx tests/rpc-contract/wide-fills-rpc.ts ;;
  execution-router-wide-directory) node --import tsx tests/rpc-contract/wide-directory-rpc.ts ;;
  execution-router-bounded-entry-benchmark|execution-router-funded-benchmark) node --import tsx tests/rpc-contract/depth-benchmark-rpc.ts ;;
  execution-router-load) node --import tsx tests/rpc-contract/router-load-rpc.ts ;;
  execution-router-bounded-entry|execution-router-notional|execution-router-closed-quantity) node --import tsx tests/rpc-contract/router-notional-rpc.ts ;;
  execution-router) node --import tsx tests/rpc-contract/execution-router-rpc.ts ;;
  default) node --import tsx tests/rpc-contract/scalable-settlement-rpc.ts ;;
  maintained-backing) node --import tsx tests/rpc-contract/maintained-backing-rpc.ts ;;
  backing-worker) node --import tsx tests/rpc-contract/maintained-backing-worker-rpc.ts ;;
  default-worker) node --import tsx tests/rpc-contract/default-worker-rpc.ts
    python3 tests/financial/check_default_worker.py "$RIVALT_RUN_DIR" > "$RIVALT_RUN_DIR/independent-worker-audit.json" ;;
  account-clients) pnpm build:trader
    node --import tsx tests/rpc-contract/account-lifecycle-client-rpc.ts ;;
  profit-attribution-checked-funding|profit-attribution-cross-fill-funding) node --import tsx tests/rpc-contract/cross-fill-funding-rpc.ts ;;
  profit-attribution-cross-maker-capacity|profit-attribution-bounded-market) node --import tsx tests/rpc-contract/cross-maker-capacity-rpc.ts ;;
  profit-attribution-successor-warm-payout|profit-attribution-successor-delayed-payout|profit-attribution-integrated-warm-payout|profit-attribution-integrated-delayed-payout) node --import tsx tests/rpc-contract/ordinary-timing-rpc.ts ;;
  profit-attribution-integrated-payout|profit-attribution-market-lane-payout|profit-attribution-ledger-payout) node --import tsx tests/rpc-contract/market-lane-payout-rpc.ts ;;
  profit-attribution-successor-funding|profit-attribution-integrated-funding|profit-attribution-market-lane-funding|profit-attribution-ledger-funding) node --import tsx tests/rpc-contract/market-lane-funding-rpc.ts ;;
  profit-attribution-successor-populated-keeper|profit-attribution-successor-population|profit-attribution-partitioned-population|profit-attribution-populated-rates|profit-attribution-original-budgets|profit-attribution-foreign-caps|profit-attribution-winner-allocations|profit-attribution-pair-schedule|profit-attribution-joint-settlement) node --import tsx tests/rpc-contract/successor-population-rpc.ts ;;
  profit-attribution-successor-workload|profit-attribution-integrated-lanes|profit-attribution-ledger-lanes|profit-attribution-market-lanes|profit-attribution-route-locks|profit-attribution-fee-lanes) node --import tsx tests/rpc-contract/successor-route-locks-rpc.ts ;;
  profit-attribution-bounded-market-apply|profit-attribution-fee-lanes-apply|profit-attribution-multi-lot-search|profit-attribution-multi-lot-apply|profit-attribution-multi-lot-tie)
    cargo build --locked --offline -p default-plan-selection --features native-search --example multi_lot_audit
    node --import tsx tests/rpc-contract/multi-lot-search-rpc.ts ;;
  profit-attribution-inventory-book-capacity|profit-attribution-inventory-book-expanded) node --import tsx tests/rpc-contract/inventory-book-capacity-rpc.ts ;;
  profit-attribution-successor-recovery|profit-attribution-owned-paged|profit-attribution-owned-integrated|profit-attribution-owned-cross|profit-attribution-owned-tie|profit-attribution-linked|profit-attribution-btc-allocation-linked|profit-attribution-linked-apply|profit-attribution-linked-flat|profit-attribution-linked-flat-apply|profit-attribution-linked-contested|profit-attribution-linked-allocation|profit-attribution-foreign-winner-ordinary|profit-attribution-foreign-winner-gate|profit-attribution-foreign-winner-apply|profit-attribution-shared-inventory|profit-attribution-shared-inventory-apply|profit-attribution-scarce-inventory-one-apply|profit-attribution-scarce-inventory-one-ordinary|profit-attribution-scarce-inventory-zero-apply|profit-attribution-scarce-inventory-floor-apply|profit-attribution-inventory-book-ordinary|profit-attribution-inventory-book-apply|profit-attribution-inventory-book-expanded-apply)
    cargo build --locked --offline -p financial-core --bin scalable-settlement-driver
    if [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-inventory-book-* ]]; then
      cargo build --locked --offline -p default-plan-selection --example single_lot_assignment
    fi
    if [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-owned-* || "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-successor-recovery ]] && [[ -n "${RIVALT_RECOVERY_SCHEDULE_BUDGET:-}" ]]; then
      cargo build --locked --offline --release -p default-plan-selection --features keeper --bin rivalt-recovery-selector
    fi
    node --import tsx tests/rpc-contract/linked-default-recovery-rpc.ts
    if [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-owned-paged || "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-successor-recovery ]] && [[ "${RIVALT_FROZEN_PLAN_CASE:-}" == paged-wallet ]]; then
      node --import tsx tests/rpc-contract/recovery-wire-conformance.ts "$RIVALT_RUN_DIR" --paged
    elif [[ "$RIVALT_SETTLEMENT_PROBE" == profit-attribution-owned-* && "${RIVALT_FROZEN_PLAN_CASE:-}" != paged-* ]]; then
      node --import tsx tests/rpc-contract/recovery-wire-conformance.ts "$RIVALT_RUN_DIR"
    fi ;;
  profit-attribution-sponsor) node --import tsx tests/rpc-contract/profit-capacity-rpc.ts ;;
  profit-attribution-recovery|profit-attribution-sponsor-recovery|profit-attribution-verified-pair|profit-attribution-verified-pair-limited|profit-attribution-btc-residual-*|profit-attribution-btc-allocation-*) node --import tsx tests/rpc-contract/btc-default-recovery-rpc.ts ;;
  profit-attribution) node --import tsx tests/rpc-contract/profit-attribution-rpc.ts ;;
  profit-attribution-successor-automatic-liquidation|profit-attribution-integrated-automatic-liquidation|profit-attribution-integrated-receiver|profit-attribution-bounded-market-receiver|maker-liquidation) node --import tsx tests/rpc-contract/maker-liquidation-rpc.ts ;;
  whole-account-risk) node --import tsx tests/rpc-contract/whole-account-risk-rpc.ts ;;
  freeze-cutoff) node --import tsx tests/rpc-contract/freeze-cutoff-rpc.ts ;;
  membership-races) node --import tsx tests/rpc-contract/membership-races-rpc.ts ;;
  *) echo 'Unknown settlement probe' >&2; exit 1 ;;
esac
printf 'Qualification evidence: %s\n' "$RIVALT_RUN_DIR"
