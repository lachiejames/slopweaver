# The listener probe — sweep step 6b, because nothing stands by to tick it

Bundled reference for the `supervisor` skill. Loaded when [sweep-contract.md](sweep-contract.md)'s step 6b
links here, not on every turn.

```bash
slopweaver listen reconcile
```

## Why the sweep runs it, and why a sibling watcher cannot

It is the fleet's only **fate-independent** view of whether the bot can hear anything. The loop runs its
listener as one of its own background tasks. The harness once stopped that session's background
tasks three times and each time took the listener AND a death-watch beside it in the same event, 7–10 ms apart. **A watcher that is a sibling of what it watches cannot report the death that
kills it.**

Three properties make this verb the right shape rather than a second watchdog, and each is checkable:

- **It needs nothing to have been alive at the moment of death.** It back-writes the deaths the arm journal
  implies but nothing recorded, so a pass that runs an hour later still counts them.
- **It never re-arms and never escalates**, so it cannot take the bot down and cannot leave it deliberately
  down. That decision stays with `listen supervise`, in the session that owns the listener.
- **It is idempotent and alert-only**, so running it on every pass costs a line only when it recorded a death
  (MONITORS-ALERT-ONLY).

## The trade, stated rather than buried

It runs **once per supervisor pass**, so with no pass running nothing checks at all. That is the same
"nothing stands by" property `AGENTS.md` rule 2 states, and never a reason to build a standing session to
carry it.

## The one ambiguity it leaves

From `arms.jsonl` alone a deliberate operator stop looks exactly like a reap. It is fixed at the SOURCE
rather than guessed at: **stop a listener with `slopweaver listen disarm` first**, which journals `disarmed`,
and a reconciling pass leaves that arm alone. An operator who skips it gets one arm recorded as `superseded`,
which is the honest reading of what the journal knows. The whole mechanism:
[docs/listener-supervision.md](../../../docs/listener-supervision.md), and this ambiguity
[its journal page](../../../docs/listener-supervision/journal-and-watchdog.md#where-it-runs-and-the-one-ambiguity-it-leaves).
