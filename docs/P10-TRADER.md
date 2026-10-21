# P10 trading UI and direct user recovery

Implementation in progress. P09/G08–G10 are verified on the stacked baseline; browser acceptance is still required. Only the explicit local test deployment is supported in this phase.

## User and signing boundary

React/Vite and wallet-adapter 3.1.1 discover Wallet Standard accounts. Public configuration binds local RPC/WS, genesis, market/domain, classic six-decimal test mint and the finalized initialization transaction. A reset, foreign account owner, wrong genesis, unsupported profile or inconsistent cohort/vault blocks transaction preparation. The browser holds no private key.

The SDK reads a common finalized bank, evaluates quantities and money with bigint, and exposes the same labeled balance calculation used by the indexer. Positive unpaid profit has zero margin credit. Displayed exit capacity is a conservative preview: the real cohort check, source rules and post-action margin remain authoritative.

Quotes are rebuilt from canonical clearing/maker accounts and independently evaluated A/B prices. Exact side/size, fee, limit, epochs, nonce, generation, instruction bytes and account roles must agree before signing. The user sees the split, all-in amount, venue fee and separate network fee. Wallet account/chain changes invalidate pending previews. Returned signed messages must match the reviewed message and verify cryptographically.

Signed bytes, signature and lifetime are saved before broadcast. Confirmed and finalized statuses are distinct; finalized success requires independently fetched exact signed bytes and consistent successful metadata. Missing or expired history remains unresolved. A retry sends the same signed bytes, never an automatic replacement signature or duplicate deposit.

## Direct exit and unavailable services

Cancellation uses owner/market/participant authority directly over RPC and does not depend on sources, makers or venue HTTP APIs. Withdrawal and funded gain settlement use the exact current cohort certificate and normal program checks. Cohort checking takes explicit preceding verification transactions of up to eight members; intervening market/source changes require a fresh preview. There is no bypass of frozen/default or margin restrictions and no promise of an unconditional withdrawal.

Indexed fills/candles and service heartbeats have explicit unavailable states. Direct RPC balances, cancellation and admissible withdrawal remain available when the venue API processes are stopped. Candles derive only from actual finalized route fills and leave no-trade intervals empty. Index, risk interval, funding and last fill are separately labeled.

## Acceptance still required

Real browser signing through Wallet Standard, deposits, split/open/close, unpaid-versus-cash, funded settlement, withdrawal, durable order partial/cancel/replace, existing-position TP/SL/generation, wallet rejection/account/cluster changes, stale quotes, ambiguous acknowledgement/reload and API-stopped direct cancel/withdraw. All successful effects must be fetched from deployed Surfpool and reconcile with PostgreSQL/indexer state. Instrumented local wallet fixtures establish browser integration, not independent external wallet-provider or devnet acceptance.

Responsive/accessibility checks cover 375/768/1280 widths, keyboard/focus, loading/empty/error states, amount precision and screenshots. Actual results and exact tooling identities belong in WORKLOG/evidence.

## Run and recover directly

After the pinned bootstrap/build in README, `pnpm build:trader && pnpm test:browser` starts fresh isolated Surfpool, PostgreSQL, the real service workers, read API and the production Vite preview. It uses the existing Chrome executable at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Playwright core is pinned to 1.64.1; React/react-dom and types are 19.3.0, Vite 7.3.7 and wallet-adapter 3.1.1. No browser binary is downloaded. The supervisor refuses occupied ports 18899/18900, 15432 and 18081/18083/18084, then stops only the processes and container it started. Full `pnpm smoke` includes this harness after the inherited checks.

For a running provisioned local deployment, set `RIVALT_TRADER_CONFIG` to its absolute public JSON path and run `pnpm trader`. Configuration contains version `1`, chain `solana:localnet`, local RPC/WS URLs, genesis hash, finalized initialization signature `anchor`, canonical market, mint and 32-byte hexadecimal domain. These values must come from the actual deployment. The server exposes only these public fields, plus fixed same-origin API prefixes. API/read proxies default to 18081/18084; no signer or database credential belongs in this file. Production builds still require a host to serve that public configuration and those API prefixes; the Vite preview supplies the local acceptance host.

