# P27 — account services and finalized reconstruction

P27 implements A32/G21 on the qualified schema-3 local artifacts from P26. It
preserves the financial contract and leaves V1/V2 interfaces intact. P28 owns the
browser and sustained concurrency qualification. P15B/P16B remain external and
24-hour endurance remains Deferred.

## Implementation sequence

1. Authenticate every schema-3 critical event; rebuild venue, custody, safety,
   registry, portfolios, roots, markets, ledgers and maker registrations in the
   existing append-only PostgreSQL journal. Reconcile finalized account bytes and
   token backing before making a projection available. Reuse journal/retry transport,
   not V2 group accounting or its ordinary exit certificate.
2. Add a version-3 public deployment contract and direct account-aware SDK. Pin
   qualified executable identities, genesis and initialization anchor. Preserve
   original signed bytes/signatures for ambiguous submission recovery; cancellation
   and admissible funded withdrawal must work without the venue API.
3. Integrate maker, source/funding, order, settlement and risk workers. Derive
   dependencies from the account and operation; never make the event sequence an
   ordinary intent prerequisite. Use explicit operator budgets and durable jobs.
   Implement an untrusted exact rate proposer from current frozen chain inputs;
   it cannot supply authoritative payouts or depend on retained acceptance dumps.
4. Qualify actual Surfpool/RPC/WS/PostgreSQL lifecycles, fresh replay, raw-byte
   reconciliation, failed-transaction exclusion, lost acknowledgements, worker and
   indexer restart, and direct cancellation/exit. Record new sources and evidence;
   P26 counts do not qualify P27.

## Projection and intermediate states

Amounts and signed fractions are decimal strings in JSON; bytes are hex. Cash,
market settlement pools, insurance, retained fees and fee carries remain separate.
The registry supplies the complete stable root order. Events are authenticated CPI
payloads, not log messages; reverted events never enter the economic projection.
Unknown critical schemas, sequence gaps or immutable identity changes fail closed.

Default has a compact event-derived financial view, not a fabricated copy of the
wide arithmetic work account. Frozen rows retain original cash and claims. Partial
Apply changes individual roots while the custody total and pools retain their
frozen values. Reconcile that mixed root sum against remaining original cash plus
applied cash; only the completion event adopts the new aggregate buckets. Inspect
the canonical resolution header/pages against the event-derived fields. Wide
registers and DFS scratch are solver continuation state, not spendable balances.

Every RPC reconciliation chunk includes custody (the global discovery sequence)
and compares the same full custody bytes. A changing sequence requests backfill;
it never silently compares accounts from different economic snapshots. Unsequenced
permissionless precreation of resolution storage is not a financial transition.
Market payout certificates and terminal retirement proof remain distinct; neither
is an ordinary own-cash withdrawal prerequisite.

## Acceptance and limits

The phase stays In progress until all four steps pass on recorded code. Intermediate
decoder/projection tests and retained-history checks only validate their own layer.
Use focused regression tests and fresh integration traces; broad inherited suites
remain in scoped CI. Local synthetic sources/internal makers are labelled as such.
No new devnet or funded deployment, paid service, outreach or external hedge is
authorized by this phase.


## Direct SDK checkpoint

`AccountUserClient` authenticates version-3 local configuration, the initialization
anchor/genesis and qualified artifact set. `readAccountSnapshot` accepts one or two
selected roots. It discovers their immutable portfolios, then reads all financial
state in one 12/13-account batch for the common same-portfolio cases. It does not
read unrelated roots or require a registry-wide exit certificate. A minimum context
slot prevents backwards RPC reads. The atomic instruction still checks current
whole-account funding, risk, reservations, source restrictions and held-window
solvency on chain. A cash balance alone is not an admission promise.

Owner exits use virgin-custody or guarded funded instructions as appropriate;
recovered/terminal exits retain their source-independent contract. Delegated
cancellation remains account-scoped. Explicit netting binds the source market's
canonical backing certificate and registry; the SDK cannot bypass that proof.
Pending signed transactions retain their exact bytes/signatures through shared
wallet recovery. The initial direct checkpoint does not yet qualify routes,
current risk previews or worker coordination; WORKLOG records completion evidence.
