# P25 — funded exits and market claim settlement

D60 and the [funded-exit proof](P22B-FINANCIAL-CONTRACT.md#2-funded-withdrawals-local-arithmetic-proof)
remain authoritative. This phase extends P24 in a separate
`account-cash-qualification` build. It does not qualify liquidation/default or
enable ordinary schema-3 trading. WORKLOG owns implementation/acceptance status.

Cash and claims have different authorization dependencies:

| Operation | Required financial checks |
|---|---|
| Owner deposit | Actual classic SPL transfer; unfrozen profile and exact owner/mint/root; no source prerequisite |
| Owner withdrawal | Full current funding/book refresh, post-withdrawal IM plus reservations, nonnegative risk equity at all four held-funding corners, actual SPL transfer in the same transaction |
| Same-owner transfer | Identical donor admission; recipient consumes its current funding; no health requirement to receive cash; total cash/vault unchanged |
| Permissionless loss collection | Whole negative entitlement at the common index; the debtor's cash covers both gross negative common claims; no choice of market can collect from an underfunded debtor |
| Permissionless gain payment | Whole positive entitlement and actual selected P; completed selected-market backing certificate; recipient final full health |
| Owner flat cross netting | Both positions flat, no live ordinary/protective order authority; source payment certificate and actual source P; move backing between P ledgers and reduce both claims, leave C unchanged |
| Fee allocation/withdrawal | Separate fee authority; actual attributed T only; no active insurance withdrawal or claim credit |

Cancelled/invalidated TP/SL records may retain historical allowance. Those records
carry no execution authority without a live order and do not block flat netting.
Account identity admission and actual reserve donations remain available in the
active candidate profile. New members invalidate payment certificates; I/T changes
do not. Treasury withdrawals cannot consume I or P, and active reserve exits are
absent. Active deposits never bypass custody withdrawal admission.

Ordinary funded exits never supply a global cohort certificate or historical event
sequence. Root/safety guards, canonical markets and actual landed state remain
mandatory. Flat fixed claims need no artificial fresh price. Negative claims,
fractions, reservations and pending funding cannot be omitted. All consumed
funding prefixes persist in the markets in the same transaction.

Gain payment certificates scan the complete canonical stable registry, at most
two read-only roots per instruction. Each selected-market debtor must independently
cover its gross obligations in both markets under the required conservative price/
held-funding corners. Positive receivables, I and T are excluded. Selected-market
net quantity and aggregate scaled claim reconcile to its P. A certificate is not
an account cash entitlement, payment queue or promise of instant profit payment.

Progress binds membership, safety and the selected liability version. Every root
cash/claim mutation with selected exposure/claims already invalidates that version,
including changes caused in the other market. Observation and funding stamps bind
only the sources required by the scanned selected debtors/exposure. Unrelated
ETH-only debt/cash activity does not become a BTC payment dependency. Canonical
pages cannot omit, repeat or reorder roots; changed required stamps restart.

The existing 234-byte certificate layout is retained. Its `cash` accumulator records
cash in roots with selected exposure/claims, not a fungible shared backing pool.
`lots` records both sampled quantity sums; only the selected sum is certified.
Other-market quantity may change during an otherwise valid scoped scan. Every
debtor's whole-account coverage is checked separately. Pool changes invalidate
the selected liability stamp, and funding/source observations are rechecked when
the completed certificate is consumed.

P25 acceptance requires independent literal cases against the real handlers,
all held-funding corners, reservations/delegates, unfunded-netting rejection,
fractional retention, fee/reserve authority, complete/invalidated certificates,
actual token rollback, generated/legacy parity and signed SVM plus real RPC/WS.
Prepare an admissible withdrawal, perform ordinary sampling/unrelated actions,
then land the unchanged exit in one transaction. P28 separately owns sustained
concurrent qualification; P27 owns new real PostgreSQL projection. Neither old
profile evidence nor a pure reference calculation closes this phase.
