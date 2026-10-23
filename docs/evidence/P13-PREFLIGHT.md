# P13 read-only preflight — A18 incomplete

Source: clean `0a6e2c92cfdfadf8507c70cab4c60bd1f4ef3fa4`, stacked above exact ready P12 PR #14 head `e0c18260a09a4cb40432a6bcc3ce6875a949b52a`.

```sh
source ops/env.sh
node --import tsx tests/rpc-contract/devnet-preflight.ts
```

The command exits zero, 2026-10-23 07:32:35.597→07:32:37.192 UTC. [Inventory](p13/preflight/inventory.json) records actual finalized dependency/ProgramData reads at slot 514171961 and a real slot WebSocket notification at 514171968. [Hashes](p13/preflight/sha256.json) bind the retained public artifacts. Genesis is Solana devnet, node core 4.4.0-beta.1, feature-set ID 3993424257. The feature-set identifier does not enumerate active features.

The documented Pyth Core receiver and Wormhole receiver are executable upgradeable-loader accounts. Their actual ProgramData addresses, deployment slots, allocated sizes, hashes and upgrade authorities are recorded. Both have upgrade authority `upg8KLALUN7ByDHiBu4wEbMDTC6UnSVFSYfTyGfXuzr`; this is dependency provenance, not independent review or immutable-code assurance. Payload hashes include allocated padding, not just an ELF file.

Three focused trust-boundary unit checks and TypeScript checking pass. No inherited financial, compiled-program, matrix, load or browser suites were rerun. No wallet/signing/faucet/deployment/financial instruction ran. The report explicitly sets `a18Complete:false`, `signedUpdateVerified:false` and `rivaltDeployed:false`.

The current documented Pyth Hermes latest-BTC endpoint returns [HTTP 403 without authentication](p13/preflight/oracle-access.json); its current [Solana integration documentation](https://docs.pyth.network/price-feeds/pro/use-prices-on-blockchain/solana) requires an API key. The precise HTTP rejection cause is not established. No Pyth configuration was present, and the user reported no access. Authenticated real update verification remains blocked; read-only program discovery cannot replace it. [P13 contract](../P13-DEVNET.md) lists the remaining G11 work. No P13 acceptance or PR is claimed.
