# Application and services

The SDK builds bounded user actions; the wallet signs them. The quote service
supplies provisional authenticated pricing. Clearing decides whether a transaction
is admissible at landing. The indexer independently reconstructs successful finalized
state into PostgreSQL; the database never creates authoritative collateral.

Signed originals are persisted before transmission. Workers reconcile the same
signature after timeout/restart and cannot replace an ambiguous action merely to
make progress. Maker updater, funding publisher, order, settlement and risk roles
have separate authority and funded lamport budgets.

Read [interfaces](interfaces.md) for deployment, SDK, API and wallet contracts;
[durability](durability.md) for event reconstruction, retries, fee reserves and
recovery. [Operator setup](../operations/deployment.md) gives actual entrypoints.

| Component | Source |
|---|---|
| User client and authenticated snapshots | [SDK](../../packages/sdk/src/account-client.ts), [account snapshots](../../packages/sdk/src/account-snapshot.ts), [liquidity routes](../../packages/sdk/src/liquidity-route.ts) |
| Journal/projection/read API | [Indexer](../../packages/indexer/src/) |
| Queue/executor/workers | [Services](../../packages/services/src/) |
| Maker/publisher config and economics | [Maker kit](../../packages/maker-kit/src/) |
| Wallet, review, positions and receipts | [Trader application](../../apps/trader/src/) |
| Earlier one-command demo supervisor | [Local demo](../../packages/local-demo/src/) |

The canonical deployment uses `/v4` interfaces and profile 4 with schema-3 financial
accounts. The interactive demo currently uses the preceding profile; do not claim
it exercises canonical liquidity until its launcher is migrated and tested.
Historical interfaces remain compatibility consumers until P37's inventory retires
them. API/schema identifiers remain meaningful even after source naming cleanup.
