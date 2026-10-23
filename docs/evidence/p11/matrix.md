# Integrated acceptance — pass

Source: `806715981a5012a0ec48f452766dc636c52d0c81`

| Scenario | Result | Evidence / reason |
|---|---|---|
| A01 Stack, SDK and signed RPC | pass | regression/summary.json |
| A02 Cash, claims and custody | pass | regression/financial.json, regression/custody.json |
| A03 Maker interface and capital | pass | regression/maker-rpc.json |
| A04 Atomic one/two-maker routes | pass | regression/route-rpc.json |
| A05 Quote races and current authority | pass | regression/route-rpc.json, lifecycle/lifecycle.json |
| A06 Indexer, database and reset recovery | pass | regression/indexer-rpc.json, regression/indexer-reset.json |
| A07 Complete funded lifecycle | pass | lifecycle/lifecycle.json |
| A08 Ambiguous submit and restart | pass | lifecycle/lifecycle.json |
| A09 Authenticated source failures | pass | oracle/oracle.json, oracle/oracle-svm.json |
| A10 Funding gaps and turnover | pass | oracle/oracle.json, oracle/oracle-svm.json |
| A11 Persistent orders and races | pass | orders/orders.json, orders/order-svm.json |
| A12 Existing-position TP/SL | pass | orders/orders.json, orders/order-svm.json, browser/browser.json |
| A13 Funded liquidation | pass | resolution/resolution.json, resolution/resolution-svm.json |
| A14 Complete-cohort default | pass | resolution/resolution.json, resolution/resolution-svm.json |
| A15 Wallet UI and API-stopped exits | pass | browser/browser.json |
| A16 Integrated fault matrix and independent conservation | pass |  |
| A17 Load and real 24-hour soak | not-run | Separate phase; not claimed by P11 |
| A18 Real dependency verification | not-run | Separate phase; not claimed by P11 |
| A19 Devnet parity | not-run | Separate phase; not claimed by P11 |
| A20 Independent maker | not-run | Separate phase; not claimed by P11 |
| A21 Funded pilot review | not-run | Separate phase; not claimed by P11 |

`matrix.json` retains faults, independent balances and all outcome populations.