Connect a Wallet Standard account supporting localnet and v0 signing. `Cancel via RPC` rebuilds the current order ID/version from chain state. `Withdraw via RPC` checks the full cohort and post-action margin before the wallet prompt. Any incomplete cohort certificate exposes explicit `Verify exit cohort` transactions before the final exit. Solana promotes writability across a transaction message, so a read-only cohort proof containing the exiting account cannot share a message with that account’s cash mutation. Each proof and the exit requires its own reviewed wallet signature. Neither action uses the venue relay. `Settle profit via RPC` converts only funded eligible whole-atom claims to cash. The SDK entry points are `UserClient.snapshot`, `user`, `exitInstructions`, `prepare`, `signed`, `broadcast` and `reconcile`; all monetary inputs are bigint.

An unsigned preview can be discarded. A signed transaction is persisted before sending and remains visible through reloads. `Resend identical bytes via RPC` verifies its saved signature/message and checks the original outcome/lifetime first. Expired unknown outcomes remain unresolved and block repeating the same action label; the UI never silently creates a fresh signature. A slow polling response cannot erase a newly saved receipt. Wallet keys remain in the provider; the instrumented acceptance wallet holds its keys only in the Node fixture.

## Display and read contract

Money and BTC use exact decimal parsing and bigint formatting. One BTC is 1,000,000 lots; one test collateral token is 1,000,000 atoms; unpaid P&L is scaled by another 1,000,000,000. Thus an atom/lot price has the same numeric label as test USD/BTC. Chart coordinates alone are normalized to pixels; prices, OHLC comparisons and accessible table labels remain rational/integer values. This UI deliberately restricts immediate routes and order input to at most 0.001 BTC in the local engineering profile.

Read envelopes now include the initialization/genesis/domain deployment binding. `/v1/trades` and `/v1/events` optionally accept `latest=true` with the existing bounded limit, returning the latest window in ascending sequence order and `next:null`. Combining `latest` with `after` rejects. Existing forward pagination is unchanged. The UI validates the deployment binding before showing fills; unavailable APIs are explicitly marked and never replace RPC balances with fabricated data.

The temporary neutral theme is recorded in `brand.md`; no final brand selection is attributed to the user. The UI includes responsive tables, labeled inputs, focus indicators, a modal review with focus return, reduced-motion support and light/dark themes. The local wallet fixture does not establish external wallet-provider or devnet compatibility; P14 owns those checks.

The browser acceptance worker uses an explicit five-second funding discovery cadence (`RIVALT_FUNDING_INTERVAL_SECONDS=5`). The service default remains two seconds and accepts only 2–5. This is scheduling within the existing on-chain minimum/held-funding/source rules; it does not change source deadlines, qualification, prices or economic authority. The fifth-second profile leaves review time between local samples. Real unsigned quote rejections are recorded and may be retried by pressing Get quote again; signed requests are never replaced automatically.

Development RPC captures found Surfpool returning a new risk account while the response’s reported finalized context slot was still below `validFrom`. The same existing eligibility checks reject that inconsistent preview; no source check is bypassed. RPC account views remain previews requested at finalized commitment, while receipt finality requires exact transaction/history agreement. This local provider behavior is recorded explicitly and cannot establish real-cluster parity.

A definitively failed finalized transaction is distinct from an ambiguous outcome. The UI displays the failed receipt and its actual network fee; a user may explicitly prepare and sign a fresh action after reviewing that result. Browser acceptance records any such race, independently fetches the failed transaction and compares the actual vault/funded participants before modeling the explicit retry. It never substitutes a new signature for missing or inconclusive history.
