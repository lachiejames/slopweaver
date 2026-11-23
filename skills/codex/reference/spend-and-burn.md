# What a pass cost, and catching a burn while it happens

The read-only verbs that sit either side of a pass: [`codex usage`](#after-you-spend-read-what-it-cost-and-what-the-last-pass-bought) counts what the recorded ones cost and what each bought, [`codex burn`](#which-model-buys-the-most-passes-per-window) measures how many sessions each model buys per window, and [`codex watch`](#watching-the-burn-while-it-happens) notices an account draining far faster than its own normal. None spends a Codex turn. [The cost judgement itself](when-a-pass-earns-its-cost.md) is the sibling file.

## Before you spend: read what the budget actually is

```bash
slopweaver codex gauge    # the latest rate-limit reading from ONE home, WITH its own age
slopweaver codex route    # every registered destination ranked, and which one new work takes (--full: accounts, stores)
```

**`codex gauge` is not a probe and cannot be.** Codex writes a `rate_limits` object only as a side effect of
running a turn, so there is no way to ask for a fresh reading without spending a real pass — which is why
every line it prints carries the instant Codex OBSERVED it and how many hours ago that was. A reading with no
recent turn behind it means nobody has run Codex lately, never that the account is healthy.

**On an account under the owner's usage limit, a running pass holds one weekly point.** Because no reading moves until a turn
writes one, every pass routed onto a limited account reserves one point of its week in
`$SLOPWEAVER_HOME/live/codex-pass-reservations.json` until it ends, and the next pass counts it: the routed line names
the limit, the live reading and what is already reserved, and a pass that would cross the limit is refused, naming
the reserved points. Not `codex burn`'s per-session figure — one point is settled policy, not a measurement
([routing](../../plans/reference/codex-routing.md)).

## After you spend: read what it cost, and what the last pass bought

```bash
slopweaver codex usage                        # every recorded pass, per arm, with its token subtotal
slopweaver codex usage --diff-sha256 <sha>    # and: which invocation the NEXT review on that diff would be
```

**A pass nobody measured is COUNTED, never summed as zero.** An abort at the bound produces no `Turn`, so no
usage object ever existed, and adding those in as zeros understates spend silently by an amount nobody can
bound. `codex usage` reports the fraction it measured — on the author's main checkout, 18 of 48 passes — and
prints a pass kind's tokens as a FLOOR whenever any of them is partial or unmeasured. Every arm gets a row
including the ones that never ran, because a table of what happened cannot show an absence.

**There are no dollars unless you supply a rate card.** This repository holds no Codex tariff and will not
invent one — `--rates <path>` names an installation card, the card declares who verified how the SDK's five
counters overlap, and a card that cannot fill that in prices nothing rather than double-billing. Without one
the report carries token counts and says so.

**`--diff-sha256` is the marginal reading, and it is VISIBILITY rather than a heuristic.** It cannot refuse a
pass and returns no recommendation. It prints which invocation on that diff the next review would be, what
each earlier one found, and what that ordinal has historically found across OTHER diffs in the checkout — so
"is a sixth review pass on this diff worth its tokens" is answered against counts. Two things it is careful
about: the ordinal counts INVOCATIONS and is not the arm number (ordinal 3 is often the third arm), and a second
BROKEN may repeat the first rather than add to it, which the record schema cannot tell apart.

## Which model buys the most passes per window

```bash
slopweaver codex burn               # every registered Codex home, files modified within 21 days of its newest
slopweaver codex burn --days 7 --json
```

Reads each destination's rollout logs — the model and effort from each session's first `turn_context`, the
weekly and five-hour `used_percent` from its `token_count` events — and prints, per model, effort and plan
type, how many sessions one whole window buys. It is the evidence behind the default model (move the default on a
number, not a guess). Measured on the ambient home, on the same plan:
`gpt-5.6-sol` at `xhigh` bought 443 sessions per week, `gpt-6-astra` at `medium` 219.

**How a draw is counted**: each window (one `resets_at`) is its own timeline, its first reading a baseline, and
every rise above the window's high-water mark is credited to the session whose reading closed it. Concurrent
sessions blur WHICH one drew a point, never the total. A window the group never read prints `not read` and a rate with nothing drawn prints `—`, never zero: these plans' rollouts carry no five-hour window at all. The rules and their measurements: `src/codex/modelBurn.ts`.

## Watching the burn while it happens

```bash
slopweaver codex watch --once --dry-run   # read and report; writes nothing, opens nothing
slopweaver codex watch --once             # records what it has not seen; still never opens anything
slopweaver codex watch                    # foreground, recurring — the only mode that may investigate
```

Samples Codex's own rate-limit log, judges the pace against **this account's own measured normal**, and on a
genuine anomaly opens ONE visible Opus session pointed at the evidence. It is foreground only and Ctrl-C
stops it — rule 2, not a limitation.

**A quiet report is never a claim that consumption is ordinary.** `WARMING` (not enough history yet) and
`INSUFFICIENT-COVERAGE` (enough history, too sparse inside it) are verdicts in their own right, and only
`ANOMALY` can open anything. The first line always names which.

**At most one automatic attempt, never exactly one opened workspace.** The suppression is an atomic exclusive
file create, so two watches ticking in the same instant are settled by the kernel rather than by a
read-then-append check both would pass. A claim survives a crash and a FAILED spawn on purpose: a failure is
not a reason to try again automatically, and clearing a stale claim is a human act. A spawn that named a
workspace and then failed reports `AMBIGUOUS` rather than `failed`, because there may be a live workspace to
go and close.
