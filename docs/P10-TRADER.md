# P10 trading UI and direct user recovery

Implemented for the explicit local test deployment. P09/G08–G10 are verified on the stacked baseline; [P10 evidence](evidence/P10.md) records passing browser/direct-exit acceptance. WORKLOG owns Review/integration status.

## User and signing boundary

React/Vite and wallet-adapter 3.1.1 discover Wallet Standard accounts. Public configuration binds local RPC/WS, genesis, market/domain, classic six-decimal test mint and the finalized initialization transaction. A reset, foreign account owner, wrong genesis, unsupported profile or inconsistent cohort/vault blocks transaction preparation. The browser holds no private key.

The SDK reads a common finalized bank, evaluates quantities and money with bigint, and exposes the same labeled balance calculation used by the indexer. Positive unpaid profit has zero margin credit. Displayed exit capacity is a conservative preview: the real cohort check, source rules and post-action margin remain authoritative.

Quotes are rebuilt from canonical clearing/maker accounts and independently evaluated A/B prices. Exact side/size, fee, limit, epochs, nonce, generation, instruction bytes and account roles must agree before signing. The user sees the split, all-in amount, venue fee and separate network fee. Wallet account/chain changes invalidate pending previews. Returned signed messages must match the reviewed message and verify cryptographically.

Signed bytes, signature and lifetime are saved before broadcast. Confirmed and finalized statuses are distinct; finalized success requires independently fetched exact signed bytes and consistent successful metadata. Missing or expired history remains unresolved. A retry sends the same signed bytes, never an automatic replacement signature or duplicate deposit.

## Direct exit and unavailable services

Cancellation uses owner/market/participant authority directly over RPC and does not depend on sources, makers or venue HTTP APIs. Withdrawal and funded gain settlement use the exact current cohort certificate and normal program checks. Cohort checking takes explicit preceding verification transactions of up to eight members; intervening market/source changes require a fresh preview. There is no bypass of frozen/default or margin restrictions and no promise of an unconditional withdrawal.

Indexed fills/candles and service heartbeats have explicit unavailable states. Direct RPC balances, cancellation and admissible withdrawal remain available when the venue API processes are stopped. Candles derive only from actual finalized route fills and leave no-trade intervals empty. Index, risk interval, funding and last fill are separately labeled.

## Acceptance contract

Real browser signing through Wallet Standard, deposits, split/open/close, unpaid-versus-cash, funded settlement, withdrawal, durable order partial/cancel/replace, existing-position TP/SL/generation, wallet rejection/account/cluster changes, stale quotes, ambiguous acknowledgement/reload and API-stopped direct cancel/withdraw. All successful effects must be fetched from deployed Surfpool and reconcile with PostgreSQL/indexer state. Instrumented local wallet fixtures establish browser integration, not independent external wallet-provider or devnet acceptance.

Responsive/accessibility checks cover 375/768/1280 widths, keyboard/focus, loading/empty/error states, amount precision and screenshots. Actual results and exact tooling identities belong in WORKLOG/evidence.

## Run and recover directly

For manual exploration on the prepared local workspace, run:

```sh
source ops/env.sh
pnpm demo:trader
```

This provisions fresh Surfpool/PostgreSQL and real service workers using the existing built binaries/UI, then opens a separate visible Chrome window at `http://127.0.0.1:18084`. It connects **Rivalt Test Wallet**, with 100 test USD already deposited and another 50 test USD in its collateral token account. Its keys stay in the local Node fixture; only the opened browser context receives the test-wallet adapter. An ordinary browser can view that URL, but does not inherit this wallet. External wallet-provider/devnet compatibility remains a separate gate.

Try a small deposit, then buy `0.0001` BTC with **Get quote**, inspect the maker legs/2 bps fee and select **Sign transaction**. The local fixture signs after this application review; it does not open a real-wallet extension approval. Wait for the finalized receipt before selling the same size. Existing-position TP/SL, limits/stops, eligible settlement and direct withdrawal are also available. Quotes may expire during review; request a fresh quote when the UI reports it. The chart starts empty and fills only from actual executed trades. No trade loop or fault injection runs in this mode.

Close the demo tab/window or press Ctrl-C in its terminal to stop the owned session. The default time limit is 60 minutes; `pnpm demo:trader --minutes 120` selects up to two hours. The current URL, PID and expiry are in `.local/trader-demo.json`. Each launch resets to a new test deployment; keep it running while testing. This is an interactive demo, not soak or acceptance evidence. If built artifacts are absent, use the existing documented build steps first; the demo does not silently rerun builds or regression suites.

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

Direct submission uses the same transport policy as the durable relay: simulate the unsigned reviewed message, verify and persist the returned signed bytes, then send them with `skipPreflight:true` and no automatic RPC retries. Program/signature validation still occurs on chain; a stale action may land as failed and incur the displayed network fee. This avoids a second RPC preflight turning a known signed race into an absent-history outcome. It does not guarantee inclusion; absent/expired history remains unresolved.

The declared full integrated acceptance cadence is 50 ms. Local deployment and upgrade provisioning allow at most 20 CLI blockhash signing attempts, retaining exact program/buffer bytes. This does not change financial submission retry rules. A standalone browser run passes at 100 ms, but that cadence is not accepted for the whole suite: sequential manual source publication and sample finalization can exceed the six-second recovery-gap policy, correctly leaving the market restrictive.


D35: quote review explicitly uses and labels a confirmed provisional snapshot. Independent client reconstruction validates the same commitment and all existing route constraints; displayed finalized account balances, direct exits and transaction-success reporting keep their prior finality rules. A forked or stale preview can reject on chain and is never automatically re-signed.
