# Validation and measured limits

## Recovery verification when a BTC winner owes ETH

On a signed eight-member freeze at `ec12a834`, two fresh client processes proposed and checked a joint forced reduction before clearing advanced settlement. The diagnostic verified BTC and ETH debtor budgets, derived 340 possible schedules, and covered all 340 without writing a financial account. Three actual trades supplied the position history. The independent rational reference selected BTC 9 and ETH 33. Those charges removed 9 and 307,515/10,001 atoms of loss. The cash vector agreed for all eight members.

| Step on the winning proof | Successful transactions | Landed CU per transaction | Signed bytes each |
|---|---:|---:|---:|
| Create checkpoint | 1 | 6,312 | 452 |
| Authenticate original margins and histories | 8 | 8,313–18,771 | 420 |
| Derive pairs and budgets | 1 | 324,106 | 346 |
| Verify the proposed recovery and protected payouts | 1 | 889,433 | 386 |
| Exclude 334 schedules in ten intervals | 10 | 6,591–6,602 | 378 |
| Check five alternatives individually | 5 | 889,902–909,996 | 402 |
| Cover the already verified proposal and seal | 2 | 4,592–4,660 | 346–402 |

The 28 successful transactions used 5,896,739 CU and 140,000 test lamports in fees, excluding checkpoint rent. The inferior 9/32 plan passed settlement in isolation. The verifier rejected it when it reached a better 8/33 alternative. Invalid rate witnesses, replayed or overbroad ranges and early completion also failed. Both attempts together produced 53 successes and seven signed rejections with unchanged checkpoints. The deployed diagnostic was 467,536 bytes, SHA-256 `798a6463ac5b26e64f79eeba89e24c0c0d079ecf37c510c10ea89a79c2e1fa73`.

The four kernel transactions for original rates, adjusted rates, original cash and protected adjusted cash used 197,699, 213,745, 343,062 and 712,227 CU respectively, 443 bytes each. The signed harness verifies returned bytes against the independent reference. The pinned `d177cc5` clearing executable still authorized both maker withdrawals of 5,004 and 34,968 atoms through its existing restricted certificate. The run recorded 274 clearing-harness outcomes, 55 worker originals and 114 events reproduced in fresh PostgreSQL. The diagnostic covered a single page and a unique highest total. It has no custody or payout authority.

