# Accounts, custody and authority

## Follow a deposit

1. An owner creates a portfolio and registers a child margin-account PDA. The owner, portfolio index and child index identify actual accounts. The portfolio holds the namespace. Cash, positions, orders and obligations belong to the margin account.
2. Financial activation inserts the root into paged membership and requires provisioned recovery capacity. A registered identity can exist without financial exposure. The local launcher provisions 128 Financial roots. This is distinct from the number of identities that can be registered.
3. A signed deposit transfers the six-decimal collateral token into the venue vault and credits the selected root. A permitted transfer between two roots of the same owner changes their clearing balances. Only a token deposit or withdrawal moves SPL tokens across the vault boundary.
4. Deactivation requires all obligations discharged. A retired child leaves a permanent tombstone. Discovery distinguishes registered, active Financial and retired roots, including their stable member IDs and activation generations.

## Ownership

| Account or authority | Owns or authorizes |
|---|---|
| Venue, custody and safety | Deployment identity, mint, vault binding, operating mode and freeze. Token gateways authenticate SPL accounts and actual vault custody. |
| Trader margin account | One cash balance and up to two market positions. Isolated roots bind one market. Cross roots combine BTC/ETH requirements against their own cash. Mode and isolated market are immutable. |
| Maker capital and registration | One isolated root per registered capital, bound to one venue and market. Owner and venue authority approve maker executable identity. A delegated updater reprices. |
| Portfolio owner or delegate | Owner controls custody and retirement. Delegated trading actions require current scope, authority epoch, expiry and account guards. The owner controls both ends of an internal cash transfer. |
| Market, ledger and maker capacity records | Index and funding state, settlement, retained fees, insurance and gross exposure. Fills can update maker-local contributions. Consumers requiring current totals authenticate the market checkpoints and complete bounded inputs. |
| Frozen member pages and settlement plan | Complete member identities, original revisions, positions and claims for one episode. Clearing checks the final payout before releasing cash. |

The shared vault is custody. It does not make funded cash in one sibling account available to another debtor. An isolated maker or trader can hold an unpaid market claim after closing.

## Wire format and changes

The fresh local client uses clearing schema 10, profile 6, maker account schema 5 and the explicit artifact binding. Fixed discriminators, integer widths, field order, PDA seeds, account metas, signed domains and error numbers are public interfaces. Namespace indices are u32 and member IDs are u64. JSON transports monetary quantities and member IDs as decimal strings. Historical seed text such as `capital-v3` remains part of address derivation.

Fresh accounts use the RVPROF02 margin extension. It carries exact entry and requires zero paid open price gain. RVPROF01 remains bound to earlier deployments. Growing the margin extension requires explicit rent funding. Both market slots start at 128 bytes and can grow to 256 bytes each. Growth requires owner consent, the current margin revision, an identified rent payer and a signed maximum payment. Rent credit is separate from margin cash. [Profit storage and eligibility](default-plan-verification.md)

Use the types and generated contracts for exact field layouts and instruction metas. Compare supported wire formats before changing an existing account. [Clearing state](../../programs/clearing/src/state/) · [Membership wire checks](../../ops/membership_wire_contract.py) · [Wire contract](../../ops/wire_contract.py) · [SDK deployment bindings](../../packages/sdk/src/account-deployment.ts)
