# Deliberate regression fixtures

These inputs exercise decoders, exact finality, independent arithmetic and adverse audit cases without requiring local run archives. They are **test fixtures, not complete acceptance reports or new live-test results**. Full original captures remain unchanged at their local `docs/evidence/` paths.

- `btc-account.hex` and `collateral-account.hex`: exact 134-byte PriceUpdateV2 captures from P13's `ffc20f3` observation. Rust and SVM boundary checks consume these small protocol messages.
- `pyth-provenance.json`: one BTC account and the update/verifier fields read by the independent proof decoder. Omitted transaction metadata is not needed by these regression tests.
- `oracle-finality.json`: one actual normal observation's wire, event and required transaction fields, replacing a full journal dependency in the SDK transport tests.
- `devnet-consumption.json`: the upstream proofs, selected original trade/failure instructions and integer deltas needed to test the P13 auditor. Other journal entries and unrelated report fields are omitted; this fixture does not establish complete run coverage.
- `p14-*.json`: only fields consumed by the P14 auditors. Lifecycle account data is an explicitly truncated field prefix, and the predecessor hash binds the projected fixture bytes. This tests accounting and lineage rejection, not full account authenticity or original-run completeness. The CLI auditors still accept the untouched full local reports for that purpose.

The JSON data is intentionally bounded and reviewable. Updating it requires explaining the new regression case; copying an entire run here is not an alternative to the local-evidence policy. The tracked source budget is 96 KiB per file and 200 KiB total, enforced by `ops/check-evidence-policy.py`.
