# P28A — interactive local evaluation

This follow-up packages the qualified schema-3 profile for hands-on use. It does
not reopen P22–P28 financial acceptance or authorize the other proposed follow-ups.
M9 tracks this small local-evaluation milestone separately from closed M8.
[Acceptance evidence](evidence/P28A.md) records the tested revision and limits;
[WORKLOG](WORKLOG.md) owns current review/integration status.

## Contract and acceptance

- Explicit `start`, `status`, `stop`, `reset`; loopback-only RPC/WS, APIs and UI.
- Fresh signed provisioning using the exact P26 program hashes, real Surfpool and
  PostgreSQL, existing maker/funding/order/settlement/risk/executor implementations.
  Fixtures provision state; retained acceptance dumps never configure the runtime.
- The standalone demo wallet is opt-in only for this launcher and origin. Its key
  is generated/stored in the browser tab, never sent by an operator or logged.
  Existing transaction review, explicit signing confirmation, immutable receipts
  and actual chain admission remain mandatory. This is not Phantom qualification.
- A local faucet supplies one SOL and 1,000 test USD per wallet, at most 16 wallets
  per session. It accepts only the configured browser origin and current genesis;
  it cannot sign a user's trade. All collateral/prices/makers are synthetic/internal.
- One disposable PostgreSQL directory; bounded operational logs; a 60-minute lease
  and low-disk shutdown prevent unattended growth. Startup requires more than
  1 GiB free; the running demo stops below 768 MiB free. No deletion of old qualification
  evidence or unrelated `.local` data. Reset removes only this launcher's ended
  runtime DB/config after port checks; session logs/receipts remain separate.
- Demonstrate fresh startup and current source/maker/readiness state, a real browser
  faucet → portfolio → cross/isolated registration → deposit → both-market trades
  → existing-position TP/SL/cancel → allocation/close/withdraw flow. Independently
  fetch original wallet transactions; verify changed cash/positions and reload.
  Check stop releases owned listeners/container, reset changes deployment identity,
  and a second start is idempotent while already running.

Surfpool 1.6.1's SQLite restart probe preserves account balances/history but changes
its genesis and resets its slot clock (actual probe: slot 56 to 1). Therefore an
ended chain is **not resumed or relabelled**. `start` after `stop` refuses the old
runtime; use `reset` to deliberately create a fresh test session. This preserves
SDK deployment authentication. No production durability or endurance is claimed.

## Start and operate

From the repository root, with frozen dependencies, P01 tools and the qualified
`.local/account-safety/` artifacts installed:

```sh
bash ops/demo.sh start
bash ops/demo.sh status
bash ops/demo.sh stop
bash ops/demo.sh reset
```

`start` starts the existing Apple Containers service if necessary, launches the
owned background processes, builds/serves the production UI, and prints its address when ready:
**http://127.0.0.1:18083**. Keep the computer awake/lid open while using it. The
60-minute session lease is a resource bound, not a soak test. `status` reports
source modes, four maker heartbeats, WS subscription, projection health and finite
operator fee budgets. If startup fails, it reports its stage and local log path.
No Docker Desktop installation or external provider/API key is needed.

`stop` ends the chain and stops only owned processes/container. It waits for the
recorded supervisor to exit and all owned ports to release; a control timeout is
not reported as successful cleanup. `reset` deliberately
starts over, with a new venue/mint/genesis; old wallet receipts cannot authorize new
actions. Session logs live in `.local/interactive-demo/sessions/`; only one DB lives
in `.local/interactive-demo/runtime/`. Stop before closing the laptop to avoid an
unexpected clock gap; source recovery still applies after a sleep.

## First walkthrough

1. Open the UI, click **Select Wallet → Rivalt Local Demo → Get test funds**.
   The wallet is local-only. Never transfer real assets to it. Its key stays in
   this browser tab across reloads; closing the tab loses the key. Reset provides
   a fresh session when needed.
2. **Create portfolio**, then **Register account** with Cross selected. For each
   action, review the amounts, click **Sign transaction**, and accept the local
   wallet confirmation. Wait for the original receipt to finalize.
3. Select the test collateral token account, enter **10**, and **Deposit**.
   Funded cash should show 10 test USD; the wallet retains its other test tokens.
4. Trade the default small BTC buy; switch Market to ETH and trade its small buy.
   Both positions use the selected cross account's cash. Limits and all-in fees
   appear in the transaction review; a rejected quote requires a fresh preview.
5. Expand **Protect existing position**, review/sign TP/SL, then **Cancel pair**.
   Prices are fixed synthetic BTC 60,000 / ETH 3,000. This walkthrough demonstrates
   placement/cancellation, not a claim that a stationary price triggers protection.
6. Select an unregistered isolated slot, choose its market before registration,
   register it and deposit 10 test USD. Allocate a small amount to the cross account
   using **Allocate collateral**. An isolated account's market is immutable.
7. Return to Cross. For each held market, select Sell, check Reduce only, retain
   the held default quantity and enter a small minimum proceeds value (0.000001).
   Review/sign the close. Use **Withdraw** to withdraw admissible funded cash.
8. Reload: selected account and saved transaction receipts should return. The
   test wallet reconnects in the same tab. Use `status`, then `stop` when finished.

A flat position can retain an unpaid claim. Gain payment/netting still needs the
current market backing certificate and can be delayed by activity. No automatic
profit guarantee, forced settlement, arbitrary balance edits or safety relaxation
is added. The risk worker probes existing safety paths but has no invented funded
liquidation receiver; forced liquidation/default demos are outside this walkthrough.
P15B/P16B remain external and continuous 24-hour endurance remains Deferred.
