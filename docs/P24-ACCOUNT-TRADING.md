# P24 — account-centric risk, funding and trading

D60 remains the financial authority. This phase implements A29/G19 core on the
verified P23 stack; WORKLOG owns progress. [A29/G19 core evidence](evidence/P24.md)
records the actual tested revision. Ordinary schema-3 activation remains false until P26.

`account-trading-qualification` is a separate local-only candidate artifact for
clearing and both maker programs. Default, devnet and P23's custody artifact do not
activate it. Qualification requires actual funded roots, separately registered A/B
capital, authenticated BTC/ETH/collateral sources and the existing sustained source
recovery. Activation resets custody-period funding, then requires new sampling.
There is no administrative option to skip health, source or maker checks.

The instruction modules are `instructions/account_trading/{activation,authority,
engine,makers,oracle,routes}.rs`. Engine adapters copy typed scalar state into the
existing pure margin/order candidates, retaining one checked financial engine.
They never deserialize schema-3 bytes as V2 accounts or call V2 authority handlers;
identity is checked before adaptation and never overwritten from a candidate.
V1/V2 wire layouts, entrypoints and behavior remain unchanged.

Root intent validity binds its nonce/state version, safety epoch, venue/market
terms, selected maker epoch/authority/consumption and explicit limits. There is no signed
historical event sequence or observation requirement. Every landed operation reads
both canonical markets and rechecks current relevant prices/funding; empty unrelated
slots need no fresh source. Consumed funding prefixes are materialized with the
root mutation, including the untouched exposed market. A later missing sample or
hold expiry cannot erase already consumed funding.

Each successful route assesses the existing cumulative 2 bps fee once. The selected
market receives `(carry + fee) / 4` whole insurance atoms; remaining fee atoms go
to T and modulo-four carry persists. Paired quantity/notional, cash debit, both
maker consumption counters, reservations, funding, I/T/carry and critical events
commit atomically. No provider fee or quote/cancel fee is introduced.

Durable orders and existing-position TP/SL retain the four-order/two-protection
bounds. Delegate grants remain root-local trading authority only. The adapter uses
current full-account reservations and generation checks; no positive unpaid-profit
margin credit or sibling-account cash backing is added.

Acceptance is scoped to the new ABI/profile, maker envelopes, affected pure engine
wrapper, independent financial vectors, signed enforcement/rollback, actual
Surfpool HTTP/WS and maximum packet/account/CU measurements. PostgreSQL and service
projection are P27, UI/concurrent qualification P28, ordinary settlement/exits P25
and liquidation/default P26. Prior profile results do not qualify this code.


The first compiled checks exposed oversized validation/event frames, then a
32 KiB heap failure from copied route snapshots. Nested context checks, bounded
allocation and wire-identical borrowed event views address those implementation
limits. Full-book resource checks include all four orders on the trader and both
maker roots, with immediate and permissionless partial execution. Maker binaries
use release size optimization while complete ProgramData hash authentication stays
mandatory. The final qualified candidate stays within the existing transaction
envelope; the evidence report records its exact limits and withheld later gates.
