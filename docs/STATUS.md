# Current status

Updated 20 November 2026. This is the live handoff, not a cumulative run diary.

## Baseline and active work

P01–P14, P15A/P16A and the delivered P17–P56 phases are integrated within
their recorded scopes, together with the clearing research and qualification
through #101. On 19 November,
all 29 PRs in stack #74 merged into `main` at
**`8a1d49d5217009a17f129266df02a214e5c429f0`**. Its file tree matches
the accepted tip `869d542ba2b6d3a01ff2483d625ff6579dce0bb3` exactly.
[Validation](operations/validation.md) records the qualified artifacts and limits.
[History](HISTORY.md) records the integration.

| Work | Status | Deliverable / next acceptance |
|---|---|---|
| P51A audit-remediation roadmap | Closed | [PR #72](https://github.com/arnabnandikgp/rivalt/pull/72); [P51–P62 plan](operations/remediation-plan.md) maps all 20 findings to 25 proposed PR scopes, dependencies, six decision gates and acceptance; clean `4025168` documentation checks pass |
| P51B account/settlement contract and feasibility | Closed | [PR #73](https://github.com/arnabnandikgp/rivalt/pull/73), above #72 in stack #74; clean `a5ac218`: 254 independent cohorts, 1,016 actual Rust comparisons, 16 compact scale diagnostics and maintained-backing model; native scope only |
| P52 bounded-progress finalized indexer | Closed | [PR #75](https://github.com/arnabnandikgp/rivalt/pull/75), above #73; clean `fe1c754`: 10,642 transactions / 4,306 invocations, three SIGKILL boundaries, continuous-write publication and identical 4,353-event fresh SQL replay |
| P53A shared price policy | Closed | [PR #76](https://github.com/arnabnandikgp/rivalt/pull/76), above #75; SBF `2136106`; publisher `55426dc` passes 99 signed outcomes; journal `e98b0eb` passes 120 outcomes and reconciled, byte-identical 72-event fresh replay |
| P53B calibrated ranges | Closed | [PR #77](https://github.com/arnabnandikgp/rivalt/pull/77), above #76; user-approved policy 2; SBF `afeb7ea`, publisher `10cadb7` (137 outcomes), boundary/PG and safety `82d2c6a` (228 / 290 outcomes); 176-event fresh replay |
| P54A scalable settlement kernel | Closed | [PR #78](https://github.com/arnabnandikgp/rivalt/pull/78), above #77; clean `60c2141`: 774 independent settlements, 307 rejection cases and 16 completed native scale cases; no runtime activation |
| P54B authenticated frozen/rate work | Closed | [PR #79](https://github.com/arnabnandikgp/rivalt/pull/79), above #78; clean `22736dc` / SBF `89b6129`: 479 signed outcomes, two insurance evaluations and complete prefix/ABI/recovery checks; financial activation unchanged |
| P54C conserving settlement | Closed | [PR #80](https://github.com/arnabnandikgp/rivalt/pull/80), above #79; clean `c6e08f9` / SBF `efa4595`: 1,405 signed outcomes, ten-root payouts, eight token exits, recovery and identical 131-event fresh PostgreSQL replay; population activation unchanged |
| P55A1 identity/index foundation | Closed | Clean `b8a19eb`: 38 focused native tests and linked SBF pass; 1,027-member independent index reconstruction; [PR #81](https://github.com/arnabnandikgp/rivalt/pull/81) above #80; no wire/admission change |
| P55A2 on-chain membership/lifecycle | Closed | Schema-9 candidate SBF `583dbcb`; lifecycle 411, complete default/SQL 1,538, custody 234 and race 274 signed outcomes; [PR #82](https://github.com/arnabnandikgp/rivalt/pull/82) above #81; selected runtime unchanged |
| P55B1 maintained-backing kernel | Closed | Clean `1715d20`: 1,274 explicit-corner comparisons, 89,720 native summary/restoration checks up to 10,000 roots, six literal financial paths; [PR #83](https://github.com/arnabnandikgp/rivalt/pull/83) above #82; no runtime activation |
| P55B2 on-chain maintained backing | Closed | SBF `bc9f029`; clean `cf128c0` passes 1,474 signed outcomes / 61 rejections, maintained progress, repair/netting/liquidation/default/exit and 469-event exact SQL replay; clean `831d352` adds 41 durable originals, SIGKILL recovery and 136-event fresh replay; [PR #84](https://github.com/arnabnandikgp/rivalt/pull/84), above #83 |
| P56 account-scale services, clients and activation | Closed | [PR #85](https://github.com/arnabnandikgp/rivalt/pull/85), above #84; clean `ad19215` / D108 SBF `ed46603` passes 128 populated Financial roots, 175 originals / 506.428 seconds, both crash recoveries, exact payouts/exit and 1,074-event fresh SQL replay. Clean `6b92665` passes the normal launcher and all 13 wallet originals. |
| Clearing architecture review | Research delivered | [Comparison](clearing/venue-comparison.md) covers six venues using primary docs accessed 17 November. Source baseline `07822f49`. [D112](DECISIONS.md#d112--capped-adl-and-proportional-residual-recovery) records the subsequent loss-policy choice. |
| Clearing engineering roadmap | Active planning | [Delivery order and functional ownership](clearing/roadmap.md). The comparison and first domain extraction have landed. Default and recovery are the active deliverable. |
| Settlement and liquidation comparison | Closed | [PR #86](https://github.com/arnabnandikgp/rivalt/pull/86) above #85. The user reported independently reproducing its payout cases and selected capped ADL followed by proportional residual recovery. |
| Capped ADL eligibility | Closed | [PR #87](https://github.com/arnabnandikgp/rivalt/pull/87) above #86. [Multi-maker and freeze comparisons](clearing/architecture-review.md#eligibility-at-the-freeze). Model `bd5b40e` passes 12 new and 11 existing focused tests. Eight new adjusted cohorts match native Rust terminal cash and insurance. D113 settles payment attribution and D114 sets the freeze cutoff. D116 sets priority among eligible winners. |
| Ordinary gain payment attribution | Closed | [PR #88](https://github.com/arnabnandikgp/rivalt/pull/88) above #87. [Payment comparison](clearing/architecture-review.md#which-profit-an-ordinary-payment-settles). Model `1ab1eaf` passes nine new and 23 preceding focused tests. Ten frozen outcomes and 15 funding accruals match native Rust. [D113](DECISIONS.md#d113--closed-first-payment-attribution) records user approval of closed-first for the successor. |
| Default eligibility cutoff | Closed | [PR #89](https://github.com/arnabnandikgp/rivalt/pull/89) above #88. [Cutoff comparison](clearing/architecture-review.md#when-default-eligibility-becomes-binding). Model `8cbbb31` passes 11 focused tests, including 18 native terminal comparisons. Four existing Rust resolution tests pass. [D114](DECISIONS.md#d114--verified-freeze-cutoff-for-loss-eligibility) records the approved prospective cutoff. |
| Signed freeze delivery | Closed | [PR #90](https://github.com/arnabnandikgp/rivalt/pull/90) above #89. Clean harnesses `bc816d4` and `3594114`, local SBF `ed46603`. [Four signed outcomes](operations/validation.md#signed-source-publication-and-freeze), including complete atomic rollback and a successful freeze two to three slots after source publication. Fresh PostgreSQL replay matched 72 events. |
| Whole-account risk-engine extraction | Closed | [PR #91](https://github.com/arnabnandikgp/rivalt/pull/91) above #90. Candidate SBF `6775e13`, harness `8b5dda2`. [Matched financial and resource results](operations/validation.md#whole-account-risk-engine-extraction) for nine signed transactions per build, 90-event SQL replay per build and 30 native tests. The normal launcher selects P56. |
| Cross-market ADL attribution | Closed | [PR #92](https://github.com/arnabnandikgp/rivalt/pull/92) above #91. [Linked creditor comparison](clearing/architecture-review.md#who-bears-the-cross-market-effect). Model `9bfd68f` passes nine new and 12 existing focused tests. Seven terminal cash/insurance vectors match native Rust. D116 records winner selection. D117 fixes cash attribution and protects the other market. |
| Individual creditor payout protection | Closed | [PR #93](https://github.com/arnabnandikgp/rivalt/pull/93) above #92. [Rounding comparison](clearing/architecture-review.md#protecting-individual-creditor-payouts). Model `c4109b1` passes eight focused tests with seven native controls and 1,125 enumerated transitions. A BTC forced close can take one ETH atom from a creditor despite unchanged total payouts and insurance. |
| Joint frozen reductions | Closed | [PR #94](https://github.com/arnabnandikgp/rivalt/pull/94) above #93. [Shared lots and two-market defaults](clearing/architecture-review.md#competing-debtors-and-simultaneous-market-defaults). Offline revision `e06dca7` passes eight joint and 17 related tests, including 81 independent matching cases and four native terminal controls. |
| Default plan verification | Closed | [PR #95](https://github.com/arnabnandikgp/rivalt/pull/95) above #94. [Verification contract and fixtures](clearing/default-plan-verification.md). At `4be157f`, eight certificate/identity tests, eleven joint tests and eight current Rust plan-controller tests passed. D121 selects frozen-episode priority for exact ties. |
| Restartable default verification | Closed | [PR #96](https://github.com/arnabnandikgp/rivalt/pull/96) above #95. [Reference and work counts](clearing/default-plan-verification.md#restarting-verification-when-a-bound-misses). At `0093a05`, six new and 19 related tests pass, including rejection of an inferior plan, episode binding and checkpoint restart. |
| Metered default selection | Closed | [PR #97](https://github.com/arnabnandikgp/rivalt/pull/97) above #96. [Native and signed results](clearing/default-plan-verification.md#measured-nine-account-verifier) at `220c139`. 67 exhaustive comparisons, twelve signed outcomes and recovery of a missing PostgreSQL receipt. |
| Frozen position attribution inputs | Closed | [PR #98](https://github.com/arnabnandikgp/rivalt/pull/98) above #97. [History and storage comparison](clearing/default-plan-verification.md#what-the-freeze-must-retain-about-open-profit) at `50d8a3a`. Five focused checks, nine existing checks, 1,000 history prefixes and independent native terminal payouts. At `100bf32` seven signed transactions cover exact growth, atomic rollback and a separate test sponsor. |
| Ordinary cross-maker payout | Closed | [PR #99](https://github.com/arnabnandikgp/rivalt/pull/99) above #98. [Signed results](operations/validation.md#ordinary-trader-payout) at `f732ae0` on selected SBF `ed46603`. The trader withdrew all 970 net atoms, an early exit failed atomically, the restarted keeper completed payment, and fresh PostgreSQL replay matched all 158 events. |
| Maker liquidation and funded receiver | Closed | [PR #100](https://github.com/arnabnandikgp/rivalt/pull/100) above #99. [Signed qualification](operations/validation.md#maker-liquidation-and-funded-receiver) at `3c05d59` / SBF `4e07c1f`. A ten-lot maker fill and a five-lot receiver transfer restored the target to maintenance, 12 signed rejections preserved state and fresh PostgreSQL replay matched 96 events. The normal runtime remains on P56. |
| Stack review closeout | Closed | [PR #101](https://github.com/arnabnandikgp/rivalt/pull/101) above #100 covers 17 CodeRabbit threads from the 28 predecessor PRs. Twelve warranted changes and five were already covered. Local default at `104a8ac` finalized 15 worker transactions and replayed 109 events. The [liquidation regression](operations/validation.md#stack-review-regressions) at `5c302cd` on candidate SBF `ab3f6c6` replayed 92 events. Integrated in the verified 29-PR merge. |
| Single-debtor BTC recovery | Review | [PR #102](https://github.com/arnabnandikgp/rivalt/pull/102). [Signed comparison](operations/validation.md#single-debtor-btc-recovery) at `7781e6b` on selected P56. Eight accounts, 13 finalized worker continuations, an 847-atom wallet exit and 115-event fresh SQL replay. A successor model on the same inputs pays the trader 996. |
| Clearing-owned surviving profit | Review | [PR #103](https://github.com/arnabnandikgp/rivalt/pull/103). [Signed results](operations/validation.md#clearing-owned-surviving-profit). Program `33361d9`, signed harness `af1c515`. All 16 frozen market slots matched independent replay across two-maker fills, a flip, backed payment and keeper liquidation. A separate 277-transaction recovery reproduced the parent’s creditor payout and wallet exit. |
| Sponsored profit capacity | Review | [PR #105](https://github.com/arnabnandikgp/rivalt/pull/105). [Signed capacity and recovery](operations/validation.md#sponsored-profit-capacity). At `291e7a5` on SBF `1763dc7`, 129 lots traded after both roots grew. A replacement sponsor reimbursed the first and received its own principal after exit. A separate 279-transaction BTC default returned the winning maker’s sponsor principal after restart and reconciliation. |
| Verified BTC default payout | Review | [PR #106](https://github.com/arnabnandikgp/rivalt/pull/106). [Signed recovery and limits](operations/validation.md#verified-btc-default-payout). At `24bc87f` on SBF `447efef`, clearing paid the flat trader 996 atoms into the wallet, debited the winning maker 1,500 and protected both markets’ accounting. All eight roots and 116 fresh SQL payloads reconciled. At `0ac7019` the 502-atom case remained frozen. |
| BTC residual recovery | Review | [PR #107](https://github.com/arnabnandikgp/rivalt/pull/107). [Three signed outcomes](operations/validation.md#btc-residual-recovery). At `1e05885` on SBF `8024a37`, actual wallet payouts were 8,498 with partial eligible gain, 8,498 with zero eligible gain and 26,988 with three opposite lots. Each run reconciled all eight roots and replayed 116 events in fresh SQL. |
| Multi-winner BTC recovery | Review | [PR #108](https://github.com/arnabnandikgp/rivalt/pull/108). [Signed results](operations/validation.md#multi-winner-btc-recovery). On SBF `9e2cc00`, harness `c747189` verified the 1,656/1,839 split and an episode-ordered 1/0 tie. The flat creditor withdrew 996 in both runs; all eight accounts and 132/140 fresh SQL events reconciled. |
| Linked-market cash allocation, creditor protection and ranking | Review | [PR #109](https://github.com/arnabnandikgp/rivalt/pull/109). At `56e276b`, 152 adjusted cohorts retained fractional cash ownership. At `1db483c`, native protected settlement matched 70 admissible joint payouts and rejected 30. D127 is implemented at `8af1a7a`. A signed diagnostic chose the expected 8/7 and 7/8 outcomes in two episodes, rejected the asymmetric case and reconciled 34 receipts in SQL. [Validation](operations/validation.md#native-linked-market-recovery). |
| Former P57–P62 audit sequence | Retired before implementation | [D111](DECISIONS.md#d111--clearing-roadmap) records the scope decision. |
| Real linked BTC/ETH default comparison | Review | [PR #110](https://github.com/arnabnandikgp/rivalt/pull/110). Clean `7c299ca`; ordinary clearing paid 9,999 and 9,997 atoms through two SPL withdrawals. The BTC-only candidate refused both incomplete instructions. Independent native settlement reproduced the original and adjusted books; fresh SQL replay matched 104 and 75 events. [Validation](operations/validation.md#signed-two-market-default-comparison). |
| Clearing-verified joint recovery | Review | [PR #111](https://github.com/arnabnandikgp/rivalt/pull/111). At `a956981`, local SBF `0e027fc` charged 3 and 5 while preserving the 9,996/9,996 cash split. After the partial certificate refused a withdrawal, both makers withdrew their funded recoveries. 265 harness outcomes, 56 worker originals and 105 fresh SQL events. [Validation](operations/validation.md#clearing-verified-linked-default-and-wallet-exit). |
| Closed BTC creditor in a linked default | Review | [PR #112](https://github.com/arnabnandikgp/rivalt/pull/112). On ordinary SBF `33361d9` the trader withdrew 4,994 atoms. On candidate `30434d5` its withdrawal paid 4,996. The independent reference enumerated 84 plans. At `89ef133` the successor replayed 124 events after three wallet exits. A second eligible BTC maker kept the contested book frozen (284 harness outcomes and 96 SQL events). [Measured comparison](operations/validation.md#closed-btc-claim-in-a-two-market-default). |
| Competing BTC winners in a linked default | Review | [PR #113](https://github.com/arnabnandikgp/rivalt/pull/113). SBF `d0ae474`, signed harness `005230c`. Clearing certified BTC 4/9 and ETH 12 after rejecting 0/12. Four withdrawals paid 29,981 atoms. Eight accounts, 71 worker originals and 143 fresh SQL events reconciled. [Measured results](operations/validation.md#linked-allocation-across-competing-makers). |
| BTC winner with an ETH debt | Review | [PR #114](https://github.com/arnabnandikgp/rivalt/pull/114). Clean `bb67d1f` on two local validators. Ordinary clearing paid 39,972 atoms; the linked candidate refused both debtor substitutions and stayed frozen. Fresh SQL reproduced 113 and 84 events. Independent search checked 340 assignments; Rust rejected the BTC-only plan and verified the joint 9/33 proposal. [Measured results](operations/validation.md#btc-winner-with-an-eth-debt). |
| Foreign creditor protection through wallet exit | Review | [PR #115](https://github.com/arnabnandikgp/rivalt/pull/115). SBF `d177cc5`, clean signed harness `7f2b7e5`. Clearing rejected BTC-only, charged BTC/ETH 9/33 atomically and paid the two maker withdrawals of 5,004 and 34,968. All eight roots and 114 fresh PostgreSQL events reconciled. [Measured results](operations/validation.md#atomic-payment-for-a-btc-winner-with-eth-debt). |
| Shared BTC winning inventory | Review | [PR #116](https://github.com/arnabnandikgp/rivalt/pull/116). Clean signed harness `cfc2279`, ordinary SBF `33361d9`. Two withdrawals paid 40,000 atoms and 110 events replayed in fresh PostgreSQL. Native allocator `981d269` agreed with 324 assignments on the signed book and the independent oracle on 120 books of one to six debtors. [Results](operations/validation.md#two-btc-debtors-sharing-winning-inventory). |
| Verified two-debtor BTC payout | Review | [PR #117](https://github.com/arnabnandikgp/rivalt/pull/117). Local SBF `59184c5`, clean signed harness `672cff0`. The certificate used 56,805 CU and 835 bytes. Both makers withdrew 20,000 atoms. Three invalid proposals refused, 54 worker transactions finalized, 111 events reproduced in fresh PostgreSQL. [Measured results](operations/validation.md#two-btc-debtors-sharing-winning-inventory). |
| Scarce BTC winning inventory and zero-budget recovery | Review | [PR #118](https://github.com/arnabnandikgp/rivalt/pull/118). SBF `2256c51`, signed harnesses `f462fc6` and `f95fbc7`. The flat maker withdrew 19,996 against the ordinary 19,990. Zero eligible gain and zero rounded budget both resumed through actual payouts and fresh SQL replay. [Results](operations/validation.md#scarce-winning-inventory-and-flat-btc-claims). |
| Population-wide single-lot matching | Review | Clean `34882ca` on ordinary SBF `33361d9` paid three makers 20,000/20,001/20,002 after a real nine-account freeze. Native `870ea08` and independent enumeration select 20,001 each. 126 fresh SQL events, 432 native comparison books. [Evidence and limits](operations/validation.md#population-wide-matching-on-a-three-debtor-freeze). |
| Clearing-verified single-lot book | Review | SBF `d5cc624`, signed harness `3e8df69`. All three maker accounts withdrew 20,001 atoms. Verification used 40,457 CU and 803 bytes. 284 harness outcomes, 59 finalized worker originals and 127 fresh PostgreSQL events. [Qualification](operations/validation.md#clearing-verified-single-lot-book). |
| Resource limits for frozen inventory | Review | [PR #121](https://github.com/arnabnandikgp/rivalt/pull/121). SBF `eb011a5`, local harnesses `cd2d893` and `2c629e5`. The worker verified 22 dispersed positions in 92,494 CU and 162 dense positions in 364,122 CU. Fresh SQL reproduced 655 and 1,053 events. Three separate maker withdrawals paid 20,001 atoms each. [Measurements and wrapper limitation](operations/validation.md#active-positions-and-frozen-page-placement). |
| Multi-lot BTC recovery comparison | Review | [PR #122](https://github.com/arnabnandikgp/rivalt/pull/122). Signed harness `4faefa7` froze eight members and replayed 81 events. Four native boundary tests and 24 independent books passed. Compact proof `397fd01` selected the same 9-atom charge as complete search on the signed input. Clearing refused release. [Results](operations/validation.md#exact-multi-lot-btc-comparison). |
| Clearing-verified multi-lot BTC payouts | Review | [PR #123](https://github.com/arnabnandikgp/rivalt/pull/123). Clearing `baef259`, signed harness `f7e76c9`. A 46,606-CU certificate yielded maker withdrawals of 20,000 and 20,004 atoms. All eight members and 111 fresh SQL events reconciled. The tied comparison refused release and replayed 81 events. [Results](operations/validation.md#clearing-verified-multi-lot-recovery). |
| Successor paired-route measurements | Review | [PR #124](https://github.com/arnabnandikgp/rivalt/pull/124). Harness `12f9902`, clearing `baef259`. All 36 signed fills finalized. Distinct BTC makers shared two writable accounts. Distinct BTC/ETH makers shared zero. A fresh database reproduced all 148 events. [Measurements](operations/performance.md#paired-routes-on-the-recovery-candidate). |
| Native linked-market reduction admission | Review | [PR #125](https://github.com/arnabnandikgp/rivalt/pull/125). Revision `a64f834` checked 142 native proposals and input controls, and reproduced four retained signed freezes. The comparison verifies paired fills, whole-account collections, exact recoveries and individual protected payouts. [Results](operations/validation.md#native-linked-market-reduction-admission). |
| Market-wide insurance verification | Review | [PR #126](https://github.com/arnabnandikgp/rivalt/pull/126). All five required CI jobs passed at `2fc1f08`. Local clearing `5b1e964`. Harness `2e5907c` finalized 37 fee-paying trades and replayed 157 events. Harness `60c173a` spent exactly 12 BTC insurance atoms in default, finalized both maker withdrawals and replayed 113 events. Two BTC shared writes remain. [Qualification](operations/validation.md#aggregate-market-insurance). |
| Parallel market totals and backing comparison | Review | [PR #127](https://github.com/arnabnandikgp/rivalt/pull/127). Native `e1bb859` reproduced 39 signed gross totals and compared 28,812 near-cap admissions. The current funding base after expiry and the complete backing-payment check matched in the tested cases. Signed harness `c7b94a2` added three real fills and a 76-event fresh replay. D138 approves a bounded multi-account read for the next local SBF. [Qualification](operations/validation.md#native-market-capacity-comparison). |
| Bounded clearing read for market gross | Review | [PR #128](https://github.com/arnabnandikgp/rivalt/pull/128). Five required CI jobs passed at `589a3f8`. SBF `3ace707`. Signed harness `856c205` returned gross of 0/4/8/6 with a 76-event SQL replay. At `d9b36d4`, a funded receiver transfer and unwind ended at gross 90 and replayed 92 events. At `fffc5d9`, the partial default totals matched eight actual margin accounts, both wallets were paid and 113 events replayed. The same-market route still writes both market and ledger. [Qualification](operations/validation.md#signed-bounded-market-gross). |
| Funding consumed by a cross-market fill | Review | [PR #129](https://github.com/arnabnandikgp/rivalt/pull/129). Scope, shell, financial and client CI passed. Harness `3abe03e`, SBF `3ace707`. The BTC fill advanced ETH funding by 1,111,111 scaled units. A later ETH report retained it through a 31-second gap and a fresh database reproduced 70 events. Native fold `da46c8f` matched the signed values. [Qualification](operations/validation.md#cross-market-funding-after-a-publication-gap). |
| Clearing-verified funding checkpoints | Review | [PR #130](https://github.com/arnabnandikgp/rivalt/pull/130). All four required CI jobs passed; CodeRabbit finished. Clean harness `1637f8f` on SBF `2da3e90`. BTC maker and ETH market checkpoints preserved earned funding through a 31-second gap. Three invalid publications rolled back. 259 signed outcomes and 71 fresh PostgreSQL events. Both same-market writes remain. [Acceptance](operations/validation.md#clearing-verified-funding-checkpoints). |
| Read-only selected market on immediate fills | Review | [PR #131](https://github.com/arnabnandikgp/rivalt/pull/131). SBF `10ab3b5`, harness `d45eae7`. All 36 paired fills finalized. Distinct BTC makers shared only the ledger. The wallet exit and complete insurance capture at freeze passed. A separate nonzero-premium trade preserved the BTC index through a 31-second gap. The paired run replayed 228 events. At `aa0a209` a two-maker reversal charged exactly 24 atoms and reproduced 111 events across the funding and reversal run. [Validation](operations/validation.md#read-only-market-on-a-signed-fill). |
| Parallel ledger and backed payout | Review | [PR #132](https://github.com/arnabnandikgp/rivalt/pull/132), five hosted CI jobs passed. Clean SBF `8bc01bb`, signed harnesses `2697472` and `733490d`. All 36 paired fills finalized. Different BTC makers share zero writable accounts. The eight-member proof paid the trader's 970-atom net profit to their wallet. The paired, payout and funding checks replayed 231, 315 and 113 events. One trailing shell print failed after the paired verifier completed. [Evidence and limitations](operations/validation.md#profit-payment-and-parallel-ledger-reads). |
| Linked BTC/ETH default plan selection | Review | [PR #133](https://github.com/arnabnandikgp/rivalt/pull/133), three applicable hosted jobs passed. Native `c41b5b7` matched independent rational settlement on 19 cases and three retained signed freezes. The largest of those three comparisons had 2,548 possible charge vectors and reached 14 individual schedules with range bounds. Signed general release remains open. [Evidence](operations/validation.md#native-selection-of-linked-default-plans). |
| Restartable verification of competing BTC/ETH charges | Review | [PR #134](https://github.com/arnabnandikgp/rivalt/pull/134), four applicable hosted checks passed. Probe `4c9ccbc` verified the eight individual payouts from a real clearing freeze across a client restart. Another schedule recovered the same 25 atoms and failed the sharing rule. 27 signed probe outcomes, 96 fresh PostgreSQL clearing events. [Measurements and scope](operations/validation.md#restartable-comparison-on-a-clearing-freeze). |
| Cross-creditor recovery verification | Review | [PR #135](https://github.com/arnabnandikgp/rivalt/pull/135), four applicable hosted checks passed. Signed diagnostic `ec12a834` verified the unique BTC 9 / ETH 33 schedule over 340 alternatives, rejected the inferior 9/32 proposal and reproduced all eight funded balances. The winning proof took 28 successful transactions. The existing clearing certificate paid both maker exits and 114 events replayed in fresh PostgreSQL. [Scope and costs](operations/validation.md#recovery-verification-when-a-btc-winner-owes-eth). |
| Financial priorities on equal recovery | Review | [PR #136](https://github.com/arnabnandikgp/rivalt/pull/136). Client, financial, scope and CodeRabbit checks passed. Signed `15eb161d` selected 4/9 from 14 equally effective recoveries. On equal gains, `78b24496` chose 7/6 by frozen member order and rejected the reversed split. Each book covered 2,548 schedules, used 67 successful transactions for the winner and replayed 96 clearing events. All eight cash balances, both market movements per member and retained reserves matched in the equal-gain case. [Measured results](operations/validation.md#financial-priorities-on-a-signed-frozen-book). |
| Clearing adoption of verified joint recovery | Review | [PR #137](https://github.com/arnabnandikgp/rivalt/pull/137). Local SBF `efbaa024`. Cross-creditor `f46b6032` paid both maker exits and replayed 114 events; the outer shell reported a trailing parse error after the financial harness. Equal-gain `d2a16818` bound 7/6 BTC and 12 ETH, refused a premature withdrawal, paid all four wallet exits and replayed 128 events. Both isolated Anchor clients matched all eight new instructions. Next qualify parallel fills and joint recovery on one fresh artifact. [Results](operations/validation.md#clearing-owned-joint-recovery). |
| Integrated parallel fills and joint recovery | Review | [PR #138](https://github.com/arnabnandikgp/rivalt/pull/138), stacked above #137. Combined local SBF `5d7a7c0f`. All 36 paired fills finalized, and the eight-member default paid both wallets 39,972 atoms in total. Harness `51123ea6` preserved funding through a 30-second gap and paid 970 net atoms on an ordinary close. Harness `3c476d16` restored maintenance through a maker and a funded receiver. Fresh PostgreSQL replays matched 231, 142, 113, 315 and 136 events respectively across the five cases. Next review this combined local candidate on the open stack before considering runtime promotion. [Qualification and limits](operations/validation.md#combined-clearing-lifecycle). |
| P50 architecture constraint audit | Closed | [PR #71](https://github.com/arnabnandikgp/rivalt/pull/71) merged; source/provenance inspection of `2a77c24`; [findings](operations/constraints.md) now mapped into the requested remediation plan |
| P48 exact interval allocation | Closed | [PR #68](https://github.com/arnabnandikgp/rivalt/pull/68) merged; clean `5e5aede`: 715 independent cases, 23 affected SDK/service checks, 130 signed RPC/WS outcomes; old limits retained at its revision |
| P49 expanded quantities | Closed | [PR #69](https://github.com/arnabnandikgp/rivalt/pull/69) merged; SBF `49c343e`, verifier `125a2b3`: 231 signed outcomes, 188-event PostgreSQL replay and 146 matched full-book outcomes; review fix `d63e3b1` accepted |
| M13 Anchor RC2 migration | Closed | P45–P47 accepted and integrated as #63 → #64 → #66; qualified C0, review fixes and applicable hosted checks pass |
| P45 migration contract | Closed | [PR #63](https://github.com/arnabnandikgp/rivalt/pull/63) merged; accepted architecture/release research, exact pins, ABI and acceptance contract |
| P46 RC2 implementation | Closed | [PR #64](https://github.com/arnabnandikgp/rivalt/pull/64) merged; serialized C0 and scoped signed RPC/WS/PostgreSQL acceptance pass |
| P47 post-migration qualification | Closed | [PR #66](https://github.com/arnabnandikgp/rivalt/pull/66) merged; full C0 matrix, B/C report, normal demo, artifact review fixes and applicable CI pass |
| M12 performance and contention | Closed | P39–P44 accepted and integrated; measured pre-migration baseline frozen; no framework migration |
| P39 dependency audit/baseline | Closed | [PR #55](https://github.com/arnabnandikgp/rivalt/pull/55) merged; focused RPC/WS baseline and 61-entrypoint inventory |
| P40 scoped events/services | Closed | A and B acceptance passed and integrated |
| P40A bounded service execution | Closed | [PR #56](https://github.com/arnabnandikgp/rivalt/pull/56) merged; scoped RPC/WS/PG fault and fresh replay acceptance |
| P40B scoped event history | Closed | [PR #58](https://github.com/arnabnandikgp/rivalt/pull/58) merged; authenticated scoped history and exact financial acceptance |
| P41 relevant market dependencies | Closed | [PR #59](https://github.com/arnabnandikgp/rivalt/pull/59) merged; accepted clean `ca8bab0` / SBF `b0c5675` |
| P42 custody/accounting isolation | Closed | [PR #60](https://github.com/arnabnandikgp/rivalt/pull/60) merged; D87 schema-7 financial/lock/settlement/gateway/default and SQL replay acceptance |
| P43 targeted CU optimization | Closed | [PR #61](https://github.com/arnabnandikgp/rivalt/pull/61) merged; matched CU comparison, 147/165 full-book and 290 safety outcomes on SBF `fb5d0c5` |
| P44 frozen pre-v2 qualification | Closed | [PR #62](https://github.com/arnabnandikgp/rivalt/pull/62) merged; 61-entrypoint baseline, integrated recovery/replay, measured cost/load envelope and admission-crash review fix |
| M11 consolidation | Closed | P35–P38 accepted and integrated; merged tree equals accepted stack tip |
| P35 component docs/handoff | Closed | [PR #50](https://github.com/arnabnandikgp/rivalt/pull/50) merged; component contracts, maintenance AGENTS and provenance |
| P36 canonical names/ABI | Closed | [PR #51](https://github.com/arnabnandikgp/rivalt/pull/51) merged; canonical API names, preserved wire contract and passing CI |
| P37 legacy retirement/runtime | Closed | [PR #53](https://github.com/arnabnandikgp/rivalt/pull/53) merged; consolidated runtime and fresh integrated acceptance |
| P38 professional root README | Closed | [PR #54](https://github.com/arnabnandikgp/rivalt/pull/54) merged; professional entrypoint and scoped docs acceptance |
| P15B independent maker validation | Open — external | Actual independent operator/economics; internal bots and assumed hedges cannot substitute |
| P16B independent review/funded readiness | Open — external | Independent review, risk/reserve calibration and separate funded authorization |
| Continuous 24-hour endurance | Deferred | No run scheduled or completion claimed |

Review means accepted work awaiting integration. Closed requires acceptance plus
integration. The user authorized the earlier #68–#71 stack's review fixes and merge on
10 November 2026; all three PRs independently report MERGED, and the open-PR query
at that closeout returned none. The fetched merge has the accepted tip's exact tree.
The 18 November scope decision supersedes the 10 November audit delivery sequence.
P56 has recorded local acceptance in PR #85. Closed-first is the approved
successor payment rule. The qualified local program uses proportional terminal
settlement. D114 binds successor loss eligibility at the first verified on-chain
freeze that commits for the episode. The [cutoff results](clearing/architecture-review.md#when-default-eligibility-becomes-binding)
quantify the tradeoff for late proofs and temporary insolvency. Clearing accepted
the named-debtor proof against already-published feeds. D116 selects maximum
recovery and proportional charges among eligible winners.
The risk engine and shared position accounting now have separate crate owners.
D117 fixes the debtor’s original cash allocation and protects foreign payouts
and insurance. The new comparison reproduces an individual creditor loss with
unchanged ETH totals. D118 approves protected rounding as the successor default. At `1f3ce81`,
the eight individual-payout and nine cross-market tests pass with that default.
The joint comparison now reproduces 8/8 flat-creditor payouts under independent
market admission and 9/9 for a complete package. D119 approves joint admission
with verified finality across both markets. At `91ae07e`, eleven joint tests pass with the D120 default, including an equal-total tie.
D120 prioritizes total verified recovery and uses the lower market recovery
percentage to break ties. D121 fixes identity priority. A sufficient score proof
works on a 121-member family, and a smaller book demonstrates a loose bound.
The small-cohort reference now verifies a submitted joint result across restarts.
D122 requires exact verification for prototype release. The native and signed nine-account fixture now verifies all ten partitions in
22,718 CU. Two matched histories now reproduce different creditor payouts from the same
aggregate frozen rows. An exact current-state checkpoint and a replayable
commitment agree on the inputs. The signed growth boundary required 40,640
additional rent lamports and 2,808 CU. D123 selects per-account capacity with
optional sponsorship. Compulsory recovery headroom remains an acceptance gate.
The ordinary payout demonstration now follows a profitable cross-maker close to
the trader's SPL wallet with a local test fee payer. Under D124 the local maker liquidation candidate now
reaches a healthy target through admitted depth and a separately funded receiver.
The single-debtor BTC comparison now measures the 149-atom difference between
the trader's signed proportional payout and the successor model on identical
frozen obligations. On the separate attribution build those obligations now carry
clearing-owned exact per-lot entry and paid profit. The 128-byte per-market
allocation rejected a 129-lot test order. The separately tested growth path admitted the same 129 lots
and refunded actual contributor principal. The first signed successor reduction
paid the flat trader 996 on the matched default. The residual candidate now
pays through the same withdrawal path for insufficient and zero eligible gain.
The multi-winner candidate also paid a wallet after dividing the BTC loss
among eligible accounts. Native joint settlement preserves each foreign creditor’s
fractional and whole-atom protection. D127 resolves exact market reflections
using the frozen member order. Two genuine clearing freezes now bind the
reference inputs. The ordinary program paid both makers and the BTC-only
candidate kept the linked case frozen. The separate linked clearing build now
verifies both schedules, resumes between legs and pays both makers. The additional
closed BTC creditor subsequently withdrew 4,996 atoms versus the ordinary 4,994.
The competing makers' signed charges now reconcile to the independent
4/9/12 allocation and the trader's full 4,996-atom withdrawal.
Three further signed trades produced a cross winner whose BTC claim backs an
ETH creditor. Ordinary clearing paid both makers. Native comparison showed
that the BTC-only and joint plans pay identical whole cash, but only the
joint plan respects the ETH creditor's entitlement. The linked candidate
refused the book on chain. The separate foreign-creditor program has now paid
both makers after verifying the direct charges and creditor floors in one
54,281-CU instruction. With two BTC debtors competing for one-lot winners, the
separate shared-inventory verifier now pays both makers after restart. The
partial-capacity build also pays when an opposing gain is exhausted or one
debtor’s after-insurance budget falls below one atom. The population-wide native matcher now
selects three distinct pairs on a signed freeze. Clearing now verifies those pairs and all three maker accounts withdrew their predicted credits. The larger book measurements now verify 22 dispersed and 162 dense active positions. The exact native multi-lot verifier and a compact proof agree on the eight-member freeze. Clearing now certifies the sharp multi-lot case through wallet withdrawal and keeps the non-unique cutoff frozen. The matched signed routes identified the BTC market and ledger as the shared writes across distinct BTC makers. Two equal fees can yield different insurance credits through the market carry. The native verifier now derives the whole proposed BTC/ETH schedule and protected payouts from frozen member histories. Optimal selection for general linked books remains open. The market-wide fee prototype verified and spent earned insurance in a signed default. Native comparison matched the market cap under competing near-limit fills, held-funding expiry and cross-market backing at the payment boundary. D138 approves a bounded multi-account read. The signed read now matches the three maker lanes through a two-maker order, a receiver transfer and partial default settlement. The signed BTC cross fill advanced the ETH funding index by 1,111,111 scaled units, which the next ETH publication retained. On `2da3e90` clearing verified both markets’ funding checkpoints through the gap. The read-only market route now removes one of two shared BTC writes. The local ledger prototype now removes the final shared write for independent single-market routes. Clearing checks the complete current backing on payment. Native complete and bounded comparisons now agree on three retained freezes. A signed diagnostic now proves the competing allocation for one whole-atom cross debtor with independent creditors. The general eight-member verifier now certifies a unique highest total on a cross-creditor freeze after a fresh-client restart. Signed tied books now exercise proportional sharing and the frozen-episode member order. Clearing now binds terminal cash and market movements and checks them through wallet exit on the eight-member combined profile. The same binary now preserves nonzero funding, pays a fully backed ordinary gain and restores maintenance through a funded receiver. Larger recovery books remain open.
General selection and production release remain open.

## Earlier checkpoints

The following dated records describe the evidence and PR state at the time of each run. The table above gives current integration status.

The 16 November architecture review inspected source at
`07822f49dc9785989897f69d5361ea90717fdc11`, Flint draft 0.8 and Percolator
`5e3af0710ec7e9b7077393012f8a94a31b2f07ef` (spec v16.9.1), plus primary
Phoenix/GMX mechanism documentation. It distinguishes existing code, research
claims and proposals, including the user's requested functional module/crate
boundaries. The user's 17 November clarification supersedes the earlier acceptance
interpretation; no successor economic/ADL policy is treated as approved. The
17 November six-venue follow-up distinguishes public mechanism descriptions from
unverified reserve/terminal-failure details and adds targeted academic context.
It changes the recommendation, not current financial behavior. Documentation base
revision: `324e5e3`; the research-only diff passes 114 local links/anchors across
five changed Markdown files, whitespace and tracked-evidence policy checks. No
runtime tests are needed for this change.
Follow-up source inspection through `a45ef43` clarifies that a close atomically commits
position/claim changes, while funded claim payment is separately gated by cash
and backing. The review records the exact code paths and recommends comparing
normal close-and-pay with explicit distressed resolution, keeping active backstop
capital separate from insurance. No combined transaction or new economic policy
has been implemented or qualified. Open-position loss collection is already
supported and selected by the settlement worker: maker closure is not required.
The recommendation prioritizes timely collection/payment before considering a
separate advance facility, whose ownership and loss rules would need a new contract.
Follow-up documentation checks pass for 57 local links/anchors in two changed
files and whitespace; no runtime suite was run for this explanation.
The roadmap consolidation on planning base `e792b3c` passes 74 local link/anchor
checks across three files, whitespace and the evidence policy. Its two examples
are hand calculations. Executable model and runtime qualification are pending.
Validation for these documentation changes is limited to source/link and
whitespace checks; no build, financial suite, external implementation tests or new
performance run is claimed. P15B/P16B stay Open and 24-hour endurance stays Deferred.

## Remediation planning

P51A uses integrated baseline `e9eb320f65ca62f4bffefe9f1cd73a6f9feb4f1a` and D92.
One [roadmap](operations/remediation-plan.md) owns the human overview and detailed
agent acceptance rather than adding a document per phase. It covers scalable
membership/default/backing, indexer progress, price policy, maker admission,
economic and funding-index calibration, operator costs/scheduling, user capacity
and confirmed vestiges. P51B's executable design decides the detailed settlement
mechanism; the roadmap does not assume paging solves exact arithmetic or approve
different payouts. Later changes remain subject to their stated decision gates.

P51A changed only documentation. Validation at clean
`4025168cb3d4bfcc4e3ee0e7e0d42cc6415892b0` passes for six
changed Markdown files, 129 local links/anchors, all
25 phase headings and ordered dependencies, all 20 findings, six decision gates,
whitespace and the tracked-evidence policy. No runtime suite was needed.
P15B/P16B remain Open and 24-hour endurance Deferred. No access blocker is known.
P51A is published ready as #72 and remains open. Its later handoff update adds
only publication metadata; P51B's newly authorized work is distinguished below.

## Account-scale feasibility

P51B branches from accepted planning tip `0e864d98dc1243e83ee4af113048f9021980fe2b`.
D93 and the existing component documents record the code-to-design matrix,
identity/financial-membership boundaries, versioned layout targets, authority,
retirement, frozen recovery, migration and G1–G3 recommendations. Schema 8 remains
the actual program; no account cap, economic rule, artifact or IDL changed.

Clean **`a5ac218d6e439be74fc136bed67c2d5b9e733a41`** passes six focused tests:
254 cohorts match the independent branch oracle and 1,016 actual retained Rust
rate/mutation/atom/continuation cases. Exact interval composition, reduced LCM and
compact conserving rounding preserve current atom owners. All 16 compact native
scale diagnostics finish, including four 10,000-row shapes; the dense baseline
explicitly stops three at its work/storage budgets. The hardest compact shapes
take about 24–25 seconds in Python, not SBF CU or landed recovery time.
The maintained-backing model completes a 256-row scan under mutations with 1,536
independently enumerated price/funding-corner comparisons. Shell, Python compilation,
links, whitespace and evidence-policy checks pass. The new suites join financial
CI; no larger-runtime acceptance is claimed. Full details and limitations
are in [validation](operations/validation.md#account-scale-native-feasibility-p51b).

P51B is published ready as #73 above #72 in stack #74; both remain open.
This is contract/native acceptance only, not larger-account runtime qualification.
Hosted [run 42872021846](https://github.com/arnabnandikgp/rivalt/actions/runs/42872021846)
completed successfully on exact published tip `b7d7686`: scope, financial and shell
pass; client/report are skipped. CodeRabbit is skipped, so no external review is
claimed. This later hosted result is separate from the clean native measurements.
No access blocker is known. P54/P55 still own compiled paging, complete mutation
coverage, worst-case storage provisioning and bounded continuation costs; P56B alone
can enable expanded local trading after actual RPC/WS/PostgreSQL qualification.
P15B/P16B remain Open, 24-hour endurance Deferred, and no external/funded action
has been performed.

P52 starts above verified #73 tip `b7d768696547c688e4d1de30f2f5c3c78d14092f`.
The implementation now commits one complete block at a time, applies the block
range/work budgets, separates covered/published snapshots and caps API events at
the reconciled cursor. D94 corrects the initial capture proposal: publication needs
one common historical revision vector and complete matching financial fields;
forward-overwriting an older candidate is insufficient proof. SQL format 3 requires
a fresh journal, preserving earlier databases/originals. Program artifacts and
account schema 8 remain unchanged.

Clean **`fe1c754e985b56e653b03795af8daf2b8ca59e62`** passes full signed
Surfpool/RPC/WS/PostgreSQL qualification: 10,642 transactions / 4,306 invocations
at backlog reconciliation, all three real SIGKILL boundaries, WS reconnect,
identical-original recovery during indexing lag, rejected-history/publication/
format checks, three advancing publications during 74 continuous delegate updates
and identical complete state / 4,353-event fresh replay. Seventy entities/eight
margin roots and 8,000,000 actual/allocated collateral atoms reconcile. The full
run lasts 306.954 seconds. Program artifacts and account schema remain unchanged.
[Validation](operations/validation.md#bounded-progress-indexer-p52) records actual
resource observations, exact commands and limitations; this is not larger-account,
production-throughput or endurance acceptance.

The same runtime code at clean `32988bb` passes typecheck, 44 scoped tests and the
small live diagnostic. The later caller adjustment makes demo startup wait for
published readiness, not merely a completed recovery cycle; typecheck and 11
existing demo transport checks pass after this entrypoint-only adjustment. These
checks do not execute browser startup; no new browser run is inferred. D94's fixed
witness solves the observed local RPC account/context skew while retaining full
financial comparisons, canonical finalized history and ten-second freshness.

Full and diagnostic evidence remain at their original ignored paths under
`.local/indexer-progress/`. Failed attempts remain retained; none substitute for
the accepted full run. The owned qualification runtime stopped successfully.
[PR #75](https://github.com/arnabnandikgp/rivalt/pull/75) contains acceptance
closeout `1eb86ff` above #73. All applicable hosted checks (scope/client/shell) pass at `c6913b2` in
[run 42970638033](https://github.com/arnabnandikgp/rivalt/actions/runs/42970638033);
report/financial are correctly skipped. Automated CodeRabbit check also reports
success; this is not independent financial review. No access blocker is known.
P15B/P16B remain Open and 24-hour endurance Deferred.

## Price-policy consolidation

P53 is split into P53A consolidation and P53B calibrated-range acceptance (D95).
P53A names the existing numeric/economic price domains and generates SDK constants
from Rust. Source normalization, order/trigger checks, maker/routing execution bands,
funding, liquidation and UI preserve their current values. No new risk range,
account layout, live parameter authority or deployment is enabled.

Clean SBF `2136106` and actual signed verifiers `55426dc`/`e98b0eb` pass scoped
acceptance: 99 publisher outcomes (12 reports), 120 financial/journal outcomes,
exact published fresh state and all 72 retained event bytes. Seventy entities/eight
roots and 8,000,000 allocated/actual vault atoms reconcile; independent fee checks
pass. Only qualification clearing changes (+896 bytes); makers/defaults/fixtures
are byte-identical to P49. P53A artifacts remain retained; P53B supersedes the local selection below.
Owned runtimes are stopped.

Typecheck, 59 SDK/UI, 22 financial-core and 29 clearing-engine native checks pass,
with generation/ABI/document/shell/evidence checks. No broad local regression,
browser, larger-account or endurance run is inferred. The first projection-only
journal pass and the subsequent host-sleep timeout remain retained. The final
probe requires fresh published readiness and exact event bytes, with unchanged
freshness/deadlines and a temporary supervisor-owned idle-sleep inhibitor.
[Validation](operations/validation.md#shared-unchanged-price-policy-p53a) records
exact pins, results and limitations. [PR #76](https://github.com/arnabnandikgp/rivalt/pull/76)
contains acceptance closeout `a24251e`; all five scoped hosted jobs pass at
`b6fbcb8` in [run 42977315184](https://github.com/arnabnandikgp/rivalt/actions/runs/42977315184).
CodeRabbit is neutral, not external approval. P53A is not integrated.

P53B's [numeric-bound policy](clearing/risk-and-resolution.md#approved-p53b-calibration)
was explicitly approved on 11 November: reference/trigger 2–909,090 and order
limit 1–1,000,000 atoms/lot. Raw assets are positive/checked and the entire risk
interval must fit; source safeguards and the arithmetic/economic boundaries stay
unchanged. P58A's canonical depth search is brought forward without changing impact
notional or adding maker financial admission. Its public helper now accepts canonical
curve records rather than arbitrary quote callbacks; full snapshot authentication
remains the report builder's responsibility.

Clean SBF **`afeb7eae419bc66cf1c902932fea79a994fa4dc1`** builds safely; clearing is
1,538,848 bytes (+64 vs P53A), every other binary unchanged. Clean publisher
**`10cadb7`** passes 137 outcomes / 21 reports, including Q=3m and source faults.
Clean **`82d2c6a`** passes 228 boundary/journal and 290 safety outcomes. Actual BTC/ETH
edge trades, stored limits/triggers, stale-source deposits/cancels/exits, whole-account
reservations, TP/SL, liquidation, complete default and recovery pass. Fresh published
PostgreSQL replay matches all **176 event bytes** and the complete financial state;
8,000,000 actual/allocated atoms reconcile, with independent aggregate fees **848**.
The default audit verifies eight Fraction payouts and rejects ten corruptions.

Scoped checks: 23 financial-core, 29 clearing-engine, 52 client/UI cases including
1,536 independent funding allocations; generation, exact ABI and typecheck pass.
At clean `afeb7ea`, 1,800 CPU measurements peak at 329 distinct quotes,
p95 0.394 ms / p99 0.535 ms. Publisher max is 21,035 CU, three-million-lot sample
21,007 CU; boundary route max 160,356 CU. These are bounded measurements, not full-book,
worst-case latency or production-throughput claims. [Validation](operations/validation.md#numeric-bound-price-policy-p53b)
records pins, commands, limitations and the first Clock-wait harness failure.

The accepted candidate is selected locally, with prior artifacts/failed runs retained
under existing ignored paths. All owned runtimes stopped. No external/funded action,
new browser or endurance run is claimed. P53B is published as [PR #77](https://github.com/arnabnandikgp/rivalt/pull/77)
above #76 in stack #74; all five PRs remain open. Scope/client/financial hosted checks pass at `c7fdfb9`
in [run 43009090127](https://github.com/arnabnandikgp/rivalt/actions/runs/43009090127);
report/shell are correctly skipped. CodeRabbit was still running at inspection.
P54A follows on the unchanged numeric proof. P15B/P16B remain
Open, endurance Deferred, and P58's other economic decision gates remain separate.

## Scalable settlement implementation

P54A starts on `implementation/p54a-scalable-settlement` above ready #77 tip
`c7fdfb9`. D96 and the risk contract specify the bounded logical-register cursor.
The pinned platform-tools compiler reports `target_arch="sbf"`, so the initial
`bpf`-architecture exclusion was insufficient. The follow-up guard uses the actual
`target_os="solana"`, with a targeted host cfg declaration. Host checking and actual
SBF-target metadata probes pass: the word cursor remains available and all four
native orchestration modules are absent. This is a compiler-boundary correction,
not a program build/deployment or changed financial result. Clean guard pin
**`7aef54f1d6908f9cef0e9186a386ddb79341793b`** also passes the 774 settlement,
307 rejection and 980 division checks again. The larger native measurements below
remain at their original pin. Scope/financial/shell CI also pass at `6b8392e` in
[run 43023501187](https://github.com/arnabnandikgp/rivalt/actions/runs/43023501187);
client/report correctly skip.

The complete native kernel now checks count-derived aggregate conservation, exact
rate/greatestness equations, all insurance-clipping evaluations and deterministic
conserving rounding. Hierarchical active arcs and generation marks replace fixed
graphs and resets; normalized atom division avoids repeated whole-width searches.
Cash, market writeoffs/impairment, insurance and retained fees stay explicit.
Clean **`60c2141eb2a7af30bc8a6d99dd752167549c3263`** passes native acceptance: 774 complete
settlements across 258 independent cohorts and 1/7/128-step budgets, 307 rejected
requests, 980 exact division cases and three aggregate/product boundary vectors.
The earlier 2,105 arithmetic/LCM/collection comparisons pass again. The active
hierarchy passes 80,000 independent ordered-set update/search pairs. All 16 scale
cases finish across 64/128/1,024/10,000 rows, with exact cash and atom-owner equality.
Scoped format, documentation, Python/shell and evidence checks pass.
[Validation](operations/validation.md#scalable-native-settlement-p54a) records actual
commands, populations, CPU/work/storage observations and limitations.

No program handler, account layout, selected artifact or account-count activation
changes. Native vector orchestration is excluded from SBF. The hardest 10,000-row
case takes 7.917139 native seconds but uses 2.67 billion arithmetic word steps;
completion does not establish affordable on-chain resolution. P54B/P54C must measure
authenticated continuations and total cost before expanded activation. No SBF,
RPC/WS/PostgreSQL, browser or external qualification is inferred. P15B/P16B remain
Open and 24-hour endurance Deferred. No access blocker is known.
[PR #78](https://github.com/arnabnandikgp/rivalt/pull/78) contains cohesive P54A
acceptance above #77 in stack #74. Scope/financial/shell CI pass at `023574b` in
[run 43019766671](https://github.com/arnabnandikgp/rivalt/actions/runs/43019766671);
client/report correctly skip. Automated review is still pending; no external review
is claimed. Next exact action: implement P54B's authenticated frozen input and rate
work on its child branch, leaving the stack open.

P54B's first hosted run at `4cd75ab` failed report/client/default-build checks:
its new ABI additions were missing from one test entrypoint and the generated lock
inventory, and positive preparation fixtures incorrectly expected success in the
disabled-default build. Financial arithmetic passed. The focused corrections pass
on clean **`9a223a3`**: 13 ABI tests (including six rejected extension mutations), exact 77-entry
inventory, five qualified settlement tests and two default tests. No runtime source
or artifact changes. All five hosted jobs (scope/report/client/financial/shell)
pass at **`d2f7810`** in [run 43058428703](https://github.com/arnabnandikgp/rivalt/actions/runs/43058428703). P54C's
in-progress per-root flow/order work is preserved on its child branch; it is not
accepted financial application. No user decision/access blocker is known.

P54B is published ready as [PR #79](https://github.com/arnabnandikgp/rivalt/pull/79),
above #78 / exact parent `6b8392e` in stack #74. It remains open. D97/D98 implement complete
source-bound valuation, denominator construction, uploaded rate verification,
original-budget insurance clipping and permissionless stalled-attempt recovery.
Six new schema-9 record types and 16 new entrypoints leave existing financial
accounts read-only. Current schema-8 admission, normal artifacts and default/devnet
gates remain unchanged; this is not larger-population activation or Apply.

Clean verifier **`22736dc5f870413029394106e5545ff64d6f0dc9`** on clean SBF
**`89b6129404ca7914bf5a8ba588079f798e6e4445`** passes **479 actual signed RPC/WS
outcomes**, including 27 intentional atomic transaction rejections. All 16 new
entrypoints execute; eight actual frozen roots match independent cash/claim totals,
156 rate continuations complete two insurance evaluations and 16 independent row
prefixes. Both markets clip fractional planned insurance once, then pass a final
integral evaluation. Stale epochs, reordered/duplicated/foreign pages, malformed
uploads, replay, wrong equations and both stalled Upload/Verify recoveries pass.
Every financial account stays byte-identical. Both Anchor conformance clients
match 461 clearing instruction encodings/metas, 44 new accounts and 503 events.

Maximum successful new-transaction usage is **100,058 CU / 818 bytes** in this
fixture. Verification storage locks **346,603,320 test lamports**; the measured
verification segment uses 363 transactions and 1,835,000 fee lamports. This is a
small-cohort cost observation, not G1 affordability or production performance.
The linked SBF is 1,947,576 bytes with no stack diagnostics; calls request no heap
increase. Exact peak heap/stack usage is not instrumented. Owned Surfpool is stopped.
Native foundational pins, independent vectors, exact resource table, reproduction
and the retained initial failure are in
[validation](operations/validation.md#authenticated-frozen-and-rate-verification-p54b).

Nine focused scoped-history tests cover the corrected kind-22 registration;
generated SDK/typecheck and literal extension preserve D90. No PostgreSQL replay,
wallet/browser, payout, larger-population, endurance, devnet or external acceptance
is claimed here. No access blocker is known. P15B/P16B remain Open and endurance
Deferred. Hosted checks pass as recorded above; independent external review is
not inferred. P54C's successor acceptance is recorded below; all PRs remain open.

## Integrated quantity work

The user authorized removing both inherited quantity ceilings on 10 November.
P48 changes only search/client behavior and preserves program limits and artifacts.
Clean `5e5aede846c27bb1c352aa06c14a25ccfc6fe06c` passes 715 independently enumerated
financial/price cases (264 allocated, 379 unavailable, 72 rejected), 23 affected
SDK/service checks, typecheck and 130 signed Surfpool RPC/WS outcomes against the
unchanged qualified C0 programs. Full-book four-scenario search benchmark: 1,000
iterations, p95 0.302 ms / p99 0.355 ms on this Apple M3; at most 151 distinct
quantity quotes and one full candidate/trader admission. This is a bounded fixture
measurement, not worst-case latency. Local evidence is `.local/quantity/p48-5e5aede*`.
No new SBF, PG replay or larger quantity is qualified by P48. P49 owns those checks.
P49 removes both inherited ceilings within the existing **100,000,000-lot**
financial domain. Programs, SDK/API/UI, order reservations and liquidation agree;
signed order fee input uses the existing cash domain, and worker size probes start
at remaining quantity. Two makers, eight regions, position/gross/cash bounds,
2 bps fees, insurance, funding and all risk checks remain enforced.

Clean SBF **`49c343e6e77a327fc9fa00c5b2a2e172dceb380d`** has safe stack frames and
fresh generated IDLs identical to the existing contract. Clean verifier
**`125a2b3eafaa4413a31ba82a4dfcf183258f9f79`** passes **231 signed RPC/WS outcomes**:
100m-lot open/close, million-lot SDK routing and two-program stored partials,
large TP/SL, reservations/transfer/withdrawal, whole-account funding, 500k-lot
liquidation and complete default. Independent raw-byte audits check nine fills,
eight exact Fraction payouts and mutation rejection. The fresh PostgreSQL replay
matches all **188 events**. A separate **146-outcome** matched full-book probe
measures 305,112 CU, versus P47's 305,080; the 100m singleton uses 166,449 CU.
[Validation](operations/validation.md#expanded-quantities-p49) records checks and
[performance](operations/performance.md#expanded-quantity-measurements-p49) records
resource assumptions. Raw evidence remains `.local/quantity/p49-*`.

Thirty-one affected native checks, 62 SDK/UI/service checks, 3,172 independent Rust
quote vectors, 715 independent router cases and 27 curve-contract cases pass.
The new artifact identity is pinned and promoted to `.local/anchor-rc2/current`;
prior C0 files/journals remain retained. No account/IDL layout changed. Both owned
Surfpool runs and their test PostgreSQL container are stopped. Compiler tools were
restored; there is no access blocker. P48's applicable hosted CI passed on #68;
P49 is merged as [PR #69](https://github.com/arnabnandikgp/rivalt/pull/69).
Scope/client/financial/shell hosted checks pass on review fix `d63e3b1` in
[run 42850851592](https://github.com/arnabnandikgp/rivalt/actions/runs/42850851592);
report is correctly skipped. The P49 review identified two valid
interface-documentation corrections and unnecessary source-unavailable order
probes. The worker now stops that order's current pass after a missing-source
result; smaller expiry/depth/health/search-budget probes remain eligible because
allocation can change. Seventeen focused worker/route tests and typecheck pass
on review fix `d63e3b1`.
These are consumer/control-flow checks, not new signed integration evidence;
programs, financial admission and durable-original handling are unchanged.
Pending acceptance detail was removed from HISTORY and replaced with the verified
integration. P48's publication-status finding is corrected here. All three inline
review threads were resolved before the atomic merge. The expiry-shortcut portion
of a review suggestion was rejected with the allocation-dependent counterexample.
The latest P49 automated re-review was still running at merge; no completed
re-review is inferred. No new runtime integration or unrelated local suite was
needed for the early-stop/docs correction; exact earlier evidence stays pinned.
P15B/P16B and deferred endurance are unchanged; no public/funded deployment is
qualified.

## Architecture constraint review

The user requested a detailed audit of inherited prototype assumptions after the
quantity work. P50 inspects current source and targeted local Git provenance at
`2a77c2419a6b80acf452a8604ba0fe904d3f35ff`; it changes documentation only. Findings
cover lifetime membership/complete-default capacity, price bands, funding impact
size, liquidation compensation, indexer progress, maker admission, numeric/OI and
funding lifetime bounds, account/order capacity, client fees and worker scheduling.
Confirmed vestiges include an unused pagination option and reference-only Rust
funding enumeration. The [audit](operations/constraints.md) separates source facts,
constructed examples, proposed remedies and protected deliberate scope.

Validation: source/call-site searches, historical decision checks, exact unit
arithmetic and document/path checks. No new financial test, runtime benchmark,
security certification or production readiness is inferred. There is no blocker.
P50 is merged as [PR #71](https://github.com/arnabnandikgp/rivalt/pull/71).
Its documentation-only delta is outside the hosted code-workflow paths; no P50
hosted code test is claimed. Its automated
review was rate-limited; this is not independent approval. The user deferred audit
remediation, including the 64-account redesign, until after integration. The new
P51A planning request is recorded above; no remedy is implemented by the audit or
the planning document itself.

## P46 serialized port checkpoint

P46 was implemented above accepted PR #63 (`696851e`). The
serialized port's scoped acceptance passes; [PR #64](https://github.com/arnabnandikgp/rivalt/pull/64)
is merged with accepted content `44d1251` and hosted acceptance at `360a247`.
[Validation](operations/validation.md#anchor-rc2-serialized-port-p46) records the
actual checks and exact pins. Frozen P44 artifacts remain untouched.

Delivered: exact RC2 crates/CLI, bounded serialized registry/foreign-loader adapters,
contexts and typed CPI borrowing, scoped event codecs, canonical identifier delta,
clearing binding 8 / maker account schema 5, actual generated IDLs/SDK and isolated
legacy/RC2 clients. Fields, seeds, privileges, signed quote/report domains, financial
rules and default/devnet gates remain intact. No C1 zero-copy conversion is needed
to close this serialized port; P47 records its measured operating envelope below.

Clean C0 SBF source is **`366c7ab4f12c058fbff6538ededca26674ccf5bf`**, retained in
`.local/anchor-rc2/c0-366c7ab/`. Clean RPC verifier
**`8feb24c81affcc98e655f3da7822ca46eaef835c`** passes 57 custody, 290 safety and 124
journal outcomes on fresh Surfpool/RPC/WS. Independent raw audits verify cash/token
conservation and eight exact Fraction default payouts; PostgreSQL rollback,
restart recovery and fresh-database replay match 74 committed events with zero
unresolved jobs. Safety receipts also reproduce five captured financial checkpoints.

Compiled maker lifecycle, default gates and five hostile-maker rollback cases
pass. Both actual maker binaries match 3,172 independent pricing vectors each.
Native adapter/financial tests and affected SDK/conformance checks passed at the
pins recorded in validation. Typecheck, ABI/generated checks and documentation
checks are scoped. All five hosted jobs (scope/client/report/financial/shell) pass
on `360a247` in [run 41289514760](https://github.com/arnabnandikgp/rivalt/actions/runs/41289514760). All evidence remains local.
The initial failed allowlist and boxed native token CPI attempts remain recorded;
the fresh signed custody pass proves the forwarding-handle fix.

P47 completes the remaining qualification below on these unchanged C0 binaries.
P15B/P16B and deferred endurance are unchanged. P45–P47 are now integrated;
local qualification and integration do not establish a funded deployment.

## P47 qualification

The P47 stack tip contains accepted P46 parent `360a247`.
Local acceptance passes; [PR #66](https://github.com/arnabnandikgp/rivalt/pull/66)
is merged. Acceptance/report content is `2b677b597912b2a3e9d7b02dab19088eca66ccc7`.
All four applicable hosted jobs (scope/client/report/shell) pass in
[run 41296789385](https://github.com/arnabnandikgp/rivalt/actions/runs/41296789385);
the unchanged Rust financial job is correctly skipped for this PR. P46’s actual
financial CI and local compiled acceptance remain separately pinned. No access blocker is present. [Validation](operations/validation.md#anchor-rc2-qualification-p47) records
exact constituents and [performance](operations/performance.md#rc2-qualification-measurements-p47)
records all 61 entrypoints, binary sizes, caller/scaling dependencies and the B/C
cost/load comparison. SBF remains clean **`366c7ab4f12c058fbff6538ededca26674ccf5bf`**;
no C1 zero-copy conversion, economic change or new program build is inferred.

| Constituent | Clean verifier | Actual result |
|---|---|---|
| Complete coverage / full books | `a01da5d`, service `b0b62ff`, retained P46 `8feb24c` | 61/61 entrypoints; 2,520 executions / 2,493 originals / 27 cross-run reexecutions; 147/165/165 full-book outcomes |
| Settlement / retirement / default | `a01da5d` | 207/63 dependency/retirement outcomes, 149/53-event PG replays; 712 complete-cohort outcomes, 64 independently audited payouts; eight separate scratch-width cases |
| Services / browser | `b0b62ff` | 468 durable originals, ten browser actions, actual stored fill, three crash/lost-ack recoveries, source/publisher recovery, identical 187-event PG replay and independent accounting |
| Dispatch / bounded load / operations | `1a893ed` | Admission/send SIGKILL and unknown-fee retention; 1,008 offers / 433 fills; complete default/recovery/cash exits with ten independently audited payouts and identical 192-event replay |
| Default/devnet gates | P46 and `eac3755` | All three actual default/devnet initialization refusals with rollback; three mixed-feature compile rejections; no devnet network |
| Normal demo | `083760a` | Fresh startup, thirteen successful local-wallet actions, both modes, BTC/ETH fills, TP/SL/cancel, closes, token-reconciled withdrawal and reload; owned server stopped |

Frozen B remains unchanged and its 2,871 originals reproduce the 53,089-byte
summary. C0's bounded summary is 56,839 bytes. The focused reader compares 33,682
financial/relative-time values across 22 states for eleven successful cases.
330 slot and 176 deployment-digest witnesses remain explicit differences, so the
observed 40–44% route-CU reductions are paired workload observations, not a pure
framework microbenchmark. Clearing/maker binary sizes fall 38.1%/36.1%; requested
CU, zero-priority bids and actual focused fees are unchanged. Wide scratch reaches
572,668 CU; no peak heap metric is invented. Raw evidence remains ignored/local.

Qualification fixes: readonly projection compares complete values independently of
JSONB object-key order; normal startup waits for the existing finalized revision
fence; each of six maker updaters and two publishers has its own restricted key
and fee payer. The demo had otherwise retained the previously measured shared-
payer starvation. Browser tests wait for Normal on opens and credible
Normal/Degraded on reduce-only closes. They retry only explicit unsigned source
refusals or permit a new bounded user review after a proven finalized version
conflict or signed expiry, retaining every failed original/fee. Ambiguous originals
are never rebuilt.
The final demo retains 13 signed originals (13 successful / 0 rejected),
at four-second funding publication and one-second synthetic feed refresh.
The separate service/load policy stays two seconds. Earlier missing-browser,
source-window, JSONB, source-recovery, connection and maker-bound failures remain retained,
not counted as passes. The initial separate-payer demo retained a finalized
FinancialSequence 6122 rejection after seven successful actions. The later test
incorrectly requiring Normal for reduce-only closes is also recorded; the final
fixture follows the existing credible-Degraded reduction contract.
No risk/authority/source safeguard was relaxed.

Actual commands include scoped `ops/current-runtime-smoke.sh` constituents,
`ops/liquidity-services-smoke.sh`, continuation/operations launchers, the independent
Python auditors, `ops/build-devnet-gates.sh`, `ops/demo.sh start|stop` with an isolated
root, and `tests/browser/demo-lifecycle.ts`. Report readers reproduce B/C0 summaries
and the focused comparison from actual original wires/RPC/WS. Typecheck, affected
indexer/measurement/demo tests, ABI/evidence policy, shell and documentation checks
are recorded in validation/PR. Broad supported host regression belongs to CI;
no unrelated local full suite, new external wallet, outreach, funded deployment or
24-hour run is claimed. Inactive disposable Cargo build targets were removed;
programs, tools, logs, keys, databases and failed evidence remain preserved.

Remaining limits: load filled 433/1,008 offered actions (92.92% of 466 submitted);
537 generator limits, five duplicate originals and 33 stale-version rejections
remain explicit. Live indexing achieved two coherent cycles / 33 revision-ahead
retries, so continuous read readiness and sustained TPS remain unproved. The
64-member cohort includes 56 flat additions; scratch-width cases never Apply.
Internal makers, P15B/P16B and deferred endurance retain their existing labels/gates.
The user authorized review fixes and merge of #63 → #64 → #66 on 2 November.
The five review threads contain four actionable artifact/path/schema-documentation
findings and one obsolete plan-approval status finding (the plan was subsequently
approved). Fixes are carried on the stack tip: shared fixed-hash artifact preflight,
staged default-build promotion, consistent smoke/demo paths and current schema
documentation. Fifteen targeted regressions, eight existing artifact-verifier
tests, typecheck, ABI and shell checks pass at review fix `c637816`; actual retained
current/C0 artifacts pass the gate. No programs, IDLs or financial rules changed.
P46 automated review was skipped for file count. A focused self-review checked the
registry codec, loader identity/ownership, event/scoped-history encoding, maker
CPI privilege/return validation and native-token CPI forwarding/revalidation;
no additional defect was found in those inspected paths. This is not independent
review. P46's hosted financial acceptance remains separately pinned above.
At clean `c637816`, the admitted default-path maker launcher passes 123 signed
Surfpool RPC/WS outcomes and 246 notifications with independent fetch/dual decode.
Standalone hostile smoke passes five full-rollback cases across 114 signed VM
transactions. Raw captures remain in `.local/anchor-rc2/p47-review-{makers,hostile}-c637816/`;
the owned Surfpool is stopped. All four applicable hosted jobs pass in
[run 41386710747](https://github.com/arnabnandikgp/rivalt/actions/runs/41386710747);
unchanged Rust financial CI stays separately pinned to P46. All five threads are
resolved. No new SBF build, PostgreSQL/service/load/endurance run was needed for
these launcher/docs fixes; no earlier evidence is relabelled. Stack #65 merged
atomically with exact tree equality. No blocker remains in this delivery.
That closeout scheduled no further work. D91 above now records the separately
authorized quantity work; no external qualification or deployment is scheduled.

## Accepted performance stack

P39–P44 follow D82 and are now the integrated baseline.
P39's immutable focused A baseline uses SBF `828fe543`; P40A adds durable bounded
service lanes, P40B scoped authenticated history, P41 relevant market dependencies,
and P42 schema-7 token custody/internal-accounting separation. Their exact accepted
commits, fresh RPC/WS/PG results and limits are in
[validation](operations/validation.md). No historical results are relabelled as P44.

P43's accepted uninstrumented SBF source is
`fb5d0c546a417796ce615e0d3d3575545c96c178`; clean verifier `1e86661` supplies its
matched CU comparison, full books and complete safety constituents. Route savings
are 669–1,230 CU; requested limits and actual fees are unchanged. Its four applicable
hosted CI jobs and automated review pass on `f9d29f6` in
[run 41244319044](https://github.com/arnabnandikgp/rivalt/actions/runs/41244319044).
Compiler-size experiments with oversized stack frames remain rejected.

## P44 checkpoint

P44 retains the same programs/IDL/economics and fixes the operational failures
found in qualification: D88 finalized-valid blockhash witnesses; D89 immutable
oldest-conflicting-original dispatch; mandatory UI account-schema forwarding; and
bounded eight-block finalized history retrieval with unchanged ordered application,
complete manifests and exact reconciliation. Old dispatcher version-1 originals
must drain before upgrade; ambiguous fees/reservations are never released to make
progress. Operators use separate restricted maker/publisher fee payers.

The B baseline covers **61/61** public entrypoints across
**2,871** independently fetched harness originals on the exact pinned binaries;
reverted calls cannot establish successful coverage. The operator and browser
populations remain separate. Current source, artifacts, fixtures, scenario maxima,
caller/scaling table, priority-fee assumptions and limitations are recorded in
[performance](operations/performance.md) and
[validation](operations/validation.md#frozen-pre-migration-qualification-p44).

Clean `a5afbc9` completes 239 durable originals (236 success / three report
rejections), three lost-ack/SIGKILL recoveries, stored-order execution, publisher
handover/revocation, source outage/recovery and live indexer restart. Fresh PG replay
matches 137 events over eight members/70 accounts; independent audit verifies
7,999,993 vault atoms, 7,999,968 cash and 25 taker-fee atoms. All six makers remain
internal and hedge costs unobserved. Ten browser actions separately pass at
`f4490e9`, including reload recovery and cash actions with both APIs blocked.

Clean `8b8c33f` completes the current bounded load experiment: 1,008 offers,
465 unique finalized originals, 430 fills, 35 on-chain rejections and
543 unsubmitted offers with explicit generator/duplicate reasons. There are no
expired/unresolved load originals. Live indexing records 2 coherent cycles and
33 revision-ahead retries; final and fresh replay match 585 events and exactly
9,000,000 vault atoms. Earlier 1/28 live progress and duplicate-wire failure remain
recorded, not counted as successful full runs. This is not sustained availability
or validator TPS.

The actual 64-member default, eight scratch-only width cases, five compiled
hostile-maker rollback cases, custody/dependency/treasury/retirement lifecycles,
and their independent financial/replay checks pass at the exact pins in validation.
The 56 added default members are flat; wide fixtures perform no payout. Ordinary
own-cash exits remain independent of unpaid-profit certificates; earlier certificate
pages still require stable relevant observations.

Fourteen affected indexer tests, 31 queue/receipt/cost cases, two independent audit
regressions and typecheck pass. Raw originals, failed attempts and databases stay
local/ignored. No new SBF build, unrelated local native suites, endurance, devnet,
external wallet, funded deployment or Anchor v2 migration is run. Broad supported
regression belongs to CI. The 53,089-byte frozen baseline reproduces from its pinned
originals; typecheck, documentation links, shell syntax, whitespace and the staged
128 KiB aggregate evidence budget pass. Acceptance content is `ade628d`.
All four applicable hosted checks (scope, shell, client and financial) pass on
review fix `da99664` in [run 41280117782](https://github.com/arnabnandikgp/rivalt/actions/runs/41280117782).

The review fix commits the finalized-valid blockhash witness with dispatch
admission, closing a process-death window before status RPC or broadcast. Nineteen
focused queue/dispatch/risk-authority tests and typecheck pass. Fresh actual
RPC/WS/PG qualification at clean `da99664` kills an executor immediately after
admission: witness slot 1522 and seven access rows survive with zero attempts.
Restart after real expiry proves nonexecution, releases access and retains the
20,000-lamport unknown-fee reserve. The run also passes post-send SIGKILL recovery,
SQL fairness/drain cases and identical 61-event fresh replay, with eight members,
70 accounts and 7,999,993 vault atoms. Evidence remains in
`.local/liquidity-execution/runs/p44-review-dispatch/`.

All review threads were resolved before merge. The P43 cross-run comparison claim
was narrowed to its recorded aggregates; service-role CU is explicitly labelled
transaction CU. Automated reviews skipped/rate-limited on #56/#58/#59/#60 and the
latest #62 update are not independent approval. No additional program build,
load/endurance run or external qualification was needed for this queue/docs fix.
The fetched merge has identical tree and includes the tested fix as an ancestor.
No implementation blocker remains within this completed scope.
P45 used this frozen B baseline to scope the subsequently accepted RC2 migration;
the integrated M13 checkpoint above records its implementation and qualification.

## Conserving settlement acceptance

P54C branches above ready #79 / `d2f7810`. It implements authenticated flow/order/
graph construction, exclusive adoption, exactly-once root application, complete
market distribution, reconciliation and unchanged source recovery. Partial Apply
keeps original cash/obligations separate from applied balances. Fees, carry,
unused insurance, monotone order IDs and isolated boundaries remain protected.

Clean verifier **`c6e08f95e694cd70768830f4e45e5bd0b63cec87`** on clean SBF
**`efa45951e01b9586469b48294de24d3f0f5fd02a`** passes **1,405 signed RPC/WS
outcomes**, including **68 expected atomic rejections**. Ten actual roots cover
isolated/cross debtors and creditors, fractional insurance clipping, internal
makers and an unrelated funded receiver. Independent Fraction/graph expectations
match final cash and market atom ownership. Eight actual SPL withdrawals and
sustained source recovery pass. PostgreSQL reopens at partial Apply, distribution
and recovery; fresh replay reproduces all **131 financial events** byte-for-byte
and reconciles **148 accounts / ten members**, with actual and allocated vault
both **11,199,993 atoms**, zero surplus and no unresolved jobs. Both isolated
Anchor clients agree on 1,383 clearing instructions, 75 accounts and 1,444 events.

Earlier clean native pins additionally cover 774 independent atom cases, 10,920
flows, canonical ordering, graph construction and serialized restarts; `d6669ac`
passes 13 scoped controller and 23 affected indexer tests. Exact pins, the resolved
fixture-allocation failure and resource measurements are in
[validation](operations/validation.md#conserving-settlement-p54c). Full Apply costs
82,205–84,277 CU in the ten-root fixture; complete qualification is not a larger-
population affordability claim. Raw captures stay at
`.local/scalable-settlement/runs/p54c-application-cross-creditor/`; the owned
Surfpool/PostgreSQL processes stopped normally.

P54C is published ready as [#80](https://github.com/arnabnandikgp/rivalt/pull/80)
above #79 in stack #74; it remains open and is not integrated. Hosted CI has been
completed: scope, client, report, financial and shell pass on exact `51393a9` in
[run 43076612051](https://github.com/arnabnandikgp/rivalt/actions/runs/43076612051).
The selected P53B runtime,
default/devnet gates and 64-member bridge remain unchanged. P55A/P55B own scalable
membership/backing; P56B owns expanded activation and its cost gate. No user
decision or access blocker remains for this PR. P15B/P16B remain Open and continuous
24-hour endurance Deferred. Next exact action: begin P55A paged membership and
safe account lifecycle above #80 under the existing roadmap.

## P55A foundation and remaining lifecycle

P55A1 branches above #80 / `51393a9`. Clean **`b8a19eb`** passes 38 focused
native cases and links a 2,335,560-byte clearing SBF without oversized-stack
diagnostics. It separates u64 scalar financial IDs from bounded reference-cohort
size, and authenticates all fifteen financial-index path nodes before mutation.
The independent reconstruction covers 1,027 sparse members / 2,054 entry-exit
transitions; literal high-ID financial cases retain exact fees, funding, exits and
atom ties. This is native/compilation acceptance only; current wire IDs, admitted
population and selected runtime remain unchanged. Exact pin/hash and limitations
are in [validation](operations/validation.md#membership-foundation-p55a1).

The [roadmap](operations/remediation-plan.md#p55a--membership-and-account-lifecycle)
now separates this foundation from P55A2's complete on-chain lifecycle and storage
integration. P55A2 now supplies canonical schema-9 layouts/consumers, Registered/Financial/Retired
authority, funded recovery storage, complete live-index default and signed lifecycle
acceptance. The populated financial gate and selected runtime remain unchanged.
P55A1 is ready as #81 above #80 and remains open. Hosted scope and financial CI
pass at `7b0ab07` in run 43086442927; other scoped jobs are correctly skipped.
Automated CodeRabbit also reports success; this is not independent financial review.
No decision/access blocker is known. P55A2 follows above #81 without waiting for merge.

P55A2 is accepted for Review above exact **`7b0ab07`**. D100/D101 implement pre-funded
reusable recovery storage, schema-9/profile-5 roots and fixed registry, authenticated
Financial membership, permanent retirement and terminal rent refunds. No selected
runtime or expanded Financial population is activated. The temporary 64 Financial
account gate remains; registration/identity is not capped at 64.

Clean SBF **`583dbcb`** passes the lifecycle run (**`0d9c378`** harness: 411 signed
RPC/WS outcomes, 18 expected rejections, 71 identities, two Financial roots, real
SPL entry/exit and five refund kinds). That lifecycle run's final tree was dirty
from unrelated concurrent harness work, as recorded in validation. The same SBF
with clean harness **`1de35c3`** passes the complete ten-Financial-account default:
**1,538 signed outcomes / 67 expected rejections**, independent Fraction/graph
checks, eight actual SPL exits, credible-source recovery, three PostgreSQL
checkpoints and **identical 141-event fresh replay / 227-account reconciliation**.
Actual/allocated vault is **11,199,993 atoms**, with zero unallocated surplus.
Peak observed CU is 161,562; whole probe fees are 8,415,000 local test lamports.
Earlier stack, duplicate-payer and partial-SQL failures remain local evidence and
are described in [validation](operations/validation.md).

Current consumer work replaces fixed-member scan adapters and old solver calls,
regenerates **all three** source IDLs (including maker-imported clearing layouts),
and adds the explicit D101 ABI delta over immutable P55A1. Eleven focused
conformance/economics tests, fourteen wire-guard tests and typecheck pass. The
corrected custody verifier **`e8dfe31`** passes **234 signed outcomes / 26 expected
rejections**, five Financial roots, real transfers/exits, exact 18-atom final
insurance/vault backing and eight independently rejected raw-byte corruptions.
Both isolated Anchor clients match 228 instructions / five accounts / 232 events;
one intentionally malformed signer-bit rejection is explicitly outside builder
parity. The earlier `7574fde` attempt reached the financial checks but failed that
inapplicable parity comparison. Both raw captures are retained. Clean verifier **`061e201`** passes **274 signed outcomes / eight expected
rejections** for membership versus registration/trade/transfer, stale retirement
after reentry, and freeze barriers. A pre-freeze route fails its signed safety epoch;
a rebuilt route also fails frozen-mode admission. Full snapshots prove rollback;
signature WS errors match fetched finalized results. Peak CU is 160,680 and fees
are 1,895,000 test lamports. The preceding `d45ff29` run expected the wrong first
guard error and is retained as a failed attempt. This is interleaving acceptance,
not a throughput test.
The historical fixed-width SVM scratch probe and retained-schema-8 projection
runner are retired at their `7b0ab07` Git provenance; paged arithmetic tests,
signed resource measurements and actual PostgreSQL reconciliation replace them.
Automatic paged default continuation remains explicitly blocked until P56A; no
success or durable-worker qualification is claimed. Current runtime commands reject
schema-8 selected artifacts against schema-9 clients before deployment.

No user decision/access blocker is known. P55A2 is open as ready PR #82 above #81. Initial hosted run 43107548317
passed scope/report/shell but exposed three native maker-admission and five SDK
margin-preview tests whose fixtures still omitted Financial lifecycle/generation.
Those fixtures are corrected without weakening admission; the preview also rejects
decimal-string zero generation. All three affected native checks, eight SDK margin
checks and typecheck pass locally. Run 43108366267 passes client/scope/report/shell
and all qualified native cases; its default build found a refund test which
incorrectly expected an enabled action. That test now explicitly asserts the
default gate; both focused build-profile checks pass. Hosted run 43109440280 passes all five jobs at `3b9e15e`. Next exact action:
implement P55B maintained backing against its conservative-region contract. P56A retains full UI,
durable automatic default and the remaining historical raw-audit adapters; P56B
retains populated-cohort qualification and runtime promotion.

## Maintained backing handoff

P55B is refined into P55B1's checked arithmetic/mutation contract and P55B2's
on-chain integration/signed acceptance. Clean **`1715d20ceda111591bc1e8addbfa95ea4208c9f0`**
passes five independent Python-to-Rust checks: **1,274** complete-corner root
comparisons, **89,720** exact summary/restoration prefixes across eight market/
population cases (64/128/1,024/10,000 roots), six literal collection/payment/netting/
inventory/fee paths, numeric/held-region rejection and 151-bit aggregate cases.
Two focused native checks verify failure atomicity/count exhaustion. Fourteen
wire tests and the unchanged program ABI check pass. The source-domain guard
explicitly recognizes the new native `RVBACK01` checkpoint tag; it is not a PDA,
Anchor account or signed transaction domain. Raw logs stay under
`.local/scalable-settlement/p55b1-*`.

The owning accounting contract maps all actual mutation owners to required proof
maintenance, including cash-only deposit/transfer, fee changes, consumed funding,
order-only writes, Financial generations and exceptional recovery. Native arithmetic
does not authenticate membership, accept a source, update a program account or pay
a claim. No P55B2 integration, SBF/CU/lock result, RPC/WS/SQL progress, larger live
population or runtime promotion is claimed. P55B1 is open as ready PR #83 above #82. Next exact action: implement P55B2's
versioned summary storage and atomic mutation hooks, then its signed acceptance.

## P55B2 candidate checkpoint

D102's schema-10/profile-6 candidate stores maintained summaries in existing market
ledgers and processed epochs in roots, with atomic cash/fill/order/liquidation hooks.
Default/devnet stay disabled; selected schema-8 artifacts remain unpromoted. Clean
SBF `bc9f029fa0f541a7407384a0bc7715bcee9c0f08` builds all three default/qualification
programs without oversized-stack diagnostics. Clearing is 2,374,856 bytes, SHA-256
`62523299a7f1629dc40e56cd99c6b858a74a247bc5eecca46debab0ec0ab65a9`.
Affected native/client/ABI checks and independent backing arithmetic pass as recorded
in [validation](operations/validation.md#maintained-backing-integration-p55b2).

Clean harness **`cf128c0e9840867a8eff054e845bd46966903ff1`** passes **1,474 signed
RPC/WS outcomes / 61 expected atomic rejections** on that binary. Both eight-root
scans finish in 39 steps (22.51 / 22.59 seconds), without reset during in-region
sampling, four overlapping independently paid scan/fill pairs and six processed
cross cash actions. Tests cover stale-source refusal without proof erasure, source
recovery, membership invalidation even after the count is restored, TP/SL and replay,
actual 1,000-atom debtor repair, explicit flat-only one-atom netting, and consenting
liquidation with its exact 27-atom funded reward. Repair and liquidation unblock the
same completed proof without rescanning. Strict post-fee progress and over-size
liquidation reject. Complete eight-root default clears processed markers, preserves
independently computed ownership, permits an actual SPL exit and completes sustained
recovery; old proof authority remains rejected after reactivation.

The separate Python 16-corner audit matches **269 summaries / 227 RPC frames**.
Both isolated Anchor clients match 1,457 clearing instructions, five account decodes
and 1,862 clearing events. PostgreSQL reopens through partial Apply, distribution,
completion and recovery; fresh replay matches **469 events**, with 227 accounts /
eight members and actual/allocated vault **7,199,891 atoms**, zero surplus. The
tracked tree remains clean. Raw files stay in
`.local/scalable-settlement/runs/p55b2-complete-recovery`.

Earlier failed attempts remain recorded locally: the initial event construction
exceeded the SBF frame by 96 bytes and was never deployed; a low-price test violated
the unchanged 1,000-atom minimum notional; a later section needed sustained source
recovery after SQL reconciliation. Those harness fixes changed no economic rule.
The focused worker at `cf128c0` lands **41 durable originals**, completes same-epoch
coverage/payment and executor lost-ack/SIGKILL recovery, reconciles the eight-million-
atom vault and reaches fresh SQL replay. Its final independent audit failed because
its capture omitted certificates; that failed run is retained. The corrected clean
**`831d352a5b95043c4aca11c1202e5b102d021c87`** run passes with **41 durable originals**,
278 separately fetched setup/publication outcomes, 39 independent summary comparisons
and **136-event identical fresh replay**. All 225 accounts/eight members reconcile
to **8,000,000 actual/allocated atoms**. One actual post-acceptance SIGKILL/lost-ack
recovers the same signed original, with a single observed broadcast and no duplicated
financial effect. Collection and payment each move exactly five atoms; final closure
and payment are atomic. The settlement budget spends exactly **205,000 test lamports**,
retains zero reservation/access rows, and observed worker CU spans **15,876–79,589**.
End tracked tree is clean. Raw files remain in
`.local/scalable-settlement/runs/p55b2-worker-complete`.

P55B2 is open for Review as ready [PR #84](https://github.com/arnabnandikgp/rivalt/pull/84)
above #83 at `bd7c0df`. Hosted run 43120447567 at `7487cc3` passed scope/report/shell but failed
native fixture literals and the generated lock inventory. Clean `1b42a2c` fixes
only those fixtures/baselines: 14 affected qualification tests, two disabled-default
activation tests and the 90-entrypoint inventory check pass. The only access-set
change is the intended writable backing ledger; SBF/financial semantics are unchanged.
Hosted run 43122151935 passes financial/scope/report/shell and exposes the
remaining frozen-proposal reader still expecting profile 5. Clean `f560b05` binds
that reader to profile 6; all three focused proposal checks pass. No program or
financial semantics changed. All five hosted jobs pass at `817fa9d` (run 43123083610). Next exact action:
finish P56A1 signed default-worker acceptance above #84.
No user decision or access blocker is known. Expanded population and runtime
promotion remain P56B; automatic default continuation and wallet/UI acceptance
remain P56A. P15B/P16B remain Open and 24-hour endurance Deferred.

## P56 acceptance and runtime handoff

P56 remains one PR (#85), following the user's 12 November instruction. Durable
default and client checkpoints are accepted on their recorded pins: `25ed94a`
scalar default and `b9d2a21` browser/SDK/API lifecycle. The latter has 23 actual
internal-wallet originals, 77 stable identities, ten Financial roots, a permanent
tombstone, API-outage/direct-RPC exit and 248-event fresh SQL replay. It is not an
external-wallet check. Batching and D107/D108 reduce transport and repeated setup
without changing settlement economics or trusted authority.

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

Normal runtime selection binds SDK, indexer, services and launcher to the same
accepted artifact set, with helper version 2, at most 32 resource-bounded
continuation instructions, and 128-root pre-funded recovery capacity. The 51
affected client/artifact/risk/batch/binding checks, typecheck, shell syntax and
artifact/helper identity checks pass. No new SBF build is needed for selection.

Clean **`6b92665d5561ac547595a9f4211b567d7e144c30`** passes the normal launcher
and installed Chrome **157.0.8103.39** browser lifecycle: **13 successful signed
originals, zero rejected originals and zero page errors in this complete run**.
Actual local wallet creation/faucet, portfolio, cross/isolated activation and
deposits, sibling allocation, BTC/ETH fills, TP/SL/cancel, both reduce-only closes,
a **1,000,000-atom SPL withdrawal**, decline without submission, reload and indexed
fills all pass. Every wallet original is independently fetched at finalized RPC
and matched to its saved wire. Indexer RPC/WS and actual PostgreSQL are active.
End tracked tree is clean; owned server/database processes stop normally. Raw
results stay in `.local/scalable-settlement/p56-normal-demo-wallet-final` and the
owned session in `.local/interactive-demo-p56-selected-5`. This is an internal
wallet check, not external-wallet or continuous-availability qualification.

Earlier partial attempts exposed and fixed the publisher's initialization-slot
wait and the cross/isolated selection snapshot race. The latter reproduces before
the fix; all four focused component cases pass afterward. Other attempts retain
a low-disk shutdown, an independently proven expired route, and a finalized
OraclePolicy refusal inside the route's slot lifetime. They are not counted as
complete acceptance or hidden from availability results. The browser permits at
most three new reviews after a finalized version/source refusal or proven expiry;
unknown originals and unrelated errors still stop. Source/financial safeguards
and publication cadence remain unchanged. Only generated Rust build caches were
reclaimed; all databases, keys and raw evidence remain intact.

The earlier 128-root resource/capture failures remain in validation. Clean
`ad19215` passes hosted CI run 43157071365; the final publication's hosted status
is reported separately on PR #85, without inferring it from local acceptance.
Publication `6c4652c` passes scope/report/shell and 403 client checks, but three
launcher hash-rejection fixtures still declare schema 8. They now declare the
current schema 10/profile 6 and all three scoped launcher checks pass locally,
reaching the intended unqualified-hash rejection before any runtime starts.
This fixture-only correction requires no repeated program or financial run.
P56 is ready for Review and remains open, not integrated. Stop after final PR
publication/checks for the user's scalability discussion; do not begin P57.

## Deployment and operational limits

Current trading is qualified only in its explicit bounded local profile; default/
devnet stay gated. Synthetic sources, internal makers and a local demo wallet do
not establish independent or production readiness. Restricted publisher trust,
finite two-market/three-maker bounds, retained unknown-fee reservations and
coordinated unpaid-profit certificates remain explicit. Historical latency results
are not new P37 measurements. See [deployment](operations/deployment.md) and
[validation](operations/validation.md). No funded pilot, paid service, outreach or
external hedge is authorized by consolidation.
