# Engineering MVP exit assessment

23 October 2026 · M1 through M5b · BTC / test collateral

The recorded implementation and acceptance evidence supports an engineering MVP of Rivalt: common clearing with separate competing A/B maker programs, an actual wallet UI, durable services and finalized PostgreSQL reconstruction. The bounded local and devnet gates pass within their declared profiles. The complete stack is integrated at `2bc298e`. D39 review fixes pass targeted program/service/browser checks, while the new maker initialization authentication still needs a narrow test-only devnet deployment verification; [WORKLOG](WORKLOG.md) is the authority for live phase/PR status. This assessment is not funded-pilot readiness.

## Evidence and configuration closure

| Engineering gate | Recorded evidence |
|---|---|
| G01–G03: exact stack, independent financial model, custody | [P01/P02 integration review](evidence/R004-REVIEW.md): locked build, isolated legacy Anchor conformance, real signed RPC round trip, exact units and custody |
| G04–G05: competing makers and atomic routes | [P03](evidence/P03.md), [P04](evidence/P04.md): funded capital, limited maker CPI, independent allocation/accounting and bounded one/two-maker messages |
| G06–G07: indexing, lifecycle and durable retries | [P05](evidence/P05.md), [P06](evidence/P06.md): real Surfpool/RPC/WS/PostgreSQL reconstruction, trade/settlement/exit and original-signature recovery |
| G08–G10: authenticated risk/funding, orders and exceptional resolution | [P07](evidence/P07.md), [P08](evidence/P08.md), [P09](evidence/P09.md): controlled local sources, bounded funding, existing-position TP/SL, funded liquidation and complete-cohort recovery |
| Browser and integrated local exit | [P10](evidence/P10.md), [P11](evidence/P11.md): wallet UI/direct exits and fresh A01–A16 integrated fault/reconciliation matrix; local instrumented wallet clearly distinguished from external Phantom |
| Revised A17 under D35 | [P12](evidence/P12.md): 30-minute qualification, 1,249/1,249 submitted trades, 71.19% normal offered availability, actual withdrawal and 12,454-transaction fresh PostgreSQL replay; recorded history-stage indexer pause |
| G11 / A18: real dependency and deployment identity | [P13](evidence/P13.md): separate devnet programs/mint/authorities, actual sponsored Core verification and accepted/rejected actions; missed live log recovered from the original signature |
| A19: actual devnet lifecycle, wallet and provider recovery | [P14](evidence/P14.md): approved source-age boundary/upgrade, actual service order/cancel/close/settle/withdraw, PostgreSQL recovery and independently fetched external-wallet registration |

These are attributed historical checks on exact recorded commits, not suites rerun in the P14 closeout. The P14 branch includes exact P13 head `93c1ef4131b96a485382b11f210704d7b085f0ef` and its verified predecessors. Configuration gates G01–G11 are satisfied for the engineering test profiles; G12 remains an external/funded gate.

## Cross-phase exit

The P13 one-lot opening is continued in P14 without recreating it. An actual 1,000-atom deposit survives a deliberately disconnected WS and discarded broadcast acknowledgement; restarted services recover its original signed bytes and exactly one event/cash effect. Real service order placement/cancellation precede an A close, complete-cohort loss collection/gain settlement and withdrawal. Independent raw-account arithmetic reconciles the final 1,000,000,470-atom vault, zero positions, zero unpaid claims and zero settlement pool. Failed initial wrappers remain retained; the successful continuation verifies their exact signature lineage instead of relabeling them.

On clean `e96806314735caaba6632138f69d8c2f8060aa3b`, the user manually connects Phantom and signs registration `2iLPo97byRamHdtR7Tq1aQfgvQN8JbsbDXDqza7MYa9CaVJpHpANXoMhDpEi1dsvA1sXh166AaZfA5dtXexrGTnc`. Independent RPC retrieval verifies the Ed25519 signature and exact canonical message, finalized at slot 514303068. The real read API records the same signature at sequence 58 and the new zero-cash participant. The raw audit reconciles 5,000 fee lamports and 4,790,440 rent lamports; the collateral vault is unchanged. Native browser automation was unavailable, so provider identity/signing interaction is user-reported; the transaction/account evidence is independently retrieved.

This is a composed cross-phase exit: CLI-owned test actors exercise the lifecycle, and the external wallet exercises registration/signing/landing. It does not claim that Phantom performed the complete financial lifecycle. The initial Phantom attempts added compute defaults and were blocked; explicit 400,000-CU / zero-priority-fee preparation resolves the observed case while preserving strict message equality.

## Limits and next gate

Devnet uses sponsored Pyth Core with intermittent freshness and an explicitly operator-controlled guard. Its approved maximum source age is 30 seconds; local/default remains 20. Six-second recovery, funding limits, confidence checks and stale restrictions remain intact. No continuous availability, mainnet throughput or independent-source assurance follows. Devnet closes against A; cross-maker close is separately established locally.

The UI is executable with `bash ops/devnet-demo.sh` and the documented secure local configuration, at `http://127.0.0.1:18088` for a bounded session. It loads no private signer or automated trading/source worker. Unfinished financial paths remain disabled in default builds, and test collateral has no redemption promise.

M6/P15–P16 still require independent maker/source participation, independent review, funded-risk/insurance/cost calibration and explicit pilot authorization. The continuous 24-hour endurance gate is deferred to P16 under D35, not passed. No paid service, outreach, external hedging or funded deployment is authorized by this engineering assessment. The immediate engineering action is to roll the reviewed maker initialization hardening into the existing test-only devnet deployment and verify the affected binding; external gates require their actual inputs and authorization.


D40's source-organization refactor is integrated through [PR #18](https://github.com/arnabnandikgp/rivalt/pull/18) at `4d4a908`. Fresh wire-ABI, pinned build and scoped signed-program checks pass on `a9d9f26`; WORKLOG R029 records their actual scope. This adds no live deployment, service-soak or independent-review claim. The pending deployment follow-up must retain explicit mappings between refactored source/build identities and the live programs.
