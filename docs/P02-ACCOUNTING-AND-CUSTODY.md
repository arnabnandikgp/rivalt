# P02 accounting and custody contract

Profile/schema 1 · synthetic local assets only · 20 October 2026

This phase implements the framework-independent financial core and real classic SPL custody. The on-chain market remains **CustodyOnly**. Model-level fills, risk, fees, funding accrual and default allocation are not externally executable financial instructions. Operational routes, observations, orders, settlement and default arrive in their owning phases.

## Precision and bounded profile (G02/G03)

[local-profile-v1.json](../scenarios/local-profile-v1.json) is the versioned machine-readable profile. `pnpm test:financial` compares its numeric limits with the compiled core. All monetary/quantity JSON fields are decimal integer strings.

| Quantity | Representation / synthetic bound |
|---|---|
| Quote collateral | Classic SPL Token; 6 decimals; no freeze authority |
| Base | Signed i64 lots; 1,000,000 lots/BTC (100 satoshis/lot); minimum new quantity 1 lot |
| Price | u64 quote atoms/lot; tick 1; inclusive range 1–1,000,000 (BTC price 1–1,000,000 quote tokens) |
| Cash C/P/I/T, allocated vault, order notional prefix | u64 whole quote atoms; each and the allocated market vault at most 1,000,000,000,000,000 |
| Virtual quote | i128 scaled units; 1,000,000,000 units/atom; absolute bound 10^26 |
| Common F / checkpoint | i128 scaled quote atoms/lot; absolute bound 10^15 |
| Exposure | Absolute participant lots <=100,000,000; market sum of absolute lots <=200,000,000 at admission |
| Risk | IM 1,000 bps; MM 500 bps; use adverse lower bound for long loss and upper for short loss; IM notional uses upper bound |
| New order admission | Minimum gross notional 1,000 atoms; committed partial fills need not separately meet a new-order minimum |
| Membership | At most 64, including makers/liquidators; four order-ID slots per participant |
| Fees | Cumulative ceil(N/5000); provider zero; all fee cash to T; no fee-to-I allocation |

Price range is a finite arithmetic/test envelope, not oracle verification. G08 owns source validity, uncertainty and execution bands. The core accepts supplied credible bounds; P02 does not expose a caller-controlled on-chain risk price.

Checked operations reject overflow/range failure. Valid marked exposure is <=10^23 scaled units; a checkpoint change contributes at most 2×10^23. Per-participant evaluated claim is bounded by 1.003×10^26; the complete-cohort total is below 2^93. Rust i128 comfortably holds these intermediates. A new ordinary stored virtual balance must still meet its 10^26 bound. Derived/default valuation uses the larger bound so a participant at the ordinary limit can still close out; P09 resolution records must preserve this headroom. Counters never wrap. Generation `u64::MAX` is terminal-flat only: admission reserves the final increment for closing, and reopening then rejects.

Proportional allocations can require a product wider than u128 even though their final result fits. `mul_div_rem` computes the exact quotient/remainder bit by bit without forming that product. It checks denominator <=floor(2^96/3); intermediate remainder arithmetic stays below 2^96. `apportion` checks unique stable IDs, count, total and sum, then sorts exact remainders descending and stable ID ascending. Python `Fraction` and arbitrary-sized integers independently check these results.

Funding accrual is exact in this scale: `v -= q*(F-Fi)`. No participant rounding occurs, and fractions survive flat positions and reopening. Accrual split across multiple checkpoints telescopes exactly. G08 must bound the later sampler's continuous-rate-to-common-index quantization; this phase does not implement or claim to verify that sampler.

## Default fraction extension

The pure `closeout` function requires a complete, already authenticated cohort; validating membership/freeze/pages is P09. It first reconciles cash, exposure and exact claims at a common price, accrues all accounts, values positions, and releases reservations.

1. Collect each debtor's minimum of funded cash and the **floor** of its whole-atom debt. Fractions stay in the claim.
2. Transfer `min(I, floor(total debt))` whole atoms from insurance to P. Allocate that exact scaled amount across debtor claims proportionally with largest remainders in **one scaled unit**, stable-ID ties. Fractional debt below one atom cannot cause an overdraw from I.
3. Cancel all residual negative claims and proportionally impair **every** positive unpaid claim by the same exact scaled total. Again use scaled-unit largest remainders.
4. Remaining positive entitlements sum exactly to `P*SCALE`. Give each participant its floor in cash atoms, then distribute the remaining P atoms by largest fractional remainder and stable ID. Record each signed terminal claim adjustment `paid*SCALE - entitlement` in `rounding_scaled`. Their sum must be zero and each absolute adjustment must be strictly less than one quote atom.
5. Credit those whole cash payments, zero all claims and P, and reconcile again. I not used remains I; T is excluded. No unassigned rounding asset and no retrospective clawback exists.

Steps 2/3 deviate by less than one scaled unit from their respective exact proportional allocation. Step 4's terminal rounding is an explicit, complete-cohort transfer of fractional entitlement; it is not ordinary settlement permission to round an unfunded gain up. Ordinary collect/settle can transfer only whole atoms within the exact entitlement. The full allocation report exposes collected, insured, impaired, terminal adjustment and paid amounts. P09 must persist and emit these same effects across legal page sizes and restarts.

