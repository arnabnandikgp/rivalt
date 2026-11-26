# Historical reference

Current behavior belongs in the [component guides](README.md), consolidated in [PR #170](https://github.com/arnabnandikgp/rivalt/pull/170) at `cfd2626c`. Use the revision that produced a result when interpreting its program hashes, measurements or client interface.

| Looking for | Pinned source |
|---|---|
| Certificate and direct worker payout comparison, to the 1,000-member grouped qualification | The [earlier cold ETH workload](https://github.com/arnabnandikgp/rivalt/pull/203) and [stressed worker harness](https://github.com/arnabnandikgp/rivalt/commit/11cb1b55) baseline the bounded BTC/ETH qualification. |
| Wallet contention, pre-signed bursts and wallet snapshot decoding | [Performance measurements at integration](https://github.com/arnabnandikgp/rivalt/blob/cf61ad81da5b355d1828a209d2b8cbacca898428/docs/operations/performance.md#wallet-count-and-market-contention) · [SDK decoder, PR #198](https://github.com/arnabnandikgp/rivalt/pull/198) |
| Dollar execution, wider maker discovery and price-constrained routing | [Benchmark, PR #181](https://github.com/arnabnandikgp/rivalt/pull/181) · [Wallet selection, PR #190](https://github.com/arnabnandikgp/rivalt/pull/190) · [Reviewed implementation at `b0e1a43f`](https://github.com/arnabnandikgp/rivalt/tree/b0e1a43f22699bb67335011ef7acfb2edf48b0d2) · [Signed qualification, PR #191](https://github.com/arnabnandikgp/rivalt/pull/191) |
| Historical exact-entry storage and the change to fixed-width entry | [Exact-entry comparison at `8744612e`](https://github.com/arnabnandikgp/rivalt/blob/8744612ee7050cceda19a1e74ee0025a6254d7e9/docs/operations/qualification-scorecard.md) · [Fixed-width implementation and signed qualification, PR #180](https://github.com/arnabnandikgp/rivalt/pull/180) |
| State of the project before this documentation cleanup, including the phase tracker and PR results | [Full documentation at `9c482583`](https://github.com/arnabnandikgp/rivalt/tree/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs) |
| Original run conditions, failures, commands and per-instruction performance reports | [Validation record](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/operations/validation.md) · [Performance record](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/operations/performance.md) · [Reproduction instructions](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/operations/local-development.md) |
| Clearing alternatives, venue comparisons and default proofs | [Design review](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/clearing/architecture-review.md) · [Venue comparison](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/clearing/venue-comparison.md) · [Verifier derivations](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/clearing/default-plan-verification.md) |
| Anchor migration and pre/post resource profiles | [Migration and qualification](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/operations/anchor-v2-migration.md) · [Tracked benchmark data](../tests/performance/baselines/) |
| Decision numbers, previous contracts and older phase records | [Decision register](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/DECISIONS.md) · [Historical index](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/HISTORY.md) · [Pre-consolidation kit](https://github.com/arnabnandikgp/rivalt/tree/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs) |

To read an older document from a local clone:

```sh
git show 9c482583:docs/operations/validation.md
git show 84c46d4d:docs/evidence/P34.md
```

PRs [#168](https://github.com/arnabnandikgp/rivalt/pull/168) and [#169](https://github.com/arnabnandikgp/rivalt/pull/169) integrated settlement scheduling and the wallet/storage workload at `9c482583`. PR records retain review and validation detail. Raw local captures stay at their original ignored paths.