Reproduce with `RIVALT_FROZEN_PLAN_PROOF=1`, `RIVALT_SETTLEMENT_PROBE=profit-attribution-foreign-winner-apply` and `RIVALT_SETTLEMENT_ARTIFACT_DIR` pointing to the pinned foreign-creditor clearing artifacts, then run `bash ops/scalable-settlement-smoke.sh`. [Proof and economic rules](../clearing/default-plan-verification.md#verifying-all-schedules-on-a-cross-creditor-freeze).

The final cleanup at `448c5659` rebuilt the diagnostic to 467,864 bytes, SHA-256 `3aa23ac912916edadd582636d5463fef3721c6ee37e05cdec66694bb9b5732ee`. On a fresh deployment the same winning proof used 5,896,799 CU across 28 successful transactions. Both candidate outcomes, two wallet exits, 55 worker originals and the 114-event PostgreSQL replay reproduced.

## Financial priorities on a signed frozen book

At `15eb161d`, five real trades produced two eligible BTC makers with different amounts of unpaid open profit. The verifier covered 2,548 possible schedules, including 14 that recovered the same 25 atoms. The independently selected charges were BTC 4/9 and ETH 12. A BTC 5/8 split paid the same total and failed the proportional-sharing comparison. The general verifier sealed the selected schedule after 67 successful transactions totalling 14,487,219 CU and 335,000 test lamports in fees, excluding rent. The largest winning transaction used 976,374 CU. Both attempts together produced 96 successes and seven signed rejections. The local clearing gate refused to release the disputed funds. Fresh PostgreSQL replay matched all 96 clearing events. On a second book at `bf525754`, two makers had identical BTC gains. The winning schedule sealed. The TypeScript reader then shadowed the schedule count and exited before checking the terminal data or submitting the losing challenge.

The corrected reader at `78b24496` completed that second case on a fresh validator. A third BTC maker took the flat trader’s round trip. That maker owed 4,996 atoms and could pay them from cash, leaving the two open winners with exactly 10,002 eligible atoms each. Of the 14 highest-recovery schedules, 7/6 and 6/7 matched on proportionality and forced lots. Frozen-episode order charged member 0 seven BTC atoms and member 2 six. This gave them 9,995 and 9,996 atoms of funded gain in the proof. Reversing the charges passed the financial checks but failed the episode ordering. The reader independently checked all eight cash balances, all 16 signed market movements, zero remaining insurance and retained fees of 39 BTC-market and six ETH-market atoms. The flat creditor gained 4,996 atoms. Clearing remained frozen throughout.

| Signed comparison | Winning transactions | Winning total CU | Largest transaction CU | Both proposals, successful / rejected | Fresh clearing events |
|---|---:|---:|---:|---:|---:|
| Proportional allocation | 67 | 14,487,219 | 976,374 | 96 / 7 | 96 |
| Exact financial tie | 67 | 14,741,700 | 993,923 | 108 / 7 | 96 |

The funded local payer paid 335,000 test lamports in fees for each winning proof, excluding rent. Both clearing runs had 284 signed harness outcomes and 41 finalized worker originals. The equal-gain diagnostic executable was 564,608 bytes with SHA-256 `b9ea61c68c0d702edb35c2eae2e47345d7dc8f0aafe12a34daab4ecefa95332a`. Both runs used the signed competing-winner reproduction command below. Set `RIVALT_FROZEN_PLAN_CASE=equal-winners` for the equal-gain variant. On the narrower, previously measured one-debtor book, the direct proportional certificate used 121,169 CU across ten transactions. The general comparison pays for independently verifying each remaining alternative. [Direct certificate measurements](#restartable-comparison-on-a-clearing-freeze).



## Restartable comparison on a clearing freeze

At `4c9ccbc`, Surfpool deployed and returned the 192,480-byte diagnostic executable with SHA-256 `153e6a6abf2d3e03cfd88446e0e2c77fce11d3386e807b076037e2a6f3384af9`. Clearing used the pinned `30434d5` artifact. Five actual trades produced eight frozen Financial accounts, including a flat BTC creditor. The independent reference enumerated 2,548 schedules. Original debtor cash contributed 19,978 BTC-market and 9,989 ETH-market collateral atoms. Insurance contributed 13 and 1. Forced charges were 4 and 9 on the two BTC makers and 12 on the ETH maker.

| Successful proof transaction | Transactions | Landed CU per transaction | Signed bytes |
|---|---:|---:|---:|
| Open comparison | 1 | 10,112 | 461 |
| Verify one member | 8 | 6,104–20,871 | 460 |
| Seal and reconcile | 1 | 5,208 | 338 |

After four members a new client process resumed each submitted schedule from its PDA. The preferred result matched all eight reference cash balances, totaling 6,059,955 atoms. Its ten transactions consumed 121,169 CU and 50,000 lamports in transaction fees, excluding account rent and the work to freeze the venue. The comparison rejected a 5/8 BTC split with the same 13-atom recovery. Other rejections covered a wrong episode, different original margin, skipped or repeated ordinal, altered suffix, premature seal and second seal. All 27 probe outcomes were signed, fetched and checked over RPC/WS. The containing clearing harness checked 284 signed outcomes, observed 41 worker originals and replayed 96 clearing events from RPC into fresh PostgreSQL. The custody and member bytes stayed unchanged during comparison.

To reproduce, select the pinned linked-flat build and set `RIVALT_FROZEN_PLAN_PROOF=1` and `RIVALT_SETTLEMENT_PROBE=profit-attribution-linked-contested` for `bash ops/scalable-settlement-smoke.sh`, with an explicit `RIVALT_SETTLEMENT_ARTIFACT_DIR`. The probe uses the independently funded test payer. General cross-creditor verification and adoption into clearing remain open.

At `735ea27`, the native comparison also accepted reversed charge/witness order and rejected duplicate witnesses for the same financial schedule. The 19-book independent comparison and large two-market bound passed with the same results.

## Native selection of linked default plans

At `c41b5b7`, independent Python rational settlement and the Rust exhaustive
and range verifiers agreed on the financial outcome of 19 cases. These cover
joint-only admissibility, fractional paid gain, changed market insurance,
competing debtors, competing winners, two frozen-episode priorities and an
incomparable book. Missing witnesses, invalid rates, invalid reflections and
an incomplete comparison produced no unauthorized selection.

The same test read original frozen accounts and histories retained from three
signed local episodes. The native winner's individual cash vector matched the
recorded comparison in each. All counts below are from new native comparisons
against those captured rows. Each comparison started the range search with the
reference winner as an untrusted hint. Clearing's financial kernel checked it.

| Retained freeze | Charge combinations | Admitted in full search | Tied on recovery | Ranges visited | Individual schedules reached |
|---|---:|---:|---:|---:|---:|
| Competing BTC winners and an ETH winner, `005230c` | 2,548 | 1,365 | 14 | 143 | 14 |
| One lot available, `f462fc6` | 572 | 47 | 1 | 35 | 1 |
| Shared inventory, `cfc2279` | 324 | 35 | 2 | 67 | 2 |

A synthetic two-market case had 25,000,000,010,000,000,001 possible charge
vectors. The verifier visited 129 ranges and reached one candidate. Both
markets recovered five billion atoms and the flat creditor received two funded
atoms. This fixture has one winner per market. Competing positions can require
many individual settlement checks.

Reproduce the synthetic comparisons with `cargo build --locked -p default-plan-selection --features native-joint --example joint_reduction_audit`
and `python3 tests/financial/check_joint_search.py`. The latter accepts retained
`linked-default.json` files as optional arguments. The measurements cover local
native code. New on-chain transaction costs, persisted restart and release of a
general linked plan still require signed qualification.

## Profit payment and parallel ledger reads

The local `read-only-route-ledger` SBF came from clean `8bc01bb`, 3,023,024
bytes, SHA-256 `6e0b3aa9e33eb79db214bb0cfb478d01a9e27bf27473624b34fece70e49d178e`.
The stack-frame check, additive IDL/SDK comparison, 104-instruction lock
inventory and two focused native backing cases passed. Each RPC check used
the two pinned maker programs, real signatures and WS confirmations, a fresh
PostgreSQL journal and independently refetched finalized account and token data.

- `2697472` paired 36 fills, followed by a 50-lot open, a funded withdrawal
  and complete freeze. All 359 signed outcomes and the 231-event database
  replay completed. BTC and ETH fees for the pairs were 375 and 39 atoms.
  The 50-lot open increased BTC fees by 601. The frozen insurance balances were
  244 and 9 atoms. The last shell print failed when the launcher file changed
  during execution. The financial verifier had already written its final result.
  The retained database reproduced all 37 per-fill splits through the paginated
  trades query with five rows per page.
- `733490d` closed a BTC lot against a second maker for a 996-atom gain after
  two 13-atom fees. Another maker's fill after the eight-account backing scan
  changed the logical backing while leaving the physical ledger byte-identical.
  Its positive, negative and signed lot totals matched the individual roots.
  Clearing rejected both incomplete coverage and an omitted ledger checkpoint.
  The closed gain moved to funded cash and the trader withdrew the expected 970
  atoms from the SPL vault. All 332 signed outcomes and 315 replayed events passed.
  Collection, proof and payout also ran on the preceding SBF `10ab3b5` at
  harness `503e251`, with 331 signed outcomes and 270 replayed events.
- `733490d` verified the ordinary cross-market fallback advances the sibling ETH
  index from 4,999,999 to 5,555,555. BTC retained 6,111,110 across a 31-second
  gap, accruing one second and skipping thirty. The two-maker reversal changed
  the trader from +1 to −1 BTC lots and charged 24 atoms once. All 275 signed
  outcomes and 113 replayed events passed.

The dedicated probes are `profit-attribution-ledger-lanes`,
`profit-attribution-ledger-payout` and `profit-attribution-ledger-funding` in
`ops/scalable-settlement-smoke.sh`. A first payout test compared its rejected
payment with a root from before membership certification. The corrected
comparison uses the immediate predecessor bytes. [Costs and lock sets](performance.md#read-only-market-and-ledger).

## Read-only market on a signed fill

The generated lock inventory contains both new instructions. Its 101 prior
entries retain their original access sets. The check now covers 103 entrypoints
across clearing and the two makers.

SBF `10ab3b5`, 2,961,736 bytes, SHA-256
`2e2aa670fc7e2aa318a4fb9bb7ee9db02f8f0f0ef517e0bab14f99fe8b21acac`.
Harness `d45eae7` finalized 36 paired one-maker trades. With distinct payers and
makers, two BTC trades shared only the ledger. A separate 50-lot BTC fill left
the market bytes unchanged. Its stored gross was zero while its authenticated
three-registration gross was 100. PostgreSQL reconciled both at that boundary.
An initial indexer run at `ea10d90` refused the financial projection because it
compared a derived total to a physical account revision. The corrected check
compares the full stored account and independently validates its derived fields.

A standalone checkpoint, a checkpoint for ETH and an intervening BTC fill each
failed to authorize a subsequent BTC withdrawal. The interposed fill reverted.
A single signed BTC checkpoint and withdrawal then paid one collateral atom
while the position stayed open. Freeze rejected unclassified fees. Atomic fee
classification and freeze then captured the exact funded insurance. Fresh
PostgreSQL replay reproduced 228 events from 359 signed outcomes.

The nonzero-funding run at `d45eae7` finalized 266 outcomes and reproduced 94
events. ETH opened at a funding index of 4,999,999 scaled units. An attempted
BTC-only instruction rejected the ETH exposure. The ordinary BTC route with both
checkpoints brought ETH to 5,555,555 and charged the exact difference to its
position. After a separate BTC fill the market PDA stayed byte-identical. The
next publication recovered 6,111,110 from its maker registration after a
31-second interval, with one second covered and 30 skipped. Follow-up harness
`aa0a209` repeated the gap and reversed a trader from +1 to −1 BTC lots
against two different makers. Each maker received one lot. The trader paid
24 fee atoms, recorded once on the first registration. The entire stored market
was unchanged, and the SDK trade snapshot matched gross lots across all eight
participant accounts. This run reproduced 111 events from 275 signed outcomes.
The funded wallet
and freeze checks apply to this fresh local artifact. General default payouts,
receiver exits and sustained throughput require their own qualification.
[Costs](performance.md#read-only-selected-market) and
[commands](local-development.md#reproduce-the-read-only-market-route).

## Clearing-verified funding checkpoints

Clean harness `1637f8f`, SBF `2da3e90`, 2,920,496 bytes, SHA-256
`ef02d96b5d689c04e3b68854560073248507c956229bc0892d5423fa3170bec8`.
The ETH fill wrote its maker checkpoint. A BTC fill on the same cross account
wrote its BTC maker checkpoint and advanced the canonical ETH checkpoint. After
31 seconds the next two-market publication recovered BTC from its maker and ETH
from its market. ETH retained 5,555,555 scaled units, two covered seconds and
29 skipped. The independent Rust replay of finalized originals agreed.

Three signed BTC reports, each with an omitted, repeated or ETH registration,
failed with `Profile`, `Alias` and `MakerBinding` respectively. The market and
publisher configuration matched byte-for-byte before and after all three. Fresh
PostgreSQL replay reproduced 71 events from 259 signed harness outcomes. Every
recorded original was fetched at finalized RPC and checked against its wire and WS
notification. An initial build panicked in simulation on the first ETH fill because
a capacity write extended into the adjacent funding field. The tested build binds
that write to bytes 24–31 of the registration extension.

The candidate still keeps a serial comparison for each publication. Other account
classes, emergency controls, payment and default have not been qualified on this
binary. [Costs](performance.md#signed-funding-checkpoint-cost) and
[reproduction](local-development.md#reproduce-checked-funding-publication).

## Cross-market funding after a publication gap

On clearing `3ace707`, signed harness `3abe03e` opened one ETH lot and then
one BTC lot on the same cross account. No ETH maker registration appeared in
the BTC transaction. ETH's two-tick premium raised its funding index from
4,444,444 to 5,555,555 scaled units on that BTC fill. The trader's ETH virtual
balance fell by exactly 1,111,111 scaled units. After a 31-second publication
gap the next ETH report retained 5,555,555, credited two covered seconds and
recorded 29 skipped. The BTC original used 176,704 CU and 1,006 v0 bytes.
256 signed harness outcomes and 70 events replayed in fresh PostgreSQL.

Rust revision `da46c8f` recovered both indices from the finalized route receipts
and the subsequent market account. Two focused native tests also exercised
negative funding, decreasing timestamps, equal-slot conflicts, old generations
and expired observations. This is a financial dependency for removing the
market write. The deployed fills in this comparison still use the serial funding
index. [Funding contract](../liquidity/funding.md#market-funding-consumed-by-another-market).

## Signed bounded market gross

SBF `3ace707`, 2,900,728 bytes, SHA-256
`62c35c3bd7c5decac5d9f6cc6feaa7aad94b554e8aba535c3afbec0225832b8d`.
All three runs used fresh Surfpool deployments, signed transactions, RPC/WS and
PostgreSQL. The normal launcher still uses P56.

| Clean harness | Scenario | Observed outcome |
|---|---|---|
| `856c205` | A/B fill, B/C fill, close against C and freeze | Four direct clearing returns were 0, 4, 8 and 6. The external CPI returned 6 immediately after close. All five matched single-context RPC reads. A foreign ETH registration failed with `InvalidSeeds`. 267 harness outcomes, 76 fresh SQL events. |
| `d9b36d4` | Distressed trader, maker fill, consenting receiver and unwind | BTC gross was 100 after opening, after partial liquidation and after the receiver took five lots. The transfer advanced the capacity generation. The receiver unwound against an opposing maker and gross fell to 90. Twelve signed rejection cases preserved state. 293 harness outcomes, 92 fresh SQL events. |
| `fffc5d9` | Complete eight-member BTC default | Gross was 8 at freeze. Individual application receipts sampled gross of 4, 4, 2 and 0, matching the sum of the absolute lots on all eight roots. Clearing spent 12 insurance atoms. Two actual wallet transfers paid 20,000 and 20,004. 272 harness outcomes, 67 finalized worker transactions and 113 fresh SQL events. |

The initial integration found a publisher that accepted only the shorter market
layout and a fill that dereferenced an Anchor account after releasing its borrow.
The measured build validates the selected layout on both publisher reads and
mutates the registration tail with one scoped borrow. The correction also
derives the consumed capacity from the touched positions. The signed fills fit
within their first maker's capacity. The full-size near-cap fallback has native
boundary coverage only. [Per-transaction cost](performance.md#signed-bounded-gross-read)
and [reproduction](local-development.md#reproduce-the-bounded-market-read).

## Native market-capacity comparison

Clean source `e1bb859`. Four gross-capacity tests, the backing-partition test
and the clearing funding-prefix test passed. The Rust driver, fed by decoded
finalized receipts, matched 37 paired-workload/exit-boundary fills and two
default-workload fills with their signed market states and frozen roots.
An additional signed scenario at `c7b94a2` used the D137 SBF: two stored
two-maker subfills cost 25 and 24 atoms. Closing all four lots against the
third maker cost 48. Market gross progressed from 0 to 4, 8 and 6 as the
trader returned to zero lots. The three registrations recorded 25/24/48;
insurance, treasury and carry were 24/73/1. There were 261 harness outcomes,
76 fresh SQL events and three more matches to the native gross comparison. [Results and public read constraint](performance.md#gross-lots-funding-and-payment-backing-on-parallel-fills).

To reproduce, use `cargo test --locked -p financial-core --features parallel-market-prototype --lib gross_capacity`,
repeat with the `backing::partitions` filter, and run
`cargo test --locked -p clearing --lib maker_local_funding_prefix_preserves_expiry_and_recovery`.
Build the `gross_capacity_replay` example with the same financial-core feature.
Run `node --import tsx tests/performance/replay-gross-capacity.ts <snapshot>` after
loading `ops/env.sh`. Use the paired run's `sql-route-bursts-and-exit-snapshot.json`
and the default run's `sql-multi-lot-native-comparison-snapshot.json`. Run
`RIVALT_SETTLEMENT_PROBE=profit-attribution-cross-maker-capacity` with the same
D137 SBF and smoke script for the stored-order case, then replay
`sql-cross-maker-capacity-snapshot.json`.

## Aggregate market insurance

Fresh local clearing `5b1e964` (2,880,864 bytes, SHA-256
`1c8aa1d744a1a88281691ed67e87152b4c266f40401813a962a9855c6c88681c`).
The aggregate profile uses its own account layouts and fee event discriminators.

- Paired-route harness `2e5907c` finalized all 36 paired fills. The initial
  BTC/ETH totals of 375/39 yielded 93/9 insurance and carry 3/3. A second BTC
  checkpoint credited zero. Two 13-atom BTC receipts reconstructed 3 and 4
  atoms of insurance. A one-atom SPL withdrawal left the funded vault at
  8,999,999. A further 50-lot fill brought BTC fees to 976. Clearing refused
  unclassified treasury allocation and a bare default freeze. Atomic BTC and ETH
  classification with freeze recorded insurance of 244/9 and retained fees of
  732/30. The harness checked 346 outcomes and fresh SQL replayed 157 events.
- Default payout harness `60c173a` collected two 25-atom BTC fees and refused
  duplicate and foreign-market registrations with `InvalidSeeds`. Both ledgers
  matched their pre-attempt bytes. The verified default spent 12 BTC insurance
  atoms and zero ETH. The worker restarted after certification and finalized 54
  originals. Two real SPL exits paid 20,000 and 20,004. The vault moved from
  6,040,042 to 6,000,038 atoms. All eight financial roots matched the independent
  payout. The harness checked 272 outcomes and fresh SQL reproduced 113 events.
- Three focused native tests include 10,368 fee distributions and checkpoint
  partitions. The API/projection suites passed 19 tests and the RC2 wire contract
  passed 18 regression tests. Source generation and TypeScript checks passed.

The [matched lock and compute measurements](performance.md#aggregate-insurance-on-the-same-workload)
retain the two BTC shared writes. Only the two-market, three-registrations-per-market
fresh prototype was exercised. [Reproduction](local-development.md#aggregate-insurance-and-default-payout).

## Native linked-market reduction admission

At `a64f834`, the opt-in Rust verifier admitted 88 and refused 54 of 142
native checks across five books and malformed-input controls. The independent
rational model supplied expectations for the paired quantities and prices,
remaining positions, debtor budgets, exact recovered value, insurance,
whole-atom receipts and wallet entitlements. Cases include a funded pool,
fractional claims, a previously paid winning position and two markets that
recover more when the reductions apply together.

Four retained eight-member signed freezes reproduced their recorded successor
cash balances. At the freeze with a BTC winner owing ETH creditors, charges
of 9 BTC-market atoms and 33 ETH-market atoms recovered exactly 9 and
307,515/10,001 atoms of loss respectively. The simultaneous two-winner
case charged 4 and 9 in BTC and 12 in ETH. These are native replays of existing
inputs. This run supplies no new signed release or throughput result.

Reproduce with `cargo build --locked -p default-plan-selection --features native-joint --example joint_reduction_audit`
and `python3 tests/financial/check_joint_reductions.py`. Pass a retained
`linked-default.json` to also verify its signed inputs and predicted payout.

## Paired routes on the recovery candidate

Harness `12f9902` on clearing `baef259` observed 36 of 36 signed routes finalize
and reconciled 148 journal events from a fresh PostgreSQL database across nine
financial members. All positions ended flat. A one-atom SPL withdrawal brought
both allocated and actual vault balances to 8,999,999. The full run recorded 336
harness outcomes. [Shared writes, costs and limitations](performance.md#paired-routes-on-the-recovery-candidate).

## Clearing-verified multi-lot recovery

The separate local clearing build `baef259` is 2,855,600 bytes. Two signed runs
at harness `f7e76c9` used fresh Surfpool and PostgreSQL instances. On the
eight-member book below, the three-fill certificate consumed **46,606 CU**
in a **762-byte v0 transaction**. Both an omitted lot holder and a repeated
ordinal were refused. The certificate preserved the original cash and vault.
After the keeper restarted, 12 BTC insurance atoms and the verified 9-atom
charge settled the book.

| Signed outcome | Clearing and wallet | Fresh PostgreSQL replay |
|---|---|---|
| Different winning capacities, 784 candidate plans | 54 worker transactions finalized. Maker roots 0 and 1 withdrew 20,000 and 20,004 atoms into the operator’s SPL account. Both roots retained 1,000,000 each. Actual and allocated vaults both ended at 6,000,038. | 111 events, 224 reconciled accounts, 8 financial members, 270 harness outcomes |
| Equal marginal costs, 144 candidate plans | Worker withheld the incomplete proof. Direct submission failed. Both headers, the frozen page, every root and the vault retained their original bytes. Exact native search selected a five-atom allocation. | 81 events, 308 harness outcomes |

The signed refusal demonstrates the boundary of this short proof. The earlier
single-lot and native comparisons remain separately reproducible. The test
for two flat half-atom claims checks the complete valuation in Rust. Six
checkpoint tests passed. The lot-rate tests cover each permitted lot count in
small rational cases and 1,024-bit historical inputs at the maximum lot count.
The financial source is [specified here](../clearing/default-plan-verification.md#how-the-multi-lot-clearing-certificate-binds-the-inputs).

## Exact multi-lot BTC comparison

Harness `4faefa7` executed two signed two-lot BTC buys against different
isolated makers on clearing SBF `eb011a5`. The buys cost 120,004 and 120,010
atoms plus 25 atoms in taker fees each. At a frozen mark of 50,000 both
debtors had 19,996 cash. Their uncovered debts of 8 and 14 shared 12 insurance
atoms. Their whole forced-reduction budgets were 3 and 6.

Independent complete-book selection and the native verifier agreed across
784 candidate allocations. The search traversed 47 bounded ranges. The first
debtor charged three atoms to maker 0. The second charged one to maker 0 and
five to maker 1. Three matched lots suffice. The two computed maker cash
balances are 1,020,000 and 1,020,004. The worker withheld the unsupported
one-lot action. A direct signed attempt failed and preserved all eight roots,
the vault, frozen page and prepared header. Fresh PostgreSQL replay reproduced
81 events across 308 harness outcomes. No multi-lot payout was released.

On revision `397fd01` the compact proof certified that same frozen input.
Checking all 784 proposals found no other bound-certified allocation. Across
24 independent synthetic books with both position directions, partial payment
and insurance, exact selection agreed on all 24 and the compact proof
certified 14. It selected no different result across 4,754 tested allocations.
A separate four-member native case certified a 140,000-atom allocation over
a raw space of 24,011,372,029,400,280,001 combinations using the bounds alone.
The last number counts mathematical combinations. No on-chain compute measurement was taken for this proof.
[Verification rules](../clearing/default-plan-verification.md#several-multi-lot-debtors-and-winners-in-one-market).

## Active positions and frozen page placement

These runs use the same clearing SBF `d5cc624`. Local funded traders alternated
one-lot buys and sells through a single internal maker, which ended flat with
four claim atoms per pair. All six maker accounts and the trader roots entered
the complete freeze. The verifier charges eight atoms per pair in the measured
16- and 29-pair books. Each eligible account had the original signed fill and
frozen claim expected by the journal.

| Harness | Active / Financial | Active pages | Finalized certificate | CU | Wire bytes | Fresh SQL events |
|---|---:|---:|---|---:|---:|---:|
| `b2ada92` | 32 / 38 | 5 | 16 pairs, 128 atoms | 88,286 | 1,111 (v0) | 259 |
| `28345d1` | 58 / 64 | 8 | 29 pairs, 232 atoms | 141,122 | 1,376 (v1) | 418 |
| `97a8d5b` | 22 / 175 | 22 | Worker withheld submission. Direct signed call returned Profile (6108). | 20,106 | 1,550 (v1) | 654 |
| `97a8d5b` | 162 / 168 | 21 | Default 32 KiB SVM heap exhausted. | 147,848 | 2,637 (v1) | Unverified |

The original dense run stopped after the finalized failure because its harness
did not recognize the SVM heap error. Its receipt establishes the failure and
cost. Post-failure reconciliation was not observed on that run.

The first three runs checked 519, 709 and 1,157 RPC/WS outcomes respectively. Their
finalized certificate attempts each paid 5,000 local lamports at zero priority
fee. The 22-page rejection preserved the prepared header, all active frozen
pages, cash accounts and vault. These measurements end after certification or
refusal. The three-wallet qualification below covers subsequent settlement.
[Wire and revision scope](../clearing/default-plan-verification.md#how-many-frozen-pages-fit-in-one-inventory-certificate).

On SBF `eb011a5`, harness `cd2d893` signed four simulations against each
frozen book before the durable worker submitted its own 128 KiB transaction.
Both workers paid 5,000 local lamports at zero priority fee. Their finalized
wire bytes and CU matched the selected simulation. Custody and the original
financial roots matched their pre-certificate bytes. Fresh SQL reconstructed
all 11 and 81 assignments respectively, each charging eight atoms.

| Active / Financial | Pages | 32 KiB CU | 64 KiB CU | 128 KiB CU landed | 256 KiB CU | v1 bytes landed | RPC harness outcomes | Fresh SQL events |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 22 / 175 | 22 | 92,422 | 92,446 | 92,494 | 92,590 | 1,554 | 1,156 | 655 |
| 162 / 168 | 21 | 147,890, heap exhausted | 346,126, heap exhausted | 364,122 | 364,218 | 2,641 | 1,544 | 1,053 |

Both measurement processes persisted and printed their reconciled results.
Their outer Bash processes exited with a parse error after the script changed
on disk during execution. The final script passed `bash -n` and ran end to
end at `2c629e5` on the same SBF. That separate nine-member run included three
signed refusals, worker restart, 59 finalized worker transactions and three SPL
withdrawals of 20,001 atoms each. The vault ended at 6,000,030. Fresh SQL
replayed 127 events across 284 harness outcomes. The two larger books were
measured only through certification.

Scalar preparation between freeze and certification used 75 transactions /
2,547,094 CU for 38 Financial members, 104 / 3,718,375 for 64, 233 /
8,247,044 for 175 and 225 / 8,533,739 for 168. At the observed 5,000 local
lamports per transaction, those preparations cost 375,000, 520,000, 1,165,000
and 1,125,000 lamports. The harness issued one preparation instruction per
transaction. Batched production costs and larger-book exits need separate
measurements.

## Clearing-verified single-lot book

On pinned clearing `d5cc624` and harness `3e8df69`, six of nine funded members
held one BTC lot. Three debtor budgets of 1, 2 and 2 met three distinct opposing
lots. The verifier used **40,457 CU and 803 signed bytes** with two writable
frozen pages. Three signed incomplete or duplicated inputs failed. The original
financial accounts and balances matched their pre-verification bytes after
both rejection and certification.

| Maker | Debtor | Price | Charge | Wallet withdrawal |
|---:|---:|---:|---:|---:|
| 0 | 6 | 40,001 | 1 | 20,001 |
| 1 | 8 | 40,002 | 2 | 20,001 |
| 2 | 7 | 40,002 | 2 | 20,001 |

The worker restarted before verification and after the certificate. Nine
insurance atoms were spent. All three SPL withdrawals landed and the vault
ended at 6,000,030. Surfpool RPC/WS covered 284 harness outcomes and 59 signed
worker transactions. Fresh PostgreSQL replay reproduced all 127 events and the
certificate digest. This measurement covers one BTC book, three internal maker
accounts and two active pages on the qualified local binary.
[Certificate contract](../clearing/default-plan-verification.md#binding-the-single-lot-assignment-to-clearing).

## Population-wide matching on a three-debtor freeze

Ordinary clearing SBF `33361d9` and clean harness `34882ca` funded nine roots.
Three BTC traders bought at 60,002, 60,003 and 60,004 from three separate maker
accounts. Each trader retained 19,998 after its 13-atom fee. At the 40,000
freeze their uncovered losses were 4, 5 and 6. Insurance supplied 9. The
resulting whole budgets were 1, 2 and 2.

| Maker ID | Actual ordinary SPL withdrawal | Independently selected successor credit | Selected debtor |
|---|---:|---:|---:|
| 0 | 20,000 | 20,001 | 6 |
| 1 | 20,001 | 20,001 | 8 |
| 2 | 20,002 | 20,001 | 7 |

Both books conserve 60,003 atoms of maker recovery. The ordinary run finalized
15 worker transactions and three withdrawals, audited 281 harness outcomes,
and reproduced 126 events in fresh PostgreSQL. The final vault held 6,000,030.
The reference checked all 5,832 proposals. The two-atom buyers consume different
lots at 40,002. The other pair executes at 40,001.

Native proposer and verifier `870ea08` matched exact independent enumeration
on 432 small books with 95,610 admissible assignments. Two targeted Rust tests
also rejected incomplete, reused, infeasible and lower-priority assignments.
A release build on this host verified 1,024 pairs among 2,048 economic members
in one warm command invocation (68 ms including process startup and output).
That case visited 2,097,152 member rows in its priority checks. This is a
native scaling measurement. The nine-account run used ordinary on-chain
payouts. The subsequent signed candidate is measured above. [Selection contract](../clearing/default-plan-verification.md#matching-a-population-of-single-lot-debtors-and-winners).

## Scarce winning inventory and flat BTC claims

Clean harness `f462fc6` used four signed BTC fills and nine funded internal
accounts. Both debtors bought at 60,002 or 60,006. A third trader then sold and
bought back one lot at 40,001, leaving the original maker flat with 20,001
unpaid atoms and another maker with one atom of gain at the frozen 40,000 mark.
The 44 fee atoms supplied 11 to BTC insurance. The original whole loss budgets
were 10 and 12. Independent enumeration checked 572 assignments. It selected
one atom on member 1 at 40,001 and 12 on member 2 at 40,012.

| Account or measurement | Ordinary SBF `33361d9` | Partial-inventory SBF `2256c51` |
|---|---:|---:|
| Flat maker’s SPL withdrawal | 19,990 | 19,996 |
| Small winning maker’s SPL withdrawal | 1 | 0 |
| Other winning maker’s SPL withdrawal | 19,994 | 19,989 |
| Total withdrawn to the internal operator’s wallet | 39,985 | 39,985 |
| Vault balance after withdrawals | 6,020,015 | 6,020,015 |
| Harness outcomes / finalized worker originals / fresh PostgreSQL events | 290 / 16 / 135 | 292 / 57 / 135 |

A zero withdrawal in this table means the account had no funded recovery above
its original deposit. The harness checked the root and skipped submitting an
empty transfer. Candidate verification cost 55,697 CU / 835 bytes. The signed run
rejected a repeated winner, the wrong pairing, and a charge above the debtor’s
budget before it allowed settlement. A new worker resumed from the on-chain
certificate. The fresh indexer reconciled all nine financial roots and the vault.

Two boundaries exercise different reasons for leaving a lot unused on the same
clearing artifact (2,638,216 bytes, SHA-256
`da2796230e4591aa53855b4fc0c6543ad424c017bd09cd2ec8c8f96535627e8e`).

| Boundary | Selected debtor charges | Signed wallet withdrawals | Verifier transaction | Outcomes / worker originals / fresh events |
|---|---|---|---|---|
| Mark equals one winner’s entry, nine members, `f462fc6` | 0 and 13 | Flat maker 19,996 and other winner 19,988 | 52,887 CU / 835 bytes | 292 / 57 / 135 |
| One debtor’s share rounds to zero, eight members, `f95fbc7` | 0 and 1 | Makers 20,002 and 20,004 | 55,733 CU / 835 bytes | 271 / 54 / 111 |

For the rounded budget, cash of 20,000 per debtor left losses of 2 and 6 before
six insurance atoms. The remaining two atoms split into exact shares of 1/2
and 3/2. Only the second admits a whole-atom close. Both winning positions had
ample gain. The independent reference verified all four proposals on this book
and all 154 in the zero-gain book. The standalone Rust comparison matched
2,516 feasible allocations across 296 independent small books and a u64
boundary. This profile covers two one-lot debtors and two opposite positions
in BTC, with any remaining creditors flat and ETH exposure and claims zero.
[Verification contract](../clearing/default-plan-verification.md#when-one-of-the-two-winning-lots-has-little-eligible-gain).

## Two BTC debtors sharing winning inventory

On ordinary clearing SBF `33361d9`, clean harness `cfc2279` bought two BTC
lots in separate trader accounts from two makers at 60,002 and 60,006. Both
traders deposited 20,010 and paid a fee of 13 collateral atoms per trade. At the frozen mark of 40,000 each trader had 19,997 funded atoms.
The uncovered debts before insurance were 5 and 9. BTC insurance supplied
six. Their exact residuals were 20/7 and 36/7; the maximum whole charges
were two and five. One atom of aggregate loss remained after both budgets.

| BTC maker | Original claim | Actual ordinary withdrawal | Verified successor withdrawal |
|---|---:|---:|---:|
| Member 0 | 20,002 | 19,998 | 20,000 |
| Member 2 | 20,006 | 20,002 | 20,000 |

The ordinary run finalized two SPL withdrawals of 40,000 atoms in total
(32,673 CU and 806 bytes each), leaving 6,000,020 in custody and the two
trader roots at zero. The operator's eight-member book reconciled after restart.
There were 268 harness outcomes, 14 finalized worker originals and 110 events
reproduced in a fresh PostgreSQL database.

The independent comparison enumerated all 324 proposed charge assignments.
Both ways of using one winning lot twice were infeasible. Rust protected
settlement agreed with the original and successor cash and claim movements.
Native selector `981d269` assigned debtor 6 to maker 0 at 40,002 and debtor 7
to maker 2 at 40,005. It also matched independent exhaustive permutations on
120 books of one to six debtors (94 full recoveries and 26 insufficient-capacity
results). Four malformed inputs and the maximum-u64 ordering boundary were
checked separately. Clean harness `672cff0` subsequently ran on local clearing
SBF `59184c5` (2,683,376 bytes, SHA-256
`caf78f79e2e0bf1b6fc30f3ce5aef2cc0f453af2ef13e422a774055a4a833eef`).
The signed verifier used 56,805 CU and 835 bytes. A repeated winning account,
the inferior pairing, and a charge of three against a budget of two were each
rejected. All watched financial accounts and the prepared certificate retained
their original bytes across those refusals. The accepted certificate changed
the prepared settlement. The worker restarted and applied it to all eight
members. Both maker accounts each withdrew 20,000 to their operator’s SPL
wallet (32,676 CU and 806 bytes per transaction). Custody retained 6,000,020.
The run recorded 271 harness outcomes, 54 finalized worker transactions and
111 events reproduced from scratch in PostgreSQL. The artifact covers the
fully recoverable single-lot assignment on this two-debtor market.
[Verification contract](../clearing/default-plan-verification.md#shared-single-lot-inventory).

## Atomic payment for a BTC winner with ETH debt

Clean program `d177cc5` (2,603,744 bytes, SHA-256
`3d7b0b64d71aad7943b265ac66011fd8231f8d195846a2c49d0fcbe0825ee76b`)
and clean harness `7f2b7e5` reproduced the three fills and eight-member freeze
from the [ordinary comparison](#btc-winner-with-an-eth-debt). Both markets
had zero pool cash. BTC and ETH insurance supplied six and three atoms.

| Signed transaction | Result | CU | Wire bytes |
|---|---|---:|---:|
| Charge BTC 9, ETH 0 | Rejected, 6130 | 26,361 | 835 |
| Charge BTC 8, ETH 33 | Rejected, 6130 | 26,361 | 835 |
| Substitute the cross account for the flat creditor | Rejected, 6130 | 22,473 | 835 |
| Charge BTC 9, ETH 33 | One lot per winner at 40,009 and 12,533 | 54,281 | 835 |
| Flat BTC maker withdraws | 5,004 funded atoms | 32,676 | 806 |
| ETH maker withdraws | 34,968 funded atoms | 32,676 | 806 |

The prepared header, financial accounts, ledgers, vault and wallet bytes matched
across the refusals. The completed certificate also left the financial balances
intact until application. After a worker restart, settlement paid 39,972 atoms
to the maker operator's wallet and left 6,000,028 in the vault. Each maker root
retained its original 1,000,000 cash. Both trader roots ended with zero cash.
All eight balances matched the independent reconstruction, which enumerated 340
charge assignments. The run recorded 274 harness outcomes and 55 finalized
worker originals via RPC/WS. Fresh PostgreSQL replay reproduced 114 events.

The signed case used one frozen page. A keeper unit test covers four different
pages in a 32-row input. Multiple debtors competing for one position, cycles and
fractional original claims still need qualification. [Reproduction](local-development.md#reproduce-a-winner-with-debt-in-the-other-market).

## BTC winner with an ETH debt

At clean harness `bb67d1f`, three genuine routes produced the same eight
frozen margin accounts and both market ledgers on two separate validators.
The isolated trader bought BTC at 60,002. The cross trader sold one BTC lot
at 54,998 to the same maker, leaving that maker flat, then bought two ETH lots
at 30,002 from a different maker. At marks of 40,000 and 12,500 the cross
trader's BTC claim was 14,998 and its ETH debt was 35,004. The two runs had
separate clocks and oracle observation windows.

| Creditor gain in atoms | Ordinary, signed | BTC-only, model | Joint, model |
|---|---:|---:|---:|
| Flat BTC maker | 5,002 | 5,004 | 5,004 |
| ETH maker | 34,970 | 34,968 | 34,968 |
| Direct charges on BTC / ETH | 0 / 0 | 9 / 0 | 9 / 33 |

The Rust verifier rejected the BTC-only proposal with `Entitlement`. The
ETH maker's exact entitlement would fall by 22,518/10,001 atoms without a
direct ETH charge. The independent search checked 340 assignments and
selected 9/33. Native protected settlement verified that plan's exact
financial conditions, per-member cash and movements, and 6/3 insurance use.
The two proposal columns have identical final balances and different
eligibility under the approved rules. A focused Rust-driver regression checks
both outcomes. [Proof obligations](../clearing/default-plan-verification.md#a-winner-whose-btc-claim-backs-an-eth-obligation).

Ordinary SBF `33361d9` finalized the two SPL withdrawals, paying 39,972
atoms into the maker operator's wallet. The vault went from 6,040,000 to
6,000,028 with zero unallocated surplus across 224 reconciled accounts. The
run recorded 271 harness outcomes, 15 worker originals and 113 events
reproduced in fresh PostgreSQL.

Candidate SBF `d0ae474` refused both proposed sole debtors and premature
payment with program error 6130. The two refusals used 21,384 and 21,562 CU
at 824 bytes. The frozen vault still held 6,040,000 and both wallets held
zero. All eight roots, both ledgers, financial source, scratch and token
balances matched across the rejected transactions. The candidate run recorded
272 harness outcomes, 41 worker originals and 84 events reproduced in fresh
PostgreSQL. Neither successor proposal was released by this candidate.
[Reproduction](local-development.md#reproduce-a-winner-with-debt-in-the-other-market).

## Linked allocation across competing makers

At clean harness `005230c`, all five trades produced the same eight original
cash balances, positions, claims and per-lot payment histories as the contested
run at `89ef133`. Both markets' prices, funding, pools, insurance and fees
matched. The independent reference enumerated 2,548 assignments. Clearing
certified 4 and 9 atoms on the BTC makers and 12 on the ETH maker. Each
reduction involved one lot, at 50,004, 50,009 and 20,012 respectively.
The original debtor supplied 19,978 BTC-market atoms and 9,989 ETH-market
atoms. Insurance supplied 13 and 1. Retained market fees were 39 and 6.

| Recipient | Ordinary model credit | Actual funded withdrawal |
|---|---:|---:|
| Flat BTC trader | 4,993 | 4,996 |
| First BTC maker | 5,003 | 5,002 |
| Second BTC maker | 9,995 | 9,993 |
| ETH maker | 9,990 | 9,990 |
| Total collateral atoms | 29,981 | 29,981 |

After the four signed SPL withdrawals the vault held 6,030,019 of its initial
6,060,000 atoms. The trader retained 29,974 funded atoms and its wallet held
4,996. The three maker accounts retained their original deposits and their
common operator wallet held 24,985. The ordinary column is an independently
computed comparison on this book. The preceding sole-winner binary kept it frozen.

The wrong cutoff finished at 0/12 after eight members, and both markets stayed
frozen. On the corrected attempt the worker reopened at ordinal three. A
duplicate row, a skipped row, a premature denominator operation and a one-atom
withdrawal were refused. The eight margin roots, both ledgers, resolution, vault
and wallets retained their original bytes through certification. The final run recorded 290 harness
outcomes and 71 separately signed worker originals. Finalized RPC/WS originals
matched the submitted bytes. Fresh PostgreSQL reproduced 143 events and the
projected state, including both allocation attempts and all four withdrawals.

| Finalized operation | CU | Wire bytes |
|---|---:|---:|
| Open corrected allocation | 31,163 | 824 |
| Score one member, range across both attempts | 31,716–43,488 | 760 |
| Highest transaction, 24 rate steps | 898,690 | 2,923 |
| Each owner withdrawal | 32,676 | 806 |

Local clearing at `d0ae474` was 2,609,136 bytes, SHA-256
`4e41342a10405a75e1539a8a249c97cbf6c955f4434f484996f9c2f0bf06bcd4`.
The layout test verified the 1,284-byte frozen page. Eight focused worker
and projection tests cover cutoff ordering and refused, resumed and completed
scans. This run measured eight members with one cross debtor and disjoint
creditors. [Reproduction](local-development.md#reproduce-the-linked-allocation-across-competing-makers).

## Closed BTC claim in a two-market default

A cross debtor bought BTC and ETH. A second trader sold one BTC lot at
64,998 and bought it back at 60,002. The two 13-atom fees came from the
trader's deposit. At the freeze its positions were flat, its funded cash
was 19,970, and its unpaid BTC claim was 4,996. The eight financial members
on both validators had identical frozen lots, cash, accrued claims and
surviving entry and payment history. The market ledgers also matched.

| Withdrawal in collateral atoms | Ordinary clearing | Linked clearing |
|---|---:|---:|
| Flat trader's BTC claim to its wallet | 4,994 | 4,996 |
| BTC maker's funded recovery | 5,003 | 5,001 |
| ETH maker's funded recovery | 9,989 | 9,989 |
| Total paid from the vault | 19,986 | 19,986 |

A fill-by-fill reference checked all eight roots, enumerated 84 charge
assignments and selected 5 BTC and 13 ETH atoms. The native protected solver
matched the cash, signed movements and insurance on both the ordinary and
adjusted books. The debtor supplied 9,988 per market and insurance paid 9
and 1. Both vaults fell from 6,039,992 to 6,020,006. The trader still had its
original 19,970 funded atoms after withdrawing the claim payout.

Ordinary harness `c8b5bc7` used SBF `33361d9`. It recorded 281 harness
transactions, 15 separately signed worker originals and 123 events replayed
in fresh PostgreSQL. The successor used SBF `30434d5` (2,586,864 bytes,
SHA-256 `e55f48477a39977d10e33a85e87bab5d5ee00161307469ae1c88dae500d2cac9`).
The BTC and ETH certificates consumed 42,732 and 46,479 CU at 801 bytes each.
The trader withdrawal consumed 32,673 CU on ordinary clearing and 32,676 CU
on the successor, both 806 bytes. All originals matched finalized RPC and WS.
The independent indexer reconstructed the flat creditor from the complete
financial membership. Twelve scoped projection tests passed. The legacy
snapshot encoding matched 256 valuations and 3,637 encoded prefixes.

An initial successor run landed every withdrawal and then found the indexer's
older sole-creditor check. With the artifact-bound projection at `3d8d239`,
fresh SQL reproduced all 124 events, including the joint certificate. The
launcher then exited with a shell parse error after its source was edited
during that invocation. At clean harness revision `89ef133`, the complete launcher exited successfully:
285 harness outcomes, 56 finalized worker originals and 124 matching fresh
SQL events. Frozen economics and all three withdrawals reproduced the preceding
run. The run refused substitution of the flat creditor, the wrong ETH winner,
premature settlement and a one-atom withdrawal during verification. The
highest worker transaction used 899,467 CU and 2,923 wire bytes for 24 rate
steps. [Reproduction](local-development.md#reproduce-the-closed-btc-traders-joint-default-payout).

At `89ef133`, a separate book gave a second BTC maker one opposing lot.
The reference searched 2,548 assignments and selected BTC charges of 4 and 9
and an ETH charge of 12, keeping the debtor's cash split at 19,978 and 9,989.
The worker reported unsupported competing creditors. Submitting **each** BTC
winner on its own and attempting to bypass certification all failed with 6130.
The eight roots and freeze checkpoint stayed byte-identical. Wallets stayed
empty and the vault kept all 6,060,000 atoms. The run recorded 284 harness
outcomes, 41 worker originals and 96 events reproduced in fresh SQL.
The 4/9/12 schedule from that run supplied the target for the subsequent
[competing-maker qualification](#linked-allocation-across-competing-makers).

## Clearing-verified linked default and wallet exit

Harness `a956981` deployed the local linked clearing build `0e027fc`
(2,585,320 bytes, SHA-256 `7f627bc93748c7b4e6c36aa65a461900690387c77ab0e6169e4745dd0bad9086`).
The eight real frozen accounts reproduced the [ordinary comparison](#signed-two-market-default-comparison).
Clearing verified one lot per winner at 50,003 and 20,005, charging 3 and 5.
The debtor’s cash contributed 9,996 to each market. Insurance paid 3 and 1.
The two makers withdrew 9,999 and 9,997 to their operator's SPL wallet,
which rose from zero to 19,996. The vault fell from 6,040,024 to 6,020,028.

| Finalized transaction | CU | Wire bytes |
|---|---:|---:|
| Verify BTC and persist progress | 42,486 | 801 |
| Verify ETH and commit both legs | 46,473 | 801 |
| Withdraw each maker's funded recovery | 32,676 each | 806 each |
| Highest worker batch in this run, 24 rate-work steps | 899,467 | 2,923 |

The run recorded 265 harness outcomes and 56 separately signed worker
originals. Each original matched finalized RPC bytes and its WS receipt. A
replacement worker continued the partial certificate from PostgreSQL. Three
signed refusals covered a BTC account passed as the ETH winner, starting
settlement after BTC alone, and withdrawing one funded atom during the freeze.
All eight roots and both token accounts reconciled. A fresh database reproduced
105 events with byte-identical payloads and state, including the joint event.

Independent rational calculations matched the paged rate and payment schedules
for 33 reduced cohorts, including fractional original cash ownership. The
scalar legacy regression passed 1,185 rate evaluations and 74 invalid proposals.
The ordinary local clearing profile also compiled without an SBF stack warning.
The regenerated IDL lock inventory covers 95 instructions, including 87 in
clearing and 14 clearing custody writers. The new event changed the clearing
IDL hash; every instruction's read and write accounts matched the previous inventory.
The [certificate](../clearing/default-plan-verification.md#joint-certificate-for-a-single-cross-debtor)
requires one creditor in each market and a whole original split. The separate
D127 mirror diagnostic remains the evidence for ranking several creditors.

Earlier local attempts stopped at an unrecognized candidate layout during
indexer reconciliation, continued with the scalar batch setting after restart,
or expected a pause error when the earlier frozen-mode gate returned 6108.
The completed run includes the corrected artifact binding, worker startup
settings and exact error. [Reproduction](local-development.md#reproduce-clearing-verified-joint-recovery).

## Signed two-market default comparison

At `7c299ca`, two fresh eight-account local deployments opened one BTC lot and
one ETH lot against distinct isolated makers. The same cross debtor paid 13
and 7 atoms in taker fees. At the freeze its 19,992 cash backed debts of
10,002 per market. An independent replay of the finalized fills reproduced
the clearing roots, entries, paid gains and both market ledgers. Debtor cash
covered 9,996 per market. Insurance supplied 3 BTC-market atoms and 1 ETH-market
atom. The complete successor model searched 24 assignments and selected charges
of 3 and 5, at prices 50,003 and 20,005. The native protected settlement kernel
matched both the model's ordinary and adjusted payouts.

| Signed clearing profile | Observed outcome | Harness outcomes / worker originals / replayed SQL events |
|---|---|---:|
| Ordinary attribution, SBF `33361d9` | The two makers withdrew 9,999 and 9,997 atoms from their distinct capital accounts to their operator's SPL wallet. Each transaction consumed 32,673 CU. | 262 / 14 / 104 |
| BTC allocation, SBF `9e2cc00` | Omitting ETH and skipping directly to denominator verification each failed with clearing error 6130. The original page, roots, resolution, vault and wallet were preserved. | 262 / 41 / 75 |

Each worker reopened its finalized original from PostgreSQL after a restart.
Every worker original matched its finalized RPC wire and WS receipt. Fresh SQL
replay reproduced the indexed financial events and state. The ordinary path
and the model pay the same cash in this book because each market has only one
creditor. Those two profiles evaluated the 3/5 schedule off-chain. The
[separate clearing candidate](#clearing-verified-linked-default-and-wallet-exit)
subsequently executed it.
[Reproduction](local-development.md#reproduce-the-linked-default-comparison).

## Native linked-market recovery

At `56e276b`, the compiled settlement kernel preserved the approved 60 BTC / 30
ETH cash split when BTC debt fell from 80 to 60. Recomputing the split moved
six atoms to ETH. The new native path matched an independent fractional solver on
152 original/effective cohorts for cash, per-market movements, insurance, funded
fee retention and each member’s exact cash allocation. Six malformed inputs
were rejected. The ordinary kernel still matched 774 settlements and rejected
307 invalid proposals. The two-market comparison enumerated 256 charge vectors
and found 70 feasible. Rust reproduced the 6/6 baseline and the two finalist
payouts of 7/8 and 8/7. These checks exercise native financial code. The
[comparison](../clearing/default-plan-verification.md#when-the-two-markets-trade-places)
records the D127 decision and its acceptance.

At `1db483c`, the native protected settlement verified 100 paired proposals
from the two ten-plan markets in that book. All 70 admissible payouts matched
the independent rational model account by account, including per-market cash
movements and insurance. The other 30 failed. This count starts after each
individual market's inventory and shortfall checks. The 256 above includes
assignments that fail those earlier checks.

Separate fractional cases preserved the original ETH receipts of 1 and 6
where ordinary rounding would assign 2 and 5. A full BTC reduction that would
cut an ETH payout from 24 to 15 was rejected, as was the variation that would
take nine more atoms from ETH insurance. Forged baseline rates and receipt
order were rejected. The ordinary rounding regression matched the independent
graph on 774 paged executions. The new checks replay the native paged graph,
including restoration of its checkpoints. Signed linked-market recovery and its
on-chain resource costs remain open.

At `8af1a7a`, four mirror cases, six restart/search cases, eight certificate
cases, four protected-settlement cases, the Rust assignment-order unit test and
TypeScript compilation passed. At the all-zero venue, the complete 256-vector
reference sweep certified only ordinal 54 for episode 1 and only 99 for episode
2. The three asymmetric books stayed uncertified. Each finalized native cash
vector matches the independently derived whole-atom distribution.

A new local Surfpool diagnostic at the same pin used a different venue and
produced ordinal 99 (BTC/ETH 8/7) in episode 1 and 54 (7/8) in episode 2 with
reversed proposal order. With asymmetric retained fees in episode 3 it accepted
neither plan. All **34 signed outcomes** were observed over WS, fetched at
finalized RPC and accounted for in PostgreSQL. Eleven deliberately rejected
instructions preserved state. Signature WS echoed each rejection. The separate logs subscription omitted the error field on those eleven receipts. The two successful comparisons used **8,400 and
8,424 CU**, each in 281 wire bytes. The fixture commits 2,372 input bytes
per episode. Its authority ends at recording the winning candidate. These CU
counts exclude solving for feasible plans and moving collateral. From a clean
checkout with the local toolchain, rerun with
`RIVALT_PROOF_SCOPE=mirror bash ops/default-proof-smoke.sh`.
After the executable moved to `tests/programs`, a fresh build and local
deployment at `9614313` repeated all 34 outcomes and both CU measurements.

## Multi-winner BTC recovery

Two independent eight-account Surfpool/RPC/WS/PostgreSQL runs at `c747189`
used clearing SBF `9e2cc00` (2,581,008 bytes, SHA-256
`cfca283a6c024d0839c4f9167bcef78ab15ca2d7346b814db4bda496503f02b9`).
One maker supplied all opposing debtor lots. A second maker and a separate
trader account held profitable longs. A third trader account had closed. The
independent checker replayed the three finalized fills and enumerated all
feasible divisions of the loss using rational arithmetic.

| Frozen BTC book | Charge to winning maker / open trader | Flat trader’s SPL withdrawal | Harness outcomes / worker originals / fresh SQL events |
|---|---:|---:|---:|
| Gains 9,002 and 9,998, shortfall 3,495 | 1,656 / 1,839 | 996 | 291 / 56 / 132 |
| Gains 9,002 and 9,002, shortfall 1 | 1 / 0 by episode priority | 996 | 299 / 56 / 140 |

Both runs proved rejection of a solvent substitute and a skipped row. Scanning
a zero cutoff across all eight roots returned the program to its frozen proposal
gate with the wallet and vault intact. The valid attempt resumed after worker
restart at row two. All eight cash balances, the funded withdrawal, 501 atoms
of BTC insurance, zero ETH insurance, 30 atoms of retained BTC fees and the
sponsor's rent refund reconciled. A fresh SQL replay reproduced the finalized
payloads. Beginning the scan cost 29,217 CU. The first two unbatched rows used
31,070 and 31,058 CU. The peak transaction used 890,597 CU including other
batched settlement instructions. These are local measurements on eight accounts.

The native verifier checked 16,470 candidate vectors against independently
enumerated optima. The default and candidate Anchor IDLs differ only by the
additional u64 in each frozen row. The [proof and scope](../clearing/default-plan-verification.md#one-btc-debtor-and-several-winning-accounts)
and [reproduction steps](local-development.md#reproduce-the-multi-winner-btc-recovery)
describe the fresh-deployment requirement.

## BTC residual recovery

At `1e05885` three independent eight-account runs used signed Surfpool RPC/WS,
fresh PostgreSQL and SBF `8024a37`. The clearing binary is 2,550,560 bytes,
SHA-256 `cd2e95d27c5e6ec9b1a55138220ec29f2475c9a7c9b3d14373c35a5361e1982e`.
The frozen mark was 70,000 in every case. Each trader withdrew the funded
amount shown to its SPL wallet. Each vault decreased by that same amount.

| Available open BTC gain | Forced close at the freeze | Remaining BTC loss | Flat trader withdrew | Winning maker gain credited | BTC insurance / retained fees |
|---|---|---:|---:|---:|---:|
| 502 against 1,500 short | 1 lot at 69,498, charged 502 | 998 | 8,498 | 0 | 498 / 21 |
| 0 against 1,500 short | 0 lots, no charge | 1,500 | 8,498 | 0 | 498 / 21 |
| 3,006 against 2,483 short | 1 lot at 69,173 and 2 at 69,172, charged 2,483 | 0 | 26,988 | 523 | 511 / 60 |

All eight cash balances in each run matched an independent fill replay and
terminal calculation. Each run checked 279 harness outcomes and 13 separately
finalized worker transactions, recovered a stored original after worker restart,
resumed custody, returned the sponsor’s principal and replayed the same 116
financial payloads in fresh SQL. ETH insurance spent was zero. Peak worker
transaction CU was 891,712, 891,712 and 891,714 respectively. These maxima
cover batched recovery work. An earlier test harness hard-coded the one-lot
fee and rejected the actual 14- and 37-atom fees before qualification.

The two-asset linked book and several competing eligible winners require other
proofs. This candidate has one debtor and one opposing BTC account. The
[rounding comparison](../clearing/default-plan-verification.md#a-sole-btc-debtor-with-residual-losses)
explains a one-atom difference that can arise for flat creditors in the defaulting
market. [Reproduction commands](local-development.md#btc-residual-recovery).

## Verified BTC default payout

At `24bc87f84e3861296fe1559786486dab6a77a877`, eight accounts on fresh
Surfpool exercised the approved successor on the same obligations as #102.
The insolvent maker owed 9,998 atoms, paid 8,000 from its own cash and used
498 from BTC insurance. Clearing verified one paired lot at 68,500 against a
70,000 frozen mark. The remaining BTC creditors received all adjusted claims.

| Funded result in collateral atoms | Selected P56 (#102) | Verified BTC candidate |
|---|---:|---:|
| Flat trader gain withdrawn to SPL wallet | 847 | 996 |
| Winning maker gain credited | 7,651 | 7,502 |
| BTC insurance spent | 498 | 498 |
| ETH insurance spent | 0 | 0 |
| BTC trading fees retained | 20 | 20 |

All eight cash balances matched independent Python replay. The wallet rose
from 0 to 996 and the vault fell from 2,048,492 to 2,047,496. The winning
maker’s storage sponsor recovered its principal after custody resumed. The
harness recorded 281 signed outcomes and separately checked 67 finalized
worker transactions over RPC and WS. The operator stepped through valuation
individually to exercise the freeze boundary. Fresh PostgreSQL replay reproduced
all 116 payloads and the final state. The proof instruction consumed 44,559 CU.
Its eight-instruction recovery batch consumed 223,476 CU, used 1,190 wire bytes
and cost 5,000 local lamports.

At `0ac7019` on the same SBF, the winning maker had only 502 eligible atoms
against the same 1,500 shortfall. Clearing rejected the pair, a substituted
creditor and an attempt to bypass verification. After 271 signed harness
outcomes and 41 worker transactions the original positions, vault and wallet
remained at freeze. Fresh SQL replay reconstructed 82 payloads.

Development runs exposed mismatched pre-charge rate totals, an older operator
page helper and an indexer running sum that used adjusted payouts for as-yet
unapplied original roots. The accepted run uses a revised rate checkpoint,
a matching helper and separate original-claim and payout checks at each row.
The 2,549,160-byte clearing SBF was built at `447efef`, SHA-256
`ad877806d413e8708d8c33189dc4d2084392fb41995763f016506c7ae04b8f6a`.
This family covers one BTC lot and full recovery with whole claims. Partial
shortfalls, other winners and joint BTC/ETH plans remain open.
[Reproduction commands](local-development.md#verified-btc-default-payout).

## Sponsored profit capacity

Program `1763dc750dbb27c852fafd5fbda4fad486fd69cb` built a 2,516,448-byte SBF
with SHA-256 `e1fa7b655b3e619aac575f1a8e559791cfc09e5c28492a5e334678b105b7f547`.
At `291e7a52bbccc92621faf24511b77c1217a2ac7a` the
[signed rent lifecycle](../../tests/rpc-contract/profit-capacity-rpc.ts) checked
274 outcomes and rebuilt 76 financial payloads in a fresh PostgreSQL database.
The refund and growth instructions also advance the margin’s scoped revision.
SOL principal and token balances were checked independently over RPC.

The first sponsor paid 1,178,543 lamports to enlarge the trader’s two slots
from 128 to 224 bytes. A 17-lamport donation already on the root earned
no refund credit. A 129-lot buy still failed until the maker funded its own
capacity. The trader then bought and closed 129 lots. During the open position,
a new sponsor reimbursed the first in full and paid 325,120 additional lamports
to grow to 256 bytes per market. After exit the trader independently returned
1,503,663 lamports to that sponsor. The 17-lamport donation remained on the
margin. The self-funded maker recovered its own 1,503,680 lamports.

| Finalized transaction | CU | Wire bytes |
|---|---:|---:|
| Sponsor initial trader growth | 14,051 | 618 |
| Buy 129 lots | 178,984 | 1,006 |
| Reject release with open exposure | 4,613 | 522 |
| Replace contributor and grow the live root | 17,188 | 650 |
| Close 129 lots | 163,182 | 1,014 |
| Refund absent final contributor | 10,705 | 554 |

Owner substitution, an insufficient signed ceiling, stale replay, missing maker
capacity and a redirected refund all rejected. In the separate signed BTC
recovery, the winning maker’s credit survived 13 restartable worker steps,
complete distribution, an 847-atom withdrawal and return to custody. The sponsor
recovered its full principal. The run checked 279 outcomes and replayed 115
financial payloads. Neither run measures arbitrary-denominator worst-case CU,
larger widths or the successor payout rule. [Commands](local-development.md#sponsored-profit-capacity).

## Clearing-owned surviving profit

The [signed test](../../tests/rpc-contract/profit-attribution-rpc.ts) at
`af1c5158301274cfdb3299b0b364955f8af1ce6f` deployed candidate clearing built
from `33361d969978543716697373826a3f3675e1edc4`. Its 2,497,736-byte binary
has SHA-256 `f4b313c3899e1aab074baf92a015c2e37f3c7a450e6610105e0669d539a98ca3`.
Both makers used the selected P56 binaries. The loopback run checked 344 signed
outcomes including setup and expected rejections. A new PostgreSQL projection
replayed all 157 events. A separate [Python fraction replay](../../tests/financial/check_profit_attribution.py)
reconstructed all 16 frozen market slots across eight accounts from finalized
fills and the backed payment.

The trader bought four BTC lots at 60,002 and closed two at 60,998. The
2,492-atom payment settled 1,992 of fixed gain and assigned 250 to each of the
two open lots. A keeper closed one more lot. Its survivor retained the same
entry and paid amount through the freeze without a trader signature or rent
transfer. A second trader bought three lots across unequal maker prices at a
total of 150,008 atoms, then flipped through a four-lot sale. Clearing retained
the exact aggregate entry for the trader and each individual price for the makers.

| Finalized transaction | CU | Wire bytes |
|---|---:|---:|
| Reject 129 lots on initial capacity; five financial accounts preserved byte-for-byte | 149,931 | 1,006 |
| Open four lots | 177,940 | 1,006 |
| Close two against another maker | 171,540 | 1,014 |
| Pay certified gain | 70,798 | 580 |
| Keeper closes one lot | 202,881 | 918 |
| Two-maker fractional entry | 245,469 | 1,174 |
| Two-maker flip | 244,667 | 1,174 |
| Named-debtor freeze | 51,746 | 918 |

At `b5555bccacaac432f84066c972704b501577575b` the same binary ran the separate
single-debtor BTC recovery below. All 277 signed outcomes, 13 worker continuations,
115 replayed events and the 847-atom token exit passed. Each distributed margin
had empty attribution. These are small local workloads with a 1,275-byte margin
root and 128 bytes reserved per market. General lot capacity, paid-for growth and
successor payouts still require their own qualification.

## Single-debtor BTC recovery

At `7781e6b0cbf0b8df7801cd3d09fff1005977c5ea`, the [signed harness](../../tests/rpc-contract/btc-default-recovery-rpc.ts)
ran the selected P56 binaries (`ed46603`) on fresh Surfpool 1.7.0 with eight
financial accounts, internally operated makers, signed test prices and one test
collateral mint. A cross trader bought one BTC lot from maker A at 60,002 and
sold it to maker B at 60,998. The trader paid two 13-atom fees. At the verified
70,000 freeze, A's short owed 9,998 atoms and A held 8,000 funded atoms.
BTC insurance supplied its whole 498-atom balance (492 donor atoms plus six fee
atoms). The remaining **1,500 atoms** are the difference between the claims and
the 8,498 available to creditors.

| Creditor | Unpaid BTC gain at freeze | Funded by selected clearing | Funded in successor model | Difference |
|---|---:|---:|---:|---:|
| Flat trader | 996 | 847 | 996 | +149 |
| Maker B, still long one lot | 9,002 | 7,651 | 7,502 | −149 |
| Total | 9,998 | 8,498 | 8,498 | 0 |

The [independent comparison](../../tests/financial/btc_default_comparison.py)
replayed both finalized fills from a flat origin, checked every frozen position
and claim, and compared all eight terminal cash balances with the signed
proportional result. The successor model assigns all 1,500 atoms to B by closing
its one eligible lot at 68,500. This leaves zero loss for subsequent proportional
allocation. ETH insurance spent zero. Clearing retained 20 atoms of fees.

The selected worker finalized 13 continuations, including a worker restart
after the first receipt. Each stored original matched finalized RPC bytes
and a successful WebSocket notification. All positions were flat at distribution.
The trader withdrew 847 funded atoms into its SPL account and the vault fell by
847. Four subsequent source observations and an authority transaction returned
clearing to custody. The run recorded 277 signed harness outcomes including setup.
A fresh PostgreSQL 18.6 replay matched the projection, all 115 event records,
their signatures and their bytes. This run covers a single BTC debtor, zero
funding, and one eligible opposite position. The general successor remains a
separate implementation and qualification gate. [Reproduction](local-development.md#btc-default-recovery-comparison)

## Maker liquidation and funded receiver

The candidate SBF was built at `4e07c1f`. Its [signed scenario](../../tests/rpc-contract/maker-liquidation-rpc.ts)
at `3c05d59` used one cross trader, distinct keeper and receiver signers, an
isolated receiver and two internal maker programs on local Surfpool. The trader
bought 50 BTC lots at 61,000 with 564,000 cash and paid 610 in fees. At the new
52,000 index the risk endpoints were 51,480 and 52,520. Funding was zero.

| Stage | Trader lots | Funded cash | Maintenance required | Conservative equity | Shortfall |
|---|---:|---:|---:|---:|---:|
| Before intervention | 50 | 563,390 | 131,300 | 87,390 | 43,910 |
| Maker bought 10 at 51,998 | 40 | 563,286 | 105,040 | 92,466 | 12,574 |
| Tight depth exhausted and receiver underfunded | 40 | 563,286 | 105,040 | 92,466 | 12,574 |
| Funded receiver took 5 at 52,000 | 35 | 563,156 | 91,910 | 94,936 | 0 |

The maker fill cancelled the trader's risk-increasing order and charged the
ordinary 104-atom fee. Clearing rejected quotes at 51,000. While the receiver
had just one atom, it could not take five lots. The venue remained active.
After a signed deposit, the receiver accepted five lots and earned 130 atoms.
It later sold them at the wide bid of 51,000, paid a 51-atom trading fee and
held a flat negative claim of 5,000. Its net outcome was **−4,921 collateral
atoms** before network costs. Insurance supplied zero receiver capital.

The maker liquidation took 175,415 CU in 918 wire bytes, the receiver transfer
54,545 CU in 715 bytes and the receiver unwind 162,340 CU in 1,014 bytes.
All three were finalized v0 transactions. Twelve signed rejections covered
healthy/restored accounts, stale sources, authority, price, available lots,
competing guards, receiver consent and capital. The scenario independently
checked unchanged account bytes on each rejection. The finalized SQL state reconciled
with the accounts, and a fresh PostgreSQL 18.6 database reproduced all 96 events,
including signatures and exact bytes. These are single-session
measurements with one maker leg, controlled prices and local fee payers.
The generated lock inventory covers 92 instructions (84 clearing, 14 custody
writers). The maker liquidation has the same declared access set as a direct
maker route. All earlier entries match their pre-liquidation inventories.

### Stack review regressions

At `5c302cd`, the rebuilt local candidate `ab3f6c6` executed the same ten-lot
BTC reduction with a live risk-increasing ETH order on the target. Both price
windows first expired and a signed BTC liquidation failed. Only BTC reports
then resumed. With the ETH window still expired, the BTC fill cancelled the ETH
order, released its reserve and reduced the target’s deficit from 43,910 to
12,574 atoms. It took 173,591 CU in 918 bytes. The five-lot funded receiver
transfer restored maintenance. All twelve signed rejections preserved state,
and fresh PostgreSQL replay reproduced 92 finalized events. The native control
on the same program source rejected expired ETH when an ETH position survived.

Separately, the eight-account default worker on clean `104a8ac` used selected
P56 clearing and the D108 native helper. All 15 signed continuation transactions
finalized, including recovery after interruption during upload and application.
A token exit landed and fresh PostgreSQL replay matched 109 events. The harness
records the eight-root operating envelope as unassessed. These two runs used
independent local Surfpool instances and test collateral.

## Ordinary trader payout

Harness `f732ae05805aadfe1f1dc06d8a83107bb3e9c02a` used the selected
`p56-window-ed46603` programs, two internal makers, signed local price updates,
Surfpool 1.7.0 and PostgreSQL 18.6. A trader closed a one-lot gain against a
different maker, paid 26 fee atoms and withdrew the 970-atom net profit to their
SPL account. The vault fell by exactly 970. An earlier signed exit that included
one unpaid atom failed with clearing error 6100 and preserved the margin, custody,
vault and token-account bytes. Both makers still held their opposing lots.

| Finalized observation | Trader funded cash | Unpaid BTC claim | BTC settlement pool | Wallet received | Seconds since close confirmation |
|---|---:|---:|---:|---:|---:|
| Closed against B | 999,974 | 996 | 0 | 0 | 59.6 |
| A's first loss collected | 999,974 | 996 | 300 | 0 | 68.5 |
| First 300 paid | 1,000,274 | 696 | 0 | 0 | 103.7 |
| Remaining gain funded | 1,000,970 | 0 | 0 | 0 | 123.4 |
| Net profit withdrawn | 1,000,000 | 0 | 0 | 970 | 126.2 |

The first collection and payment were deliberately staged. The cold certificate
took 39 verification instructions. The ordinary keeper then collected 698 more
from maker A, restarted with its finalized receipt, and paid 2 to maker B and
696 to the trader. The three keeper receipts matched stored signed bytes, finalized
RPC and WebSocket outcomes. Each checkpoint compared the indexed account and API
with a direct SDK read. A fresh database reproduced the final projection and all
158 event rows including their signatures and bytes. Reported times include cold
indexer catch-up, staged collection, certificate preparation and finality. This
run does not estimate steady-state latency. The [local report](local-development.md#ordinary-payout-demonstration)
renders five finalized snapshots through the trader's Positions panel.

## Metered default verification

At `220c139` the [signed resource comparison](../clearing/default-plan-verification.md#measured-nine-account-verifier)
covers an independently deployed fixture on Surfpool 1.7.0 with PostgreSQL 18.6.
All twelve signed transactions were fetched, decoded and observed over WebSocket.
A second process recovered the missing receipt from RPC and resumed at partition
three. The local terminal driver established the resulting cash allocation.
The live clearing release path and its compute budget are outside this measurement.

The [frozen attribution comparison](../clearing/default-plan-verification.md#what-the-freeze-must-retain-about-open-profit)
at `50d8a3a` checks 1,000 prefixes, 367 payments and two exact native terminal
payoffs. Its general storage figures are serialized reference payloads. The [signed growth
probe](../clearing/default-plan-verification.md#signed-storage-boundary) at `100bf32` separately
finalized seven transactions, including atomic rollback and an eight-byte
sponsored expansion, and reconciled six PostgreSQL observations. These CU
measurements cover the dyadic position fixture.

## Settlement and liquidation research

Model revision `11a6000` passes 11 focused Python tests. Eight frozen inputs also
pass through the compiled `financial-core` settlement driver and match independently
specified final cash and insurance debits. The driver checks the terminal settlement
on the original or adjusted claims. Candidate ADL pricing runs in Python. The
[comparison and reproduction commands](../clearing/architecture-review.md#executable-settlement-and-liquidation-comparison)
give the results and scope. This research adds no signed runtime or CU measurement.

Model revision `bd5b40e` passes the original 11 tests and 12 eligibility tests.
The latter include 144 comparisons against exhaustive independent charge vectors
and eight adjusted cohorts with cash and insurance checked by the native Rust
kernel. Competing allocation rules and payment attribution run in Python. The
[multi-maker histories and commands](../clearing/architecture-review.md#eligibility-at-the-freeze)
describe the fee-free scope and the observed close/reopen and account-splitting effects.

Payment-attribution model `1ab1eaf` passes nine new and 23 preceding focused
tests. The new suite compares 180 matched history pairs, ten policy/history
outcomes against literal balances and native Rust terminal settlement, and
15 account/checkpoint accruals against Rust `Participant::accrued`. The
[results and reproduction commands](../clearing/architecture-review.md#which-profit-an-ordinary-payment-settles)
describe the fixed funding component and the open-first and closed-first rules.
This evidence covers research arithmetic and supplies no runtime ADL qualification.

Freeze-cutoff model `8cbbb31` passes 11 focused tests. Six orderings of the
observation, proof, close and reopen across three policies give 18 comparisons
to literal charges and cash, with final cash and insurance also matched to the
compiled Rust settlement kernel. Four existing native clearing tests passed for
the current freeze guards and financial membership commitment. The [results and
commands](../clearing/architecture-review.md#when-default-eligibility-becomes-binding)
document the rebound, omitted witness, atomic rollback, funded payments and
deferred emergency valuation. No signed execution or keeper latency was measured.

Model `9bfd68f` passes nine cross-market tests and the existing 12 winner
eligibility tests. Seven adjusted cohorts match independently specified cash and
insurance debits in the compiled settlement kernel. Candidate selection runs in
Python at frozen prices. The [cross-market cases](../clearing/architecture-review.md#who-bears-the-cross-market-effect)
include an ETH creditor whose payout falls despite an unchanged ETH position,
an additional ETH insurance draw and a feasible partial BTC reduction.

Model `c4109b1` passes eight individual-payout and fractional-ownership tests.
Seven unmodified native terminal calculations reproduce the specified ordinary
outcomes. Independent enumeration checks 1,125 three-creditor transitions.
The nine previous cross-market and 29 clearing-network tests also pass. Five
scalable-kernel tests passed, including 774 matched settlements. The
[new examples](../clearing/architecture-review.md#protecting-individual-creditor-payouts)
cover a loss hidden by identical aggregate ETH payout, recovery rate and insurance.
The constrained allocation and frozen-share comparisons run offline. At
`1f3ce81`, all eight payout and nine cross-market tests passed with D118
protected rounding selected by default.

Joint model `e06dca7` passes eight new tests, including 81 independent
two-debtor/two-winner matching cases and four ordinary Rust terminal controls.
The eight individual-payout and nine cross-market tests pass at the same pin.
The [payout table](../clearing/architecture-review.md#competing-debtors-and-simultaneous-market-defaults)
reports each market in isolation and both together. Candidate selection,
protected rounding and the joint commitment policy are offline research.
Run `python3 tests/financial/test_joint_reductions.py -v` after building the
native settlement driver as described above. At `400ea98`, the eight tests pass
with D119 joint admission selected. At `bec7149`, ten tests pass, including
two additional native terminal controls for the ranking comparison. Its funded
flat-creditor outputs are 6/7 and 5/8, with zero insurance in either case.
At `65899ee`, eleven joint tests pass, including the 61/12 equal-total case.
At `91ae07e` all eleven pass with the approved D120 policy as the default.

At `4be157f`, eight default-plan verification tests, eleven joint tests and
eight native clearing plan-controller tests passed. The new tests include 97
six-winner books, five native terminal controls and a 121-member funded cohort.
The [results](../clearing/default-plan-verification.md) distinguish a sufficient
score proof, a loose bound and the identity tie. Python carries the successor
verification. The Rust controls exercise ordinary settlement.

At `0093a05`, six restartable default-search tests pass alongside eight
certificate/identity and eleven joint tests. The six-account case reproduces
the native 9/9 terminal payout after a nine-candidate scan. Tests cover changed
sources and proposals, stale cursors, early access and an inferior equal-score
assignment. The [work counts and limits](../clearing/default-plan-verification.md#restarting-verification-when-a-bound-misses)
describe a Python reference with trusted checkpoint storage. No successor
RPC execution, on-chain step limit or wall-clock guarantee is claimed.

### Signed source publication and freeze

On 18 November 2026 harness `bc816d4` deployed the qualified local SBF
`ed46603` on fresh Surfpool 1.7.0. A 60-lot BTC long against a funded
maker had 999,099 atoms of common-value equity at 60,000 atoms/lot
and −200,901 at 40,000, including funding at the frozen index. A separate
permissionless keeper paid the fee. Two independent local fixture publishers
signed six BTC, ETH and collateral feed updates.

| Finalized original | Result | Wire bytes | CU | Writable / read-only keys | Fee (test lamports) | Broadcast to observed confirmation |
|---|---|---:|---:|---:|---:|---:|
| Freeze the named account at the original price | Solvent, resolution error 6130 | 918 (v0) | 33,470 | 10 / 13 | 5,000 | 123 ms |
| Publish all six feeds and freeze the same account in one transaction | Oracle source error 6123 | 1,551 (v1) | 25,780 | 16 / 9 | 15,000 | 102 ms |
| Publish the adverse prices | Committed at slot 1569 | 1,056 (v0) | 6,138 | 7 / 4 | 15,000 | 113 ms |
| Freeze using those published prices | Committed at slot 1572 | 918 (v0) | 51,582 | 10 / 13 | 5,000 | 110 ms |

The atomic packet reached clearing after six successful publisher invocations.
Its compiled message gave all six feed accounts write access. The
[source binding](../../programs/clearing/src/engine/sources.rs) requires each
feed to be read-only. All feed and writable clearing account bytes matched
their pre-transaction values after rejection. The separate publication left
the venue active. The subsequent freeze fixed all eight financial members,
both funding indices and BTC/ETH prices of 40,000/30,000 atoms per lot.

The successful pair consumed 57,720 CU and 20,000 test lamports. From building
the updates, with the proof instruction already prepared, to observing freeze
confirmation took 265 ms including intermediate RPC checks. This is one
loopback sample with 50 ms slots, signed synthetic prices and zero priority
fee. Live oracle publication and keeper discovery latency are unmeasured.

The harness compared the signed bytes with finalized RPC history for all four
originals. Signature WS notifications agreed with the receipts. Surfpool's log
notifications reported a null error for both rejections. Fresh PostgreSQL replay
matched the 72 committed events and reconciled the frozen accounts. Reproduce
from the repository root with the pinned local artifacts and Apple Container.
A fresh review run at `3594114` refreshed all six original-price sources and
observed the same chain second through the healthy rejection. It checked both
frozen marks and each signature notification against its finalized receipt.
All four CU measurements repeated exactly. Publication and freeze landed at
slots 1651 and 1653, and PostgreSQL replay reproduced 72 events.

```sh
RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/anchor-rc2/current \
RIVALT_SETTLEMENT_PROBE=freeze-cutoff bash ops/scalable-settlement-smoke.sh
```

## Whole-account risk-engine extraction

Harness `8b5dda2` deployed predecessor `ed46603` and candidate `6775e13`
on separate Surfpool 1.7.0 instances with fresh PostgreSQL 18.6 databases.
Each ran the same two-market cross account, isolated receiver and funded makers.
The nine measured originals matched in outcome, packet size, fee, signature
count and loaded-account count. Rejections rolled back the tracked accounts.

| Signed original | Predecessor CU | Extracted CU | Bytes |
|---|---:|---:|---:|
| Two-maker BTC fill | 279,463 | 281,352 | 1,196 |
| Two-maker ETH fill | 278,800 | 280,753 | 1,196 |
| Reject withdrawal below IM | 24,119 | 24,631 | 806 |
| Funded withdrawal | 55,332 | 55,940 | 806 |
| Reserve a cross-account order | 35,492 | 36,145 | 636 |
| Reserve an isolated order | 34,903 | 35,410 | 636 |
| Reject liquidation that worsens the deficit | 27,859 | 28,648 | 715 |
| Transfer ten BTC lots and pay the receiver | 55,250 | 56,436 | 715 |
| Reject stale liquidation replay | 9,618 | 9,618 | 715 |

Both transferred exactly 260 fee atoms. Cash ended at 598,738 for the target
and 1,000,260 for the receiver. Signed lots and virtual quote matched the
independent transfer and funding equation on both roots in both markets.
Each deployment reconciled its own 90 committed events to fresh SQL replay.
The clearing SBF shrank from 2,389,840 to 2,374,256 bytes. The largest direct
frame-pointer displacement in each disassembly was 4,096 bytes. The candidate
build passed the SBF frame diagnostic check. Displacement describes an
instruction offset, not aggregate call-stack usage.

Twenty-four native financial tests and six clearing liquidation tests passed.
All three regenerated IDLs matched the checked-in bytes. The RC2 wire and
signed-domain contract, generated price constants and TypeScript check passed.
These measurements cover the listed paths. The normal demo and workers continue
to select `ed46603`. The candidate has its own test-only artifact set.

To repeat, build the candidate from clean `6775e13` into the directory below.
Run the same probe once per pinned artifact set from the harness checkout.

```sh
for artifacts in .local/anchor-rc2/current .local/risk-engine-6775e13; do
  RIVALT_SETTLEMENT_ARTIFACT_DIR="$artifacts" RIVALT_SETTLEMENT_PROBE=whole-account-risk bash ops/scalable-settlement-smoke.sh
done
```

## Account-scale populated qualification (P56)

Clean harness **`ad19215df00c03d5a6ab8f597d411e07fac8e467`**, D108 SBF/helper
**`ed466030eccd485b8552b378815bf3f4e28fb658`**, passes the actual populated
128-Financial-root run. The cohort includes six makers, 16 cross roots, 120 exposed
roots, 65 debtors, 70 creditors and 15 roots with opposite-sign market claims.
There are **175 durable originals / 2,317 guarded instructions**, **506.428 seconds**
through complete resolution, **875,000 test lamports**, peak **897,380 CU / 3,348
wire bytes**. Original p50/p95 processing is 2.328 / 2.751 seconds. G1 passes.

Both actual upload/Apply SIGKILLs recover the same signed originals with one observed
broadcast each. Independent Fraction/graph payouts and market insurance consumption
(**6,792 / 3,252 atoms**), complete application, one-atom SPL exit, sustained recovery
and explicit resume pass. All 1,023 setup/recovery outcomes (eight deliberate
rejections) are fetched over RPC and matched to WS. Independently paid BTC/ETH fills
have disjoint actual signed lock sets; this is not a validator-throughput claim.
Fresh PostgreSQL replay reproduces **1,074 events / 405 accounts / 128 Financial
members**. Actual and allocated vault equal **332,907,139 atoms**, zero surplus.
Both isolated Anchor clients match 3,332 clearing instructions / 4,368 clearing
events, plus 378 maker instructions / 384 maker events. This run adds no account
decode vectors. The separate independent worker audit passes; end tracked tree is
clean. Raw files remain in `.local/scalable-settlement/runs/p56-populated-128-parity`.

Pre-funded recovery has **99 accounts / 192,661 data bytes / 1,043,091,640 rent
lamports**. All clearing accounts before resolution total **404 / 352,526 bytes /
2,053,529,040 rent lamports**. Rent is separate from transaction fees and collateral;
these are local test-lamport measurements with zero priority bids. Worst-width
storage is provisioned; this financially populated sample is not an adversarial
maximum-denominator latency proof. The finite work/storage bounds remain checked.
Larger compiled workloads, including 1,024 Financial roots, require separate
measurement before enablement; no unlimited population or profitability is claimed.

### Selected normal launcher and wallet

Clean **`6b92665d5561ac547595a9f4211b567d7e144c30`** passes the actual normal
launcher on the same D108 binaries/helper and installed Chrome **157.0.8103.39**.
The complete run has **13 successful wallet originals, zero rejected originals
and zero page errors**. Every signed wire matches independently fetched finalized
RPC history. Actual Surfpool RPC/WS and PostgreSQL serve the app and indexer.

Checks cover a fresh internal browser wallet and faucet, origin/stop denial,
portfolio and both account modes, atomic activation/deposits, sibling allocation,
wallet decline with no original, BTC/ETH fills, TP/SL/cancel, both reduce-only
closes, an actual **1,000,000-atom token withdrawal**, reload with retained originals
and reconciled indexed fills. The tracked tree is clean at completion. The owned
server and database stop normally. Captures remain at
`.local/scalable-settlement/p56-normal-demo-wallet-final`; runtime/keys/database
remain at `.local/interactive-demo-p56-selected-5`.

Earlier normal-launcher attempts are partial evidence: an initialization-slot
publisher fence (fixed by waiting before refreshing inputs), a low-disk shutdown,
and a cross/isolated selection render crash (fixed by requiring the selected root
in the snapshot before financial calculation/actions). The crash reproduces in a
focused regression before the fix; all four component cases and typecheck pass
afterward. The 51 prior selection/client/batch/binding checks also pass.

Other browser attempts preserve a MakerQuote rejection after signed route expiry
(expiry 4,118; finalized landing 4,138), and an OraclePolicy refusal inside its
signed lifetime (landing 9,553; expiry 9,615). The latter is not relabelled expiry.
The verifier models at most three fresh user reviews after finalized version/source
refusals or independently proven expiry, waiting for current source admission each
time. Unknown originals and unrelated financial errors stop; every failure and fee
is retained. Neither partial run is counted as complete acceptance. The passing
run required no such retries. No program guard or publication cadence was relaxed.

This closes P56's local acceptance, not PR integration, external-wallet acceptance,
continuous availability, production throughput or a larger-population cost claim.
Hosted run 43162914676 on `6c4652c` passes 403 client checks but exposes three
launcher fixtures with schema-8 manifests. The fixture-only correction declares
schema 10/profile 6; all three focused checks now reach their intended bad-hash
rejection before runtime creation. No program, launcher guard or qualified binary
changes, and the signed financial/browser acceptance is not rerun for this fix.

## Maintained backing integration (P55B2)

The gated schema-10/profile-6 candidate has source-derived IDL/SDK outputs and an
explicit D102 wire delta against immutable P55B1 `c650265`. Before its first clean
build pin, affected checks pass: 18 cash/certificate tests, four region/layout tests,
13 scoped journal tests, one dependency test, 65 client tests across ten affected
files, 15 ABI-guard regressions, typecheck and the all-three-program ABI comparison.
The changed kernel passes the independent five-method reference again (1,274
corner contributions and 89,720 summary/restoration prefixes; native only).
The worker completes an unpayable cohort's scan without attaching a doomed payment.

At the P55B2 checkpoint, the selected runtime remained schema 8. Candidate manifests now read actual source
schema/profile constants; they do not bypass the selected runtime hash allowlist.
Candidate `bbd3398` is rejected by the SBF guard: backing-event construction has
maximum stack offset 4,192, 96 bytes over the allowed frame. It was not deployed.
Separate snapshot construction frames fix this at clean
`bc9f029fa0f541a7407384a0bc7715bcee9c0f08`: all three default and qualification
programs build without oversized-stack diagnostics. Clearing is 2,374,856 bytes,
SHA-256 `62523299a7f1629dc40e56cd99c6b858a74a247bc5eecca46debab0ec0ab65a9`.
Clean harness `3c44c0ef7443b1e4afca341887153f3465d989d1` passes 402 signed outcomes
(six expected rejections), RPC/WS receipt equality and exact 214-event fresh
PostgreSQL replay. Both eight-member market scans finish 39 continuations in
22.90 / 22.91 seconds without resetting after initial epoch creation, while sources
continue sampling, four independently paid scan/fill pairs overlap and six processed
cross cash mutations land. Two failed atomic closure/payment transactions preserve
all tracked bytes; two valid closures pay one actual funded atom each. The Python
16-corner auditor matches 135 summaries across 98 actual RPC captures. Both isolated
Anchor clients agree on 389 clearing instructions, five final accounts and 595
clearing events. The actual/allocated vault is 8,000,000 atoms, with zero surplus;
226 accounts/eight members reconcile. End tracked tree remains clean.

| Observed transaction | CU range | Maximum bytes |
|---|---:|---:|
| Backing continuation | 32,091–39,321 | 579 |
| Atomic final closure/payment | 81,937–81,973 | 738 |
| Overlapping admitted fill | 166,738–167,141 | 910 |
| Processed cross transfer/withdraw/deposit | 33,752–66,858 | 806 |

Actual signed messages confirm selected-ledger/root contention without adding a
writable venue registry to ordinary fills. Raw logs/transactions/SQL captures stay
at `.local/scalable-settlement/runs/p55b2-progress-initial`. This is eight populated
roots and bounded overlapping activity, not saturated throughput or public-network
fee evidence.

The expanded clean harness **`cf128c0e9840867a8eff054e845bd46966903ff1`** passes
**1,474 signed RPC/WS outcomes / 61 expected atomic rejections** on the same pinned
SBF. Its two initial scans take 22.51 / 22.59 seconds and never reset under ongoing
in-region activity. Added acceptance covers stale-source refusal/recovery without
proof erasure, actual Financial entry/exit with restored-count rejection, TP/SL and
reservation/replay guards, conservative bad-debtor blocking and actual 1,000-atom
repair, flat-only one-atom closed-claim netting, and liquidation repair with a literal
27-atom funded reward. Invalid size and no post-fee deficit improvement reject.
Complete default and one actual SPL exit pass the independent Fraction/graph
expectations; sustained source recovery cannot revive pre-default proof authority.

Python's direct 16-corner audit matches **269 summaries across 227 actual frames**.
Both isolated Anchor clients match 1,457 clearing instructions, five account decodes
and 1,862 clearing events. SQL checkpoints cover partial Apply, distribution,
completion and recovery; **469 events** replay identically into a fresh database.
All **227 accounts / eight Financial roots** reconcile to **7,199,891 actual and
allocated vault atoms**, zero surplus. End tracked tree is clean. Evidence remains
at `.local/scalable-settlement/runs/p55b2-complete-recovery`.

Failed harness attempts are retained: `3f8dca7` used a one-lot price-2 trade below
the unchanged 1,000-atom minimum notional; `716d56c` passed its 500-lot replacement
but required normal source recovery after the SQL section. No risk rule was relaxed.
The focused worker run at `cf128c0` lands 41 original transactions and completes
lost-ack/SIGKILL recovery and SQL checks, but the final independent audit stops on a
missing certificate capture. The corrected clean **`831d352a5b95043c4aca11c1202e5b102d021c87`** worker run
passes: **278 setup/publication outcomes plus 41 durable worker originals**, all
independently fetched with signature WS checks. A real SIGKILL after RPC acceptance
and before acknowledgement recovers the same persisted signed bytes (one observed
broadcast); producer calls remain blocked while that original is unresolved.
The proof completes epoch 1 in 39 scan steps, with loss collection/certificate
initialization making 41 originals total. Exactly five atoms are collected and
paid; final closure/payment is atomic. The independent auditor matches **39
summaries / 41 frames**. Fresh PostgreSQL replay is identical across **136 events**,
225 accounts/eight Financial roots, with **8,000,000 actual/allocated vault atoms**
and zero surplus. The settlement budget spends exactly **205,000 test lamports**,
with zero retained fee/access reservations. Worker CU spans **15,876–79,589**. The
128.55-second worker-loop measurement includes source renewal, executor death,
reopening, checks and SQL replay; it is not saturated throughput. The tracked tree
is clean. Raw evidence is `.local/scalable-settlement/runs/p55b2-worker-complete`.

The expanded financial run additionally measures one flat net at **51,858 CU**,
liquidation at **68,970 CU**, and eight default Apply actions at **84,008–86,064 CU**
(up to 915 bytes). Its peak is 181,941 CU and whole-harness fees are 9,720,000 local
test lamports, including setup and expected rejection cases, not a default-only
cost claim. Full population/default-worker/UI activation remains P56A/P56B.

Reproduce using `source ops/env.sh`, explicit
`RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/scalable-settlement/p55b2-frame-fix`, a fresh
`RIVALT_RUN_DIR`, and `bash ops/scalable-settlement-smoke.sh`. The financial workload
selects `RIVALT_SETTLEMENT_PROBE=maintained-backing` with
`RIVALT_SETTLEMENT_PLAN=1 RIVALT_SETTLEMENT_APPLY=1`; the separate worker workload
selects `RIVALT_SETTLEMENT_PROBE=backing-worker`. Both own actual Surfpool and
PostgreSQL, and the supervisor stops them after completion. The worker harness
binds only the explicit candidate hashes; no production financial method is replaced.
P55B2 is accepted for Review on these pins. No larger population, runtime promotion, endurance or external
validation follows from these checks.

P55B2 CI correction: hosted run 43120447567 at `7487cc3` caught raw native
schema-9 fixtures, a rejected-profile list containing the new valid profile 6, and
an outdated generated lock inventory. Clean `1b42a2c` passes 14 affected native
qualification checks, both disabled-default activation checks and the regenerated
90-entrypoint inventory. The reviewed access delta is `check_market_backing`'s
writable ledger, already implemented/measured by D102. Other changes are IDL hashes.
Only tests and the bounded inventory change; the accepted program binary and signed
financial results above remain the same. Hosted run 43122151935 passes financial,
scope, report and shell. Its client suite catches the stale profile-5 frozen-proposal
reader; clean `f560b05` updates that guard to profile 6 and passes all three focused
proposal tests. A first worktree test attempt lacked workspace dependency links and
ran no tests; after reusing existing dependencies the complete focused run passes.
No SBF/economic change or additional signed acceptance is claimed for this guard fix.

## Maintained backing arithmetic (P55B1)

Clean **`1715d20ceda111591bc1e8addbfa95ea4208c9f0`** compiles the actual
`financial-core::backing` kernel and passes five independent transport checks.
The Python reference enumerates all 16 corners using the direct unpaid formula,
without importing production arithmetic or the previous P51B candidate model:

- **1,274** Rust contribution comparisons, including numeric extrema, fractional
  negatives, isolated/cross roots, gross sibling debt and zero positive-profit credit.
- **89,720** exact summary/checkpoint-prefix comparisons across both markets and
  64/128/1,024/10,000 native roots, with processed-root cash damage/repair and
  unprocessed-root funding changes between scan steps. Every kernel prefix is
  decoded/restored; this is not a process-crash or account-authentication test.
- Six literal collection/payment/flat-netting/fill/fee sequences, including pool
  identity changes and newly bad contributions; nine malformed/underflow cases,
  thirteen invalid root/region cases and nine held-region boundary cases.
- A u64::MAX-count **arithmetic diagnostic** exercises positive/negative aggregate
  carry/borrow beyond u128. This is neither a funded nor authenticated cohort.

Two focused native tests verify immutable failure candidates and checked count
exhaustion. Fourteen wire-regression tests and `ops/wire_contract.py` pass: no
Anchor layout/IDL/instruction/PDA/signed-domain change. The source-literal guard
explicitly adds only the native `RVBACK01` checkpoint tag. `ops/financial.sh`
includes the new driver/reference for CI; unrelated local suites were not rerun.

Reproduce with pinned environment, `cargo build --locked -p financial-core --bin
backing-driver`, `python3 tests/financial/test_maintained_backing.py` and
`cargo test --locked -p financial-core --lib backing::tests`. Logs remain at
`.local/scalable-settlement/p55b1-*`. The complete mutation map is in accounting.
No SBF resource/authority claim follows: P55B2 still owes actual atomic hooks,
complete membership, current source and held-window checks, persisted worker
restart, concurrent-activity progress, final-page/payment rollback and RPC/WS/SQL
acceptance. P56B's live-population gate remains unchanged.

## Canonical account lifecycle (P55A2)

Clean SBF **`583dbcb53a748db8f2fa21d0594eaaafdd7e5f85`** links without
oversized-stack diagnostics: clearing 2,335,664 bytes / SHA-256
`d48d562762208c50a5566c9ea640e23fbe01bc10729e8cf0e9681544aae68074`.
The source-derived IDL/SDK has schema 9 / profile 5. The earlier `bfd10e8`
stack-rejected build is not admitted; the subsequent `65c14bf` signed attempt
found a legitimate same-wallet authority/rent-payer duplicate constraint. The
narrow untyped destination exception preserves immutable payer binding and
other mutable-account duplicate guards. No financial or oracle rule changed.

Lifecycle harness **`0d9c378`**, with that SBF, passes **411 signed RPC/WS
outcomes**, including **18 expected rejections**. It registers 71 permanent
identities, exercises IDs 65/66 as two Financial roots, rejects entry before
complete rent-backed capacity, fences a stale competing predecessor, increments
re-entry generation, and rejects leaving with cash. Five actual SPL atoms are
deposited/withdrawn before exit. Three root retirements retain 135-byte markers;
whole-venue retirement enables five allocation-kind refunds to the immutable
payer, retaining 72-byte markers. Actual payer balance increases equal refunds
less independently fetched transaction fees; total refunded is 34,391,600 test
lamports. Recovery ready capacity becomes zero after the terminal cleanup.

| Transaction | Observed CU | Wire / loaded keys |
|---|---:|---:|
| Financial entry/exit | 54,339–56,334 | v1 1,232 bytes / 27 |
| Empty root retirement | 23,122–24,410 | v0 617 bytes / 12 |
| Terminal allocation refund | 16,581–17,248 | v0 461 bytes / 9 |

The v0 entry/exit encoding is 1,274 bytes; the canonical v1 encoding is exactly
1,232, with zero priority bid and no lookup tables. Both isolated Anchor clients
agree on 407 clearing instructions, 377 final account decodes and 556 events.
Signature WS and fetched transaction errors match for every outcome. The full
probe consumes 10,036,949 CU and 2,865,000 base-fee lamports. The 99 recovery
allocations/receipts cost 1,169,324,560 rent lamports, excluding the header and
permanent membership storage; capacity is 128 roots, **not** evidence of 128
Financial participants. Owner/signature separation measures rent refunds without
confusing them with trader collateral. Shared-index stale-guard acceptance is an
optimistic race check, not a throughput benchmark.

Raw results: `.local/scalable-settlement/runs/p55a2-lifecycle-refund-fixed/`.
The run starts from the committed harness; its final Git metadata reports dirty
because the separate default/SQL harness was migrated concurrently. The executed
lifecycle sources were unchanged. This is not a clean whole-repository acceptance
claim. The owned Surfpool stopped normally. The subsequent default/SQL, custody, race and wire-delta checks below complete
the P55A2 boundary. Runtime selection remains P53B; default/devnet remain disabled.

## Canonical complete default (P55A2)

Clean verifier **`1de35c30f4cb96047292ca6d5d45f36cabc7bca2`** against the
same clean **`583dbcb`** SBF passes **1,538 signed RPC/WS outcomes**, including
**67 expected rejections**. Ten actual Financial accounts enter through signed
storage-backed membership. Independent Python Fraction and graph expectations
check rate prefixes, insurance clipping, conserving atom owners and actual Apply.
All accounts reconcile, eight one-atom SPL exits land, and sustained credible
sources allow explicit recovery to custody. No financial state is injected.

Actual PostgreSQL checkpoints pass after the first Apply, after complete bucket
distribution and after recovery/exits. Fresh refetch/replay exactly matches **141
events** and reconciles **227 accounts / ten Financial members**. Final actual and
allocated vault both equal **11,199,993 atoms**; surplus is zero. Applied cash is
9,500,000 atoms and market insurance spent is 1,001,522 / 300,430 atoms. Peak
observed CU is **161,562**; full probe fees are **8,415,000 test lamports**, including
provisioning and hostile/replay attempts, not an operating-cost forecast.

Both isolated Anchor clients agree on 1,516 clearing instructions / 75 accounts /
1,588 events, plus 76/38 maker-A/B instructions and 80/40 events. Raw evidence is
`.local/scalable-settlement/runs/p55a2-default-source-plan-fixed/`. Start and end
tracked trees were clean. The preceding `4c8dd27` run failed its first partial SQL
checkpoint because the indexer used old source-header progress semantics. Its
retained failure led to the frozen-source versus plan-progress regression; no
partial run is counted as acceptance.

This completes the exercised on-chain default path at ten Financial roots, not
128-root acceptance, durable automatic continuation, runtime promotion or P56B.
The old fixed-width resource-only `safety-width-svm.ts` and retained-schema-8
`scoped-safety-projection.ts` runners are retired; retrieve them at immutable
`7b0ab0716810c6894064cc1a11fc5da27ed54a3a` only for their historical captures.
Current verification uses paged arithmetic checks and actual signed RPC/WS/SQL.

## Custody and lifecycle interleavings (P55A2)

Clean custody verifier **`e8dfe31b1f169edc3ca520622e8e4fec127821b0`**, against
SBF **`583dbcb`**, passes **234 signed outcomes / 26 expected rejections** with
five Financial roots. Actual transfers and SPL exits preserve final cash zero,
market insurance 7/11 atoms and actual/allocated vault 18 atoms. The separate
raw-byte Python auditor rejects eight corruptions. Peak CU is 56,019; fees are
1,425,000 test lamports. Both isolated Anchor clients agree on 228 instructions,
five accounts and 232 events. The deliberately malformed missing-owner-signer
instruction is explicitly excluded from builder parity: the IDL builder correctly
restores the mandatory flag. Its actual signed rejection and rollback are still
verified. The earlier `7574fde` attempt failed that inapplicable parity comparison;
raw evidence is retained under `.local/scalable-settlement/runs/p55a2-custody-*`.

Clean race verifier **`061e201881f0396831e40b81f54f318b74a8f569`** with the same
SBF passes **274 signed outcomes / eight expected rejections**. A prepared entry
survives unrelated empty registration and a real 50-lot BTC fill. A one-atom cash
transfer invalidates a prepared exit; cash-bearing exit rejects until an actual
SPL withdrawal. Reentry advances generation and fences an old retirement. Actual
bankruptcy freezes all eight remaining Financial roots; previously prepared entry,
retirement, registration and trade cannot cross that freeze. A rebuilt trade also
rejects frozen-mode admission. Every hostile case compares full affected bytes.

Signature WS errors match independently fetched finalized outcomes. Both isolated
Anchor clients match 256 clearing instructions / three accounts / 329 events,
44/22 maker-A/B instructions and 48/24 maker events. Peak CU is **160,680** (the
actual fill); Financial entry reaches **57,077 CU / v1 1,232 bytes**, retirement
25,146 CU and freeze 49,091 CU. Full probe fees are **1,895,000 test lamports**.
The preceding `d45ff29` run rejected the pre-freeze trade correctly but expected
Profile instead of the earlier FinancialSequence guard. The corrected run tests
both the stale guard and newly rebuilt guard. Raw results remain at
`.local/scalable-settlement/runs/p55a2-races-061e201/`; both start/end trees are clean.
These are optimistic transaction interleavings, not simultaneous-load/TPS evidence.

All three IDLs and generated SDKs are source-derived, including imported clearing
layouts in maker IDLs. The D101 ABI regression names the literal delta from
immutable `7b0ab07` and then reuses the previous D97/D90 guards; no baseline is
recaptured. Fourteen wire tests, eleven affected conformance/economics tests,
typecheck and generated-output/instruction-inventory checks pass at `7574fde`.
The final race-only correction changes no ABI or SBF. Full hosted regression is
CI's responsibility; no unobserved CI pass is claimed here.

P56A still owns complete wallet/UI discovery, durable paged-default automation and
migration of the retained trading/safety Python raw-audit adapters. Current-runtime
commands explicitly reject selected schema-8 artifacts with schema-9 clients.
This phase does not promote the demo, qualify 128 Financial roots or enable default/
devnet trading. Reproduce the scoped candidate checks using
`ops/account-membership-smoke.sh` (lifecycle or `RIVALT_MEMBERSHIP_PROBE=custody`)
and `ops/scalable-settlement-smoke.sh` (default or
`RIVALT_SETTLEMENT_PROBE=membership-races`), with the explicit artifact/run paths.

## Recovery storage provisioning (P55A2 intermediate)

Clean verifier **`81aae9df623bdddff69a73f2ba9f88c80a6fc9bb`** runs
`ops/account-membership-smoke.sh` against clearing SBF
**`174b3b2a9659b873b6ac037f9050fee27d3ac31f`**, 2,445,600 bytes, SHA-256
**`189320a7a9ed4ebf419dd421f8b3aee639775827535f2afa25ac854092cde85f`**.
It is a fresh local qualification deployment; selected/default/devnet artifacts
remain unchanged. The pinned SBPFv0 build has no oversized-stack diagnostic.

Actual Surfpool RPC/WS verifies **223 signed outcomes / 11 expected atomic
rejections**. The independently derived 128-root schedule authenticates **99 real
allocations**, with immutable payer receipts, before earning any capacity. Cases
cover authority, zero/overflow/decreasing capacity, stale start/progress/cancel,
skipped steps, interrupted cancellation/restart, paused writes and actual partial/
fully donated rent. Funding alone leaves the proof cursor/capacity unchanged.
Collateral remains zero throughout. Signature WS outcomes match fetched finalized
results, and both isolated Anchor clients match **220 clearing instructions,
199 accounts and 214 events**.

Allocation costs **31,491–44,499 CU**, at most **501 bytes / ten loaded accounts**;
verification **16,120–18,448 CU**, **462 bytes / nine accounts**. These are actual
v0 transactions at 400,000 requested CU and zero priority fee. Allocation plus
receipt rent is **1,169,339,800 lamports** (excluding the capacity header); actual
allocation payer top-ups total **1,035,340,320**, with prior donated lamports
separately exercised. Whole-probe transaction fees total **1,125,000 lamports**
and measured CU total **5,817,743**. These are local test costs, not a production
fee forecast or a claim about complete default recovery cost.

At the same clean verifier pin, eight focused native checks pass: four schedule/
epoch cases, two hostile actual-account loaders, one scoped raw-create transition
and the literal layout roundtrip. Typecheck and D90 plus explicit additions ABI
checks pass. The first run completed its signed provisioning assertions but failed
the final client check because the harness used PascalCase instead of Anchor's
camelCase account names; the corrected fresh run above passes. Original captures
remain at `.local/scalable-settlement/runs/p55a2-storage-174b3b2/` and
`.../p55a2-storage-parity/`; the owned runtime stopped normally.

This is an intermediate **storage-only** result. It does not complete P55A2,
activate Financial membership, qualify live-index freeze/default or establish a
PostgreSQL replay. Those remain required before phase acceptance.

## Membership foundation (P55A1)

Clean **`b8a19ebf13f32a23461213648de97a8daa4382c0`** passes **38 focused native
tests**: two index-planner cases, two literal full-width financial identity cases,
32 affected margin/cross/economic cases and two authenticated program-loader cases.
The index test independently rebuilds all radix counts after each of 2,054 entry/
exit transitions across 1,027 sparse members, including IDs above 2^53 and near
u64 exhaustion. It verifies the complete leaf/root count relation, masks, replay,
invalid ancestors and unreachable high branches. These are native populations,
not admitted on-chain accounts.

Literal high-ID financial cases verify fees, whole-account funding, cash exits,
transfers, duplicate identity rejection and stable-ID atom ties. The authenticated
adapter uses actual Pinocchio account views and exact PDA bytes, rejecting missing,
aliased, reordered, foreign, readonly, executable and stale-revision nodes before
any write. Scoped history retains revision ownership; public lifecycle/authority,
member-page, safety and recovery-storage integration remain P55A2 work.

The same clean pin links a **2,335,560-byte** clearing SBF, SHA-256
`f8420651a1e0f2a400226e7349ec992ffeb46462ade6fe0a343eb47c6593f7c1`, without
oversized-stack diagnostics. This is compilation evidence only, with no signed
successor lifecycle, CU/latency claim, SQL replay or new selected runtime. The
candidate is retained at `.local/scalable-settlement/p55a1-b8a19eb/`; raw focused
logs remain alongside it. The wire contract still matches D90 plus the existing
approved extensions, and the evidence-policy check passes. The sole development
loader-test compile error (a missing mutable test binding) was fixed before this
clean pin. P55A remains unfinished until P55A2's complete signed acceptance.

## Conserving settlement (P54C)

Clean SBF **`efa45951e01b9586469b48294de24d3f0f5fd02a`** links at
**2,331,160 bytes**, SHA-256
`c943fafd89ddd7688e693384acdc650b8284689f1c5822689c38c36998873af0`, with no
oversized-stack diagnostic. It remains separately stored at
`.local/scalable-settlement/p54c-efa4595/`; normal runtime selection remains P53B.
Clean verifier **`c6e08f95e694cd70768830f4e45e5bd0b63cec87`** passes **1,405
signed deployed RPC/WS outcomes**, including **68 intended atomic rejections**.
The ten-root cohort has isolated/cross debtors and creditors, both markets,
internal makers and a healthy receiver holding one atom. Signed positions and
funding generate the frozen claims; independent Python Fraction/circulation
expectations determine rates, flows, cash and exact terminal atom owners.

All eleven new construction/application entrypoints execute. Complete market
orders and 685 bounded construction continuations precede exclusive adoption.
Stale revisions, omitted/repeated rows, bad order recovery, premature distribution,
legacy Apply after adoption and terminal replay reject. A transaction with two
identical Apply instructions rolls back both instructions and their financial
bytes. Exactly-once cleanup preserves monotone order/protection IDs and frozen
funding, invalidates execution generations/delegates, and clears obligations.

Actual final cash is **9,500,000 atoms**; BTC/ETH insurance spends exactly
**1,001,522 / 300,430 atoms**, matching the independent clipped solution. Retained
fees, fee carry and unused insurance remain unchanged. All eight positive-cash
roots withdraw one actual SPL atom, including the unrelated receiver and cross
creditor. Early resume rejects; four fresh independent source samples over the
unchanged recovery hold permit owner resume to Custody/source stage 12.

PostgreSQL closes/reopens its writer at partial Apply, after market distribution
and after recovery/token exits. Each checkpoint reconciles all **148 accounts /
ten members** over actual finalized RPC. A fresh database refetches the chain and
reproduces the complete state and **131 financial event bytes** exactly, with zero
unresolved jobs. Final actual/allocated vault both equal **11,199,993 atoms** and
surplus is zero. This uses the real store, decoder and reconciler with a fixed
candidate artifact hash; it does not qualify a larger-population service daemon.
Both isolated legacy/RC2 clients agree on **1,383 clearing instruction encodings /
full metas, 75 accounts and 1,444 events**; maker A/B agree on 76/38 instructions
and 80/40 events respectively.

Successful financial instruction measurements on that ten-root run:

| Transaction | Samples | Actual CU | Wire bytes | Loaded accounts |
|---|---:|---:|---:|---:|
| Adopt verified plan | 1 | 44,903 | 718 | 17 |
| Apply one root | 10 | 82,205–84,277 | 882 | 21 |
| Complete market distribution | 1 | 56,025 | 718 | 17 |
| Reconcile one root | 10 | 50,507–51,547 | 825 | 20 |
| Complete vault/cohort reconciliation | 1 | 44,310 | 718 | 17 |

Those transactions use v0, 1,000,000 requested CU, zero priority price, a 5,000-
lamport fee and the default heap; peak heap/stack usage is not measured. Successful
construction peaks at **117,545 CU / 858 bytes / 20 accounts**. Its segment has
768 outcomes (ten rejects), **48,211,282 CU / 3,850,000 fee lamports**. The segment
from successful adoption through terminal reconciliation has 53 outcomes (30
rejects), **2,354,476 CU / 265,000 fee lamports**. Total test storage occupies 75
verification/plan accounts with **692,277,000 rent lamports**; the entire run,
including setup, repeated fault cases and source/maker updates, uses **74,448,638
CU / 7,700,000 fee lamports**. These are measured test costs, not an optimized
production schedule, larger-cohort bound or G1 affordability acceptance.

Clean `d6669ac` passes 13 scoped native controller/source tests (including complete
3-/64-root application) and 23 affected indexer tests. Generated SDK, typecheck,
literal retained/new ABI and 13 wire checks pass in development. Its first signed
run failed before payout because setup had already allocated a legacy page; the
fixture was corrected to reuse it. Clean `ca26fcf` then passed the nine-root
payout/recovery/token path and 118-event fresh replay; the final pin above adds
cross-creditor coverage. Raw captures remain local at
`.local/scalable-settlement/runs/p54c-application-cross-creditor/` and the owned
Surfpool/PostgreSQL processes stopped normally. Default/devnet remain disabled;
P55/P56 still own live paged membership, larger-cohort activation and its resource
acceptance. No external review, funded qualification or endurance is claimed.

Reproduce using the exact candidate artifacts above and a new ignored run directory
(the wrapper starts/stops its own Surfpool and PostgreSQL):

```sh
source ops/env.sh
RIVALT_SETTLEMENT_PLAN=1 RIVALT_SETTLEMENT_APPLY=1 RIVALT_PG_PORT=15454 \
  RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/scalable-settlement/p54c-efa4595 \
  RIVALT_RUN_DIR=.local/scalable-settlement/runs/p54c-application-repeat \
  bash ops/scalable-settlement-smoke.sh
```

The following earlier pins retain distinct native/construction evidence; their
historical scope statements do not describe the final application acceptance.


Clean **`51b4a4fd8f5b7cf63790ea5fdaf8df779493e0b9`** passes 10,920 exact per-root flow/retained-cash/
floor/fraction/order comparisons against the independent Fraction oracle and
rejects flow authorization for 137 fractional-insurance evaluations. Maximum
observed flow work is 2,453 word steps/root. A separate 774-case persisted graph
matrix reproduces independent canonical cash and market atom owners at checkpoint
budgets 1/7/128: 3,639 augmentations total, maximum 3,478 steps, 352,956 scalar
record reads and 116,778 writes across the fixtures. Undeclared reads/writes reject;
each transition accesses at most three records and performs at most four reads/
writes. At that pin graph construction is still the native P54A implementation, explicitly
not program-page authentication or financial application.

Two hierarchy tests compare 90,000 updates/queries against an ordered set across
nine lengths, including sparse u64 boundaries; per-operation bounds remain eleven
update and 21 successor word steps. Flow and graph codec tests cover immutable
bindings, invalid domains and substitution of a write cursor for a successor read.
Pinned SBF metadata compilation and evidence-policy checks pass. This does not
link or execute a Solana binary. Those native results do not qualify
on-chain graph construction, payouts, token exits, SQL replay, larger populations,
CU, heap/stack, latency or affordability. Raw development logs remain at
`.local/scalable-settlement/p54c-flow-development/`.

Clean **`ae33d3377de817db83c7b578b0b31f7b18378abf`** adds a bounded persisted graph constructor and
exact market-order cursor. All 774 independent payout cases also compare every
newly constructed node, arc and adjacency with the retained canonical topology,
starting from poisoned scratch. Each construction step performs at most three
record accesses. Exact order verification accepts 835 independent valid sequences
and rejects 1,197 reversed/tied/duplicate/incomplete sequences; maximum 1,981 word
steps/cohort in these fixtures. Permutation markers are still native test transport,
not authenticated program records. Two additional codec tests and SBF metadata
compilation pass. The separate signed construction checkpoint follows below.

Clean **`c08aa495804a1740e109c7ef24b21f982c1495ed`** adds six public entrypoints, a 1,181-byte
owned plan and scalar records inside the existing authenticated limb pages. Three
native controller tests pass: independently derived half-atom tie ownership across
1/7/128-step restarts, a 65-row physical-page case, duplicate/reversed-order and
stale/incomplete rate-history rejection, and revision/attempt/64-slot recovery
boundaries. Each work/row step uses the real PageWindow loader and serialized plan;
the test transport supplies account bytes, not signed transactions. Five physical
page-adapter, ten scoped-history and two scalar codec/layout tests pass at that
pin. Generated SDK, retained D90 plus literal new ABI and
83-entrypoint inventory agree; existing financial access sets are unchanged.
The same clean source links a **2,168,808-byte** SBF with SHA-256
`08eca403915e5c8a35b68b03d29ab92e2c13a585f754a4f3e6fa9f528a616ed5` and no unsafe
stack-frame diagnostics. It is separately retained at
`.local/scalable-settlement/p54c-c08aa49/`, not selected for ordinary runtime.
At that earlier pin financial application was pending; construction-only execution below
does not qualify a larger financial population or select a deployment.

The extended signed construction harness is prepared with explicit
`RIVALT_SETTLEMENT_PLAN=1` and that candidate artifact directory. Its native
`settlement-plan-pages` example transports next-page requests from public RPC
bytes; it is not an independent financial oracle. The Python Fraction/circulation
reference independently derives every floor, fractional flag, order and terminal
atom owner.

Clean verifier **`2205ada0cd198f3c106b425636f4bb204925ef22`** passes **968 signed
RPC/WS outcomes**, including **35 deliberate atomic rejections**, on that exact
SBF. The construction extension contributes **489 outcomes / eight rejections**,
including 416 bounded continuations and all six new entrypoints. Each of the eight
actual frozen rows matches independently derived flow floors, fractional flags,
local order and final cash/market atom ownership. Both complete market orders,
current-revision duplicate rejection, stale replay, real 64-slot foreign recovery,
construction-reset refusal and terminal replay are exercised. All original
financial account bytes remain identical through verification and construction.

Successful construction transactions use **33,049–114,841 CU**, at most **858
wire bytes** and **20 loaded accounts**, with v0 throughout. Their requested limit
is 1,000,000 CU, zero priority price and the default heap. The extension (including
allocation and rejected originals) consumes **30,773,527 CU / 2,455,000 fee
lamports** and adds **339,150,960 rent lamports** for 30 accounts. Total verification
storage rent is 685,754,280 lamports. These are eight-root observations, not G1
affordability, a dense larger-cohort bound or measured peak heap/stack.

Legacy and RC2 clients agree on **950 clearing instruction encodings/full metas,
74 verification accounts and 984 events**; both maker clients also agree. Captures
are local at `.local/scalable-settlement/runs/p54c-construction-2205ada/`; the owned
Surfpool is stopped. That construction-only pin did not qualify Apply, recovery,
token exits or PostgreSQL; the final application acceptance above supplies them.

Clean **`cadabc2`** adds complete original/applied bookkeeping and root-mutation
helpers. The same 774 independent graph cases now feed the actual persisted
ApplicationScan and check its returned payouts against the independent atom oracle;
original rows have zero position quantities in this arithmetic transport. Two
kernel tests separately cover partial/final conservation, replay, invalid rounding,
insurance overdraw and checkpoint binding. Two program-helper tests cover actual
nonzero cross/isolated positions, accrued funding, both monotone order/group IDs,
generation/nonce/delegate invalidation, dormant-book reconciliation and exhaustion
without input mutation. Pinned SBF metadata compilation passes. These development
checks have no signed Apply, source adoption, pool debit or SQL effect. Raw logs
remain beside the preceding construction evidence with the `cadabc2` pin.

## Authenticated frozen and rate verification (P54B)

Clean verifier **`22736dc5f870413029394106e5545ff64d6f0dc9`** runs on linked clean
SBF **`89b6129404ca7914bf5a8ba588079f798e6e4445`**, SHA-256
`0bb44610f6ed17d51582830999fbcd66d1047f47990b0560d073d2ca055a6547`.
The program is 1,947,576 bytes. Build output contains no unsafe stack-frame
diagnostics. The candidate is retained at `.local/scalable-settlement/p54b-89b6129/`
and is not selected for ordinary runtime.

**479 actual signed RPC/WS outcomes** pass, including **27 intentional atomic
transaction rejections**. Finalized originals are independently fetched and decoded;
signature WS outcomes agree. Actual signed deposits, fills, withdrawal, insurance
contributions and an adverse synthetic price move establish the eight-root frozen
cohort. No fixture injects a successful financial effect. The successor verifies
this existing-size frozen source; P55/P56 own live lifecycle and expanded admission.

All **16 new public entrypoints** execute. Complete membership includes ancestor
count closure; row cash, whole-account accrued/fractional claims, quantities,
identity/revision and collected cash match independent arithmetic. Five bounded
denominator calls produce **30,006,000,555,553**, matching independent rational
reduction. **156 rate continuations** cover an invalid proposal and both valid
insurance evaluations; **16 completed valid row prefixes** exactly match the
independent Fraction/branch oracle. Exact market residual/creditor-loss numerators,
insurance floor and fractional flags agree at each completed evaluation.

Original market insurance is **[2,000,150, 1,000,075]** test atoms. The first
verified evaluation requires fractional consumption whose floors are
**[600,771, 300,430]**. Each market clips its planned budget once; the second complete
evaluation consumes those integral amounts. This changes only verification work:
all venue/custody/safety/registry/market/ledger/margin/vault and original resolution
bytes remain identical through valuation, rejection, reset and successful verification.
No insurance is spent and no cash is paid by this phase.

The signed negative matrix covers stale frozen revision/epoch, wrong index level,
omitted/duplicated root, stale revision and attempt, missing/foreign/reordered/
duplicated limb pages, same-transaction continuation rollback, zero factor,
oversized width/chunk, skipped/duplicated/non-normalized upload, incomplete work,
completed replay and attempted reset of a verified plan. A correctly encoded but
wrong rate records Rejected and leaves the original insurance checkpoint unchanged.
A different signer recovers both an incomplete upload and a completely uploaded,
stalled verification after actual 64-slot inactivity; early reset rejects. Reordered
and duplicated-page checks have mandatory execution assertions, rather than being
silently skipped when the first arithmetic step needs only one page.

| Transaction (complete actual context) | Actual CU | Maximum wire bytes |
|---|---:|---:|
| Initialize prepared source | 22,975 | 686 |
| Initialize count node | 22,792–24,497 | 720 |
| Initialize complete member page | 26,237 | 719 |
| Initialize frozen row page | 23,238 | 719 |
| Initialize denominator/rate limb page | 22,752–23,805 | 723 |
| Traverse membership / close ancestor | 23,856–28,110 | 685 |
| Value actual margin root | 35,693–36,713 | 751 |
| Accept frozen denominator row | 24,199–34,402 | 685 |
| Continue denominator | 27,265–31,333 | 744 |
| Initialize rate verification | 23,254 | 711 |
| Start untrusted rate attempt | 28,195–28,204 | 742 |
| Upload numerator words | 23,146–23,154 | 756 |
| Retag scratch for current attempt | 22,316 | 718 |
| Accept frozen rate row | 35,003–45,618 | 726 |
| Continue rate arithmetic | 55,654–100,058 | 818 |
| Reset rejected/stalled proposal | 21,437–21,450 | 790 |

All successful new transactions fit v0's 1,232-byte packet envelope; the oversized
rejected upload is 1,005 bytes. Existing setup includes its separately supported v1
publisher/repricing calls. The harness requests 1,000,000 CU, 8 MiB loaded-account
data and zero priority fee for P54 calls; it requests no heap-frame increase.
The observed new contexts load at most 19 accounts. Success under the runtime's
default heap and absence of 4,096-byte stack overflow diagnostics establish this
fixture's bounded execution; exact peak heap/stack high-water marks are **not**
instrumented. Native vector orchestration remains excluded from SBF.

Forty-four verification accounts lock **346,603,320 test lamports** of rent,
including all 25 one-page registers; this excludes ordinary venue provisioning.
The verification segment, including provisioning/negative/recovery checks, has
**363 transactions**, **14,813,084 observed CU** and **1,835,000 actual fee lamports**.
Do not extrapolate these fixture totals to a dense 128-/1,024-account default or
claim G1 affordability. P54C/P56 must measure full settlement and activation costs.

The isolated legacy and RC2 Anchor conformance clients agree on **461 clearing
instruction encodings/full metas**, **44 new account records** and **503 clearing
events**, including setup; maker conformance also passes. The original D90 ABI is
unchanged after checking the literal new extension. Generated SDK/typecheck,
five source/layout tests, nine scoped-history tests and two page-plan tests pass
on the affected source. The first signed candidate (`60f7ec8`) rejected rate-account
creation because a duplicate scope allowlist stopped at kind 21; the corrected
source uses the single schema mapping and explicitly tests kind 22. That failure
and the earlier 471-outcome pass remain retained, not counted as the final matrix.

| Earlier clean native pin (unchanged primitives retained) | Independent acceptance |
|---|---|
| `a7adbaf` | 774 exact comparisons; 1,338 arithmetic, 462 LCM, 305 collection vectors; four cursor codecs and page-plan checks |
| `1bd8e2e` | 120 denominator passes; 256 valuations / 3,637 persisted prefixes; 304 aggregate vectors; 22 rejected cohort/domain inputs; six codecs and four canonical page-loader tests |
| `6f051bc` | Complete radix traversal through 11 dense/sparse populations / 22,448 entries; two core and three canonical-reader tests, including foreign identities and count/order failures |
| `999ce4d` | 1,440 normalized integer operations up to 32,768 bits with dirty tails; ten invalid domains and two codec/alias checks |
| `0ff7c53` | 642 exact atom divisions including three corrected estimates; four invalid domains and checkpoint corruption; normalized regressions retained |
| `f1cd4a7` | 1,185 complete persisted rate evaluations / every incoming prefix, 74 hostile or non-greatest requests, three checkpoint/order/insurance-clipping tests |

Those primitives restore owned checkpoints at 1/7/128-step boundaries and deny
undeclared word access; pinned SBF metadata compilation passes. Native population
or bit-width tests do not constitute signed larger-cohort acceptance.

Reproduce the signed matrix from the verifier pin with:

```sh
RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/scalable-settlement/p54b-89b6129 \
  bash ops/scalable-settlement-smoke.sh
```

The launcher checks this exact source/hash independently of admitted maker/oracle
artifacts, runs an owned offline Surfpool and stops it on completion. Raw originals,
logs and references stay at
`.local/scalable-settlement/runs/p54b-rates-final-89b6129/`; native pins keep their
existing `.local/scalable-settlement/p54b-*/` paths. No raw evidence is tracked.

P54B qualifies verification only. It does **not** qualify Apply/payouts, expanded
accounts, complete default recovery, PostgreSQL replay, browser, endurance, devnet,
independent review or production. P54C owns conserving rounding/application and
actual exits/replay. P15B/P16B remain Open; 24-hour endurance stays Deferred.

P54B publication CI at `4cd75ab` failed three checks: stale generated lock inventory,
a direct ABI-test call that bypassed extension validation, and four positive
preparation tests incorrectly run in the disabled-default configuration. The
arithmetic suite passed. The correction routes both ABI entrypoints through the
literal extension check, explicitly tests six extension corruptions and retains
negative authority checks on predecessor instructions. The regenerated inventory
adds exactly 16 instructions without changing any of the 61 retained access sets.
Qualification-only positive tests now run with their feature; a separate default
case proves preparation rejects before writing any output. No runtime source,
IDL, financial gate or accepted SBF artifact changes. Clean correction **`9a223a3`** passes 13 ABI cases, five qualified settlement
cases, two default cases, exact inventory, D90 extension and evidence-policy
checks. All five hosted jobs pass at **`d2f7810`** in
[run 43058428703](https://github.com/arnabnandikgp/rivalt/actions/runs/43058428703).
No additional SBF rebuild or signed financial rerun was needed for this test-only correction.

## Scalable native settlement (P54A)

Clean **`47ba74e36c03379560e7ed2eba6392b212c91deb`** builds the native
`scalable-wide-driver` and passes four focused tests against independent Python
integers/Fractions: **1,338** resumable arithmetic cases, **462** exact LCM
extensions and **305** reduced collection rows, plus rejected domains. Resume
budgets 1/7/128 agree; cases cross the inherited 96-limb size and reach 13,757
words. Dirty scratch tails are cleared before widening. Each step touches at most
three words; LCM work follows used input width rather than allocated capacity.
The affected source format, Python compilation, shell and evidence checks pass.
The optional whole-workspace format check detects pre-existing formatting outside
this change; no unrelated files were reformatted.

Clean **`60c2141eb2a7af30bc8a6d99dd752167549c3263`** passes complete native acceptance:

- **258 independent cohorts × three continuation budgets = 774 compiled settlements**
  match the retained branch/Fraction oracle for rates, collections, cash, insurance
  budgets/usage, debtor writeoffs, creditor impairments and every atom owner and
  rounding adjustment. Budgets are 1/7/128 steps. Cases include cashless cycles,
  external creditors, two insurance-clipping passes, maximum claims/cash, unused
  insurance and separate retained fees.
- **307** malformed, incomplete, non-greatest, out-of-domain, missing/duplicate/
  foreign/order-corrupted requests reject. Every unfinished graph prefix refuses
  results and completed graph/cursor replay rejects. This is native continuation,
  not authenticated account replay or process-crash durability.
- **980** normalized atom-division comparisons match independent Python `divmod`,
  plus three literal 151-bit aggregate / 302-bit product cases. All prior **1,338**
  word arithmetic, **462** LCM and **305** collection cases pass again at this pin.
- The active hierarchy matches an independent ordered set across **80,000** paired
  updates/searches, emptying and boundary failures, with tested per-query/per-update
  word limits. Affected literal model regression, scoped format, Python compilation,
  shell syntax, evidence policy and **91** local documentation targets pass.
- All **16** release-build scale diagnostics complete: four shapes at 64, 128,
  1,024 and 10,000 rows. Exact cash/movements and augmentation counts match the
  streaming model, with independent repeated-fraction `1/3` recovery/cash identities.
  These use synthetic already-valued claims; registered, claim-participating,
  empty and funded counts are distinct. No exposed-position admission is claimed.

Representative distinct-denominator cases, on Apple M3 / Rust 1.97.1 release:

| Rows / claim-participating / funded | Used words peak | Arithmetic word steps | Compiled process seconds | Native graph payload bytes |
|---|---:|---:|---:|---:|
| 64 / 63 / 21 | 33 | 133,433 | 0.006383 | 24,832 |
| 128 / 126 / 42 | 60 | 495,525 | 0.005770 | 49,104 |
| 1,024 / 1,023 / 341 | 433 | 29,384,846 | 0.093212 | 389,336 |
| 10,000 / 9,999 / 3,333 | 4,009 | 2,665,849,459 | 7.917139 | 3,797,360 |

The 10,000-row common denominator is 256,232 bits. Its untrusted proposal and
separate Python rounding comparison take 4.481841 / 20.482780 seconds. The all-
participating 10,000-row mixed-link case takes 4.955804 compiled seconds and uses
3,818,720 graph payload bytes. Process timings include startup, transport parsing
and result decoding; the first 64-row cycle launch takes 0.397770 seconds. These
are individual diagnostics, not latency percentiles. Payload excludes scalar rows,
registers, allocator/transport overhead and native test copies; it is not peak RSS
or account rent. Logical steps exclude host allocation/copying. The conservative
O(N+W) storage and finite work bounds in the risk contract are checked in each case.
The large word count explicitly leaves SBF affordability unproved.

A follow-up compiler-boundary check found that pinned platform-tools v1.52 reports
`target_arch="sbf"`, not `bpf`. The native-module guard now checks the actual
`target_os="solana"`; Cargo explicitly recognizes that patched target OS for host
cfg linting. Host `cargo check` and a pinned SBF `rustc --emit=metadata` pass.
A positive metadata probe imports the word cursor; a negative probe fails with
E0432 for all four native modules. Raw probes stay at
`.local/scalable-settlement/p54a-target-guard/`. These are target metadata checks,
not a complete SBF program build, stack/CU measurement or deployment. Clean guard
revision **`7aef54f1d6908f9cef0e9186a386ddb79341793b`** passes both probes, scoped
formatting and all four complete-settlement Python checks again (774 settlements,
307 refusals, 980 divisions and three aggregate/product vectors). No native financial
semantics change; the scale observations remain pinned to `60c2141`.

Reproduce the scoped checks with `cargo build --locked -p financial-core --bin scalable-wide-driver --bin scalable-settlement-driver`,
`python3 tests/financial/test_scalable_wide.py`,
`python3 tests/financial/test_scalable_settlement.py` and
`cargo test --locked -p financial-core --lib clearing::scalable::active::tests`.
The independent settlement suite joins financial CI. The separate scale diagnostic
uses `cargo build --release --locked -p financial-core --bin scalable-settlement-driver`
and `RIVALT_SCALABLE_DRIVER=target/release/scalable-settlement-driver python3 tests/financial/measure_compiled_settlement.py`.
Exact clean logs/results remain in `.local/scalable-settlement/p54a-60c2141/`;
earlier development captures remain separate and retained. No evidence is tracked.

This is native arithmetic/graph acceptance only. Vector orchestration is excluded
from SBF; frozen account authentication, physical pages/cursors, transactional
rollback, continuation CU/rent and token effects belong to P54B/P54C. No new selected
program, runtime transaction, enabled account capacity or financial activation is
qualified. No RPC/WS/PostgreSQL, browser, endurance or external run is inferred.

## Numeric-bound price policy (P53B)

G5 approval on 11 November selects policy 2: reference/trigger 2–909,090 and
stored limits 1–1,000,000 collateral atoms/lot. Raw asset inputs must be positive
and checked; the complete risk interval is validated without clipping. Source
freshness/confidence/agreement/depeg/recovery, fees, margin, numeric arithmetic
and default/devnet gates remain unchanged. This qualifies the local prototype.

Clean SBF **`afeb7eae419bc66cf1c902932fea79a994fa4dc1`** builds with no unsafe
stack diagnostic. Qualification clearing is **1,538,848 bytes** (+64 vs P53A),
SHA-256 `fbd5524190f301a4e82146839fef1a7a3917f9a86e1a871be2e3c9dc509cd1dd`.
Every other binary, including default clearing, is byte-identical to P53A/P49.
Generated SDK/policy parity and D90's exact ABI comparison pass; no IDL, account,
PDA, discriminator, error-number or signed-report change is introduced.

- Clean publisher verifier **`10cadb701a5a41718ad73449559ca25196449065`**:
  **137 signed RPC/WS outcomes / 21 reports**, 11 intentional rejections. Old
  fixture cliffs, both new reference edges, Q=3,000,000, extreme confidence,
  immediate-outside disagreement, stale/depegged sources, complete coverage,
  zero-cash published depth and authority/replay rollback pass. Legacy/RC2
  conformance decoding passes. Maximum publisher CU **21,035**, 838 bytes,
  13 keys; the three-million-lot report uses **21,007 CU**. Budget stays 200k.
- Clean boundary/journal verifier **`82d2c6a1223e8f88529216362102a8e2f93a37a1`**:
  **228 signed outcomes**, eight BTC/ETH open/reduce-only-close pairs at
  2/9,999/100,001/909,090 plus two restart-recovered fills. Stored limit/trigger
  edges accept, immediately outside terms roll back; actual stale-source deposit,
  cancellation with full numeric survivor reservation and flat funded exit pass.
  The actual journal has 225 transactions, eight intentional failures, **176
  events/outbox records**, zero unresolved jobs. Reconciled publication and fresh
  PostgreSQL reproduce the complete state and all **176 original event bytes**.
  Seventy entities/eight roots reconcile 8,000,000 actual/allocated collateral.
  Independent fees total **848**: BTC 436 (109 insurance/327 fees), ETH 412
  (103/309), both carries zero. Failed withdrawal CPI has no financial effect.
- Clean safety verifier **`82d2c6a`**: **290 signed outcomes**, 23 intentional
  failures. Existing-position TP/SL, reservations, transfer/withdrawal, held
  whole-account funding, post-fee liquidation, complete-cohort resolution,
  stale-source terminal exits and recovery/reactivation pass. The independent
  raw-byte audit verifies eight exact Fraction payouts, two rounding augmentations
  and ten rejected corruptions. This uses the current eight-root cohort; it does
  not qualify expanded population or the future scalable solver.
- Observed boundary-route peak **160,356 CU / 1,014 bytes / 19 keys**; paired-market
  publisher peak **44,026 CU / 1,192 bytes / 17 keys**. Safety route peak 279,710 CU;
  safety instruction peak 187,509 CU. These are scoped workloads, not full-book
  maxima, fresh contention measurements or a new throughput claim.
- Source checks pass: 23 financial-core and 29 clearing-engine native tests;
  52 affected SDK/UI cases, including **1,536 independent per-lot exhaustive
  allocations**; typecheck, generation, exact ABI and evidence checks. Canonical
  funding uses interval and convex pair search, preserving deterministic ties,
  two legs and complete coverage without financial admission. At clean `afeb7ea`,
  1,800 timed searches over 18 bounded scenarios (three makers/eight regions,
  including Q=3m) peak at **329 distinct quotes**, p95 **0.394 ms**, p99 **0.535 ms**
  on Apple M3. This measures off-chain CPU, not landed CU or worst-case latency.

The first boundary run at `10cadb7` passed trades/order edges but requested a
21-second expiry wait from a 20-second watchdog. It is not a completed replay.
The corrected verifier splits the wait and leaves source age, waiter deadlines
and publication freshness unchanged. Both attempts and all raw receipts remain
at existing ignored `.local/price-policy/p53b-*` paths. Accepted candidate files
are `.local/price-policy/afeb7ea-artifacts`; the selected runtime uses their exact
hashes. Previous selected files are retained at `.local/price-policy/pre-p53b-current`.
All owned runtimes stopped; no browser, endurance, external or funded run is claimed.
P15B/P16B remain Open, 24-hour endurance Deferred and P58's other economic gates open.

Reproduce with the candidate build command, `ops/funding-publisher-smoke.sh`,
`RIVALT_PRICE_POLICY=1 RIVALT_LIQUIDITY_PROBE=indexer RIVALT_LIQUIDITY_POSTGRES=1 RIVALT_PG_PORT=15454 bash ops/current-runtime-smoke.sh`,
and `RIVALT_LIQUIDITY_PROBE=safety bash ops/current-runtime-smoke.sh`, using explicit
fresh run/artifact directories. `node --import tsx tests/performance/funding-search.ts`
prints the bounded CPU diagnostic. Historical `phaseAcceptance:false` fields
remain explicit: these scoped P53B constituents do not reopen entire older phases.

## Shared unchanged price policy (P53A)

Clean SBF source **`213610666d7b1ab3136b5b3f0da25c856ad92d1f`** builds with the pinned
RC2/platform-tools profile and no unsafe stack-frame diagnostic. Qualification
clearing is 1,538,784 bytes (+896 versus P49), SHA-256
`a42f1b0affb774c4c8725656b4ce37cb20d6905494ccef31ad94c86d97afc375`.
Both maker binaries, default clearing/makers and fixtures are byte-identical to P49.
Generated IDL/SDK and the pinned wire check have no ABI delta. Numeric policy
version 1 names existing behavior; accepted prices and financial rules do not change.

- Clean publisher verifier **`55426dc676dc55ae790f9b2b7d3c1ccd5b524728`**: 99 actual
  signed Surfpool RPC/WS outcomes, 12 reports. Existing source/reference edges,
  100/600-lot exact depth optima, source values 9,999/100,001, forged available
  reports, collateral depeg, failed verification, expired coverage and publisher
  authority/replay reject or degrade as specified. The isolated legacy/RC2 decode
  checks pass. Single-market publisher transactions peak at 20,939 CU, 838 bytes
  and 13 loaded keys; requested budget remains 200,000 CU.
- Clean journal verifier **`e98b0ebf9a9649fec5fc1c5f02be1b8c197bf3af`**: 120 signed
  outcomes, two actual fills, restart catch-up and reverted-CPI rollback. Fresh
  PostgreSQL reaches reconciled publication after two pending cycles and matches
  the complete financial state plus all **72 event-byte records**. The initialization
  journal contains 117 transactions (four intentional failures), 72 outbox records
  and zero unresolved jobs. Seventy entities/eight roots reconcile exactly
  8,000,000 allocated/actual vault atoms. Independent expected fees are 26 atoms:
  six insurance, 20 retained and carry two; cash plus fees equals vault.
- Scoped actual route peak: 160,001 CU, 1,006 bytes, 19 keys. The paired-market
  publisher transaction peaks at 43,814 CU / 1,192 bytes / 17 keys. These are this
  workload's measurements, not full-book maxima or a new throughput qualification.
- Source checks: typecheck; 59 affected SDK/UI cases; 22 financial-core and 29
  clearing-engine native tests; generated-policy/SDK parity, pinned ABI, shell,
  whitespace, local documentation targets and evidence policy. Literal cases cover
  both market units, source edges/depeg, full numeric fallback reservations and
  post-fee liquidation. Broad regression is delegated to applicable CI.

The first journal slice at `55426dc` matched projection only. Tightening the older
harness to require fresh published readiness exposed a host-sleep timeout at
`73855fc`: macOS logged 170 seconds of idle sleep. The final supervisor holds the
existing temporary idle-sleep assertion for all finite probes; its original
60-second check and ten-second publication freshness are unchanged. Failed and
partial attempts remain local and are not substituted for the final acceptance.

Evidence: `.local/price-policy/{2136106-artifacts,p53a-publisher,p53a-indexer-awake}`.
At P53A qualification these files were selected in `.local/anchor-rc2/current`;
P53B now supersedes that selection. Pre-P53A contents remain retained in
`.local/price-policy/pre-p53a-current`. Use a fresh local domain/
database; do not run old journals/originals against a replacement artifact binding.
No new browser, full-book/load/endurance or external deployment is claimed.
P53B has separate approval and signed acceptance above;
this P53A evidence qualifies only policy 1. P15B/P16B remain external.

Reproduction uses `ops/build-liquidity-execution.sh` with an explicit candidate
destination, `ops/funding-publisher-smoke.sh`, and
`RIVALT_LIQUIDITY_PROBE=indexer RIVALT_LIQUIDITY_POSTGRES=1 RIVALT_PG_PORT=15453 bash ops/current-runtime-smoke.sh`
with explicit fresh run/artifact directories. The publisher and replay summaries
retain `phaseAcceptance:false` for their historical parent phases: they are scoped
constituents, not a rerun of all P32/P33 qualification.

## Bounded-progress indexer (P52)

Clean **`fe1c754e985b56e653b03795af8daf2b8ca59e62`** passes full signed
Surfpool/RPC/WS/PostgreSQL qualification. Runtime code is identical to clean
`32988bb`, which passes typecheck and 44 focused indexer/API/service tests. No
program, IDL, financial rule or account-schema change; freshly deployed programs
are the existing P49-qualified artifacts, with Surfpool 1.7.0 / PostgreSQL 18.6.
SQL transport format 3 requires a fresh journal, preserving earlier databases and
signed originals with their existing executor.

- Backlog reconciliation contains **10,642 transactions / 4,306 clearing
  invocations**, including 10,100 independently signed/finalized unrelated SOL
  transfers and 4,200 successful delegate changes. Recovery makes durable progress
  through the per-cycle 500-unit budget instead of failing a total-backlog limit.
- Actual subprocess SIGKILL before writes, during SQL before COMMIT and after
  COMMIT leaves the expected covered checkpoints (1731, 1731, 1732), with no false
  publication. WS reconnect recovers through complete RPC history. A pending wallet
  original finalizes with identical bytes/signature while publication is stale.
- Conflicting retained blocks/invocations, forged or regressing publication,
  expired witnesses, append-only mutation and format-2 startup reject. A deliberately
  reverted two-instruction delegate transaction leaves no economic event. Focused
  tests also cover missing blocks/manifests, scoped revision gaps, multi-instruction
  atomicity, oversized/empty-block work, API cursor/freshness fences and RPC byte caps.
- Two actual fills independently require 26 fee atoms: six insurance, 20 retained
  fees and carry two. Root cash plus fees remains 8,000,000 collateral atoms.
- During 74 continuous delegate updates, three distinct nonces (4205, 4229, 4253)
  are published at verified finalized checkpoints. Complete state and **4,353 ordered
  event-byte records** match fresh PostgreSQL replay; 70 entities/eight margin roots
  and 8,000,000 actual/allocated vault atoms reconcile with no surplus.

The [fixed-witness proof](../application/durability.md#attainable-reconciliation-while-the-head-advances)
handles the demonstrated Surfpool account/context skew by waiting for one captured
observation ceiling to finalize; it never serves nonfinalized history or replaces
the captured account bytes while catching up. It retains full financial-field
comparisons and the original ten-second freshness deadline. The smaller diagnostic
at `32988bb` was useful for isolating this issue but is not substituted for the full
run above. Its `phaseAcceptance:false` remains explicit.

| Full run observation | Measured value / scope |
|---|---|
| End-to-end qualification | 306.954 seconds, including provisioning, faults and replay |
| Main recovery | 2,799 committed blocks after the crash checkpoints; 23 pending cycles, zero recorded cycle failures |
| Fresh replay | 5,676 complete blocks / 10,679 transactions; 29 pending cycles before publication |
| Largest observed block | 200 transactions; one complete block per SQL commit |
| Largest observed SQL commit | 140.567 ms in the main recovery process; not a percentile or global worst case |
| RPC | Main recovery 6,052 requests / 40,144,224 response bytes; replay 11,867 / 40,690,414 |
| Largest observed RPC response | 2,576,464 bytes, including artifact checks; configured per-response budget 64 MiB |
| Database size | 106,947,087 bytes at the backlog checkpoint, before live tail/replay database |
| Sampled process RSS peak | 665,387,008 bytes for the combined test harness/indexer, not standalone indexer memory |

This is one Apple M3 local observation at 50 ms simulated slots, not validator TPS,
production capacity, 10,000 live margin accounts or continuous endurance. Changing
accounts across multiple RPC batches may still lack a common witness; oversized
responses and slow finality retain coverage and close readiness. Larger-cohort and
production limits require their own acceptance. The demo caller now waits for
published readiness across bounded cycles. Typecheck and 11 existing demo transport
checks pass after this entrypoint-only adjustment; they do not execute browser
startup, and no fresh browser qualification is claimed.

Reproduce only the affected checks:

```sh
source ops/env.sh
pnpm typecheck
pnpm exec vitest run packages/indexer/src/finalized-indexer.test.ts packages/indexer/src/account-reconcile.test.ts packages/indexer/src/account-api.test.ts packages/indexer/src/scoped-history.test.ts packages/indexer/src/rpc.test.ts packages/services/src/account-runtime.test.ts
RIVALT_LIQUIDITY_PROBE=indexer-progress RIVALT_LIQUIDITY_POSTGRES=1 RIVALT_PG_PORT=15452 bash ops/current-runtime-smoke.sh
```

Raw accepted evidence remains `.local/indexer-progress/fe1c754-20261111-full`;
small live diagnosis remains `32988bb-20261111-live` in that same parent directory.
`RIVALT_INDEXER_DIAGNOSTIC=live` deliberately selects smaller traffic and cannot
satisfy full phase acceptance. Owned runtimes stop and local data/evidence remain.
P15B/P16B remain external, and 24-hour endurance remains Deferred.

## Account-scale native feasibility (P51B)

Clean candidate **`a5ac218d6e439be74fc136bed67c2d5b9e733a41`**, based on planning
tip `0e864d9`. This is a contract/model deliverable. No program, IDL, current schema,
activation limit, artifact or runtime configuration changes. The actual retained
financial-core row and atom drivers were rebuilt with the pinned toolchain.

- Six focused Python tests pass. Across 254 complete <=64-row cohorts, the new
  exact solver and compact schedule match the independently implemented Fraction/
  branch oracle; **508 actual Rust rate/mutated-proposal cases** and **508 actual
  Rust atom/continuation cases** also match. Dense and compact schedules preserve
  the same atom owners/augmentation counts, including reverse-path repairs.
- Literal cashless cycles, external creditors, own-cash proportional debts,
  fractional claims, no/partial insurance, sequential insurance clipping and
  numeric-edge rows are included. Repeated-fraction goldens at 128/1,024/10,000
  roots independently require rates 1/3, preserve fees and conserve every market.
- The backing model passes **1,536 independent explicit-corner comparisons**
  during a 256-row scan with mutations between every step. New shortfalls remain
  visible; repair restores eligibility, invalid sources and out-of-region points
  refuse readiness. This is a maintained-summary proof model, not authorization,
  source-validation or signed transaction/rollback evidence.
- Shell syntax, Python compilation, relative documentation links/anchors,
  whitespace and tracked-evidence policy pass. The two focused suites are added
  to financial CI; no hosted result is inferred from local success.

The reproducible sweep runs four shapes at 64/128/1,024/10,000 registered rows:
cycle plus external creditor, repeated proportional fractions, distinct large
denominators, and mixed large denominators plus cross links. Counts of populated
rows are explicit; remaining rows are zero-state identities. These inputs are
already-valued synthetic claims, **not proof of live position admission**. All
16 compact runs finish; the dense baseline finishes 13 and explicitly declines
three at the configured diagnostic budgets. No partial output is treated as payout.

| 10,000-row native shape | Financial rows | Reduced L bits | Dense flow storage lower bound | Dense / compact visited arcs | Compact solve + round time |
|---|---:|---:|---:|---:|---:|
| Cycle with external creditor | 9,999 | 1 | 160,000 bytes | 30,001 / 13,336 | 0.456 s |
| Repeated fraction | 9,999 | 2 | 160,000 bytes | stopped at 2,000,001 / 16,665 | 0.245 s |
| Distinct fraction | 9,999 | 256,232 | 640,640,000 bytes | dense storage budget / 16,665 | 24.288 s |
| Mixed wide fractions/links | 10,000 | 155,324 | 388,320,000 bytes | dense storage budget / 10,000 | 24.994 s |

Single observed Python runs on Apple M3; these are neither percentiles nor CU.
The 64 MiB dense-flow budget is checked against a lower bound on serialized
numerators, not measured Python peak memory. The 2m-arc cutoff is diagnostic, not
a proposed financial limit. Compact storage uses shared wide work/recomputation;
its timing includes exact ordering/conservation checks. Counted limb visits and
remainder comparisons are abstract operations, not a complete CPU/CU cost model.
The distinct 10,000-row product L was 284,554 bits: exact reduction helps but does
not cure adversarial denominator growth. Streaming response segments also avoids
retaining a wide intercept for every link threshold in the mixed case.

Reproduce only the affected checks:

```sh
source ops/env.sh
cargo build --locked -p financial-core --bin clearing-row-driver --bin clearing-atoms-driver
python3 tests/financial/test_scalable_clearing.py
python3 tests/financial/test_incremental_backing.py
python3 tests/financial/measure_scalable_clearing.py
python3 tests/financial/measure_scalable_clearing.py --compact
```

Raw diagnostics remain `.local/scalable-clearing/p51b-a5ac218-{dense,compact}.jsonl`.
No SBF, Surfpool/RPC/WS, PostgreSQL, new CU/fee/rent or deployed-account result is
claimed. P54/P55 must prove bounded paged arithmetic/graph execution, complete
membership/mutation coverage, worst-case storage provisioning and current-source
backing progress, then measure the stated G1 recovery/resource budgets. P56B still
requires actual larger-cohort integration before enabling local financial paths.
The model does not qualify 10,000 live accounts or close P15B/P16B/endurance gates.

## Expanded quantities (P49)

Clean SBF source **`49c343e6e77a327fc9fa00c5b2a2e172dceb380d`**, clean integrated
verifier **`125a2b3eafaa4413a31ba82a4dfcf183258f9f79`**. Default/qualification
clearing and both makers build without unsafe stack diagnostics. Fresh actual
Anchor IDLs for all three programs are identical to the existing generated
contract; generated SDK and D90 wire-contract checks pass. The fixed allowlist
uses `p49-expanded-quantities-candidate-v1`; old bindings remain historical.
Normal local files are promoted to `.local/anchor-rc2/current`, after preserving
all previous files at `.local/quantity/pre-p49-current` and immutable C0.

Affected native checks: 15 financial-core order/liquidation/safety cases, ten
maker-interface cases and six clearing route cases, all passing. These include
independent literal large-order reservation, 100m-depth prefix arithmetic and a
500k-lot liquidation preserving one scaled fractional unit with strict progress
after fees. Sixty-two affected SDK/UI/service checks pass. Independent Python
comparison passes 715 router cases, 3,172 Rust quote vectors (1,547 exact quotes /
1,625 expected rejects) and 27 curve-contract cases. Typecheck, SDK generation and
ABI checks pass; 23 artifact-verifier/launcher checks also pass after updating pins.
The initial native linking failure was absent Apple compiler
tools; the user restored them before successful native/SBF acceptance.

Actual signed acceptance:

| Fresh run (under `.local/quantity/`) | Result |
|---|---|
| `p49-125a2b3-rpc` | 231 signed RPC/WS outcomes; 100m open/close, million-lot SDK route, two-program stored partials, large TP/SL, numeric/replay/over-close rejections with rollback, reserved transfer/withdrawal, whole-account funding, 500k liquidation, complete default and terminal funded exit |
| Independent raw audits | Nine fills checked against literal flat prices and whole-account funding; eight exact Fraction default payouts; eight route and ten default/accounting corruptions rejected |
| Same run's real PostgreSQL | 188 authenticated finalized events; on-chain cash agrees; fresh database/refetched RPC replay produces identical complete projection |
| `p49-125a2b3-resource` | 146 outcomes retaining the P47 full-book 4,608-lot workload, both program routes, skew crossing and depth-epoch rollback |
| `p49-49c343e/default-gates-svm.json` | All three newly compiled default binaries reject valid initialization with rollback |

Reproduce the larger flow with pinned artifacts and an unused run directory:

```sh
RIVALT_LIQUIDITY_PROBE=quantities RIVALT_LIQUIDITY_POSTGRES=1 \
RIVALT_PG_PORT=18943 RIVALT_RUN_DIR=.local/quantity/new-run \
bash ops/current-runtime-smoke.sh
```

[Performance](performance.md#expanded-quantity-measurements-p49) records exact CU,
wire and account counts. The numeric envelope is finite, not guaranteed liquidity;
source, margin, inventory, gross exposure, signed fee limits and search-work
exhaustion can reject smaller trades. Worker halving is a bounded operational
policy, not an exhaustive subfill feasibility proof. No new endurance, production,
external maker, paid oracle or public deployment acceptance is inferred. Owned
Surfpool and the test PostgreSQL container were stopped; raw evidence stays local.

The 10 November review correction `d63e3b1` stops order-size probing for a missing required
market source, while preserving smaller probes for allocation-dependent expiry,
depth/health and search-budget refusals. Seventeen focused worker/route tests and
typecheck pass: eight order-loop cases, five existing liquidity-worker cases,
one quantity schedule and three route-builder cases including different expiry
at different sizes. Queue/quote doubles establish control flow only; no new
Surfpool/PostgreSQL, SBF or financial acceptance is claimed for this early-stop
change. Existing exact integration pins above remain unchanged.
Scope/client/financial/shell hosted jobs pass on `d63e3b1` in
[run 42850851592](https://github.com/arnabnandikgp/rivalt/actions/runs/42850851592);
report is correctly skipped. P48/P49/P50 integrate at `28db412` with the complete
tree equal to accepted `953cd1f`. Merge equality is not a new runtime measurement.

## Exact quantity search (P48)

Clean verifier `5e5aede846c27bb1c352aa06c14a25ccfc6fe06c` replaces exhaustive
allocation with the interval proof in [routing](../liquidity/routing.md), retaining
4,096/4,608 program limits and the qualified C0 binaries. Independent Python
per-lot/exhaustive full-financial comparison passes 715 cases: 264 allocations,
379 unavailable and 72 invalid requests. Three hundred added cases cover complete
maker books, flat/generation boundaries and nonprefix health. Twenty-three focused
SDK/service tests pass, including interior VWAP bands, a net-proceeds fee-step tie
and exhausted search withholding an otherwise feasible singleton and instructions.
Typecheck passes. The initial test/benchmark failures asserted retired exhaustive
operation counts; their financial expectations passed and the resource assertions
now check bounded search work.

The unchanged four full-book benchmark workloads, 24 warmups / 1,000 iterations,
measure p95 0.302 ms / p99 0.355 ms on Apple M3 / Node 24.22.0. Maximum distinct
quantity quotes is 151, compositions and trader admissions one. This does not
establish a worst-case or larger-domain latency claim. The algorithm explicitly
refuses uncertified results on work-budget exhaustion.

`RIVALT_RUN_DIR=.local/quantity/p48-5e5aede-rpc bash ops/liquidity-execution-smoke.sh`
passes 130 real signed, independently fetched RPC/WS outcomes: current-price and
two-program routes, source/funding dependencies, stored partial fills and rejected
pause/replay cases with rollback. Raw evidence and the clean benchmark are local
under `.local/quantity/p48-5e5aede*`; the owned Surfpool was stopped. There is no new
program build, PostgreSQL run or larger-size acceptance in P48. P49 separately owns
expanded numeric bounds, new artifacts and integrated larger-size qualification.

A pass applies to its exact code, binaries, environment and population. The
consolidation stack integrates P35–P38 at `caa47d2`, with complete tree equal to
accepted `9d3e15f`. Merge verification introduces no new runtime-test claim.
The preceding baseline integrates P29–P34 at `b80bb38`, with complete tree equal to
reviewed `9e6dd07`; documentation closeout is `1f1a5aa`. P35 changes documentation,
not these program artifacts. P36 adds the separately scoped rebuilt-code evidence
below; P37's fresh integrated qualification after retirement is recorded separately.
[Original reports](../HISTORY.md) retain complete commands, failed attempts and pins.

## Anchor RC2 qualification (P47)

P47 local acceptance **passes**; P45–P47 integrated at `fb6c26b` with the complete
tree identical to accepted review tip `c637816`. [STATUS](../STATUS.md) records
integration separately from runtime evidence. Normal artifacts are selected only after the financial,
service and resource checks below. Unchanged C0 artifacts and clean verifiers
are recorded in the bounded
[coverage summary](../../tests/performance/baselines/p47-c0.json). Its **61/61**
entrypoints establish coverage; the distinct financial/service/load/default
constituents below supply their own acceptance. The inventory retains 2,520
executions / 2,493 originals / 27 byte-identical cross-run reexecutions, separating
rejections and operator/browser populations. Retained B stays immutable.

Clean `a01da5d` passes the 12-case focused RPC/WS profile; 123 maker and 84
publisher outcomes; 207 dependency/settlement and 63 retirement outcomes with
149/53-event PostgreSQL replays; 147/165/165 full protected/entry/stored-book
outcomes; and 712 complete-cohort outcomes. Independent arithmetic verifies 64
exact payouts (56 added members are flat), one augmentation and ten corruption
rejections. Eight separate wide-scratch compiled cases pass; they do not execute
payout history. P46's original 57 custody/290 safety/124 journal outcomes remain
separate constituents. All use C0 SBF `366c7ab`.

Clean **`b0b62ff`** completes the services/browser constituent with real
Surfpool/RPC/WS/PostgreSQL in `.local/anchor-rc2/p47-services-jsonb/`: **254 harness
outcomes, 468 durable originals (457 successful / 11 rejected), ten signed browser
actions**, three actual SIGKILL/lost-ack recoveries, stored-order execution,
publisher rotation/revocation, source outage/recovery and live indexer restart.
Fresh replay matches **187 events, 70 accounts/eight members**, zero unresolved
jobs. The independent `p33_services_reference.py` audit verifies **7,999,993 vault
atoms, 7,999,665 funded root cash, fees [267,61], insurance [66,15]**, flat inventory
and zero aggregate unpaid claims. Six makers are internal; hedge assumptions stay
labelled and no hedge was executed. Browser evidence uses installed Chrome and an
instrumented local wallet, not a new external-wallet compatibility claim.

Failed attempts remain local: missing Playwright cache; six browser actions then
an unsigned source-window refusal; and ten browser actions followed by the order
worker timeout. The last failure traced to JSONB key ordering in the readonly
projection comparison, reproduced from nine actual finalized custody events with
identical venue values. Structural comparison fixes that false rejection while
retaining complete field/array/revision guards; the new regression first fails
on old code and then rejects actual metadata changes. Twenty affected indexer
cases and typecheck pass; the clean integrated rerun above supplies runtime proof.

[Performance](performance.md#rc2-qualification-measurements-p47)
records the paired B/C observations, full financial state comparison and explicit
clock/digest mismatch limits. Fourteen affected measurement/provenance cases pass.
Raw wires/logs/database copies stay ignored. No unrelated full host suite, new
program build, funded/devnet deployment, external review or endurance is inferred.
Clean `1a893ed` adds fresh dispatch, load and operational constituents. Dispatch
passes pre-broadcast and post-send SIGKILL, actual expiry proof with seven durable
access rows and retained 20,000-lamport unknown-fee reserve, SQL ordering/fairness
cases and identical 61-event replay. The bounded load records 1,008 offers, 466
submitted originals, 433 fills, 33 stale-version rejections and 542 unsubmitted
(537 generator-inflight / five duplicate originals), zero expired/unresolved.
Live indexing obtains two coherent cycles and 33 revision-ahead retries; final
and fresh replay match 588 events / nine members / 9,000,000 vault atoms.
Operational workers pass liquidation, complete default with proposal-upload
SIGKILL/restart, six-second recovery and all funded account exits. Independent
arithmetic verifies ten exact Fraction payouts, one augmentation and five rejected
corruptions. Identical 192-event replay over ten members leaves **452 atoms** of
insurance/protocol fees only. Evidence is retained under
`.local/anchor-rc2/p47-{dispatch,load,operations}-1a893ed/`.
Clean `eac3755` compiles all three devnet-feature binaries without unsafe stack
diagnostics. All three reject valid-context initialization with full rollback;
maker contexts are explicitly injected negative fixtures because clearing cannot
initialize this profile. All three local/devnet feature combinations fail
compilation at the intended mutual-exclusion guard. No devnet network is used.
Evidence: `.local/anchor-rc2/devnet-gates-eac3755/`, reproduced with
`RIVALT_DEVNET_GATE_ARTIFACTS=<fresh-directory> bash ops/build-devnet-gates.sh`.
Fifteen affected local-demo configuration/process/transport tests pass. Twelve
resource-parser/receipt cases pass; absent heap requests and missing observed
heap/data metrics remain absent. The C0 and comparison summaries reproduce from
retained actual receipts; B still reproduces its unchanged 53,089-byte summary.

Normal launchers/builds select `.local/anchor-rc2/current`, preserving frozen B and
immutable C0. Its actual binary hashes must still match the SDK allowlist. The
artifact binding remains `p46-anchor-rc2-c0-candidate-v1` to preserve the qualified
journal identity; its historical name does not select arbitrary binaries.
The stack review found that runtime/continuation launchers checked only a
self-consistent manifest, while the SDK separately enforced the qualified hashes.
The shared `ops/verify-liquidity-artifacts.ts` preflight now enforces both account
schemas, clean qualification metadata, actual lengths and the fixed SDK hashes
before any normal/continuation/broad-smoke runtime starts. The default build uses
retained staging and validates before copying into `current`; explicit alternate
build outputs remain candidates, not admitted runtime artifacts. Standalone
hostile-maker smoke now selects `current` and applies the same preflight.
Fifteen focused file/manifest/launcher regressions pass, including self-consistent
forgeries rejected before runtime creation; eight existing deployed-code verifier
tests, typecheck, ABI and shell checks pass. The actual retained `current` and
immutable `c0-366c7ab` files pass the new gate. No program or IDL changed, and no
new performance, broad financial, load or endurance result is inferred.
At clean `c637816`, `bash ops/canonical-maker-smoke.sh` uses the default admitted
artifacts and passes 123 actual signed RPC/WS outcomes, 246 WS notifications and
independent fetch/dual decoding. Standalone `liquidity-hostile-svm.ts`, with no
artifact override, passes five hostile rollback cases across 114 signed VM
transactions. Raw evidence remains under
`.local/anchor-rc2/p47-review-{makers,hostile}-c637816/`; the owned Surfpool stops.
The first sandboxed RPC-launch attempt was refused before runtime creation; the
authorized local-network rerun supplies the stated pass. Scope/client/report/shell
CI pass on `c637816` in
[run 41386710747](https://github.com/arnabnandikgp/rivalt/actions/runs/41386710747).
Unchanged Rust financial CI is separately pinned to P46. No new SBF build or
PostgreSQL/service matrix was needed for the preflight/path/documentation changes.
All five review threads are resolved. P46's automated review was skipped for file
count; the bounded self-review of codec/loader/CPI/history adapters is not an
independent audit. Merge tree equality introduces no new runtime claim.
Clean `0591f10` initially caught confirmed provisioning advancing during the first
finalized indexer cycle. Startup now retries only typed `ReconciliationAhead` for
up to 30 seconds before producers start; all other errors remain fatal. Clean
`02f536c` then starts successfully and finalizes six wallet account/cash actions,
but its first unsigned trade refuses unavailable BTC sources. The normal launcher
had still shared one updater/payer across all producers. It now assigns six maker
and two publisher restricted keys through real signed provisioning, as qualified
services already did. Their fee payers no longer serialize all publication.
Neither failure is counted as completed demo acceptance; both remain local.

Fresh demo runtime and clean browser verifier **`083760a`** pass
**thirteen successful actual local-demo-wallet originals** in
`.local/anchor-rc2/p47-demo-browser-083760a/` (runtime/data retained in
`.local/anchor-rc2/p47-demo-083760a/`). Independently fetched finalized wires match
all wallet signatures, both margin modes, deposits/sibling allocation, BTC/ETH
trades, TP/SL cancellation, reduce-only closes, token-reconciled withdrawal and
saved-original/reconciled-fill reload. Actual wallet decline creates no original;
untrusted faucet origin and unauthorized stop reject. Page errors are zero.
The fixture follows the unchanged source contract: Normal for opens and credible
Normal/Degraded for reduce-only closes. It waits for real source recovery and
allows bounded explicit unsigned-source refusal retries. A proven finalized
version conflict or independently proven signed expiry may receive a new bounded
user review; its failed original/fee remains recorded. Ambiguous originals never
rebuild. The owned server and PostgreSQL are stopped, and all seven owned listeners
are released. No new external-wallet claim is made.

The complete demo denominator is **13 signed originals: 13 successful / 0 rejected**,
with **65,000 actual fee lamports**; every finalized receipt is retained. The full
interactive worker set targets four-second funding publication within the existing
2–5-second range, and one-second synthetic feed refresh. These local settings do
not replace the separate two-second service/load measurements.

Earlier demo attempts retained a proven signed expiry (landed slot 2,018 versus
expiry 1,956), an unaccepted MakerQuote 6115 refusal, source-recovery timeouts and
a worker PostgreSQL startup disconnect. Clean `ffceacd` also passed ten actions
before the fixture incorrectly demanded Normal for a reduce-only close with
credible Degraded prices; `083760a` corrects only that fixture condition. None of
these incomplete attempts is counted as a full pass or hidden by accepting more
financial error codes. The final lifecycle does not establish continuous
availability or eliminate those operating limits.

The paired resource report records observed route reductions of 40–44%, with
unchanged requested budgets and paid fees. Full books and 64-member continuation
fit; separate 5,632-bit scratch verification reaches 572,668 CU. Its 56 added default
members are flat and scratch cases never Apply. The bounded load's 433/1,008 fills,
all classified rejection/unsubmitted reasons, two coherent live index cycles /
33 revision-ahead retries and exact final replay remain limitations, not sustained
availability or TPS. P15B/P16B and continuous 24-hour endurance remain unchanged.

P47 is ready in [PR #66](https://github.com/arnabnandikgp/rivalt/pull/66) above #64.
Accepted/report content is `2b677b597912b2a3e9d7b02dab19088eca66ccc7`. All four
applicable hosted checks (scope/client/report/shell) pass in
[run 41296789385](https://github.com/arnabnandikgp/rivalt/actions/runs/41296789385),
including broad client regression, generated output, independent SDK pricing/
allocation and UI build. The unchanged Rust financial job is skipped; its P46
CI/source pins remain separate. Local B/C replay, ABI/evidence checks, four changed
shell scripts, typecheck and 312 documentation file links also pass. The stack
remains open; these results are not an independent review or an integration claim.

## Anchor RC2 serialized port (P46)

This section records P46’s scoped implementation acceptance; **P47’s complete
qualification and local promotion are recorded separately above**. D90 uses exact Anchor `2.0.0-rc.2`, isolated CLI/client installations,
platform-tools v1.52 and SBPF v0. The fresh clearing/account binding is 8, maker
account schema is 5, and quote/report protocol versions and financial rules remain
unchanged. Canonical identifiers replace the explicitly recorded historical IDs;
the immutable predecessor ABI guard checks fields, seeds, privileges and protocol
error codes. Default/devnet financial activation remains disabled.

Clean uninstrumented C0 SBF source is
**`366c7ab4f12c058fbff6538ededca26674ccf5bf`**. All default/qualification binaries
and oracle/hostile fixtures build without unsafe stack diagnostics. C0 binaries
and manifest are retained locally at `.local/anchor-rc2/c0-366c7ab/`; the normal
frozen B directory is untouched. Qualification binaries are 1,537,824 bytes for
clearing, 166,712 for each maker and 60,288 for the oracle fixture. These sizes do
not establish per-transaction CU savings; P47 owns the matched B/C report. C0
retains serialized owned accounts; no optional zero-copy C1 has been introduced.

Fresh RPC harness revision **`8feb24c81affcc98e655f3da7822ca46eaef835c`** is clean.
Commands use `RIVALT_ALLOW_RC2_CANDIDATE=1`, explicit
`RIVALT_ARTIFACT_DIR=.local/anchor-rc2/candidate` and distinct new run directories:

| Scoped gate | Actual result | Local evidence below `.local/anchor-rc2/` |
|---|---|---|
| `ops/account-custody-smoke.sh` | 57 signed/finalized RPC/WS outcomes; raw-byte conservation verifies zero remaining trader cash, 18 reserve/vault atoms and 1,999,982 returned token atoms; eight corruptions rejected | `custody-8feb24c/` |
| `ops/liquidity-safety-smoke.sh` | 290 signed/finalized outcomes, including two-maker cross routes, funding, TP/SL, reserved withdrawals/transfers, strict post-fee liquidation progress, complete eight-member default, exact atom ownership, exits and sustained recovery | `safety-8feb24c/` |
| Independent Fraction/raw safety audit | Eight exact payouts, two augmentations and ten corruptions rejected; tokens/claims/cash/reserves reconcile. Both isolated Anchor clients agree on 560 instructions, two accounts and 787 events | Same safety run |
| `ops/liquidity-journal-smoke.sh` | 124 harness outcomes; real PostgreSQL 18.6 records 121 in-scope transactions, five failures, 74 events/outbox rows and zero unresolved jobs. Actual SQL failure rolls back; restart recovers a missed fill; fresh database replay is identical; fees/carry reconcile to 26 charged atoms | `journal-8feb24c/` |
| Retained safety projection | 244 authenticated invocations and 23 failed transactions; 68 captured entities match at all five liquidation/default/recovery checkpoints. One portfolio body is explicitly uncaptured; this is not another RPC/SQL run | `safety-8feb24c/scoped-projection.json` |

Compiled C0 checks also pass: maker lifecycle **123** cases/**16** exact rejections;
three default initialization gates with rollback; five hostile-maker rejection
cases across 114 signed VM transactions. Hostile testing first rejects an unapproved
binary, then deliberately replaces only its admission hash to test CPI isolation;
this is not an authorized-upgrade or RPC-landing claim. Independent pricing checks
execute each actual maker binary against **3,172** vectors (1,547 exact quotes,
1,625 expected rejections) per program; inserted pricing fixtures do not claim
reachable cash state. Logs are under `.local/anchor-v2-build/`.

Earlier port checks on source `10b4d98` passed 119 clearing and 12 maker-interface
native tests, including bounded registry and foreign-loader negatives. Actual
source-generated IDLs, SDK generation, ABI guard and scoped dual-client conformance
pass. Affected client reruns pass 45/45 after stale-schema fixture corrections;
the other 200 checks passed in the preceding run. Typecheck passes after the CPI
and harness fixes. Broad hosted regression has not yet been observed.

Retained failed attempts are explicit: the first RPC attempt rejected the old
artifact allowlist; the next reached signed provisioning but failed its first
deposit with `AccountBorrowFailed`. RC2 boxed native accounts needed the forwarding
`ToCpiHandle` traits rather than the generic `AnchorAccount` method. The fresh pass
above verifies the fix without bypassing borrow guardrails. Framework failures
now use their exact RC2 named errors; protocol custom codes remain unchanged.

At the P46 checkpoint, P47 still owed full entrypoint/scenario coverage, full-book/64-member width gates,
operator/browser/fault/load qualification, complete operational replay and a
matched B/C resource/fee report. P46's scoped results do not satisfy those gates.
No devnet, external participant, funded deployment, C1 optimization or continuous
24-hour run is claimed. P15B/P16B remain open and endurance remains deferred.

## Checks by change

| Scope | Existing targeted entrypoints |
|---|---|
| Docs/handoff | Relative links/anchors, source/command existence, `git diff --check`, `python3 ops/check-evidence-policy.py` |
| Types/IDL/SDK | `python3 ops/wire_contract.py`, `pnpm typecheck`, `pnpm generate:check`, affected conformance tests in `tests/rpc-contract/`, isolated `tests/anchor-conformance/` |
| Canonical prices | `python3 tests/financial/test_maker_curve_contract.py`, `python3 tests/financial/check_maker_curve_parity.py --implementation sdk` (or explicitly built Rust/SBF variants), `bash ops/canonical-maker-smoke.sh` |
| Exact router | `python3 tests/financial/check_liquidity_allocation.py`, affected SDK adapter/allocation tests, `bash ops/canonical-maker-smoke.sh --adapters` |
| Publisher | `bash ops/funding-publisher-smoke.sh`, independent `tests/load/p34-publisher-reference.ts` on retained actual input rows |
| Current execution | `bash ops/liquidity-execution-smoke.sh` and affected full-book variants |
| Maker CPI isolation | `node --import tsx tests/rpc-contract/liquidity-hostile-svm.ts`; compiled fault injection, distinct from real RPC landing/upgrade evidence |
| Account/default arithmetic | Independent Fraction/bounded integer cases in `tests/financial/`, actual account safety handlers and compiled/RPC tests |
| Durable dispatch/conflict scheduling | `bash ops/dispatch-smoke.sh`, scoped `dispatch`, queue and expiry-authority tests; P40A acceptance tracked separately |
| Services/wallet/replay | `bash ops/liquidity-services-smoke.sh`, independent `tests/financial/p33_services_reference.py` |
| Default/recovery/exits | `bash ops/liquidity-operations-smoke.sh`, independent `tests/load/p34_operations_report.py` |
| Bounded comparison when changed behavior warrants it | `bash ops/liquidity-qualification-smoke.sh`, `tests/load/p34_report.py` |

Do not run the entire table for a routine PR. Financial expected values must come
from literal/independent arithmetic, not the implementation invoked twice. Host
models, compiled program tests, simulations, actually submitted/fetched transactions,
PostgreSQL reconstruction and browser signing prove different layers. Record all
failed/omitted attempts and why checks were skipped. Do not relabel simulation as
landing or a historical capture as a fresh run. Scoped hosted CI supplements these
checks; current workflow selection lives in `ops/ci-scope.py`.

## Performance redesign checkpoint

P39's [focused baseline](performance.md#current-results) uses clean harness
`0ac6511` and unchanged hash-verified SBF `828fe543` on actual Surfpool RPC/WS.
Twelve measured signed outcomes include one expected stale-account rejection;
all actual receipts/wires agree. Eight-root cash/claims, 83 fee atoms and the
25% insurance carry reconcile independently. The complete static inventory covers
61 entrypoints; only the named twelve cases have new CU measurements. Separate
payer versus protocol locks are recorded. No PostgreSQL, throughput, full
instruction-profile or Anchor v2 claim follows from this focused audit.

P40A service code at **`9134fd6aceed0b910b556bfb24c52134b5b280d0`** passes actual
Surfpool RPC/WS/PostgreSQL dispatch: two independent originals progress concurrently
under duplicate executors, shared-payer conflicts defer, expired nonexecution
releases access but retains a 20,000-lamport fee reserve, and actual SIGKILL after
upstream acceptance recovers the same cash-withdrawal original. Eight queue
originals yield six successes, one charged on-chain rejection and one proven
unexecuted expiry. Cash reconciles to 7,999,993 atoms; operator fees are 60,000
lamports. Fresh 61-event PostgreSQL replay matches. The RPC harness separately
verifies 106 signed setup/price-advance outcomes on unchanged SBF `828fe543`.

The SQL follow-up at **`a2860f93af6190ba116ad752a6e26359305abce0`** checks read/read,
W/W and both W/R directions, committed reservation persistence, rejection of
ambiguous legacy queues and idempotent activation after their known receipt. Those
encoded access fixtures are not additional financial executions. Fourteen scoped
consumer tests and typecheck pass. Raw records remain under
`.local/liquidity-execution/runs/p40a-dispatch-9134fd6/` (`dispatch.json` and
`dispatch-database.json`); owned processes/ports are released. P40B event migration,
validator scheduler throughput, broad financial/build/browser checks and endurance
are outside this service-only acceptance. The current global on-chain writes remain.

### Scoped history acceptance (P40B)

Fresh schema-5 accounts and SQL journal format 2 use no global writable discovery
counter. Native layout/source coverage binds all 17 headers, 42 contexts and 53
clearing entrypoints. The independent ABI delta derives from immutable P40A
`f8984e0`; generated SDK parity and relevant legacy Anchor encodings pass. Twenty
sequence-only custody writers become readonly; 30 economic/administrative writers
remain. No old state/database is reinterpreted.

- `02bbdec` with SBF `ba2f15f`: separate actual journal and live indexer runs, each
  120 signed outcomes and 72-event fresh PostgreSQL replay. SQL rollback, duplicate
  byte checks, restart, reverted-effect exclusion and 70-account/eight-root live
  reconciliation pass. Exact initial backing is 8,000,000 atoms; fees are 26 atoms.
- `a44b26b` with SBF `6123dc8`: independent custody/insurance/token audit passes
  57 signed outcomes and eight corruptions. Multichunk tests use 109 encoded
  accounts, advancing unrelated slots and relevant revision/unversioned-byte races;
  these are transport fixtures, not additional financial executions.
- Final clean verifier `b495b38`, SBF **`304da5c`**: 57 signed same-slot/nested-CPI/
  retirement outcomes, including two batches of three originals in one slot,
  later-CPI rollback, zero-payload storage, pause-epoch proof invalidation and cash
  exit. Live PostgreSQL reconciliation covers 32 accounts/six roots, 5,999,999 atoms;
  51-event fresh replay matches. Anchor checks 49 clearing encodings, three account
  codecs and 97 events, plus makers.
- The same final pins pass 290 safety outcomes (267 successes, 23 expected rejects):
  TP/SL, reservations, whole-account liquidation, complete two-market eight-root
  default, stale-source resolved exit and recovery/reactivation. Independent Fraction
  audit checks all payouts and ten corruptions. Anchor checks 266 clearing encodings,
  two account codecs and 487 events, plus makers. Max observed 477,424 CU; two-row
  Apply max 268,620 CU. A retained-receipt projection regression separately compares
  five raw-state boundaries, excluding one uncaptured portfolio; no new live SQL or
  complete-block proof is attributed to that offline comparison.

Final clearing is 2,452,824 bytes; makers are 261,056 each. Artifact hashes are in
SDK pins and retained manifests. The first two-row Apply failed on 32 KiB heap;
borrowed row/footer serialization fixes it without changing bytes, heap or CU limits.
Four borrowed-payload parity tests and seven footer/header cases include the maximum
32-entity footer. Default SBF initialization remains rejected in all three programs.
The earlier retirement projection initialization bug after zero-payload storage is
also fixed and regression-tested. Failed attempts remain alongside successful runs.

D85 changes Surfpool to checksum-pinned 1.7.0 (core 4.3.2, feature 3383571666) because
1.6.1 inconsistently reconstructed empty-block parent hashes. Full bodies also match
separate signature manifests. P39 measurements are not a same-runtime comparison.
Raw evidence stays under `.local/liquidity-execution/runs/p40b-*`; owned RPC/WS/PG
processes are stopped. No browser, full P44 instruction/resource coverage, validator
scheduler throughput, funded deployment or endurance result is claimed. Scoped
client/typecheck/generation/source/ABI checks pass; broad regressions run in CI.

### Relevant-market acceptance (P41)

Schema 6 preserves account layouts/seeds while optional canonical market contexts
and four explicit partial payloads remove unrelated source/funding dependencies.
The D86 ABI delta is checked against immutable P40B `d55ab82`. Independent omitted
one-scaled-unit claims, live orders and receiver dependencies reject; absent empty
slots retain their checkpoint/generation and reservation observations.

Clean SBF **`b0c5675f9e511c1d46a6538d22ced16241d6a4f8`** builds default/qualified
programs, IDLs and generated SDK. Clearing is 2,472,208 bytes; SHA-256
`03c475ba72dcc77244ed32b2fc3c79c9ffe58ac0ae0ca90cb06e96d313d11e03`.
The first order handler exceeded the 4 KiB frame by 240 bytes; borrowing typed
markets removes duplicate snapshots. No heap/CU limit or admission check changes.
All three compiled default initialization gates reject. Native coverage comprises
112 passing clearing cases followed by eight affected trading cases including the
new independent negative-prefix/expiry vector; these counts overlap.

- Clean verifier **`ca8bab092ae6bc17b0ba982181a4a8c58f4df3f9`**: 167 actual RPC/WS
  outcomes, 161 successes/six expected rejections; both isolated markets, coupled
  cross roots, transfers/exits, orders/protection, negative funding, actual hold
  expiry/revocation, complete backing, gain payment and explicit flat netting.
  Ten omission cases check signed-message/footer absence and unchanged market bytes.
  Fresh PostgreSQL replay matches all 115 events and reconciles 73 accounts/nine
  members. Literal cash 7,998,935 + pools 999/4 + insurance 9/5 + retained fees
  30/15 equals actual/allocated vault 7,999,997 atoms; fee carries are 3/0.
  Exact quantity and checkpoint-adjusted claim identities pass in both markets.
  Anchor independently checks 148 clearing encodings/257 events plus both makers.
- Clean safety verifier **`078057ae4f0581dfed0228dd098f442d18c99093`**, same SBF:
  290 signed outcomes, 267 successes/23 expected rejections, TP/SL/reservations,
  strict post-fee liquidation, complete eight-root default, cash exit and recovery.
  Independent raw-byte Fraction audit verifies eight payouts and ten corruptions.
  Anchor checks 266 clearing encodings, two account codecs and 487 events plus
  makers. Offline projection matches five raw-body boundaries, with one explicitly
  uncaptured portfolio; it is not additional live SQL/block-fence evidence.

Maximum observed CU is 276,058 in the dependency probe and 480,324 in safety;
these are scoped observations, not P44 full-path bounds or validator throughput.
The first claim probe landed all effects then found a revision-less certificate
payload projection error. The corrected reader binds it to the authenticated
footer; 13 affected projection cases pass, followed by the fresh successful probe.
Current typecheck, generation, source coverage, explicit ABI and inventory checks
pass. The legacy payload itself and on-chain settlement logic were unchanged by
that repair.

Raw records remain under `.local/liquidity-execution/runs/p41-claims-revision/`,
`p41-safety/` and retained failed/earlier attempts; build/check logs use `.local/p41-*`.
Owned RPC/WS/PostgreSQL processes stop after each run. Broader browser, services,
full-cohort resources and endurance are not rerun for this phase; P44 owns final
integration and full profiling. Custody/ledger coupling and continuous-activity
certificate progress remain P42. External/funded gates are unchanged.

## Custody isolation acceptance (P42)

D87's schema-7 implementation is qualified for its scoped local acceptance only.
Clean SBF source **`6aeb7d0cf645fca889a9e3154ac01a129a72a6a8`** builds qualified and
still-disabled default programs without oversized frames. Qualified clearing is
2,482,344 bytes, SHA-256
`d9c83864f5d3b0c5e7dcfa0100486335b1c96c583b62f9c68054318cf3169bcb`.
The explicit D87 ABI delta against immutable P41, generated SDK, eleven ABI guard
regressions, 53-entrypoint/43-context scope coverage and all three compiled default
gates pass. Current static inventory covers 61 entrypoints and 20 custody writers.
All 114 native clearing cases pass on final source. Seventy-one affected client,
projection and Anchor cases pass; four dependency-builder cases overlap three of
those, and one additional worker case verifies atomic final-page/payment enqueue.
The separate custody conformance case passes eleven current instruction/meta
comparisons against isolated Anchor; its obsolete context-name fixture is updated.

| Clean verifier / local run | Actual acceptance |
|---|---|
| `569ed3e` / `p42-custody-distinct/` | 207 RPC/WS outcomes: 196 successes, 11 expected rejections; ten market omission cases, cross funding/claims, exact fractions/netting and atomic certificate/payment with later-instruction rollback. Fresh PostgreSQL replay matches 149 events; 75 accounts/ten members reconcile allocated/actual V=8,099,997 atoms |
| `569ed3e` / `p42-safety/` | 290 outcomes: 267 successes, 23 expected rejections; TP/SL, reservations, strict post-fee liquidation, complete eight-root default, stale-source resolved cash exit and recovery/reactivation. Independent raw-byte Fraction audit verifies eight payouts and rejects ten corruptions |
| `6fbc5d6` / `p42-journal-treasury/` | 124 signed outcomes, five expected rejections; selected-market T→I allocation and actual fee exit retain authority and exact carry. Real SQL write rollback, shutdown/RPC backfill, failed-effect exclusion and identical 74-event fresh replay; 121 clearing-discovered transactions, zero unresolved |
| `6fbc5d6` / `p42-retirement/` | 63 outcomes, seven expected rejections; nested CPI/second-call rollback, two same-slot batches, pause-bound complete-member retirement, cash exit, wrong reserve authority/destination rejection and actual 11-atom selected reserve exit. Fresh 53-event SQL replay; 32 accounts/six members, actual/allocated V=5,999,999 |
| `72e2d18` / `p42-custody-alias/` | 57 signed gateway outcomes, 25 committed custody events, independent SPL/root/pool identities and eight rejected raw-state corruptions. Isolated legacy Anchor account/event parity passes |

All run directories above are under `.local/liquidity-execution/runs/`; logs remain
`.local/p42-*`. Each run uses the same hash-verified SBF source. Safety's separate
retained-receipt projection matches five lifecycle boundaries/68 entities with one
explicitly uncaptured portfolio; this is not additional live SQL/block-fence evidence.

Actual distinct-owner/payer BTC/ETH trades have no protocol **or complete-message**
W/W or W/R overlap. Same-market exact fee/exposure ordering and genuinely cross
roots still couple dependencies. Internal routes preserve custody/vault bytes.
Atomic final-page/payment is **118,337 CU, 604 bytes**, including a beneficiary
promoted writable by the later instruction. A later failed instruction rolls back
both proof and payout. The worker queues both as one immutable original.

Certificate progress has an explicit residual: **four constructed attempts** include
three deliberately interleaved new source observations, all correctly rejected,
and one coordinated-window completion. This is not normal offered availability,
a trading load rate or proof of progress under unbounded sampling. Earlier scan
pages still require stable relevant observations/liabilities; no stale payment or
oracle relaxation is introduced. Funded own-cash withdrawal needs no certificate.

Maximum observed CU is 274,817 in the dependency run and 479,015 in safety; treasury
allocation/fee exit are 17,282/30,465 CU, retired reserve exit 33,493 CU. These are
scoped observations, not P44 full-path bounds or validator TPS. The first dependency
fixture correctly hit self-trade prohibition; a third independently funded owner
fixes that fixture. The gateway's old seed-error expectation was corrected to
Anchor's earlier duplicate-writable rejection (2040). Failed receipts remain local;
no admission rule changed to obtain a pass.

No broad unrelated, browser, full-cohort resource or endurance suite is rerun for
P42. CI owns broad regression; P43/P44 own targeted optimization and fresh complete
qualification. Default/devnet and external/funded gates remain unchanged.

## Targeted CU acceptance (P43)

The optimization consolidates checked whole-account accrual/admission and reuses an
unchanged book-binding model. It preserves input/output/position bounds, per-market
IM rounding, reservations, funding and negative-claim admission. No positive unpaid
credit, changed code trust, ABI/layout, risk setting or compiler migration is added.

Clean uninstrumented SBF source **`fb5d0c546a417796ce615e0d3d3575545c96c178`** builds
qualified/default programs without oversized frames. Clearing is 2,484,144 bytes,
SHA-256 `a9a8f59e5e5fa93c4657ed25313f99199827d1e1ecf56e2f8b8ebb2caa6305f4`;
its size increases by 1,800 bytes. Maker and oracle hashes remain exactly P42's.
Regenerated IDL/SDK and the explicit wire contract are unchanged. All three compiled
default gates still reject valid initialization with rollback.

Clean before harness **`1c9c931`** / P42 SBF `6aeb7d0` and after harness
**`1e86661`** / P43 SBF `fb5d0c5` each pass 117 actual setup outcomes and twelve
focused signed RPC/WS cases. Receipt/wire verification and legacy Anchor parity
pass. Workload, Surfpool 1.7.0 runtime/features, IDL hashes, message shapes, requested
CU, fees and seven lock comparisons match. Each run independently checks every
root's lot/claim conservation, exact fee/insurance carry and actual token-vault
backing. The cross-run summary comparator matches fee totals, aggregate root cash
and root count; it does not compare individual root positions or vault bytes.
The bounded [before](../../tests/performance/baselines/p43-before.json) and
[after](../../tests/performance/baselines/p43-after.json) summaries are reproducible
with `tests/performance/summarize.ts` and `tests/performance/compare.ts`.

| Named state | Before CU | After CU | Reduction |
|---|---:|---:|---:|
| BTC single maker | 257,045 | 256,160 | 885 |
| ETH single maker, same cross root after BTC | 274,817 | 273,918 | 899 |
| Isolated BTC single maker | 265,335 | 264,666 | 669 |
| Two makers, same program | 352,022 | 350,792 | 1,230 |
| Two makers, distinct programs | 479,272 | 478,042 | 1,230 |
| Place / cancel order | 46,968 / 39,203 | 46,352 / 38,925 | 616 / 278 |

These are **small savings, one observation per named state**, not statistical or
worst-case improvements. Repricing stays 18,250 CU and stale-account rejection
33,313 CU. The two report observations each increase by one CU. Observed fees stay
10,000 lamports with two signatures and zero priority bid; requested limits are
unchanged, so no actual lamport saving is claimed.

Diagnostic source **`132e086`** also passes that workload in an isolated artifact.
Five authenticated trade receipts attribute about 131k CU to each distinct full
maker-code hash, about 20k to the singleton financial candidate and 18k to maker CPI.
The [attribution](../../tests/performance/baselines/p43-attribution.json) includes
marker/compiler overhead and nested overlapping intervals; it is not headline CU.
Two broader compiler-size experiments produced oversized frames and were rejected
without deployment or SDK pinning. The full-code check and original compiler flags
remain. Trace code is absent from ordinary builds; accepted artifacts are preserved.

On clean verifier **`1e86661`**, the same uninstrumented source additionally passes:

- 147 full protected-book RPC/WS outcomes and 165 full entry/stored-book outcomes,
  each including six expected rejections. Three full books, two protections per
  root where applicable, eight regions, 4,608-lot aggregate routes, 4,096-lot single
  routes, skew crossing, unfunded-provider rollback and structural invalidation
  retain independent per-lot gross/fee/claim checks. Maximum observations are
  504,141 CU/1,196 bytes/v1 and 503,938 CU/1,099 bytes/v0 respectively. These cases
  deliberately retain broad canonical market dependencies; they are conservative
  resource cases, not minimum-packet production-router measurements.
- 290 safety outcomes, 267 successes/23 expected rejections: full reservations,
  post-fee liquidation, complete eight-root default, stale-source cash exit and
  recovery/reactivation. The raw-byte Fraction audit verifies all eight payouts,
  two augmentations and ten corruption rejections. Maximum observed CU is 477,798.
  Retained-receipt projection matches five boundaries/68 entities, with one
  explicitly uncaptured portfolio; this is not new SQL/block-fence evidence.
- 38 affected financial-core cases, including 108 independently calculated
  admission/accrual combinations and invalid-bound cases, plus all 114 clearing
  native cases. Typecheck, generation/ABI, bounded evidence and documentation checks
  pass. No broader unrelated client/browser/endurance suite is rerun locally.

Raw receipts stay in `.local/liquidity-execution/runs/p43-{before,trace,after,safety,resources,resources-stored}/`;
logs use `.local/p43-*`. All owned listeners stop after each run. SQL, service faults,
complete entrypoint/variant coverage, latency/cost scenarios and full frozen
qualification remain P44; inherited P42 or P16A results do not claim them complete.
P15B/P16B, default/devnet gates and deferred endurance are unchanged.

## Frozen pre-migration qualification (P44)

This qualification reuses the **same uninstrumented programs** built from clean
`fb5d0c546a417796ce615e0d3d3575545c96c178`; no P44 program or IDL change occurs.
Clearing is 2,484,144 bytes, SHA-256
`a9a8f59e5e5fa93c4657ed25313f99199827d1e1ecf56e2f8b8ebb2caa6305f4`.
The bounded [B baseline](../../tests/performance/baselines/p44-pre-v2.json) pins
all four hashes/sizes, current IDL hashes, exact clean verifier commits, retained
summary hashes and per-entrypoint successful/reverted CU and transaction ranges.
The P43 focused, full-book and safety constituents already use these exact binaries;
they are included once, not represented as fresh P44 reruns. P39 remains immutable.

Build pins are Anchor 1.2.1, host Rust 1.97.1, platform-tools 1.52 / SBF Rust 1.89.0
(dev), SBPF v0 with the locked build script and no CU instrumentation. Runtime pins
are Surfpool 1.7.0, Solana core 4.3.2 / features 3383571666, Agave CLI 4.1.2,
Node 24.22.0, pnpm 10.23.0, web3.js 3.1.1, Kit 8.5.0 and PostgreSQL 18.6.
Legacy Anchor conformance remains isolated on Anchor 1.2.1 / web3.js 1.99.0.
Wide/hostile VM checks use LiteSVM 1.6.1 and are not RPC landing evidence.
The hostile fixture first rejects an unapproved replacement, then fault-injects
only its approval hash to test the admitted malicious CPI boundary.

| Constituent | Clean verifier; local run directory | Verified outcome |
|---|---|---|
| Maker lifecycle | `f9d29f6`; `p44-makers/` | 123 actual signed RPC/WS outcomes; both programs, eight regions, controls, revoke/approve and legacy Anchor parity |
| Complete 64-member default | `cbc132b`; `p44-complete-cohort/` | 712 signed outcomes / 11 expected rejections; actual source-emergency deadline, all stages, exit, 64 exact independent Fraction payouts and ten rejected corruptions |
| Dependency/claim/certificate | `f3b73c2`; `p44-market-dependencies/` | 207 outcomes / 11 rejections, ten omitted-market cases, negative funding/revocation, atomic page/payment rollback; 149-event fresh PG replay, 8,099,997 vault atoms |
| SQL journal and treasury | `f3b73c2`; `p44-journal/` | 124 outcomes / five rejections; SQL rollback, shutdown/backfill, failed-event exclusion and immutable identity; identical 74-event fresh PG replay |
| Custody | `9470101`; `p44-custody-pinned/` | 57 signed scenarios, 25 committed events, actual selected-artifact provenance, independent raw-byte conservation/eight rejected corruptions and Anchor parity |
| Retirement/reserve exit | `9470101`; `p44-retirement/` | 63 outcomes / seven rejections, same-slot/nested-CPI ordering, terminal reserve withdrawal; identical 53-event fresh PG replay, 5,999,999 vault atoms |
| Current load / parallel indexing | `8b8c33f`; `p44-load-final/` | 1,008 offers, 465 unique signed outcomes, 430 fills, 2 live coherent cycles / 33 revision-ahead retries; exact independent root/fee/claim audit and identical 585-event fresh PG replay |
| Initial direct offered load | `7e8d042`; `p44-load-first/` | 752 offers, 401 signed outcomes, 377 economic successes; exact per-root replay and identical 524-event fresh PG replay, 9,000,000 vault atoms |
| Dispatch / SQL ordering | `f4490e9`; `p44-dispatch-fair/` | Two lanes, duplicate executors, shared-payer deferral, immutable oldest-waiter ordering, version-1 drain gate, real lost-ack/SIGKILL, expiry; identical 61-event fresh PG replay |
| Review: admission crash window | `da99664`; `p44-review-dispatch/` | 106 harness outcomes, eight durable originals; real SIGKILL immediately after admission, restart after actual expiry, retained 20,000-lamport unknown-fee reserve, post-send recovery and identical 61-event fresh PG replay |
| Services and independent economics | `a5afbc9`; `p44-services-parallel-history/` | 188 harness outcomes, 239 durable originals (236 success / three report rejections), all three actual SIGKILL recoveries, stored-order fill, rotation/revocation/budget handover, source outage/recovery and live indexer restart; identical 137-event fresh PG replay, 7,999,993 vault atoms |
| Compiled hostile maker | `1cc2d6a`; `.local/liquidity-execution/hostile-svm.json` | Five rejected replacement/malicious-CPI cases with complete rollback across 114 signed VM transactions; all financial state provisioned by real instructions |
| Current browser | `f4490e9`; `p44-services-fair/` | Ten finalized internal-wallet actions, BTC/ETH and both account modes, TP/SL/cancel, saved-receipt reload, direct withdrawal/deposit while both APIs blocked |

Run directories above are under `.local/liquidity-execution/runs/`. Browser
acceptance is bounded to its saved receipts and `browser-summary.json`; that run
later fails unsigned order preparation and is **not** a complete service pass.
The dispatch probe's one proven-unexecuted expired original retains its actual
20,000-lamport unknown-fee reservation; it is not classified as fee-free.

Review qualification at clean `da9966401027a6cb92893db29251a2c696ae0fce`
also verifies the finalized-valid witness is committed with successful admission,
before the first status response or broadcast. SIGKILL leaves witness slot 1522,
seven access rows and zero attempts durable. Restart after real expiry proves
unchanged economic authority at slot 1644 and releases access, retaining the
unknown fee. The second process fault recovers the exact landed cash-exit original;
fresh replay matches eight members/70 accounts and 7,999,993 vault atoms. Nineteen
focused service tests and typecheck pass; all four applicable hosted jobs pass in
[run 41280117782](https://github.com/arnabnandikgp/rivalt/actions/runs/41280117782).
This requalifies the changed queue boundary only: no SBF rebuild or repeat of the
unaffected load, browser, default or endurance populations. Frozen B data remains
at its original pins. Integration `6b14e8a` has the exact tested stack tree.

The separate width fixture at clean `f3b73c2`, `.local/p44-width-probe/`, verifies
eight compiled cases on a copy of the captured full 64-row context: 2,796/5,632-bit
common denominators, 186-bit rate factors and mixed signs. Maximum Verify/FlowPlan
costs are 782,453/749,225 CU, 681-byte v0, requested 1.2m CU with at least 20%
headroom. Only arithmetic scratch is constructed; no Apply/payout occurs and the
original capture is unchanged. The actual 64-member lifecycle peaks at 364,614 CU;
its 56 added roots are flat and receive real one-atom deposits. These complementary
checks do not prove arbitrary maximum-width claims arise in a funded lifecycle.

Independent service-only replay verifies all eight roots, literal BTC fees 25
atoms (six insurance / nineteen protocol), cash 7,999,968 and vault 7,999,993;
all positions finish flat and aggregate unpaid claims sum to zero. Six internal
maker reports retain zero funded trading P&L and explicitly unobserved hedges.
All 55 stored funding inputs are retained; 53 available reports match independent
flat-curve arithmetic. Three actual failed originals reject with `FundingReport`
6131 and each pays 5,000 lamports; none is omitted from operator costs.

D88 fixes premature blockhash-expiry inference; its finalized-valid witness is
persisted even while dispatch defers. D89 prevents newer conflicting originals
starving an older committed waiter. Neither releases active/ambiguous locks nor
relaxes source, price, epoch, margin or fee-reservation checks. Qualification also
separates six maker and two publisher fee payers using existing restricted
permissions. The browser's public Vite configuration now forwards mandatory
`accountSchema`; its fixture builds current source and checks actual HTTP fields.

Retained failed attempts distinguish the causes: new-hash false expiry; deferred
witness missed behind a shared payer; live finalized reconciliation ahead of
journal; shared publisher payer starvation; absent bundled browser; stale ignored
UI build; omitted public schema; and newer jobs overtaking a wallet trade. The
corrected custody run supersedes an earlier financial pass whose report pointed
to an obsolete artifact. The first `2281869` service attempt times out during
setup with a recorded roughly twelve-minute runtime/finality stall; no application
recovery result follows from that interrupted attempt. Its subsequent complete-
setup attempt passes economic/worker faults but times out during live indexer
restart. Bounded eight-block body/manifest reads fix that observed catch-up case
at `a5afbc9`, preserving canonical ordering, drain-on-failure and every history/
revision/financial check. Fourteen affected indexer tests and typecheck pass.

For reproduction, use the scoped `ops/current-runtime-smoke.sh` probes with explicit
fresh run directories, RPC/WS ports and PostgreSQL port. `services` needs real PG;
set `RIVALT_CHROME_PATH` to installed Chrome. `RIVALT_SERVICE_BROWSER=0` deliberately
omits already separately accepted browser actions and cannot claim a new browser
pass. `complete-cohort`, `market-dependencies`, `journal`, `performance-load` and
`dispatch` each preserve actual originals and independent financial checkpoints.
`node --import tsx tests/performance/full-baseline.ts --replay` reproduces the frozen
bounded inventory from the retained exact receipts and signed wires. Raw evidence
remains ignored/local; the baseline is not a portable archive of those receipts.

[Performance](performance.md) owns the complete actor/CU/scaling table, offered-load
denominators, fee assumptions and residual constraints. Initial load indexing obtains
one coherent cycle and 27 revision-ahead retries; the scoped current rerun records
2 coherent cycles and 33 revision-ahead retries. Both complete exact
post-stop replay; neither proves sustained read-API readiness or validator TPS. Loaded-data bytes absent
from RPC remain unknown. P15B/P16B and deferred endurance are unchanged. No new
program build, unrelated native regression, external wallet, devnet, 24-hour run,
funded deployment or Anchor v2 migration is claimed by P44; broad regression runs
in scoped hosted CI after publication.

Frozen inventory reproduces **61/61 successful public entrypoints** over
**2,871** distinct harness originals (2,721 success / 150 reverted).
Operator/browser originals and VM cases are separate evidence populations and are
not silently added to that count. Thirty-one focused queue/receipt/cost tests,
fourteen indexer tests and two independent replay-auditor regressions pass.

## Qualified baseline and provenance

| Scope | Actual tested pin(s) | Evidence boundary |
|---|---|---|
| Account safety | `915d8e8` | Actual maximum-cohort/default/activation matrix; canonical changes separately qualified in P32 |
| Account services/UI | `13b558f`, `f595fd7`, `5491752` | Whole-account durable worker and concurrent exits/replay; earlier fixed-maker profile |
| Canonical maker/preview | `2d6fcdd`, `e9ee447`, `2fda67b`, `f9a70c3` | Compiled prices/controls, authenticated snapshot and independent exact allocation |
| Canonical execution/safety | SBF `6437f7d`; safety/PG `5d26561`; full books `df70e7c`; continuation `34b4325` | Explicit local execution with independent financial/ABI/RPC/WS/PG checks |
| Canonical services/UI | `fccf062` | Durable processes and instrumented local wallet; browser originals fit v0 |
| Comparative/operational qualification | `fb082de`, `03c4e73`, `aae8bb0`, `875b647` | Separate baseline, control/treatment, default/recovery/exits and maximum-book cases |
| Stack review remediation | `791fb8d` | Real expiry/nonapplication/retry, 370 service originals, 174-event fresh PG replay and per-trader audit |
| Self-review of skipped large PRs | `608f73c` | Unchanged final SBF artifacts; independent price vectors, compiled lifecycle and fresh publisher/execution RPC probes; not independent security approval |

The historical canonical SBF set was built at `6437f7d`; P36 rebuilt at `cff1cf9`.
The current P37 candidate is built from clean `828fe543`; SDK artifact definitions
and local manifests pin actual hashes. P35 adds no build/deployment/soak claim.
Original P13/P14 devnet evidence is earlier behavior; neither the current profile
nor v1 external-wallet compatibility inherits it.

## Resource contracts

| Operation | Submitted CU ceiling | Required measured ceiling | Additional bound |
|---|---:|---:|---|
| Reprice | 100,000 | 80,000 | Price publication only; explicit wire/key checks |
| Control gateway | 400,000 | 320,000 | <=18 loaded keys including payer/co-signers |
| Atomic pair of controls | 800,000 | 640,000 | <=32 keys; combined transaction measured |
| Canonical route | 800,000 | 640,000 | <=32 keys; complete books |
| Publisher init/config/report | 200,000 | 160,000 | <=20 keys |
| Resolution continuation | 1,200,000 | 960,000 | One-row Verify/FlowPlan, other allowed pages 1/2 |

Default heap remains 32 KiB; every SBF stack frame <=4,096 bytes. Complete signed
wire is v0 <=1,232 or v1 <=4,096 bytes. Shared custody/market writes and price
read/write overlaps remain real contention. A context snapshot read ceiling is
not a submitted-transaction key limit. Combined operations need their own proof.

P34 actual maxima: canonical publisher 31,813 CU / 775 bytes v0 / 13 keys;
risk/default worker 419,737 CU / 1,196 bytes v0 / 22 keys; maximum protected/entry/
stored-book route 615,433 CU / 1,165 bytes v0 / 26 keys, with other two-leg cases
1,262 bytes v1. Maximum route headroom is 23.07% under its 800k budget. All sampled
priority prices are zero. These are local results, not production fee estimates.

The maximum-width safety scratch probe measured 774,364 CU Verify and 638,366
FlowPlan. It widened derived scratch, not authenticated financial history; no
Apply/token movement occurred in that fork. The parent financial cohort completed
its separately reconciled lifecycle. Never conflate arithmetic scratch cases with
actual maximum-value financial histories.

## Availability, latency and economics

P34 schedules 600 offers in 300 seconds for each of three profiles. Full denominators:

| Profile | Offered | Eligible | Quoted | Attempted | Submitted | Finalized success |
|---|---:|---:|---:|---:|---:|---:|
| Earlier fixed-maker baseline | 600 | 287 | 287 | 287 | 287 | 286 |
| Canonical control | 600 | 542 | 542 | 542 | 542 | 542 |
| Canonical treatment | 600 | 546 | 546 | 546 | 546 | 546 |

Control omissions: 38 BTC-required Degraded, 18 ETH-required Degraded, 2 stale
publications. Treatment: 35/15/4 respectively. Baseline includes 164/148 Degraded,
one epoch-expired quote and one actual MakerQuote rejection at the selected maker's
expiry slot 4,722. Retain failures/fees; do not drop them from offered availability.
A BTC exposure can require BTC sources for an ETH cross-account request.

The 209 matched ordinary successes give baseline/control p95 signed-to-confirmed
192.262334/240.320167 ms: ratio 1.249959688 against a predeclared 1.25 ceiling.
The margin is less than 0.01 ms, a narrow one-host pass. It is not a stable production
latency margin. Eligible success regression ceiling is five percentage points.
The workload is two offered opportunities/second, not a throughput ceiling.

Exact financial replay explains all cash/claim/fee/insurance changes. All six
internal makers have zero funded trading P&L in that window; positive spread/funding
remains unpaid. Indexes are constant, so 2s/10s markouts describe controlled spreads,
not predicted profitability. The illustrative 1 bps hedge cost is unexecuted.
Network costs remain lamports; quote collateral and SOL must not be silently mixed.

Independent replay reproduces all 508 actual canonical funding reports. Separate
operational qualification completes ten-root default, restart during proposal,
sustained recovery and all remaining funded exits; vault residual is exactly
452 atoms of attributed insurance/protocol fees. Fresh PostgreSQL replay agrees.
These historical results remain pinned, not repeated by document consolidation.

## Remaining limits and external gates

- Restricted publisher honesty/complete coverage is a trust assumption; risk bounds
  limit its effect but do not prove input aggregation. No hypothetical maker margin
  admission occurs in funding.
- Three makers per market, two markets, one mint and at most two route legs are
  qualification bounds. Zero Surfpool AccountInUse errors proves no validator scale.
- Missing/advanced history proofs may keep originals unresolved; unknown fees remain
  reserved and can exhaust budgets/block handover. Required payment certificates
  may need coordination with relevant concurrent mutations.
- Local fixture prices/makers and browser signers are internal. Fresh OS installation,
  external maker profitability, current devnet parity and independent security review
  are not claimed by the recorded local results.
- P15B/P16B remain Open; 24-hour endurance stays Deferred. Reserve sizing, real risk
  calibration and any funded pilot require their independent gates/authorization.

## Canonical-name refactor qualification

P36 preserves the three-program wire manifest captured at `72187bc`, including
layouts, field/variant order, discriminator bytes, metas, seeds, errors and domains.
Current source names are different; numeric schema and journal/API tags remain.
SBF source `cff1cf9` builds without oversized stack diagnostics: clearing 4,511,952
bytes, each maker 382,864, oracle fixture unchanged. This is a scoped refactor pass,
not a rerun of the earlier full operating qualification.

At clean `53beba5`, the corrected publisher and execution probes submit/fetch/decode
84 and 125 actual RPC/WS outcomes. Isolated Anchor comparison covers 283 instruction
payload/meta pairs, 4 accounts and 258 events. Publisher control/report cases peak
at 30,585 CU, 871 bytes, 14 keys; routes at 589,748 CU, 1,262 bytes v1, 26 keys.
These are scenario maxima; full-book/default/service contention is P37's gate.
Independent Python/per-lot pricing agrees on 3,172 inputs for the current SDK and
each actual rebuilt maker SBF, including 1,625 expected rejections per implementation.

The first publisher run's zero-instruction name-filter selection was rejected as
instruction-parity evidence. The harness now uses discriminator identity and fails
empty coverage. Both runs remain local. P36 additionally checks native wire sizes,
PDA/schema negatives, generated parity, typecheck and affected consumer projections.
No PostgreSQL replay, new external wallet, endurance or external approval follows
from these scoped P36 tests. P37's changed implementation is qualified below.

## Current-runtime consolidation qualification

P37's clean SBF source is `828fe5431433f19cd562a23f44c45258ddbd61aa`; allowlist
`629d44a` records measured binaries. Later commits change consumers, launchers,
verification or documentation; no program/IDL change follows that build. Retained
wire hashes match the exact pre-retirement `b89768b` interface. Removed APIs are
listed explicitly in `tests/fixtures/wire-contract.json`; old deployments are not
upgraded or migrated. Clearing is 2,290,224 bytes, each maker 260,560; oracle fixture
unchanged. Qualified/default builds and stack diagnostics pass.

| Fresh scope | Verifier / evidence under `.local/` | Actual result |
|---|---|---|
| Custody | `629d44a`; `liquidity-execution/runs/p37-custody-629d44a/` | 57 signed outcomes, 25 events; raw token/cash audit and eight corruptions rejected |
| Publisher | `6819b1f`; `liquidity-execution/runs/p37-publisher-current/` | 84 outcomes / eight reports; 87 instruction, two account, 88 event Anchor comparisons |
| Execution | `6819b1f`; `liquidity-execution/runs/p37-execution-6819b1f/` | 130 outcomes; cash/claims/fees/depth plus foreign pause authority, active pause/unpause and epoch invalidation |
| Safety/default | `6fd5d02` transaction harness; corrected auditor `9703039`, final captured-byte conformance `a9878a0`; `liquidity-execution/runs/p37-safety-pages/` | 290 signed outcomes; liquidation, complete default, stale-source terminal exit, recovery/reactivation; eight exact Fraction payouts and ten audit corruptions rejected |
| Full books | `liquidity-execution/runs/p37-resources-{protected,entry,stored}/` | 147 / 165 / 165 outcomes; all three book variants, eight regions, maximum quantity, two-maker rollback and stale depth authority |
| Services/browser | `a9878a0`; `liquidity-execution/runs/p37-services-a9878a0/` | 343 durable originals, 84 reports, ten browser and two CLI actions, three real SIGKILL/lost-ack recoveries; identical 169-event fresh PostgreSQL replay |
| SQL journal | final recorder `f6b84a0`; `liquidity-execution/runs/p37-journal-canonical/` | 120 outcomes, 89 stored transactions / three failed, 72 events; SQL rollback, restart, immutable conflicts, reverted-event exclusion and fresh replay |
| Operational recovery/exit | runtime `d62c709`; `liquidity-execution/qualification/p37-operations-tcp/operations/` | 343 harness outcomes; 84 worker originals, restart during proposal upload, ten-root default/recovery/full funded exit, identical fresh PG replay; 452 vault atoms remain as insurance/fees only |
| Interactive demo | `a0a3651`; `demo-checks/p37-current-receipts/` and `p37-interactive-demo-current/` | 13 actual local-wallet originals; both modes, allocation, BTC/ETH, TP/SL/cancel, closes, withdrawal and reload; owned runtime stopped and ports released |
| Compiled hostile CPI | `15ee603`; `liquidity-execution/hostile-svm.json` | Five rejection/rollback cases across 114 signed VM transactions; wrong price/length, read-only write, maker error and unapproved replacement |

Full-book verifiers are respectively `7816aa4`, `9703039`, `a9878a0`. The first was
recorded before a local amend of the independent safety auditor; its current
counterpart `9703039` changes only that unrelated auditor, with identical program
and resource harness. Raw provenance is retained verbatim. Operational and journal
source stays identical during later unrelated harness/demo commits; their recorded
runtime/final-recorder pins remain distinct from the SBF pin.

Independent `p33_services_reference.py` reconciles each trader's cash, funding,
claims and fee carries, all six internal maker reports and exactly 267/61 fee atoms.
Independent `p34_operations_report.py` reproduces ten Fraction payouts, rejects five
corruptions and verifies each worker original's actual receipt/resources. All ten
roots finish flat, claim-free and with zero cash. No hedge or external maker result
is inferred. Demo signatures/bytes are independently fetched from finalized RPC.

| Fresh measured operation | Maximum CU | Complete wire / loaded keys |
|---|---:|---|
| Publisher/control scoped cases | 30,317 | 871 bytes / 14 |
| Ordinary execution probe | 463,965 | 1,262 bytes v1 / 26 |
| Full protected / entry / stored book routes | 489,571 / 488,255 / 489,401 | Maximum pair route 1,165 bytes v0; other pair cases 1,262 bytes v1 / 26 |
| Operational publisher reports | 31,535 | 775 bytes v0 / 13 |
| Operational risk/default worker | 419,054 | 1,196 bytes v0 / 22 |

The maximum route leaves 38.80% of its 800,000-CU budget. These are bounded scenario
measurements, not a new throughput, production priority-fee or latency qualification.
No lookup table is required. Published funding depth remains an attestation.

Current client suite passes 229 cases in 55 files; subsequent scoped conformance/
demo checks pass 19 cases (overlapping, not an additional aggregate count). Clearing
passes 102 native tests in each qualified/default build. Both maker crate targets
compile but contain zero native cases; actual compiled lifecycle has 123 cases /16
rejections. Independent Rust/SDK/SBF A/SBF B pricing each agrees on 3,172 vectors;
allocation has 415 independent cases. Financial reference checks include 2,060 wide
arithmetic, 337 collection/flow/rate and 549 atom/continuation comparisons. Three
compiled defaults reject valid provisioning with rollback; mixed local/devnet maker
features reject compilation. Typecheck, generated parity, wire guard, 21 tooling
checks, UI build and docs/evidence checks pass.

The hostile VM first rejects an unapproved binary replacement. It then deliberately
replaces only that registration's approval hash to reach malicious CPI behavior;
all financial state came from signed instructions. This tests isolation even from
an admitted malicious maker; it is not authorized-upgrade or RPC-landing evidence.

Failed attempts remain local: obsolete publisher launcher path; dynamic resolution
metas and variable-byte handling in isolated Anchor conformance; the safety raw
auditor's original discriminator; PostgreSQL's temporary init-server readiness;
a stale test-only journal label; and demo rejection-only provisioning/old receipt
prefix. The safety lifecycle completed before its final conformance error; corrected
post-run comparison of captured original bytes passes 560 instructions / two accounts /
543 events. Do not describe its original shell exit as successful. Every other
failed integrated attempt was followed by the scoped fresh pass recorded above.

The separate indexer smoke is not repeated: services/operations already exercise
the current projection and fresh database reconstruction, with journal-specific SQL
faults separately checked. Retired-profile suites, new comparative load, 24-hour
endurance, external wallet/devnet and independent/funded gates are not rerun or
claimed. Hosted CI supplies broad supported client/native regression after PR
publication; local acceptance does not imply an unobserved CI result.


## Durable paged default worker (P56 internal A1)

Clean `25ed94a832e66c8986554b53be6cb59d9c5b7139` passes the actual production
candidate controller/queue against unchanged D102 SBF `bc9f029`. Native page helper
build `2d7337f` has identical helper source at the tested revision; its 547,184-byte
executable hashes to `246a3e09925c3f04bf91ec528a0d7a6c07b32c414c067af60f0466887a0659fe`.
The helper returns bounded account descriptors, never financial authority.

Run `RIVALT_SETTLEMENT_PROBE=default-worker` with the pinned artifact directory
through `ops/scalable-settlement-smoke.sh`. Actual signed trades create the
bankrupt cross debtor and opposing maker claims. The pre-execution independent
Python Fraction/graph reference supplies expected cash/insurance; post-run
`tests/financial/check_default_worker.py` checks every final owner, protected fee
carry, all insurance/pools, the one-atom token exit, exact original bytes and fees.

| Measured result | Observed |
|---|---|
| Financial population / durable worker originals | 8 / 665 |
| Separate provisioning/recovery RPC/WS outcomes | 271 |
| Upload and Apply executor faults | Actual SIGKILL after RPC acceptance, before acknowledgement; same signature/bytes and one observed broadcast each |
| Maximum worker CU / serialized bytes | 116,191 / 915 |
| Worker fees / remaining fee reservation | 3,325,000 test lamports / 0 |
| Worker elapsed through completion | 1,266.843 seconds; serial finality after each original |
| Insurance consumed BTC / ETH | 120 / 30 collateral atoms |
| Fresh SQL replay | 109 identical events, 224 reconciled accounts, 8 members |
| Actual / allocated collateral / surplus after exit | 7,399,999 / 7,399,999 / 0 atoms |

SQL checkpoints cover partial Apply, distribution, complete settlement and recovered
custody. All payouts match the independent model; reservations/delegates/positions
clear and historical order/group IDs remain. An actual SPL withdrawal is followed
by sustained source recovery and explicit resume. End tracked tree is clean.
Both isolated Anchor clients match 249 setup/recovery clearing instructions and
1,023 clearing events (plus maker events); worker instructions are fetched as exact
persisted wire but are not claimed as an additional legacy instruction-parity run.
Nineteen focused service tests, two native descriptor tests, typecheck and all five
hosted jobs pass at the recorded revisions. Hosted run: 43126999240 at `25ed94a`.

Earlier stopped runs are retained, not accepted: `bd61659` incorrectly required
fresh publication for frozen continuation; `6752a36` reached 656 originals but used
the source stage instead of the plan stage after distribution. Regression checks
cover live-discovery fencing, frozen progress during publication lag, adopted-plan
reconciliation/completion and mismatched checkpoint rejection.

Limits: internal makers/synthetic sources, eight roots and one insurance evaluation;
no larger Financial population, selected runtime promotion, external wallet, soak
or independent review. This 21.1-minute scalar path does not meet larger-cohort G1
latency acceptance; P56 owns continuation optimization and populated-cohort costs.
Raw evidence remains at `.local/scalable-settlement/runs/p56a1-default-complete`.

## Account lifecycle clients (P56 internal A2)

Clean **`b9d2a21beffc7f551ebc0d078cc65d15f5aa4677`** passes
`RIVALT_SETTLEMENT_PROBE=account-clients bash ops/scalable-settlement-smoke.sh`
with the unchanged D102 binaries, actual Surfpool RPC/WS, PostgreSQL and explicitly
selected Chrome **157.0.8103.39**. Evidence is local at
`.local/scalable-settlement/runs/p56-account-clients-chrome`; `result.json` records
a clean final tree, 412 separately fetched setup/publication outcomes and 23
browser-signed originals, all matched to their exact RPC bytes and finalized
signature notifications. No indexer recovery exception was recorded.

The UI creates a portfolio and Registered accounts beyond stable ID 64, atomically
activates/deposits, trades BTC/ETH in cross and isolated accounts, places/cancels a
reserved order and existing-position TP/SL, allocates collateral, withdraws,
deactivates an empty child and permanently retires its namespace. An actual
activation followed by zero deposit rejects and restores membership, fifteen index
nodes and custody/vault bytes. Reload preserves retired slots and signed receipts;
RPC deposit/exit succeeds with both HTTP service surfaces blocked. Trading roots
retain their true closed/fractional claims; the retirement case is collateral-only.

Final discovery has **77 identities / 76 non-retired roots / ten Financial roots /
one retired slot**. Actual/allocated vault is **10,010,000 atoms**, wallet tokens
**1,990,000 atoms**, zero surplus. An independent fresh PostgreSQL database replays
**248 identical events**, with **304 accounts** reconciled at one finalized fence.
Browser transactions use **16,550–160,492 CU / 443–1,329 bytes**, each costing
5,000 test lamports; atomic activation/deposit uses v1. The two isolated Anchor
clients agree on **392 clearing setup/publication instructions / 612 events**,
196 maker-A instructions / 200 events and 98 maker-B instructions / 100 events.
Those counts exclude wallet instruction parity; wallet evidence is independently
fetched signed wire and decoded/reconciled state, not a second Anchor-client claim.

Thirty focused discovery/activation-envelope/ingress/API/UI checks, typecheck and
UI build pass on the implementation. The earlier clean `10b55aa` run provisioned
identities but stopped at a missing Playwright binary; it is retained as a failed
attempt. Early browser preflight now selects an installed executable before signed
provisioning. No new SBF build, unrelated native regression, devnet, Phantom,
external wallet or larger Financial population is qualified here. P56 still owns
continuation batching and G1's populated-cohort resource gate before promotion.

## Atomic default continuation batches (P56)

Clean **`2521b21159c5db94f3cc22f14fabf791d3ce258e`** passes the existing actual
`default-worker` probe with `RIVALT_DEFAULT_BATCH_STEPS=8` on unchanged D102 SBF.
The same **665 guarded instructions** fit **84 immutable signed originals**;
**189.010 seconds**, **420,000 test lamports**, peak **703,645 CU / 1,590 bytes**.
Compared with the separately pinned scalar run, original count/fees fall 87.37%
and measured completion time falls 85.08%. These are two local runs with their own
independent frozen-input expectations, not public-network throughput guarantees.

Both real SIGKILL/lost-ack faults (inside upload and Apply batches) recover one
observed broadcast of the exact original wire/signature. Every applied ordinal
matches the independent Fraction/graph reference. Insurance spends 120/30 atoms;
actual one-atom token exit, sustained recovery and explicit resume succeed.
Fresh PostgreSQL replay reproduces **109 events / 224 accounts / eight members**;
actual/allocated vault is **7,399,999 atoms**, zero surplus. No fee reservation or
access lock remains. Setup/recovery contributes 271 separately fetched outcomes;
worker instruction parity is not claimed through the isolated Anchor client.
The runner and independent post-audit both exit successfully, with clean final tree.
Raw evidence: `.local/scalable-settlement/runs/p56-default-batches-writes`.

The first clean attempt `1e39de7` stopped before any default original because RPC
omitted a requested simulation poststate. The planner now requests only writable
poststates and reads unchanged dependencies using its checked speculative reader;
it never substitutes live state for a missing write result. Thirteen transport
boundary tests and five risk-controller checks pass; typecheck passes. No program
or economics change was needed for batching. The option remains explicit and
defaults to one step. This completes the eight-root batching acceptance only;
128-root resource, rejection/contended progress and expanded activation gates remain.

## Workspace-backed population build (P56 candidate)

Clean **`0cc21b820005cc9708d7baeb63193f55576c4f62`** builds all current default,
qualification and fixture binaries with the pinned RC2/SBF toolchain and no
oversized-stack diagnostics. Clearing is **2,374,816 bytes**, SHA-256
`16f94c7fb2808e9ac4d547a3671a13386be4296c2a43cb5ef8950e67de3d0651`.
The default clearing binary and both maker programs remain byte-identical to D102;
only the qualified clearing population guard changes. The explicit candidate set
is `p56-population-0cc21b8`, schema 10/profile 6, retained at
`.local/scalable-settlement/p56-population`. Selected artifacts remain unchanged.
Eleven affected native membership checks and typecheck pass. No larger Financial
population or G1 acceptance is implied by compilation; the new signed populated
probe must establish that independently.

The first clean populated harness **`46462fd`** creates, funds and trades all 128
Financial accounts and freezes them, but stops before any default original: the
independent Python branch reference still imposed its historical 64-row fixture
ceiling. This is a failed qualification, retained at
`.local/scalable-settlement/runs/p56-populated-128`; no settlement or G1 result is
claimed. That reference-only ceiling is removed without changing its conservation,
fixed-point, insurance or rounding equations. Thirty affected reference checks now
pass, including literal 65/128-row cash/haircut and cashless-cycle cases compared
against the actual compiled Rust kernel. Frozen inputs are now captured before
reference execution so a diagnostic failure retains its exact proposed inputs.

### P56 populated recovery resource follow-up

Clean `74484ea`, D106 SBF `0cc21b8`, eight-step batches and 128 actual Financial
roots reached 997 originals / 7,976 instructions before the operator fee-budget
guard rejected further work. Measured originals cost 4,985,000 test lamports and
2,073.172 seconds; peak CU 751,785. Upload same-original SIGKILL recovery passed.
No Apply, complete payouts, exit or fresh replay acceptance is claimed. This
misses G1's 900-second target. Raw run: existing ignored
`.local/scalable-settlement/runs/p56-populated-128-cases`.

The resource-bound 32-step attempt at `0d265a3` correctly rejected the concurrent
reduce-only fixture's omitted position generation before any default original.
`0d01a11` supplies the actual generation. Clean D107 source `1c08778` passes 14
focused native settlement tests and all qualification/default SBF builds without
oversized-stack diagnostics; clearing is 2,378,392 bytes / SHA-256
`60c3bb23a550723dd0958fc6b34dcde72ed742f3dde4075bf1b6eab5a01e3790`.
This only qualifies the build and native checks; signed resource improvement and
populated completion remain pending. Selected runtime has not been promoted.

D107's clean `0ca9927` populated attempt retained 146 finalized worker originals /
2,854 instructions, peak 899,903 CU, one upload SIGKILL recovery and two actual
disjoint-lock BTC/ETH fills. The negative full-batch replay correctly rejected
at 908,178 CU but violated its harness's 20%-headroom assertion. The fix budgets
that negative probe at 1.2m and flushes immediately; worker limits stay unchanged.
The observed 977.9-second sum contains one 597.06-second interval; neither full
recovery nor steady-state elapsed time is qualified. Raw run remains under
`.local/scalable-settlement/runs/p56-populated-128-continuation`.

D108 candidate native checks pass: 23 settlement/page-authentication cases, two
helper transport cases and 19 batch/descriptor/binding checks. Its literal
one-atom debtor/equal-creditor test preserves exact ownership across restarts;
65-root plan continuations decrease from 1,792 to 89, and 128 roots take 166.
Only three native roots carry claims in that boundary fixture. Generated clearing
IDL/SDK and the explicit additive ABI guard pass; the 91-entrypoint lock inventory
adds the window context only. Compiled CU/frames, populated signed outcomes,
crash recovery and SQL reconciliation remain required before promotion.

Clean D108 SBF **`ed466030eccd485b8552b378815bf3f4e28fb658`** builds all
qualification/default programs without oversized-stack diagnostics. Clearing is
**2,389,840 bytes**, SHA-256
`2637469c4a8b1761c7cefc4c931d38611ebb651e05c60065e9617bbf3af13d3e`.
Its separately retained version-2 helper is 588,816 bytes, SHA-256
`3b378f41a508cbed8689211a67028e8648fe45157f53f52af21ff54203bfcafa`;
both manifests record clean source. The 16 ABI-guard checks and 91-entrypoint
inventory pass. Candidate bindings are pinned to these bytes. Actual populated
RPC/WS/reconciliation and resource acceptance are still pending; selected runtime
and historical helper binaries remain unchanged.

The D108 run at clean `faf5427` completes actual 128-root default, both upload/Apply
SIGKILL recoveries, independent payouts, token exit, recovery and fresh SQL replay
assertions, then fails final compatibility reporting on an 8 MiB stdout buffer.
It retains 175 worker originals / 2,317 instructions / 875,000 test lamports, peak
897,380 CU, and 417.979 seconds summed original-processing time. Final reconciliation
is 405 accounts / 128 members and 332,907,139 actual/allocated atoms, zero surplus.
Total wall time/storage were not persisted before the reporting error: this is
not yet full G1 acceptance. Raw capture remains in
`.local/scalable-settlement/runs/p56-populated-128-window`. File-backed isolated
client output removes the capture buffer; original builder metas replace compiled
transaction privilege unions in the negative probe and all worker parity checks.
Offline comparison classified exactly two promoted read-only metas; no program
layout or economic rule changed. A complete corrected run is required.

## Clearing-owned joint recovery

Local SBF `efbaa024` is 3,055,624 bytes, SHA-256
`902291ec1c562037e18bb04f7311276bd8d9c3b82ff8857dffd86484c2e43fdd`.
The page helper is built from the same revision. The default IDL adds eight
instructions, a search account and a binding event. Every prior instruction,
account, event and type was structurally identical in the generated IDL.
The D90 ABI check, TypeScript type-check, seven Rust verifier tests, the SDK
receipt test and nine scoped-event tests passed.

At `f46b6032` the cross-creditor book covered all 340 schedules. The selected
BTC 9 / ETH 33 plan took 28 successful search transactions totaling 5,998,545 CU.
The largest used 922,695 CU. The winner cost 140,000 test lamports in fees and
the sponsor deposited 42,636,440 rent lamports in the search account. Binding
used 30,734 CU in 726 signed bytes. Incomplete, defeated, stale and duplicate
bindings were rejected. All eight balances and 16 signed movements matched the
independent model. The two maker capital accounts paid 5,004 and 34,968 atoms to their owner’s wallet;
each withdrawal used 32,726 CU in 806 bytes. The run recorded 276 main harness
outcomes and 54 worker originals. A fresh database reproduced all 114 events
and the reconciled cash, fees and reserves. Retained finalized bytes for all
eight new instructions and both binding payloads matched the isolated legacy
and RC2 Anchor clients.

The first attempt at `3f669775` stopped after selection when a synchronous
test subprocess starved the parent's finality poll. The repeated `f46b6032`
financial harness completed and emitted its checked result. Its outer shell
reported a trailing parse error after the final reconciliation while the
script file was edited during the run. The pinned supervisor passes
`bash -n`. Raw receipts are retained in the existing ignored
`.local/profit-attribution/owned-cross-f46b603` directory.

At `d2a16818`, two BTC makers each held 10,002 eligible atoms. Clearing
verified 2,548 schedules, selected BTC charges of 7/6 by frozen member order,
and charged 12 on ETH. The winner took 67 successful search transactions,
14,743,233 CU total, 994,013 CU peak and 335,000 test lamports in fees.
Binding took 31,184 CU in 726 bytes. A one-atom withdrawal after binding and
before application failed. All eight funded balances and 16 market movements
matched the independent result. The flat trader withdrew 4,996 atoms; maker
credits of 9,995, 9,996 and 9,990 reached their owner's token account. Both
reserves ended at zero, alongside retained fees of 39 and 6. The supervisor
completed 291 main harness outcomes, 55 worker originals, both isolated Anchor
comparisons and an identical 128-event fresh SQL replay. Signed receipts are
under `.local/profit-attribution/owned-tie-d2a1681`. The local proposer supplied
the schedules and witnesses; a fully autonomous operating service and larger
book resource qualification are still open.

## Combined clearing lifecycle

The local `integrated-recovery-qualification` SBF at `5d7a7c0f` is
3,187,040 bytes, SHA-256
`94a82ceab69599b2abb952b0ea2f2867b27a27f5d54eb3ef59e88ee19f7ace9f`.
Each workload used the same clearing and maker binaries on a fresh Surfpool
deployment, signed transactions, RPC/WS and its own PostgreSQL 18.6 database.

- At `e5a9de5a`, all 36 paired routes and the additional pre-freeze fill
  finalized. Independent makers on BTC shared zero writable keys. Only the
  shared-maker pair wrote the same capital and registration. The test exercised
  a funded exit, rejected an intervening fill that invalidated the checkpoint,
  froze with exact insurance, and reproduced 231 events from scratch.
  [Resource and timing measurements](performance.md#paired-routes-on-the-recovery-candidate).
- At `49a90358`, two BTC lane fills and the full ETH cross-account fill
  collected 24 and 13 fee atoms. The freeze rejected incomplete classification,
  then recorded 6 and 3 insurance atoms with 18 and 10 retained. Clearing
  compared 340 schedules, accepted charges of 9 and 33 and rejected the
  competing 9/32 schedule. The 28 transactions for the winning proof used
  5,999,369 CU in total and 140,000 test lamports in fees. Binding used
  31,083 CU in 726 bytes. Early withdrawal failed. The makers withdrew
  5,004 and 34,968 atoms, each in 806 bytes and 32,955 CU. All eight
  member balances and sixteen market cash movements matched the independently
  reconstructed book. There were 278 main outcomes, 55 worker originals and
  142 freshly replayed events. Both independent Anchor clients reconstructed
  eight recovery instructions and both emitted binding-event payloads.
  The first harness at `e5a9de5a` stopped at freeze because its comparison
  selected only the older fill event. The rerun explicitly checked both lane
  fills and the full route before comparing any financial result.

- On clean harness `51123ea6`, the ETH funding index advanced from 4,999,999
  to 5,555,555 scaled units in a BTC cross-account fill. BTC retained
  6,111,110 through 30 skipped seconds, with one second of valid coverage.
  A two-maker reversal from +1 to −1 lot charged the taker 24 atoms once.
  The cross-account fill used 260,371 CU in 1,204 bytes. The reversal used
  207,100 CU in 1,110 bytes. Both finalized with 10,000 test lamports in fees.
  The run recorded 275 outcomes and 113 events in fresh SQL replay.
- On the same harness, the trader opened and closed BTC against different
  makers for a 996-atom gain, with 26 atoms in trading fees. Another fill
  changed backing after all eight accounts had been scanned. Clearing rejected
  payment with incomplete checkpoints, then paid the fully backed gain. The
  wallet received the 970-atom net profit. Payment used 139,697 CU in 848
  bytes and withdrawal used 141,359 CU in 1,074 bytes. There were 332
  outcomes and 315 freshly replayed events.
- On clean harness `3c476d16`, the ten-lot maker fill reduced the maintenance
  deficit from 43,910 to 12,574 atoms after fees. The target remained at 40
  lots while no quote or funded receiver could execute. Once funded, a
  consenting receiver took five lots. That restored maintenance, left the
  trader with 35 lots and prevented further liquidation. The receiver unwound
  all five lots. The maker liquidation used 267,650 CU in 1,154 bytes and the
  receiver transfer used 145,490 CU in 983 bytes. There were 294 finalized
  outcomes and fresh SQL replay matched 136 events. The first run at
  `51123ea6` exposed a missing ledger classification on the receiver deposit.
  The corrected test verifies rollback without it, then funds the receiver with
  the classification in the same transaction.

On keeper revision `c96e43a8` with the same `5d7a7c0f` program, the service
read the frozen accounts over RPC and generated the original and candidate rate
and rounding witnesses. The earlier independent calculations matched byte for
byte. The restarted signed workflow covered 340 schedules, rejected the
inferior proposal and early withdrawal, and paid 5,004 and 34,968 atoms to the
two wallets. Fresh PostgreSQL replay matched 142 events after 278 main harness
outcomes and 55 worker originals. The two search processes recorded 27 and 33
outcomes. Two targeted unit tests passed and 26 witness calculations matched
the retained independent results from the cross-creditor and tied-gain books.
Only the cross-creditor book was redeployed for this change. The harness still
supplied the schedule numbers, exclusion intervals and submission loop.

### Automatic recovery keeper

On `453e8c5c`, the risk worker read the eight frozen margin histories and
compared all 340 BTC/ETH schedules. It chose rank 339, with charges of 9 and
33 atoms. A separate process instance resumed from the first landed exclusion
interval. Clearing bound the result, refused withdrawal before application, and
paid the two wallets 5,004 and 34,968 atoms. Fresh PostgreSQL replay matched
142 events. There were 273 main harness outcomes and 78 worker originals. A
one-schedule budget blocked the same episode before the sponsor rented an
account. The run used the combined `5d7a7c0f` clearing SBF on Surfpool.

| Frozen book | Signed proof transactions, including binding | Total CU | Peak CU / bytes | Sponsor fees | Rent deposited |
|---|---:|---:|---:|---:|---:|
| Cross-creditor, 340 schedules | 23 | 5,979,755 | 922,695 / 726 | 115,000 lamports | 42,636,440 lamports |
| Tied BTC gains, 2,548 schedules | 67 | 14,765,834 | 994,013 / 726 | 335,000 lamports | 42,636,440 lamports |

On worker `94f14ee5` the tied-gain book selected rank 1,364 of 2,548 from
the authenticated freeze. The selection agreed with the independent reference
on charges of 13 BTC and 12 ETH collateral atoms. The flat trader withdrew
4,996 atoms. The three maker withdrawals were 9,995, 9,996 and 9,990 atoms.
The run recorded 286 main harness outcomes, 122 worker originals and 128
events in a fresh PostgreSQL replay. It used the owned-recovery local SBF from
`efbaa02`. Both runs stopped and reopened the worker after a landed interval.

The RPC receipts distinguish the fee from the extra debit to create the
payer’s proof account. Reopening the worker reused the original account.
Both isolated Anchor clients reproduced all eight recovery instructions and
two emitted events. The amounts are local test collateral and lamports.

### Recovery selection across two membership pages

On `51214434` a signed verifier captured the nine Financial roots from both
canonical frozen pages, including the final flat BTC creditor. It sealed rank
1,364 after covering all 2,548 schedules. The sponsor process exited at cursor
169 and a new process reread the landed proof. The 67 finalized proof
transactions consumed 15,937,670 CU in total, with a peak of 1,055,640 CU
and a maximum signed packet of 466 bytes. The payer spent 335,000 local
lamports in fees and posted 52,669,440 in account rent. The final cash,
movements, remaining insurance and retained fees matched the independent
calculation. The original clearing freeze stayed in place. The 284 harness
outcomes, 43 clearing-worker transactions and fresh 99-event PostgreSQL
replay are separate from the 67 verifier transactions.

Harness `7543e863` reached freeze on the paged clearing binary `37672622`. Snapshot reconciliation then rejected the new account layout before any proof or payout. The account and settlement snapshot readers now share the same deployment-specific frozen-page decoder.

On `00a2858c`, the paged clearing binary rejected omitted or reversed frozen
pages. Neither rejection changed the prepared header or either page. Binding
all nine results consumed 41,209 CU. The premature withdrawal failed as
expected. PostgreSQL ingestion then rejected the newly introduced binding
event at the transport boundary. From the retained finalized original, the
corrected decoder and projector matched the nine-member vector, including
34,970 atoms of final cash for the last creditor. Isolated Anchor 1 and RC2
clients reproduced all eight instructions, the binding event and the footer.
This run ended before an authorized wallet payout.

On `69e64a52` the two-pass insurance case reached the incumbent comparison.
The signed wire exhausted its 1.2M CU preflight. The same instruction and
frozen accounts simulated successfully at 1,221,755 CU under the 1.4M
validator ceiling. LiteSVM replay of both original wires and captured account
bytes reproduced both measurements exactly. Multi-pass individual comparisons
now request 1.35M CU. The run measured a simulation and moved no payout.

Harness `ae1c59ea` on clearing SBF `37672622` settled nine members with two
insurance calculations before and after the forced reduction. Clearing checked
all three possible schedules, selected rank 2 and charged two ETH-market
atoms. The original BTC/ETH debtor cash allocation stayed fixed. The markets
spent six and one insurance atoms and retained seven and zero respectively.
The flat BTC creditor withdrew 4,996 atoms. Three maker withdrawals totalled
30,003, matching the 34,999-atom reduction in the vault. A restarted worker
completed application and reconciliation. The fresh PostgreSQL database
reproduced all 134 events and matched the live accounts. The harness recorded
291 outcomes and 79 finalized worker transactions.

The 16 recovery-proof transactions used 1,965,510 CU in total and 80,000 local
lamports in fees. The sponsor also posted 52,669,440 in rent. The full
comparison used 1,221,755 CU in a 424-byte packet. Binding used 40,218 CU
and 792 bytes. The peak comparison used 90.5% of the requested 1.35M CU.
These are local measurements on this two-pass book.

On `edf85cab` the separate nine-member case completed on the same SBF.
The keeper resumed the proof, covered all 2,548 schedules and bound rank
1,364. Recovery charges were 13 BTC-market and 12 ETH-market atoms.
Insurance supplied 13 and one respectively. The second-page creditor held
34,970 atoms of final cash and withdrew 4,996. Three makers withdrew
29,981 in aggregate. The vault decreased by 34,977. Fresh PostgreSQL
replay reproduced 134 events and reconciled the live accounts. The harness
recorded 291 outcomes and 125 finalized worker transactions. Both isolated
Anchor clients matched eight recovery instructions and two events.

The 68 proof transactions, including binding, consumed 15,988,672 CU in total
and 1,055,773 at peak. Binding consumed 41,209 CU. The largest packet was
792 bytes. The sponsor spent 340,000 test lamports in proof fees and posted
52,669,440 in rent.

On `9b9894dc` a fresh local `efbaa02` clearing deployment froze nine Financial
accounts after five signed fills. Member 8 was flat with a 4,996-atom BTC
claim. The worker read both original pages, fenced each margin-history
batch against the prepared revision, and selected rank 1,364 of 2,548.
The independent calculation started from the signed fills and matched the
charges of 13 BTC and 12 ETH collateral atoms. The existing clearing profile
held the freeze. Neither wallet nor the vault moved during selection. The
run recorded 284 harness outcomes and 43 finalized worker transactions. A
fresh PostgreSQL replay matched 99 events.

A separate nine-member fractional vector required three insurance calculations.
The independent rational solver produced rate triples `[1,1,1]`, `[3,3,2]`
and `[23,20,15]`. It paid the final flat creditor one atom from each market
and spent zero insurance atoms. The worker reproduced all triples and both
nine-member remainder orders. The native finance verifier accepted all three
passes and rejected an omitted pass and an eight-member payout order. This
fractional vector ran off chain. The signed freeze used whole-atom claims.

On `41269935` a read-only Solana verifier authenticated the prepared header,
resolution, both membership pages and all nine original margin accounts. It
verified the proposed forced trades and calculated protected payouts. The
returned digest matched every member's cash and both market movements plus
the remaining insurance balances. Repeating page zero in place of page one
was rejected. The accepted transaction used **1,089,543 CU**, **901 bytes**
and **5,000 test lamports**. Fresh PostgreSQL replay again matched 99 events.
This measurement covers one proposed schedule. Enforcing optimality across
the 2,548 schedules and applying wallet balances require further instructions.
The clearing-side conservation scan at `97063aa3` separately rejects omitted
members, unbalanced reductions, a wrong insurance market and fee reallocation
in a targeted native test.

The earlier combined-build proof admitted exactly eight members. Its nine-member route workload qualified contention and freeze. The separate paged clearing binary qualified the two nine-member payouts above. A sponsor supplied the exact
proposal and witnesses in the original recovery run at `49a90358`. The automatic keeper covers the admitted profile. Recovering larger cohorts and establishing a sustained throughput limit remain open. P56 remains the selected local runtime.

On harness `b026dcba` the funding, ordinary payout and receiver runs stopped
during setup with filesystem `ENOSPC`. Their partial evidence was excluded. The successful cases above ran sequentially
after removal of 24 approved, stopped test databases.

### Ordinary settlement worker checkpoint parity

On `73799a2b` the service builder reproduced instruction data and ordered
account addresses for 39 backing scans, one maker loss collection and one
trader payment from finalized combined-build run `51123ea6`. Three focused
settlement-worker tests passed, including separate contiguous checkpoint sets
for an atomic final scan and payment, and TypeScript checking passed. This
check reused signed originals. It establishes no new payout latency.

### Ordinary close-to-wallet timing

Harness `ddd4f36b` ran two independent eight-member Surfpool venues on combined
SBF `5d7a7c0f`. In both, a trader bought one BTC lot at 60,002 and sold it to a
different maker at 60,998. The close recorded a 996-atom claim. Two fees of 13
left 970 atoms of net profit. Both backing certificates were complete before the
close. The table uses the harness observation of close confirmation as time zero.

| Confirmed observation | Pool funded before close | Collection delayed across restart |
|---|---:|---:|
| Pool had at least 996 atoms | Already present | +2.322 s |
| Keeper reopened the same pending original | Continuously running | +2.277 s |
| Claim paid into margin cash | +5.246 s | +7.611 s |
| Net gain received in SPL wallet | +5.383 s | +7.790 s |
| Events reproduced by fresh PostgreSQL replay | 334 | 329 |

In the delayed case the pool held zero at close. The harness checked that the
signed collection had never landed, stopped the worker, waited 1.5 s and
reopened its PostgreSQL journal. The worker recovered the same signature and
wire. In both cases it collected the outstanding maker loss and paid two gains
in member order. The second payment cleared the trader's claim. The wallet and
vault moved by exactly +970 and −970 atoms and the trader's funded cash returned
to its opening balance.

Each of the three worker originals cost the keeper 5,000 local test lamports.
The close and withdrawal each cost the harness fee payer 10,000. The close used
177,788 CU, the trader payment 91,116 CU and withdrawal 141,207 or 141,192 CU
respectively. The measurements use one sample per case, local synthetic price
updates, a 250 ms service loop and an immediately signed withdrawal. Setup and
the preceding backing scan are outside the timing interval. Each original was
independently fetched at finality and worker signatures were verified over WS.

An optional atomic close-and-pay is worth prototyping for already-backed claims.
Here the pool already held the full gain yet the trader waited another 5.246 s
for the worker. Before exposing that path, demonstrate that the actual post-fill
certificate, payout cap and pool cover the payment, preserve other creditors'
entitlements, and measure the signed packet and CU. A stale certificate or
insufficient funds must still allow an ordinary close with asynchronous payment.
Changing the payment priority under scarce backing needs a separate economic
decision. [Reproduction](local-development.md#reproduce-the-combined-clearing-lifecycle).


### Automatic maker and receiver liquidation

Harness `84ef28f3` on combined clearing SBF `5d7a7c0f` ran the service against
nine Financial members. A trader held 50 BTC lots and an ETH risk-increasing
order. At a 52,000 reference, the independently valued maintenance deficit
was 43,910 collateral atoms. The worker received no target, maker or fill size.

| Signed outcome | Remaining trader lots | Trader cash | Maintenance deficit | Worker CU / wire |
|---|---:|---:|---:|---|
| Sell ten to the admitted maker at 51,998 and cancel the ETH order | 40 | 563,286 | 12,574 | 247,096 / 1,103 bytes |
| Tight depth exhausted, receiver funded with one atom | 40 | 563,286 | 12,574 | No original |
| After another 99,999 atoms arrive, consenting receiver takes five at 52,000 | 35 | 563,156 | 0 | 100,497 / 689 bytes |
| Reprobe restored health | 35 | 563,156 | 0 | No original |

The target paid a 104-atom taker fee on the maker sale and a 130-atom
penalty directly to the receiver on the transfer. The worker fee payer was
also the receiver owner. Its SOL balance fell by exactly 5,000 test lamports
for each finalized original and by zero during the blocked and healthy probes.
The receiver unwound its five lots at the remaining wide bid. Each signed
worker transaction matched its PostgreSQL original when independently fetched
over RPC and confirmed over WS. Fresh replay matched 149 events and reconciled
accounts. The independent calculation included actual funding on each interval
at the inventory held.

The initial run did not queue the maker. A subsequent run exposed the old
manual fixture's zero-premium assumption after consumed depth changed the
funding sample. Another caught an indexer race with deposit finality. The
successful run preserves the oracle bounds and waits for fixture finality
before publishing reconciled receiver capacity. The worker uses bounded size
probes and one configured receiver. It reports a missed probe round separately
from an executed liquidation. [Reproduction](local-development.md#reproduce-the-combined-clearing-lifecycle).


### Financial domain extraction

Harness `ecd515e4` ran identical signed payout and liquidation workloads on
the parent binary `84ef28f3` and the extracted binary `90d71835`. Both used
the integrated qualification features and the pinned RC2 SBF compiler.
The loss, payment and receiver-transfer rules are exercised through the
program entry points in the [financial source map](../clearing/README.md#trace-a-financial-transition).

| Finalized transaction | Before CU | After CU | Change |
|---|---:|---:|---:|
| Open 50 BTC lots | 263,816 | 263,816 | 0 |
| Close with a different maker | 167,361 | 167,361 | 0 |
| Fill against an already-scanned book | 182,866 | 182,866 | 0 |
| Collect maker loss | 123,033 | 123,112 | +79 |
| Pay backed closed profit | 139,697 | 139,749 | +52 |
| Withdraw net gain | 141,359 | 141,359 | 0 |
| Force a ten-lot maker sale | 267,650 | 267,653 | +3 |
| Transfer five lots to a funded receiver | 145,490 | 145,490 | 0 |
| Receiver unwind | 247,283 | 247,283 | 0 |

The SBF grew from 3,193,416 to 3,193,704 bytes. On **each** binary the
payout run produced 332 signed outcomes, 996 gross gain, 26 trading fees,
970 atoms to the wallet, and 315 events in fresh PostgreSQL replay. The
liquidation run produced 294 signed outcomes, the same 43,910 → 12,574 → 0
maintenance deficits, and 136 freshly replayed events. The fixture signs,
submits, refetches and decodes the original transactions over RPC/WS.

Eight financial-core margin cases, eight on-chain route tests and ten on-chain
cash tests passed. The immutable D90 wire contract check passed. The public
native whole-account settlement helper now shares the live program's gross-debt
coverage rule. A cross account with 119 cash against debts of 80 and 40 refuses
a one-atom collection from either market. With 120 cash, collecting one leaves
119 cash, 79 and 40 debt, and one pool atom. The previous helper checked the
selected claim alone. This corrects the native helper and preserves the signed
program's economic behavior.