## Custody ABI and authority

The committed [Anchor IDL](../packages/sdk/idl/clearing.json) is the exact field-order, discriminator, signedness, account-role and error schema. Anchor/Borsh serializes integers little-endian. Schema 1 has no upgrade-in-place migration promise; a future incompatible schema needs an explicit migration or fresh local deployment.

| Account | PDA seeds under clearing | Layout / allocation |
|---|---|---|
| MarketState | `market`, `BTC` | 224 bytes including discriminator; identity/authority/mint/vault, terms/config epochs, sequence, pause/mode, F, total C/P/I/T and allocated vault |
| Participant | `participant`, market pubkey, owner pubkey | 181 bytes; schema/market/owner/stable u16 ID, u64 C, i64 q, i128 v/F_i, generation/nonce/reserve, four u64 order IDs, bump |
| ParticipantRegistry | `registry`, market pubkey | 2,097 allocated bytes; schema, market, count, Borsh vector length, up to 64 pubkeys, bump; only the populated prefix is membership |
| Vault | `vault`, market pubkey | Classic SPL token account, 165 bytes; market PDA is token authority |
| Event authority | `__event_authority` | Anchor event-CPI signer |

The registry's count must equal its vector length. Registration assigns the next stable ID and appends the participant key once. There is no deletion/deregistration in this profile. The bounded heap-backed vector avoids the measured 4,096-byte SBF stack-frame limit; build diagnostics for oversized frames now fail the build.

- `initializeMarket(domain)`: only the deployed clearing program's actual upgrade authority, proven through its loader-owned ProgramData; nonzero domain; six-decimal mint without freeze authority. Initializes one BTC market, registry and token vault. The domain is declared deployment identity; cluster/genesis preflight remains P13.
- `registerParticipant`: owner signs and pays account rent; market unpaused; at most 64. Starts with zero financial state and four empty order-ID slots.
- `deposit(amount)` / `withdraw(amount)`: owner signs; participant/mint/vault/PDA/token-program bindings checked; source/destination must be an owner-controlled same-mint token account distinct from the vault. Real classic SPL `transfer_checked` CPI; positive amount; bounded cash; vault reconciliation before and after. Withdrawals require completely flat, claim-free, reserve-free custody state.
- `fundInsurance(amount)`: market authority contributes its own tokens by checked CPI to I, with no participant claim and no revenue classification.
- `classifySurplus`: market authority explicitly classifies **only** observed vault surplus to I and emits the amount. Ordinary deposits/withdrawals preserve surplus without crediting it. An actual deficit always rejects; it cannot be hidden by classification.
- `setCustodyPause(bool)`: market authority; reconciled, custody-only profile; increments config epoch. Pause rejects registration/deposit/withdraw/insurance. It is not the future source-mode/default recovery mechanism.

No maker receives a vault signer or writable clearing account. Market administration cannot choose a participant withdrawal recipient, mutate a balance directly, transfer treasury funds or submit a funding rate.

Error 6000 preserves the P01 probe contract. Custody errors 6100–6109 respectively encode arithmetic, paused, authority, mint, alias, capacity, amount, reconciliation, profile and domain failure. Anchor's own constraint errors remain part of the rejection surface; Anchor 1.2.1 rejects duplicate mutable account aliases as 2040 before the explicit alias constraint.

`CustodyChanged` uses event-CPI and includes schema/profile/domain/market, epochs, checked market sequence, slot, operation, actor/participant, amount and post-state cash pools. For market-wide events participant is the default key and participant cash is non-applicable. Registration reads no vault: `actual_vault=0` is non-applicable for kind 1 only. Consumers must use operation kind, successful transaction metadata and event position. A failed multi-instruction transaction can retain a reverted custody event; it must create no committed projection.

Anchor's token-account `init` derive requires the `anchor-spl/token_2022` helper feature to compile. Every executable account/CPI is still statically restricted to classic `Program<Token>` / `Account<Mint>` / `Account<TokenAccount>`; Token-2022 collateral is not enabled.

## Executable checks

```sh
source ops/env.sh
pnpm smoke
```

The full command builds the pinned SBF/IDL, verifies deterministic generation and isolated legacy instruction/account/event parity, runs financial tests and the exact Python oracle, runs signed compiled-program LiteSVM checks, then deploys and executes the P01 and custody suites on a fresh offline Surfpool process through standard HTTP/WS. It records `.local/runs/<run>/financial.json`, `svm.json`, `custody.json`, raw failed transaction and live conformance bytes.

Individual commands: `pnpm test:financial`, `pnpm test:svm` (requires current SBF), `pnpm test`, `pnpm typecheck`. Test-only additional signers support real mint/account provisioning through the modern SDK transport. LiteSVM 1.6.1 and modern token/system clients 0.18.0/0.16.0 are exact lockfile pins. LiteSVM deployment metadata is provisioned to expose an upgrade authority; financial balances and membership are created only by signed instructions. Separate, labeled corruption fixtures test deficit/profile rejection and are restored exactly afterward.

V01–V04 have fixed independent expected values; V05's route rollback/protective allowance is a model check only. Actual maker route rollback is P04 and actual TP/SL is P08. PostgreSQL/service integration is P05 onward; oracle authentication, operational default, browser, soak, devnet and external review are not P02 results.
